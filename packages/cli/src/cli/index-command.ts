import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname, isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { compareCodepoint } from '../core/compare-codepoint.js';
import { ContentHasher } from '../core/staleness/content-hasher.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { loadPlugins } from './plugin-loader.js';
import { InstallCommand } from './install-command.js';
import { changeLogSize, writeCoChangeMatrix } from './index-cochange.js';
import {
  loadConfig,
  indexIgnorePatterns,
  indexIgnoreProjectPatterns,
  makeGlobMatcher,
  resolveCoChangeConfig,
} from '../core/config/load-config.js';
import type { CtxoConfig } from '../core/config/config-schema.js';
import {
  detectLanguages,
  decideNeededLanguages,
  officialPluginFor,
  EXTENSION_LANGUAGE,
  type KnownLanguage,
} from '../core/detection/detect-languages.js';

const requireCjs = createRequire(import.meta.url);
import { JsonIndexWriter } from '../adapters/storage/json-index-writer.js';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { SqliteStorageAdapter } from '../adapters/storage/sqlite-storage-adapter.js';
import { SchemaManager } from '../adapters/storage/schema-manager.js';
import { ArchitectureArtifactsWriter } from '../adapters/storage/architecture-artifacts-writer.js';
import { CommunitySnapshotWriter } from '../adapters/storage/community-snapshot-writer.js';
import { SimpleGitAdapter } from '../adapters/git/simple-git-adapter.js';
import { RevertDetector } from '../core/why-context/revert-detector.js';
import { canonicalizeChangeLog } from '../core/history/change-log.js';
import { buildIntentHistory } from '../core/history/intent-history.js';
import { CommunityDetector } from '../core/overlay/community-detector.js';
import { DriftDetector } from '../core/overlay/drift-detector.js';
import { BoundaryViolationDetector } from '../core/overlay/boundary-violation-detector.js';
import { SymbolGraph } from '../core/graph/symbol-graph.js';
import { PageRankCalculator } from '../core/importance/pagerank-calculator.js';
import type {
  BoundaryViolationsArtifact,
  CommunitySnapshot,
  DriftEventsArtifact,
  EdgeQuality,
  FileChange,
  FileIndex,
  SymbolKind,
} from '../core/types.js';

interface TsMorphLike {
  loadProjectSources(sources: Map<string, string>): void;
  clearProjectSources(): void;
}

interface RoslynLike {
  isReady(): boolean;
  batchIndex(): Promise<void>;
  startKeepAlive(): Promise<boolean>;
  reindexFile(relativePath: string): Promise<{
    symbols: Array<{ symbolId: string; name: string; kind: string; startLine: number; endLine: number }>;
    edges: Array<{ from: string; to: string; kind: string }>;
    complexity: Array<{ symbolId: string; cyclomatic: number }>;
  } | null>;
  dispose(): Promise<void>;
}

interface CSharpCompositeLike {
  getRoslynDelegate(): RoslynLike | null;
  getTier(): 'full' | 'syntax' | 'unavailable';
}

interface GoCompositeLike {
  getTier(): 'full' | 'syntax' | 'unavailable';
}

interface JavaCompositeLike {
  getTier(): 'full' | 'syntax' | 'unavailable';
}

export class IndexCommand {
  private readonly projectRoot: string;
  ctxoRoot: string;
  private supportedExtensions: Set<string>;

  constructor(projectRoot: string, ctxoRoot?: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = ctxoRoot ?? join(projectRoot, '.ctxo');
    this.supportedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.go', '.cs']);
  }

  private loadIgnoreConfig(): {
    /** The whole loaded config, so the run reads `.ctxo/config.yaml` (and warns about it) once. */
    config: CtxoConfig;
    ignoreFile: (p: string) => boolean;
    ignoreProject: (p: string) => boolean;
    ignoreProjectPatterns: string[];
  } {
    const { config } = loadConfig(this.ctxoRoot);
    const filePatterns = indexIgnorePatterns(config);
    const projectPatterns = indexIgnoreProjectPatterns(config);
    if (filePatterns.length > 0) {
      console.error(`[ctxo] index.ignore: ${filePatterns.length} pattern(s) active`);
    }
    if (projectPatterns.length > 0) {
      console.error(`[ctxo] index.ignoreProjects: ${projectPatterns.length} pattern(s) active`);
    }
    return {
      config,
      ignoreFile: makeGlobMatcher(filePatterns),
      ignoreProject: makeGlobMatcher(projectPatterns),
      ignoreProjectPatterns: projectPatterns,
    };
  }

  async run(options: {
    /** One repo-relative path to re-index: the older spelling of `files: [file]` (`--file`). */
    file?: string;
    /**
     * Repo-relative paths to re-index (`--files`). An incremental run: the other files keep their
     * committed entries, and everything global (registry, co-change, communities, artifacts, SQLite)
     * is computed from the merged index, not from these files alone.
     */
    files?: string[];
    /**
     * Re-index the files changed by this commit and drop the ones it deleted or renamed away
     * (`--commit`). Meant for the commit just made, which is what the post-commit hook runs on. A merge
     * commit lists no files, so nothing is re-indexed, but the global products are still refreshed.
     */
    commit?: string;
    check?: boolean;
    skipSideEffects?: boolean;
    skipHistory?: boolean;
    skipCommunity?: boolean;
    /** Commits of history kept per file in `intent[]`. Does not affect the co-change window. */
    maxHistory?: number;
    /** Co-change window in commits (`--cochange-commits`); overrides `cochange.maxCommits`. */
    cochangeCommits?: number | 'all';
    /** Co-change window by age, counted back from HEAD (`--cochange-since`); overrides `cochange.since`. */
    cochangeSince?: string;
    installMissing?: boolean;
  } = {}): Promise<void> {
    if (options.check) {
      // Delegate to verify logic: hash-based freshness check
      return this.runCheck();
    }

    // Pre-index: detect missing plugins and optionally auto-install
    if (options.installMissing) {
      await this.autoInstallMissingPlugins();
    }

    const ignore = this.loadIgnoreConfig();
    const gitAdapter = new SimpleGitAdapter(this.projectRoot);

    // An incremental run is selected by paths (--files, --file), by a commit (--commit), or both.
    const incremental = options.files !== undefined || options.commit !== undefined || Boolean(options.file);
    // The commit is read before anything heavy starts, so a revision git cannot resolve fails at once,
    // without a plugin having been loaded.
    const commitChanges = options.commit !== undefined ? await readCommitChanges(gitAdapter, options.commit) : [];

    // Set up adapters via plugin discovery (TS, Go, C# all plugin-backed)
    const registry = new LanguageAdapterRegistry();
    const { tsMorphLike, roslynAdapter, csharpTier, goTier, javaTier } = await this.registerDiscoveredPlugins(registry, ignore.ignoreProjectPatterns);
    this.supportedExtensions = registry.getSupportedExtensions();

    // Emit a language-aware pre-scan so users see the plan before the work runs
    this.printLanguagePreview();

    const writer = new JsonIndexWriter(this.ctxoRoot);
    const schemaManager = new SchemaManager(this.ctxoRoot);
    const hasher = new ContentHasher();
    const revertDetector = new RevertDetector();

    // The committed JSON index, read at most once per run, and before this run writes anything. An
    // incremental run needs it for the entries it removes, the symbol registry and the merged index; a full
    // run for the co-change file set and for pruning the entries that went stale. Each entry keeps the path
    // of the JSON file it came from: removing an entry deletes that file, never one named by the entry's
    // own `file` field, which a corrupt or crafted file can point at an artifact.
    let committed: { indices: FileIndex[]; jsonPaths: Map<string, string[]> } | undefined;
    const readCommitted = (): { indices: FileIndex[]; jsonPaths: Map<string, string[]> } => {
      if (committed === undefined) {
        const entries = new JsonIndexReader(this.ctxoRoot).readEntries();
        const jsonPaths = new Map<string, string[]>();
        for (const { path, index } of entries) jsonPaths.set(index.file, [...(jsonPaths.get(index.file) ?? []), path]);
        committed = { indices: entries.map((entry) => entry.index), jsonPaths };
      }
      return committed;
    };
    const committedIndex = (): FileIndex[] => readCommitted().indices;

    // Monorepo workspaces: the folders a full run discovers files in, and the ones index.ignoreProjects
    // leaves out. A file that the project configuration excludes from the index matches index.ignore or
    // lies inside one of those ignored workspaces.
    const workspaces = this.discoverWorkspaces(ignore.ignoreProject);
    const isIgnored = (path: string): boolean =>
      ignore.ignoreFile(path) ||
      workspaces.ignored.some((workspace) => isInsideDirectory(workspace, join(this.projectRoot, path)));

    // Discover files (an explicit selection, monorepo workspaces, or the full project)
    let files: string[];
    // Files of the committed index that this run drops: deleted, renamed away, or gone from the working tree.
    let removedPaths: ReadonlySet<string> = new Set();
    if (incremental) {
      const selection = await this.selectIncrementalFiles(
        [...(options.files ?? []), ...(options.file ? [options.file] : [])],
        commitChanges,
        registry,
        ignore.ignoreFile,
        workspaces.kept,
        new Set(committedIndex().map((idx) => idx.file)),
        gitAdapter,
      );
      files = selection.changed.map((path) => join(this.projectRoot, path));
      removedPaths = new Set(selection.removed);
      console.error(
        `[ctxo] Incremental re-index: ${selection.changed.length} file(s) to index, ${selection.removed.length} to remove` +
          (options.commit !== undefined ? ` (commit ${options.commit})` : ''),
      );
    } else {
      // Discover files across all workspace roots (the project root itself outside a monorepo)
      files = [];
      for (const ws of workspaces.kept) {
        const wsFiles = this.discoverFilesIn(ws, ignore.ignoreFile);
        files.push(...wsFiles);
      }
      console.error(`[ctxo] Building codebase index... Found ${files.length} source files`);
    }

    // Pre-Phase 0: sweep orphan .<pid>.tmp files from a previous interrupted write.
    try {
      const { sweepStaleTmpFiles } = await import('../adapters/storage/atomic-write.js');
      const swept = sweepStaleTmpFiles(join(this.ctxoRoot, 'index'));
      if (swept > 0) {
        console.error(`[ctxo] Cleaned ${swept} orphan .tmp file(s) from previous interrupted run`);
      }
    } catch {
      /* non-fatal */
    }

    // Phase 0: Roslyn batch index (if available, pre-caches all C# results)
    if (roslynAdapter?.isReady()) {
      const hasCsFiles = files.some(f => f.endsWith('.cs'));
      if (hasCsFiles) {
        await roslynAdapter.batchIndex();
      }
    }

    // Phase 1a: Extract symbols (CPU-bound, builds symbol registry for edge resolution)
    const symbolRegistry = new Map<string, SymbolKind>();
    const pendingIndices: Array<{
      relativePath: string;
      source: string;
      fileIndex: FileIndex;
    }> = [];
    let processed = 0;

    for (const filePath of files) {
      const adapter = registry.getAdapter(filePath);
      if (!adapter) continue;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');

      try {
        const source = readFileSync(filePath, 'utf-8');
        const lastModified = Math.floor(Date.now() / 1000);

        const symbols = await adapter.extractSymbols(relativePath, source);
        const complexity = await adapter.extractComplexity(relativePath, source);

        // Build symbol registry for accurate edge resolution
        for (const sym of symbols) {
          symbolRegistry.set(sym.symbolId, sym.kind);
        }

        pendingIndices.push({
          relativePath,
          source,
          fileIndex: {
            file: relativePath,
            lastModified,
            contentHash: hasher.hash(source),
            symbols,
            edges: [],
            complexity,
            intent: [],
            antiPatterns: [],
          },
        });

        processed++;
        if (processed % 50 === 0) {
          console.error(`[ctxo] Processed ${processed}/${files.length} files (symbols)`);
        }
      } catch (err) {
        console.error(`[ctxo] Skipped ${relativePath}: ${(err as Error).message}`);
      }
    }

    // An incremental run extracts edges for a few files, but those files refer to symbols defined in all
    // the others. Their kinds come from the committed index, minus the entries this run replaces or
    // removes, so a reference resolves to the same kind as in a full run.
    if (incremental) {
      const replaced = new Set<string>(removedPaths);
      for (const { relativePath } of pendingIndices) replaced.add(relativePath);
      for (const idx of committedIndex()) {
        if (replaced.has(idx.file)) continue;
        for (const symbol of idx.symbols) symbolRegistry.set(symbol.symbolId, symbol.kind);
      }
    }

    // Pre-load all sources into ts-morph for cross-file resolution
    const allSources = new Map<string, string>();
    for (const entry of pendingIndices) {
      allSources.set(entry.relativePath, entry.source);
    }
    tsMorphLike?.loadProjectSources(allSources);

    // Phase 1b: Extract edges (uses symbol registry for correct kind resolution)
    for (const entry of pendingIndices) {
      const adapter = registry.getAdapter(entry.relativePath);
      if (!adapter) continue;

      try {
        adapter.setSymbolRegistry?.(symbolRegistry);
        entry.fileIndex.edges = await adapter.extractEdges(entry.relativePath, entry.source);
      } catch (err) {
        console.error(`[ctxo] Edge extraction failed for ${entry.relativePath}: ${(err as Error).message}`);
      }
    }

    // Clean up pre-loaded sources
    tsMorphLike?.clearProjectSources();

    // The index that the co-change file set, community detection, the architecture artifacts and the SQLite
    // cache are all built from, assembled at most once per run. A full run indexed every file it discovers,
    // so those files are the project; an incremental run re-indexed a few, so the rest comes from the
    // committed index (minus the removed files).
    let graphInputIndices: FileIndex[] | undefined;
    const graphInput = (): FileIndex[] =>
      (graphInputIndices ??= this.buildGraphInputIndices(
        pendingIndices,
        incremental ? { committed: committedIndex(), removedPaths } : undefined,
      ));

    // The files the co-change matrix is computed for. The matrix is committed and shared, so it must not
    // depend on which language plugins this machine has loaded: it covers the files indexed in this run and
    // every file the committed index already holds that the project configuration does not exclude (the
    // co-change step drops the ones whose source is gone). A file that only a missing plugin keeps this
    // machine from indexing therefore still takes part. An incremental run follows the same rule, minus the
    // files it removes, so its matrix equals the one a full run writes for the same HEAD.
    const coChangeFiles = (): string[] => {
      const files = new Set(pendingIndices.map(({ fileIndex }) => fileIndex.file));
      for (const { file } of committedIndex()) {
        if (!removedPaths.has(file) && !isIgnored(file)) files.add(file);
      }
      return [...files];
    };

    // A full run also prunes the index entries that went stale: the source file is gone from the working
    // tree, or index.ignore / index.ignoreProjects now excludes it. Left in place they would come back into
    // the merged index of the next incremental run. An entry of a file that exists and is not excluded is
    // never pruned, even when no plugin loaded here handles it: another machine may have indexed it. Nor is
    // the entry of a path that git tracks but marks skip-worktree (a sparse checkout).
    const stalePaths = incremental
      ? []
      : await this.withoutSkipWorktree(
          this.findStaleEntries(committedIndex(), new Set(pendingIndices.map(({ fileIndex }) => fileIndex.file)), isIgnored),
          gitAdapter,
        );

    // The committed entries that are still there once the stale ones are pruned (an incremental run prunes none).
    const survivingEntries = new Set(committedIndex().map((idx) => idx.file)).size - new Set(stalePaths).size;

    // The snapshot and the architecture artifacts are rebuilt whenever the run changed the index. A --commit
    // run rebuilds them even when it re-indexed no file: a merge commit lists none, and a commit that only
    // touched documents still moves HEAD, which the snapshot records. A --files run that selected nothing
    // has nothing to rebuild. A full run that only pruned rebuilds them only when no entry survives, because
    // then the project really is empty: with entries left, a run that discovered nothing (no language plugin
    // loaded here, say right after a clone) would replace the committed snapshot with an empty one.
    const refreshProducts =
      pendingIndices.length > 0 ||
      removedPaths.size > 0 ||
      options.commit !== undefined ||
      (stalePaths.length > 0 && survivingEntries === 0);

    // Co-change is built from git history and the committed entries, not from what this run discovered, so
    // it also follows a run that only pruned.
    const refreshCoChange = refreshProducts || stalePaths.length > 0;

    if (!incremental && pendingIndices.length === 0 && survivingEntries > 0) {
      console.error(
        registry.getSupportedExtensions().size === 0
          ? '[ctxo] No language plugin is loaded, so no file was indexed. Run `ctxo install` (or `ctxo index --install-missing`). ' +
              'communities.json, its history and the architecture artifacts were left as they are'
          : '[ctxo] No source file was indexed. communities.json, its history and the architecture artifacts were left as they are',
      );
    }

    // Phases 2 and 2b: one git pass (the change log) feeds both the per-file intent[] and the
    // co-change matrix of the whole repository. The co-change window comes from `cochange.*` in
    // config.yaml and `--cochange-*`; `--max-history` only sets how much history each file keeps.
    // Non-fatal like phases 2c and 2d: an unexpected failure here must not stop the index from
    // being written, and co-changes.json is only ever replaced by a complete matrix.
    if (!options.skipHistory && refreshCoChange) {
      try {
        const coChange = resolveCoChangeConfig(ignore.config, {
          maxCommits: options.cochangeCommits,
          since: options.cochangeSince,
        });
        const maxHistory = options.maxHistory ?? 20;
        const changeLog = await gitAdapter.getChangeLog(changeLogSize(coChange.maxCommits, maxHistory));

        if (changeLog === undefined) {
          // git failed, is missing, or the repository has no commit yet. intent[] stays empty, as it
          // did when the old batch read failed, and co-changes.json is left alone: a failing git call
          // must never replace a good matrix with an empty one.
          console.error('[ctxo] Git history unavailable: intent[] left empty and co-changes.json not updated');
        } else {
          // Renames are resolved once; intent[] and the co-change matrix share the result.
          const commits = canonicalizeChangeLog(changeLog.commits);

          // Phase 2: intent[] and antiPatterns of the files indexed in this run
          const history = buildIntentHistory(commits, maxHistory);
          for (const { relativePath, fileIndex } of pendingIndices) {
            const fileCommits = history.get(relativePath) ?? [];
            fileIndex.intent = fileCommits.map((c) => ({
              hash: c.hash,
              message: c.message,
              date: c.date,
              kind: 'commit' as const,
            }));
            fileIndex.antiPatterns = revertDetector.detect(fileCommits);
          }

          // Phase 2b: the co-change matrix of the whole repository, whichever files this run re-indexes.
          writeCoChangeMatrix({
            writer,
            projectRoot: this.projectRoot,
            commits,
            head: changeLog.head,
            headCommittedAt: changeLog.headCommittedAt,
            coChange,
            indexedFiles: coChangeFiles(),
          });
        }
      } catch (err) {
        console.error(`[ctxo] History and co-change skipped: ${(err as Error).message}`);
      }
    }

    // Phase 2c: Community detection + snapshot
    //
    // Full indexing:    run Louvain over the files this run indexed (all of the project).
    // Incremental (--files, --commit): the merged index, so Louvain sees the *complete* graph:
    //                       the just-updated fileIndex(es) spliced into the rest of the committed JSON
    //                       index, minus the removed files. Running it over the few updated files alone
    //                       would produce a meaningless N-singleton snapshot (modularity 0).
    // Opt-out (--skip-community): skip entirely. Warn if a stale snapshot exists on disk.
    let communitySnapshot: CommunitySnapshot | undefined;

    if (options.skipCommunity && refreshProducts) {
      if (existsSync(join(this.ctxoRoot, 'index', 'communities.json'))) {
        console.error(
          `[ctxo] WARN stale communities.json present — --skip-community preserved existing snapshot. Run \`ctxo index\` (full) to refresh.`,
        );
      }
    } else if (refreshProducts) {
      try {
        const graphIndices = graphInput();
        communitySnapshot = await this.buildCommunitySnapshot(
          graphIndices,
          {
            csharpTier,
            goTier,
            javaTier,
            tsCount: graphIndices.filter((idx) => /\.(ts|tsx|js|jsx)$/.test(idx.file)).length,
          },
          gitAdapter,
        );
        const scope = incremental ? ' (incremental, full-graph recompute)' : '';
        console.error(
          `[ctxo] Community detection${scope}: ${countCommunities(communitySnapshot)} clusters (modularity ${communitySnapshot.modularity.toFixed(3)})`,
        );
      } catch (err) {
        console.error(`[ctxo] Community detection skipped: ${(err as Error).message}`);
      }
    }

    // Phase 3: Write all indices
    // What the index holds after this run is assembled first: both an incremental run and a full run read the
    // committed JSON as it was before this run wrote anything.
    const indexed = graphInput();

    // Removed and stale files leave the index before the new entries are written. On a case-insensitive file
    // system a case-only rename names one JSON file twice, so deleting afterwards would take the entry just
    // written for the new name. The JSON file deleted is the one the entry was read from. A file that cannot
    // be deleted is reported and the run goes on, since the index this run builds its products from already
    // leaves it out. Returns true only when a file was really deleted.
    const deleteEntry = (file: string): boolean => {
      let deleted = false;
      for (const jsonPath of readCommitted().jsonPaths.get(file) ?? []) {
        try {
          if (writer.deleteEntryFile(jsonPath)) deleted = true;
        } catch (err) {
          console.error(`[ctxo] Could not remove ${file} from the index: ${(err as Error).message}`);
        }
      }
      return deleted;
    };
    for (const file of removedPaths) deleteEntry(file);
    const pruned = [...new Set(stalePaths)].filter(deleteEntry).length;
    if (pruned > 0) {
      console.error(
        `[ctxo] Pruned ${pruned} stale index ${pruned === 1 ? 'entry' : 'entries'} (source file deleted, or excluded by index.ignore / index.ignoreProjects)`,
      );
    }
    for (const { fileIndex } of pendingIndices) writer.write(fileIndex);

    // Write schema version
    schemaManager.writeVersion();

    // Populate SQLite cache (skip rebuildFromJson since we just wrote the JSON). It holds what the snapshot
    // and the artifacts are built from: the files of this run after a full run, and after an incremental
    // run the merged index, not just the few files it re-indexed. initEmpty() clears the tables, which
    // init() would not (it re-inserts rows and duplicates edges).
    const storage = new SqliteStorageAdapter(this.ctxoRoot, { allowProductionPath: true });
    try {
      await storage.initEmpty();
      storage.bulkWrite(indexed);
      if (communitySnapshot) {
        storage.writeCommunities(communitySnapshot);
      }
    } finally {
      storage.close();
    }

    // Phase 2d: Persist derived architectural artifacts (drift events + boundary
    // violations). These are computed AFTER `writeCommunities` so that history
    // already holds the previous commit's snapshot (see writeArchitectureArtifacts).
    // Consumers:
    // - pages/ctxo-visualizer.html Architecture tab reads these directly.
    // - Future MCP tools can surface the same data without recomputing.
    if (communitySnapshot) {
      // The full graph, like the snapshot it is compared with: after an incremental run the edges of a few
      // files alone would hide every violation that starts in a file this run did not re-index.
      this.writeArchitectureArtifacts(indexed, communitySnapshot);
    }

    // Ensure .ctxo/.cache/ is in .gitignore (skip during verify runs)
    if (!options.skipSideEffects) {
      this.ensureGitignore();
    }

    // Tier summary
    const csCount = pendingIndices.filter(e => e.relativePath.endsWith('.cs')).length;
    const tsCount = pendingIndices.filter(e => /\.(ts|tsx|js|jsx)$/.test(e.relativePath)).length;
    const goCount = pendingIndices.filter(e => e.relativePath.endsWith('.go')).length;
    const javaCount = pendingIndices.filter(e => e.relativePath.endsWith('.java')).length;
    console.error(
      `[ctxo] Index complete: ${processed} files indexed${removedPaths.size > 0 ? `, ${removedPaths.size} removed` : ''}`,
    );
    if (tsCount > 0) console.error(`[ctxo]   TypeScript/JS: ${tsCount} files (full tier)`);
    if (csCount > 0) console.error(`[ctxo]   C#: ${csCount} files (${csharpTier} tier${csharpTier === 'syntax' ? ' - .NET SDK 8+ for full analysis' : ''})`);
    if (goCount > 0) console.error(`[ctxo]   Go: ${goCount} files (${goTier} tier${goTier === 'syntax' ? ' - Go 1.22+ for full analysis' : ''})`);
    if (javaCount > 0) console.error(`[ctxo]   Java: ${javaCount} files (${javaTier} tier${javaTier === 'syntax' ? ' - JRE 11+ & "ctxo install java --full-tier" for full analysis' : ''})`);

    // Dispose Roslyn adapter
    if (roslynAdapter) await roslynAdapter.dispose();
  }

  private async autoInstallMissingPlugins(): Promise<void> {
    const detection = detectLanguages(this.projectRoot);
    const needed = decideNeededLanguages(detection);
    const missing: KnownLanguage[] = [];
    for (const lang of needed) {
      try {
        requireCjs.resolve(`${officialPluginFor(lang)}/package.json`);
      } catch {
        missing.push(lang);
      }
    }
    if (missing.length === 0) return;
    console.error(`[ctxo] --install-missing: installing ${missing.join(', ')}`);
    await new InstallCommand(this.projectRoot).run({ languages: missing, yes: true });
  }

  private printLanguagePreview(): void {
    const detection = detectLanguages(this.projectRoot);
    const lines: string[] = [];
    for (const [lang, count] of Object.entries(detection.byExtension)) {
      const hasPlugin = this.supportedExtensions.size > 0 && Object.entries(EXTENSION_LANGUAGE)
        .some(([ext, id]) => id === lang && this.supportedExtensions.has(ext));
      const status = hasPlugin ? 'plugin available' : 'no plugin — skipped';
      lines.push(`  ${lang.padEnd(10)} ${String(count).padStart(5)} files (${status})`);
    }
    if (lines.length === 0) return;
    console.error('[ctxo] Language scan:');
    for (const line of lines) console.error(line);
  }

  private async registerDiscoveredPlugins(
    registry: LanguageAdapterRegistry,
    ignoreProjectPatterns: string[] = [],
  ): Promise<{
    tsMorphLike: TsMorphLike | undefined;
    roslynAdapter: RoslynLike | null;
    csharpTier: string;
    goTier: string;
    javaTier: string;
  }> {
    const loaded = await loadPlugins(this.projectRoot, { ignoreProjects: ignoreProjectPatterns });
    let tsMorphLike: TsMorphLike | undefined;
    let roslynAdapter: RoslynLike | null = null;
    let csharpTier = 'unavailable';
    let goTier = 'unavailable';
    let javaTier = 'unavailable';

    for (const { plugin, adapter } of loaded) {
      // Plugins that expose an initialize() lifecycle need it called before register
      if (typeof adapter.initialize === 'function') {
        try {
          await adapter.initialize(this.projectRoot);
        } catch (err) {
          console.error(`[ctxo] Plugin ${plugin.id} initialize failed: ${(err as Error).message}`);
          continue;
        }
      }

      registry.register(plugin.extensions, adapter);

      // Duck-type: TsMorphAdapter exposes project-wide preload hooks
      const tsCandidate = adapter as unknown as Partial<TsMorphLike>;
      if (
        typeof tsCandidate.loadProjectSources === 'function' &&
        typeof tsCandidate.clearProjectSources === 'function'
      ) {
        tsMorphLike = tsCandidate as TsMorphLike;
      }

      // Duck-type: CSharpCompositeAdapter exposes Roslyn delegate + tier info
      const csCandidate = adapter as unknown as Partial<CSharpCompositeLike>;
      if (
        plugin.id === 'csharp' &&
        typeof csCandidate.getRoslynDelegate === 'function' &&
        typeof csCandidate.getTier === 'function'
      ) {
        csharpTier = csCandidate.getTier();
        roslynAdapter = csCandidate.getRoslynDelegate() ?? null;
      }

      // Duck-type: GoCompositeAdapter exposes tier info
      const goCandidate = adapter as unknown as Partial<GoCompositeLike>;
      if (plugin.id === 'go' && typeof goCandidate.getTier === 'function') {
        goTier = goCandidate.getTier();
      }

      // Duck-type: JavaCompositeAdapter exposes tier info
      const javaCandidate = adapter as unknown as Partial<JavaCompositeLike>;
      if (plugin.id === 'java' && typeof javaCandidate.getTier === 'function') {
        javaTier = javaCandidate.getTier();
      }

      const activeTier =
        plugin.id === 'csharp' ? csharpTier :
        plugin.id === 'go' ? goTier :
        plugin.id === 'java' ? javaTier :
        plugin.tier;
      const tierSuffix = activeTier !== plugin.tier ? ` (active: ${activeTier})` : '';
      console.error(`[ctxo] Plugin ${plugin.id}@${plugin.version} (${plugin.tier} tier${tierSuffix}) — ${plugin.extensions.join(', ')}`);
    }

    return { tsMorphLike, roslynAdapter, csharpTier, goTier, javaTier };
  }

  private discoverFilesIn(root: string, ignoreFile: (p: string) => boolean = () => false): string[] {
    try {
      // -z: NUL-separated, unquoted names. Without it git prints a non-ASCII path in quotes with octal
      // escapes ("src/\303\266d\303\274n\303\247.ts") under the default core.quotePath, and the extension check drops it.
      const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      return output
        .split('\0')
        .filter((line) => line.length > 0)
        .filter((line) => this.isSupportedExtension(line))
        .map((line) => join(root, line))
        .filter((abs) => {
          const rel = relative(this.projectRoot, abs).replace(/\\/g, '/');
          return !ignoreFile(rel);
        })
        // `git ls-files --cached` still lists files that have been deleted in
        // the working tree but whose removal isn't staged yet. Filter those out
        // so we don't spam ENOENT errors from readFileSync on stale entries.
        .filter((abs) => existsSync(abs));
    } catch {
      console.error(`[ctxo] git ls-files failed for ${root}`);
      return [];
    }
  }

  /**
   * The folders a full run discovers files in (`kept`), and the workspace folders that
   * `index.ignoreProjects` leaves out (`ignored`). Outside a monorepo, `kept` is the project root.
   */
  private discoverWorkspaces(
    ignoreProject: (p: string) => boolean = () => false,
  ): { kept: string[]; ignored: string[] } {
    const pkgPath = join(this.projectRoot, 'package.json');
    if (!existsSync(pkgPath)) return { kept: [this.projectRoot], ignored: [] };

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const workspaces: string[] | undefined = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces?.packages;

      if (!workspaces || workspaces.length === 0) return { kept: [this.projectRoot], ignored: [] };

      // Resolve workspace patterns (supports simple globs like packages/*)
      const resolved: string[] = [];
      for (const ws of workspaces) {
        if (ws.endsWith('/*') || ws.endsWith('\\*')) {
          // Glob: packages/* → list subdirectories of packages/
          const parentDir = join(this.projectRoot, ws.slice(0, -2));
          if (existsSync(parentDir)) {
            for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
              if (entry.isDirectory()) {
                resolved.push(join(parentDir, entry.name));
              }
            }
          }
        } else {
          // Literal path
          const wsPath = join(this.projectRoot, ws);
          if (existsSync(wsPath)) {
            resolved.push(wsPath);
          }
        }
      }

      if (resolved.length === 0) return { kept: [this.projectRoot], ignored: [] };

      const ignored: string[] = [];
      const filtered = resolved.filter((wsAbs) => {
        const rel = relative(this.projectRoot, wsAbs).replace(/\\/g, '/');
        if (ignoreProject(rel)) {
          console.error(`[ctxo] index.ignoreProjects: skipping ${rel}`);
          ignored.push(wsAbs);
          return false;
        }
        return true;
      });

      if (filtered.length === 0) return { kept: [this.projectRoot], ignored };

      console.error(`[ctxo] Monorepo detected: ${filtered.length} workspace(s)`);
      return { kept: filtered, ignored };
    } catch {
      return { kept: [this.projectRoot], ignored: [] };
    }
  }

  private isSupportedExtension(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return this.supportedExtensions.has(ext);
  }

  private async runCheck(): Promise<void> {
    console.error('[ctxo] Checking index freshness...');

    // Register adapters so supportedExtensions includes discovered extensions
    const registry = new LanguageAdapterRegistry();
    const { roslynAdapter: _roslyn } = await this.registerDiscoveredPlugins(registry);
    this.supportedExtensions = registry.getSupportedExtensions();
    if (_roslyn) await _roslyn.dispose();

    const hasher = new ContentHasher();
    const files = this.discoverFilesIn(this.projectRoot);
    const reader = new (await import('../adapters/storage/json-index-reader.js')).JsonIndexReader(this.ctxoRoot);
    const indices = reader.readAll();
    const indexedMap = new Map(indices.map((i) => [i.file, i]));

    let staleCount = 0;

    for (const filePath of files) {
      if (!this.isSupportedExtension(filePath)) continue;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');
      const indexed = indexedMap.get(relativePath);

      if (!indexed) {
        console.error(`[ctxo] NOT INDEXED: ${relativePath}`);
        staleCount++;
        continue;
      }

      // Guard: file may be deleted from disk but still tracked by git
      if (!existsSync(filePath)) {
        console.error(`[ctxo] DELETED: ${relativePath}`);
        staleCount++;
        continue;
      }

      // Fast path: mtime check (skip hash if mtime hasn't changed)
      const mtime = Math.floor(statSync(filePath).mtimeMs / 1000);
      if (mtime <= indexed.lastModified) continue;

      // Slow path: hash-based verification (handles git checkout, cp -p, CI)
      if (indexed.contentHash) {
        const source = readFileSync(filePath, 'utf-8');
        const currentHash = hasher.hash(source);
        if (currentHash === indexed.contentHash) continue;
        console.error(`[ctxo] STALE: ${relativePath} (content hash differs)`);
      } else {
        // Legacy index: contentHash wasn't populated yet. We cannot tell whether
        // the mtime bump reflects real content change — fail closed, but tell the user why.
        console.error(
          `[ctxo] STALE: ${relativePath} (index predates contentHash — run \`ctxo index\` once to enable mtime-tolerant checks)`,
        );
      }
      staleCount++;
    }

    if (staleCount > 0) {
      console.error(`[ctxo] ${staleCount} file(s) need re-indexing. Run "ctxo index"`);
      process.exit(1);
    }

    console.error('[ctxo] Index is up to date');
  }

  private ensureGitignore(): void {
    const gitignorePath = join(this.projectRoot, '.gitignore');
    const cachePattern = '.ctxo/.cache/';
    const suffix = `\n# Ctxo local cache (never committed)\n${cachePattern}\n`;

    // Read-modify-write atomically to avoid TOCTOU race
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
    if (existing.includes(cachePattern)) return;

    writeFileSync(gitignorePath, existing + suffix, 'utf-8');
    console.error('[ctxo] Added .ctxo/.cache/ to .gitignore');
  }

  /**
   * Which files an incremental run re-indexes, and which entries of the committed index it drops.
   *
   * The candidates are the paths asked for plus the files the commit added, modified or renamed to. Only
   * a file that a full run would index is kept: a language plugin handles it, `index.ignore` does not
   * match it, it lies inside a workspace that `index.ignoreProjects` leaves in, and (for a path listed by
   * name) git does not ignore it through .gitignore. A candidate that is
   * gone from the working tree is dropped from the index instead of being re-indexed, unless git tracks
   * it as skip-worktree (a sparse checkout): then it is merely not checked out and its entry stays.
   *
   * What the commit deleted, and the old path of what it renamed, are dropped without looking at the
   * working tree: on a case-insensitive file system a case-only rename leaves the old name "existing".
   * Only paths that have an entry in the committed index are reported as removed.
   */
  private async selectIncrementalFiles(
    paths: readonly string[],
    commitChanges: readonly FileChange[],
    registry: LanguageAdapterRegistry,
    ignoreFile: (path: string) => boolean,
    workspaces: readonly string[],
    indexedFiles: ReadonlySet<string>,
    gitAdapter: SimpleGitAdapter,
  ): Promise<{ changed: string[]; removed: string[] }> {
    const candidates = new Set<string>();
    const listed = new Set<string>();
    const dropped = new Set<string>();

    for (const raw of paths) {
      const path = toRepoPath(this.projectRoot, raw);
      if (path === undefined) {
        console.error(`[ctxo] Skipped ${raw}: not a path inside the project`);
        continue;
      }
      candidates.add(path);
      listed.add(path);
    }
    for (const change of commitChanges) {
      if (change.status === 'D') {
        dropped.add(change.path);
        continue;
      }
      candidates.add(change.path);
      if (change.status === 'R' && change.oldPath !== undefined) dropped.add(change.oldPath);
    }

    const isIndexable = (path: string): boolean =>
      registry.getAdapter(path) !== undefined &&
      !ignoreFile(path) &&
      workspaces.some((workspace) => isInsideDirectory(workspace, join(this.projectRoot, path)));

    let changed: string[] = [];
    const missing: string[] = [];
    let skippedListed = 0;
    for (const path of [...candidates].sort(compareCodepoint)) {
      if (!isIndexable(path)) {
        // A commit changes plenty of files nothing indexes (docs, JSON); only a file asked for by name is worth a word.
        if (listed.has(path)) skippedListed += 1;
      } else if (existsSync(join(this.projectRoot, path))) {
        changed.push(path);
      } else {
        missing.push(path);
      }
    }
    // A candidate that is missing from the working tree is dropped from the index, unless git tracks it
    // as skip-worktree: then it is merely not checked out, and its entry stays.
    for (const path of await this.withoutSkipWorktree(missing, gitAdapter)) dropped.add(path);

    // A full run leaves out what .gitignore covers (it lists files with --exclude-standard), so a path
    // listed by name is left out too. The files of a commit are tracked, which git never calls ignored, so
    // only the listed ones are asked about. If git cannot say, they are indexed as before.
    const toCheck = changed.filter((path) => listed.has(path));
    if (toCheck.length > 0) {
      const ignoredByGit = await gitAdapter.getIgnoredPaths(toCheck);
      if (ignoredByGit === undefined) {
        console.error('[ctxo] Could not ask git which listed files .gitignore excludes: indexing them anyway');
      } else {
        skippedListed += changed.filter((path) => ignoredByGit.has(path)).length;
        changed = changed.filter((path) => !ignoredByGit.has(path));
      }
    }
    if (skippedListed > 0) {
      console.error(
        `[ctxo] Skipped ${skippedListed} listed file(s) that a full run would not index (no language plugin, index.ignore, .gitignore, or outside the workspaces)`,
      );
    }

    const reindexed = new Set(changed);
    const removed = [...dropped]
      .filter((path) => indexedFiles.has(path) && !reindexed.has(path))
      .sort(compareCodepoint);
    return { changed, removed };
  }

  /**
   * Keeps the candidates whose index entry may be deleted. A path that git tracks but marks skip-worktree
   * (a sparse checkout) is absent from the working tree on purpose, so a missing source says nothing about
   * it, and its entry is committed data that other machines rely on. One git call lists those paths, made
   * only when there is a candidate and kept in memory. If git cannot answer, nothing is deleted this run
   * (fail safe).
   */
  private async withoutSkipWorktree(candidates: readonly string[], gitAdapter: SimpleGitAdapter): Promise<string[]> {
    if (candidates.length === 0) return [];
    const skipWorktree = await gitAdapter.getSkipWorktreePaths();
    if (skipWorktree === undefined) {
      console.error(
        '[ctxo] Could not tell which paths git marks skip-worktree (sparse checkout): no stale index entry was removed',
      );
      return [];
    }
    return candidates.filter((path) => !skipWorktree.has(path));
  }

  /**
   * The committed index entries a full run drops, as source paths. An entry is stale when its source file
   * is gone from the working tree, or when `index.ignore` / `index.ignoreProjects` now excludes it, and
   * this run did not just re-index it.
   *
   * It is never stale merely because no plugin loaded on this machine handles the file: that entry may
   * have been committed by a machine that has the plugin, and the file is still there.
   */
  private findStaleEntries(
    committed: readonly FileIndex[],
    reindexed: ReadonlySet<string>,
    isIgnored: (path: string) => boolean,
  ): string[] {
    return committed
      .map((idx) => idx.file)
      .filter((file) => !reindexed.has(file) && (!existsSync(join(this.projectRoot, file)) || isIgnored(file)))
      .sort(compareCodepoint);
  }

  /**
   * Produce the FileIndex list used as input to community detection, the architecture artifacts and the
   * SQLite cache (the co-change phase has its own file set, `coChangeFiles` in `run`).
   *
   * The list is sorted by file name in code point order, whichever run builds it. The graph, the
   * community detection and the PageRank that follow depend on the order they are fed in, and a full
   * run (discovery order) and an incremental run (directory order of the committed JSON, new files
   * appended) would otherwise feed them differently, and could write different snapshots for one HEAD.
   *
   * Full index run (`base` undefined): returns the indices of this run, sorted by file. A full run indexes
   * every file it discovers, so they are the whole project. The committed JSON of a file this machine
   * cannot index (no plugin loaded here) stays in the index, because a full run prunes only entries that
   * went stale, but it is not part of these local graph products.
   * Incremental run (`--files`, `--commit`, `base` given): pendingIndices holds only the just-updated
   * files. The committed JSON index is spliced in around them, a fresh index replacing the committed
   * entry of the same file and the entries of `base.removedPaths` left out, so Louvain sees the COMPLETE
   * project graph. Without this, Louvain would run on a few-file subgraph and emit a meaningless
   * modularity-0 snapshot. `removedPaths` is applied here, and not by reading the index again after the
   * JSON is deleted, because this runs in Phase 2b, before Phase 3 deletes anything.
   */
  private buildGraphInputIndices(
    pendingIndices: ReadonlyArray<{ relativePath: string; fileIndex: FileIndex }>,
    base?: { committed: readonly FileIndex[]; removedPaths: ReadonlySet<string> },
  ): FileIndex[] {
    if (base === undefined) return sortByFile(pendingIndices.map(({ fileIndex }) => fileIndex));

    const { committed, removedPaths } = base;
    const pendingByPath = new Map<string, FileIndex>();
    for (const { fileIndex } of pendingIndices) {
      pendingByPath.set(fileIndex.file, fileIndex);
    }

    const merged: FileIndex[] = [];
    for (const idx of committed) {
      if (removedPaths.has(idx.file)) continue;
      const override = pendingByPath.get(idx.file);
      if (override) {
        merged.push(override);
        pendingByPath.delete(idx.file);
      } else {
        merged.push(idx);
      }
    }
    // Newly indexed files (no prior committed entry) get appended.
    for (const remaining of pendingByPath.values()) merged.push(remaining);
    return sortByFile(merged);
  }

  private async buildCommunitySnapshot(
    indices: readonly FileIndex[],
    tiers: { csharpTier: string; goTier: string; javaTier: string; tsCount: number },
    gitAdapter: SimpleGitAdapter,
  ): Promise<CommunitySnapshot> {
    const graph = new SymbolGraph();
    for (const fileIndex of indices) {
      for (const symbol of fileIndex.symbols) graph.addNode(symbol);
    }
    for (const fileIndex of indices) {
      for (const edge of fileIndex.edges) graph.addEdge(edge);
    }

    const pagerank = new PageRankCalculator().calculate(graph, { limit: graph.nodeCount });
    const pagerankMap = new Map<string, number>();
    for (const entry of pagerank.rankings) pagerankMap.set(entry.symbolId, entry.score);

    const detector = new CommunityDetector();
    const edgeQuality = pickEdgeQuality(tiers);
    const detectResult = detector.detect(graph, pagerankMap, edgeQuality);

    return {
      version: 1,
      computedAt: new Date().toISOString(),
      commitSha: await safeHeadSha(gitAdapter, this.projectRoot),
      modularity: detectResult.modularity,
      communities: detectResult.communities,
      godNodes: detectResult.godNodes,
      edgeQuality: detectResult.edgeQuality,
      crossClusterEdges: detectResult.crossClusterEdges,
    };
  }

  /**
   * Writes drift-events.json and boundary-violations.json next to
   * communities.json. Must be called AFTER storage.writeCommunities, which
   * archives the previous current snapshot into communities.history/ when HEAD
   * has moved since the last run. On a rerun at the same HEAD nothing is
   * archived (history holds one snapshot per commit), so history[0] is then the
   * snapshot of the last different commit. The detectors compare only with
   * earlier commits and count distinct commits, whatever else the history holds.
   */
  private writeArchitectureArtifacts(
    indices: readonly FileIndex[],
    snapshot: CommunitySnapshot,
  ): void {
    try {
      const snapshotWriter = new CommunitySnapshotWriter(this.ctxoRoot, {
        allowProductionPath: true,
      });
      const history = snapshotWriter.listHistory();

      const graph = new SymbolGraph();
      for (const fileIndex of indices) {
        for (const symbol of fileIndex.symbols) graph.addNode(symbol);
      }
      for (const fileIndex of indices) {
        for (const edge of fileIndex.edges) graph.addEdge(edge);
      }

      const driftResult = new DriftDetector().detect(snapshot, history);
      const violationsResult = new BoundaryViolationDetector().detect(
        graph,
        snapshot,
        history,
      );

      const computedAt = new Date().toISOString();
      const driftArtifact: DriftEventsArtifact = {
        version: 1,
        computedAt,
        commitSha: snapshot.commitSha,
        confidence: driftResult.confidence,
        snapshotsAvailable: driftResult.snapshotsAvailable,
        distinctCommits: driftResult.distinctCommits,
        ...(driftResult.hint ? { hint: driftResult.hint } : {}),
        events: driftResult.events,
      };
      const violationsArtifact: BoundaryViolationsArtifact = {
        version: 1,
        computedAt,
        commitSha: snapshot.commitSha,
        confidence: violationsResult.confidence,
        snapshotsAvailable: violationsResult.snapshotsAvailable,
        distinctCommits: violationsResult.distinctCommits,
        ...(violationsResult.hint ? { hint: violationsResult.hint } : {}),
        violations: violationsResult.violations,
      };

      const writer = new ArchitectureArtifactsWriter(this.ctxoRoot, {
        allowProductionPath: true,
      });
      writer.writeDriftEvents(driftArtifact);
      writer.writeBoundaryViolations(violationsArtifact);

      console.error(
        `[ctxo] Architecture artifacts: ${driftResult.events.length} drift events, ` +
          `${violationsResult.violations.length} boundary violations ` +
          `(confidence: drift=${driftResult.confidence}, violations=${violationsResult.confidence})`,
      );
    } catch (err) {
      // Non-fatal: detectors failing must not break the core index.
      console.error(
        `[ctxo] Architecture artifacts skipped: ${(err as Error).message}`,
      );
    }
  }
}

function pickEdgeQuality(tiers: {
  csharpTier: string;
  goTier: string;
  javaTier: string;
  tsCount: number;
}): EdgeQuality {
  const hasSyntaxOnly = tiers.csharpTier === 'syntax' || tiers.goTier === 'syntax' || tiers.javaTier === 'syntax';
  const hasFull =
    tiers.tsCount > 0 || tiers.csharpTier === 'full' || tiers.goTier === 'full' || tiers.javaTier === 'full';
  if (hasSyntaxOnly && hasFull) return 'mixed';
  if (hasSyntaxOnly) return 'syntax-only';
  return 'full';
}

/** The indices ordered by file name in code point order (never by locale), leaving the input alone. */
function sortByFile(indices: readonly FileIndex[]): FileIndex[] {
  return [...indices].sort((a, b) => compareCodepoint(a.file, b.file));
}

/**
 * The short SHA of HEAD as git prints it, or 'nocommit' when there is none. It is not cut to a fixed
 * length: the snapshot staleness check compares it with `getHeadSha()`, which is whatever
 * `git rev-parse --short HEAD` gives for this repository.
 */
async function safeHeadSha(gitAdapter: SimpleGitAdapter, projectRoot: string): Promise<string> {
  try {
    const sha = await gitAdapter.getHeadSha();
    if (sha) return sha;
  } catch {
    /* fall through */
  }
  try {
    // cwd matters: without it git answers for whichever repository the process happens to run in.
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim() || 'nocommit';
  } catch {
    return 'nocommit';
  }
}

/**
 * The files one commit changed, for `--commit`. Throws when git cannot say (unknown revision, or git
 * failed), because a run that cannot tell what to re-index must not pretend it did.
 */
async function readCommitChanges(gitAdapter: SimpleGitAdapter, rev: string): Promise<FileChange[]> {
  const changes = await gitAdapter.getCommitFileChanges(rev);
  if (changes === undefined) {
    throw new Error(`--commit ${rev}: cannot read the files this commit changed (unknown revision, or git failed)`);
  }
  return changes;
}

/**
 * `input` as a repo-relative path with forward slashes, or undefined when it is empty or points outside
 * the project. Accepts backslashes, a leading `./`, and an absolute path inside the project.
 */
function toRepoPath(projectRoot: string, input: string): string | undefined {
  const trimmed = input.trim().replace(/\\/g, '/');
  if (trimmed === '') return undefined;
  const relativePath = relative(projectRoot, resolve(projectRoot, trimmed));
  if (relativePath === '' || isAbsolute(relativePath) || relativePath.split(/[\\/]/)[0] === '..') return undefined;
  return relativePath.replace(/\\/g, '/');
}

/** True when `absolute` lies inside `directory` (and is not the directory itself). */
function isInsideDirectory(directory: string, absolute: string): boolean {
  const relativePath = relative(directory, absolute);
  return relativePath !== '' && !isAbsolute(relativePath) && relativePath.split(/[\\/]/)[0] !== '..';
}

function countCommunities(snapshot: CommunitySnapshot): number {
  const ids = new Set<number>();
  for (const entry of snapshot.communities) ids.add(entry.communityId);
  return ids.size;
}
