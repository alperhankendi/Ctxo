import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createRequire } from 'node:module';
import { ContentHasher } from '../core/staleness/content-hasher.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { loadPlugins } from './plugin-loader.js';
import { InstallCommand } from './install-command.js';
import {
  loadConfig,
  indexIgnorePatterns,
  indexIgnoreProjectPatterns,
  makeGlobMatcher,
} from '../core/config/load-config.js';
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
import { SimpleGitAdapter } from '../adapters/git/simple-git-adapter.js';
import { RevertDetector } from '../core/why-context/revert-detector.js';
import { aggregateCoChanges } from '../core/co-change/co-change-analyzer.js';
import { CommunityDetector } from '../core/overlay/community-detector.js';
import { SymbolGraph } from '../core/graph/symbol-graph.js';
import { PageRankCalculator } from '../core/importance/pagerank-calculator.js';
import type { CommunitySnapshot, EdgeQuality, FileIndex, SymbolKind } from '../core/types.js';

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
      ignoreFile: makeGlobMatcher(filePatterns),
      ignoreProject: makeGlobMatcher(projectPatterns),
      ignoreProjectPatterns: projectPatterns,
    };
  }

  async run(options: {
    file?: string;
    check?: boolean;
    skipSideEffects?: boolean;
    skipHistory?: boolean;
    skipCommunity?: boolean;
    maxHistory?: number;
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

    // Set up adapters via plugin discovery (TS, Go, C# all plugin-backed)
    const registry = new LanguageAdapterRegistry();
    const { tsMorphLike, roslynAdapter, csharpTier, goTier } = await this.registerDiscoveredPlugins(registry, ignore.ignoreProjectPatterns);
    this.supportedExtensions = registry.getSupportedExtensions();

    // Emit a language-aware pre-scan so users see the plan before the work runs
    this.printLanguagePreview();

    const writer = new JsonIndexWriter(this.ctxoRoot);
    const schemaManager = new SchemaManager(this.ctxoRoot);
    const hasher = new ContentHasher();
    const gitAdapter = new SimpleGitAdapter(this.projectRoot);
    const revertDetector = new RevertDetector();

    // Discover files (single file, monorepo workspaces, or full project)
    let files: string[];
    if (options.file) {
      const fullPath = join(this.projectRoot, options.file);
      files = [fullPath];
      console.error(`[ctxo] Incremental re-index: ${options.file}`);
    } else {
      // Check for monorepo workspaces — discover files across all roots
      const workspaces = this.discoverWorkspaces(ignore.ignoreProject);
      files = [];
      for (const ws of workspaces) {
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

    // Phase 2: Batch git history (single git call for all files)
    if (!options.skipHistory && pendingIndices.length > 0) {
      const maxHistory = options.maxHistory ?? 20;
      const batchHistory = await gitAdapter.getBatchHistory?.(maxHistory) ?? new Map<string, import('../core/types.js').CommitRecord[]>();

      for (const { relativePath, fileIndex } of pendingIndices) {
        const commits = batchHistory.get(relativePath) ?? [];
        fileIndex.intent = commits.map((c) => ({
          hash: c.hash,
          message: c.message,
          date: c.date,
          kind: 'commit' as const,
        }));
        fileIndex.antiPatterns = revertDetector.detect(commits);
      }
    }

    // Phase 2b: Aggregate co-change data from git history
    if (!options.skipHistory && pendingIndices.length > 0) {
      const fileIndices = pendingIndices.map(e => e.fileIndex);
      const coChangeMatrix = aggregateCoChanges(fileIndices);
      writer.writeCoChanges(coChangeMatrix);
      console.error(`[ctxo] Co-change analysis: ${coChangeMatrix.entries.length} file pairs detected`);
    }

    // Phase 2c: Community detection + snapshot
    //
    // Full indexing:    run Louvain over pendingIndices (all indexed files).
    // Incremental (--file): merge the just-updated fileIndex(es) with the rest of the committed
    //                       JSON index on disk so Louvain sees the *complete* graph. Running it
    //                       over the 1-file subgraph alone would produce a meaningless
    //                       N-singleton snapshot (modularity 0).
    // Opt-out (--skip-community): skip entirely. Warn if a stale snapshot exists on disk.
    let communitySnapshot: CommunitySnapshot | undefined;

    if (options.skipCommunity && pendingIndices.length > 0) {
      if (existsSync(join(this.ctxoRoot, 'index', 'communities.json'))) {
        console.error(
          `[ctxo] WARN stale communities.json present — --skip-community preserved existing snapshot. Run \`ctxo index\` (full) to refresh.`,
        );
      }
    } else if (pendingIndices.length > 0) {
      try {
        const graphIndices = this.buildGraphInputIndices(pendingIndices);
        communitySnapshot = this.buildCommunitySnapshot(
          graphIndices,
          {
            csharpTier,
            goTier,
            tsCount: graphIndices.filter((idx) => /\.(ts|tsx|js|jsx)$/.test(idx.file)).length,
          },
          gitAdapter,
        );
        const scope = options.file ? ' (incremental, full-graph recompute)' : '';
        console.error(
          `[ctxo] Community detection${scope}: ${countCommunities(communitySnapshot)} clusters (modularity ${communitySnapshot.modularity.toFixed(3)})`,
        );
      } catch (err) {
        console.error(`[ctxo] Community detection skipped: ${(err as Error).message}`);
      }
    }

    // Phase 3: Write all indices
    const indices: FileIndex[] = [];
    for (const { fileIndex } of pendingIndices) {
      writer.write(fileIndex);
      indices.push(fileIndex);
    }

    // Write schema version
    schemaManager.writeVersion();

    // Populate SQLite cache (skip rebuildFromJson since we just wrote the JSON)
    const storage = new SqliteStorageAdapter(this.ctxoRoot, { allowProductionPath: true });
    try {
      await storage.initEmpty();
      storage.bulkWrite(indices);
      if (communitySnapshot) {
        storage.writeCommunities(communitySnapshot);
      }
    } finally {
      storage.close();
    }

    // Ensure .ctxo/.cache/ is in .gitignore (skip during verify runs)
    if (!options.skipSideEffects) {
      this.ensureGitignore();
    }

    // Tier summary
    const csCount = pendingIndices.filter(e => e.relativePath.endsWith('.cs')).length;
    const tsCount = pendingIndices.filter(e => /\.(ts|tsx|js|jsx)$/.test(e.relativePath)).length;
    const goCount = pendingIndices.filter(e => e.relativePath.endsWith('.go')).length;
    console.error(`[ctxo] Index complete: ${processed} files indexed`);
    if (tsCount > 0) console.error(`[ctxo]   TypeScript/JS: ${tsCount} files (full tier)`);
    if (csCount > 0) console.error(`[ctxo]   C#: ${csCount} files (${csharpTier} tier${csharpTier === 'syntax' ? ' - .NET SDK 8+ for full analysis' : ''})`);
    if (goCount > 0) console.error(`[ctxo]   Go: ${goCount} files (${goTier} tier${goTier === 'syntax' ? ' - Go 1.22+ for full analysis' : ''})`);

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
  }> {
    const loaded = await loadPlugins(this.projectRoot, { ignoreProjects: ignoreProjectPatterns });
    let tsMorphLike: TsMorphLike | undefined;
    let roslynAdapter: RoslynLike | null = null;
    let csharpTier = 'unavailable';
    let goTier = 'unavailable';

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

      const activeTier =
        plugin.id === 'csharp' ? csharpTier :
        plugin.id === 'go' ? goTier :
        plugin.tier;
      const tierSuffix = activeTier !== plugin.tier ? ` (active: ${activeTier})` : '';
      console.error(`[ctxo] Plugin ${plugin.id}@${plugin.version} (${plugin.tier} tier${tierSuffix}) — ${plugin.extensions.join(', ')}`);
    }

    return { tsMorphLike, roslynAdapter, csharpTier, goTier };
  }

  private discoverFilesIn(root: string, ignoreFile: (p: string) => boolean = () => false): string[] {
    try {
      const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => this.isSupportedExtension(line))
        .map((line) => join(root, line))
        .filter((abs) => {
          const rel = relative(this.projectRoot, abs).replace(/\\/g, '/');
          return !ignoreFile(rel);
        });
    } catch {
      console.error(`[ctxo] git ls-files failed for ${root}`);
      return [];
    }
  }

  private discoverWorkspaces(ignoreProject: (p: string) => boolean = () => false): string[] {
    const pkgPath = join(this.projectRoot, 'package.json');
    if (!existsSync(pkgPath)) return [this.projectRoot];

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const workspaces: string[] | undefined = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces?.packages;

      if (!workspaces || workspaces.length === 0) return [this.projectRoot];

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

      if (resolved.length === 0) return [this.projectRoot];

      const filtered = resolved.filter((wsAbs) => {
        const rel = relative(this.projectRoot, wsAbs).replace(/\\/g, '/');
        if (ignoreProject(rel)) {
          console.error(`[ctxo] index.ignoreProjects: skipping ${rel}`);
          return false;
        }
        return true;
      });

      if (filtered.length === 0) return [this.projectRoot];

      console.error(`[ctxo] Monorepo detected: ${filtered.length} workspace(s)`);
      return filtered;
    } catch {
      return [this.projectRoot];
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
   * Produce the FileIndex list used as input to community detection.
   *
   * Full index run: returns pendingIndices as-is — they already cover every file.
   * Incremental `--file` run: pendingIndices holds only the just-updated file(s). We load the
   * rest of the committed JSON index from disk and splice in the fresh in-memory indices so
   * Louvain sees the COMPLETE project graph. Without this, Louvain would run on a 1-file
   * subgraph and emit a meaningless modularity-0 snapshot.
   */
  private buildGraphInputIndices(
    pendingIndices: ReadonlyArray<{ relativePath: string; fileIndex: FileIndex }>,
  ): FileIndex[] {
    const pendingByPath = new Map<string, FileIndex>();
    for (const { fileIndex } of pendingIndices) {
      pendingByPath.set(fileIndex.file, fileIndex);
    }

    const reader = new JsonIndexReader(this.ctxoRoot);
    const committed = reader.readAll();

    const merged: FileIndex[] = [];
    for (const idx of committed) {
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
    return merged;
  }

  private buildCommunitySnapshot(
    indices: readonly FileIndex[],
    tiers: { csharpTier: string; goTier: string; tsCount: number },
    gitAdapter: SimpleGitAdapter,
  ): CommunitySnapshot {
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
      commitSha: safeHeadSha(gitAdapter),
      modularity: detectResult.modularity,
      communities: detectResult.communities,
      godNodes: detectResult.godNodes,
      edgeQuality: detectResult.edgeQuality,
      crossClusterEdges: detectResult.crossClusterEdges,
    };
  }
}

function pickEdgeQuality(tiers: {
  csharpTier: string;
  goTier: string;
  tsCount: number;
}): EdgeQuality {
  const hasSyntaxOnly = tiers.csharpTier === 'syntax' || tiers.goTier === 'syntax';
  const hasFull =
    tiers.tsCount > 0 || tiers.csharpTier === 'full' || tiers.goTier === 'full';
  if (hasSyntaxOnly && hasFull) return 'mixed';
  if (hasSyntaxOnly) return 'syntax-only';
  return 'full';
}

function safeHeadSha(gitAdapter: SimpleGitAdapter): string {
  try {
    const maybeSha = (gitAdapter as unknown as { getHeadSha?: () => string | undefined }).getHeadSha?.();
    if (maybeSha) return maybeSha.slice(0, 8);
  } catch {
    /* fall through */
  }
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' });
    return out.trim();
  } catch {
    return 'nocommit';
  }
}

function countCommunities(snapshot: CommunitySnapshot): number {
  const ids = new Set<number>();
  for (const entry of snapshot.communities) ids.add(entry.communityId);
  return ids.size;
}
