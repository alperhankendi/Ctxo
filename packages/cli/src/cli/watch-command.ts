import { join, extname, relative } from 'node:path';
import { readSourceText } from './read-source.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { loadPlugins, type LoadPluginsOptions } from './plugin-loader.js';
import { JsonIndexWriter } from '../adapters/storage/json-index-writer.js';
import { SqliteStorageAdapter } from '../adapters/storage/sqlite-storage-adapter.js';
import { ChokidarWatcherAdapter } from '../adapters/watcher/chokidar-watcher-adapter.js';
import { execFileSync } from 'node:child_process';
import { ContentHasher } from '../core/staleness/content-hasher.js';
import { SimpleGitAdapter } from '../adapters/git/simple-git-adapter.js';
import { RevertDetector } from '../core/why-context/revert-detector.js';
import { SymbolGraph } from '../core/graph/symbol-graph.js';
import { PageRankCalculator } from '../core/importance/pagerank-calculator.js';
import { CommunityDetector, type CommunityDetectorOptions } from '../core/overlay/community-detector.js';
import { communityDetectorOptions, indexTestPatterns, loadConfig, watchSnapshotMinFileChanges } from '../core/config/load-config.js';
import type { CtxoConfig } from '../core/config/config-schema.js';
import type { LoadedModule } from '../ports/i-ctxo-module.js';
import { dropTestFileRetryTimeouts, extractFileFacts, pluginFactRequest } from './index-facts.js';
import { runModuleIndexPasses } from './module-index-passes.js';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { WatchModulePassScheduler, classifyWatchPath, watchPassModules, type WatchPassTrigger } from './watch-module-pass.js';
import { createLogger } from '../core/logger.js';
import type {
  FileIndex, CommitIntent, AntiPattern, CommunitySnapshot, SymbolNode, GraphEdge, ComplexityMetrics,
} from '../core/types.js';
import type { CodeFact, IIncrementalReindex, IncrementalReindexCapable } from '@ctxo/plugin-api';

const log = createLogger('ctxo:watch');
const DEBOUNCE_MS = 300;
const COMMUNITY_SNAPSHOT_DEBOUNCE_MS = 5000;

export class WatchCommand {
  private readonly projectRoot: string;
  private readonly ctxoRoot: string;
  /** Set by `run`: stops the watcher, drains the passes and closes the cache. */
  private stopWatching: (() => Promise<void>) | undefined;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  /**
   * `modules` are the opt-in modules the router loaded (@ctxo/domain); a module's fact request reaches the
   * plugins exactly as in `ctxo index`, and a module that classifies watched paths gets its index pass run
   * after the re-index, batched (`WatchModulePassScheduler`).
   */
  async run(options: { modules?: readonly LoadedModule[] } = {}): Promise<void> {
    console.error('[ctxo] Starting file watcher...');

    const registry = new LanguageAdapterRegistry();

    // Config is read before the plugins load, so the facts capability reaches every createAdapter.
    const watchConfig = loadConfig(this.ctxoRoot).config;
    const pluginOptions = watchPluginOptions(watchConfig, options.modules ?? []);
    const watchFacts = pluginOptions.facts === true;
    // index.tests globs, so watch drops test-file retry-timeout facts exactly as ctxo index does.
    const testGlobs = indexTestPatterns(watchConfig);

    // Plugins via discovery
    const keepAliveByExt = new Map<string, IIncrementalReindex>();
    for (const { plugin, adapter } of await loadPlugins(this.projectRoot, pluginOptions)) {
      if (typeof adapter.initialize === 'function') {
        try {
          await adapter.initialize(this.projectRoot);
        } catch (err) {
          console.error(`[ctxo] Plugin ${plugin.id} initialize failed: ${(err as Error).message}`);
          continue;
        }
      }

      registry.register(plugin.extensions, adapter);

      // Generic feature detection: if the adapter exposes an incremental-reindex capability, use it
      const capable = adapter as unknown as Partial<IncrementalReindexCapable>;
      if (typeof capable.getIncrementalReindex === 'function') {
        const cap = capable.getIncrementalReindex();
        if (cap?.isReady() && (await cap.startKeepAlive())) {
          for (const ext of plugin.extensions) keepAliveByExt.set(ext.toLowerCase(), cap);
          console.error(`[ctxo] ${plugin.id} watch: keep-alive active (full tier, fast incremental re-index)`);
        }
      }

      console.error(`[ctxo] Plugin ${plugin.id}@${plugin.version} (${plugin.tier} tier)`);
    }

    const supportedExtensions = registry.getSupportedExtensions();
    const writer = new JsonIndexWriter(this.ctxoRoot);
    const storage = new SqliteStorageAdapter(this.ctxoRoot, { allowProductionPath: true });
    await storage.init();
    const hasher = new ContentHasher();

    const gitAdapter = new SimpleGitAdapter(this.projectRoot);
    const revertDetector = new RevertDetector();
    const watcher = new ChokidarWatcherAdapter(this.projectRoot);
    const pendingFiles = new Map<string, NodeJS.Timeout>();

    // Watch-time community snapshots cost ~1s of blocking CPU on 25K-symbol
    // monorepos (full PageRank + Louvain recompute). Only recompute once at
    // least `snapshotMinFileChanges` distinct files have been re-indexed
    // since the last snapshot, so rapid-fire saves don't stall the editor.
    const snapshotThreshold = watchSnapshotMinFileChanges(watchConfig);
    const detectorOptions = communityDetectorOptions(watchConfig);
    const pathsChangedSinceSnapshot = new Set<string>();

    // Module index passes (@ctxo/domain): the seam of Phase 2e of `ctxo index`, on the merged JSON index,
    // without the change log (moved files and the discovery result keep their last recorded values). Only
    // modules that classify watched paths take part; without one, nothing below runs.
    // The pass reads the config watch started with (`watchConfig`), as the re-index does; `factsRequested`
    // tells a module whether these plugins were asked for facts.
    const passModules = watchPassModules(options.modules ?? []);
    let reindexesInFlight = 0;
    // Only pending re-indexes of files a plugin handles hold a due pass back (build output does not).
    const reindexPending = () =>
      reindexesInFlight > 0 || [...pendingFiles.keys()].some((f) => supportedExtensions.has(extname(f).toLowerCase()));
    const modulePasses =
      passModules.length === 0
        ? undefined
        : new WatchModulePassScheduler({
            sourceThreshold: snapshotThreshold,
            isBusy: reindexPending,
            onPassDuration: (ms) => log.debug(`module index pass took ${ms} ms`),
            run: async (trigger) => {
              await runModuleIndexPasses(passModules, {
                projectRoot: this.projectRoot,
                ctxoRoot: this.ctxoRoot,
                config: watchConfig,
                indices: new JsonIndexReader(this.ctxoRoot).readAll(),
                factsRequested: watchFacts,
              });
              console.error(`[ctxo] Module index pass after ${describeTrigger(trigger)}`);
            },
          });
    const noteModulePath = (filePath: string, indexed: boolean) => {
      if (!modulePasses) return;
      const relativePath = toRepoPath(this.projectRoot, filePath);
      const kind = classifyWatchPath(passModules, relativePath, indexed);
      if (kind !== undefined) modulePasses.note(kind, relativePath);
    };

    const reindexFile = async (filePath: string) => {
      const adapter = registry.getAdapter(filePath);
      if (!adapter) return;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');

      try {
        // Generic keep-alive path: use capability if registered for this file extension
        const cap = keepAliveByExt.get(extname(filePath).toLowerCase());
        if (cap?.isReady()) {
          const result = await cap.reindexFile(relativePath);
          if (result) {
            const commits = await gitAdapter.getCommitHistory(relativePath);
            const intent: CommitIntent[] = commits.map((c) => ({
              hash: c.hash, message: c.message, date: c.date, kind: 'commit' as const,
            }));
            const antiPatterns: AntiPattern[] = revertDetector.detect(commits);
            const source = readSourceText(filePath);

            const fileIndex = buildWatchFileIndex(relativePath, {
              lastModified: Math.floor(Date.now() / 1000),
              contentHash: hasher.hash(source),
              symbols: result.symbols,
              edges: result.edges,
              complexity: result.complexity,
              intent,
              antiPatterns,
              facts: watchFacts ? await extractFileFacts(adapter, relativePath, source) : undefined,
              testGlobs,
            });

            writer.write(fileIndex);
            storage.writeSymbolFile(fileIndex);
            console.error(`[ctxo] Re-indexed (keep-alive): ${relativePath}`);
            return;
          }
        }

        // Default path: use adapter from registry (tree-sitter or ts-morph)
        const source = readSourceText(filePath);
        const lastModified = Math.floor(Date.now() / 1000);

        const symbols = await adapter.extractSymbols(relativePath, source);
        const edges = await adapter.extractEdges(relativePath, source);
        const complexity = await adapter.extractComplexity(relativePath, source);

        const commits = await gitAdapter.getCommitHistory(relativePath);
        const intent: CommitIntent[] = commits.map((c) => ({
          hash: c.hash, message: c.message, date: c.date, kind: 'commit' as const,
        }));
        const antiPatterns: AntiPattern[] = revertDetector.detect(commits);

        const fileIndex = buildWatchFileIndex(relativePath, {
          lastModified,
          contentHash: hasher.hash(source),
          symbols,
          edges,
          complexity,
          intent,
          antiPatterns,
          facts: watchFacts ? await extractFileFacts(adapter, relativePath, source) : undefined,
          testGlobs,
        });

        writer.write(fileIndex);
        storage.writeSymbolFile(fileIndex);
        console.error(`[ctxo] Re-indexed: ${relativePath}`);
      } catch (err) {
        console.error(`[ctxo] Failed to re-index ${relativePath}: ${(err as Error).message}`);
      }
    };

    let communitySnapshotTimer: NodeJS.Timeout | undefined;
    const scheduleCommunitySnapshot = () => {
      // Threshold skip — don't even arm the debounce timer unless enough
      // distinct files changed since the last accepted snapshot.
      if (pathsChangedSinceSnapshot.size < snapshotThreshold) return;

      if (communitySnapshotTimer) clearTimeout(communitySnapshotTimer);
      communitySnapshotTimer = setTimeout(() => {
        communitySnapshotTimer = undefined;
        if (pathsChangedSinceSnapshot.size < snapshotThreshold) return;
        const changedCount = pathsChangedSinceSnapshot.size;
        pathsChangedSinceSnapshot.clear();
        try {
          const snapshot = buildWatchCommunitySnapshot(storage, detectorOptions);
          if (snapshot) {
            storage.writeCommunities(snapshot);
            console.error(
              `[ctxo] Community snapshot refreshed after ${changedCount} file change(s) (modularity ${snapshot.modularity.toFixed(3)})`,
            );
          }
        } catch (err) {
          console.error(`[ctxo] Community snapshot skipped: ${(err as Error).message}`);
        }
      }, COMMUNITY_SNAPSHOT_DEBOUNCE_MS);
    };

    const debouncedReindex = (filePath: string) => {
      const existing = pendingFiles.get(filePath);
      if (existing) clearTimeout(existing);

      pendingFiles.set(
        filePath,
        setTimeout(async () => {
          pendingFiles.delete(filePath);
          reindexesInFlight += 1;
          try {
            await reindexFile(filePath);
          } finally {
            reindexesInFlight -= 1;
          }
          pathsChangedSinceSnapshot.add(filePath);
          scheduleCommunitySnapshot();
          // After the re-index, so a pass that becomes due reads the new entry. A file no plugin handles
          // (a card, the registry) was not re-indexed, but a module pass may read it.
          noteModulePath(filePath, supportedExtensions.has(extname(filePath).toLowerCase()));
        }, DEBOUNCE_MS),
      );
    };

    watcher.start((event, filePath) => {
      if (event === 'unlink') {
        const ext = extname(filePath).toLowerCase();
        if (!supportedExtensions.has(ext)) {
          noteModulePath(filePath, false);
          return;
        }

        const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');
        writer.delete(relativePath);
        storage.deleteSymbolFile(relativePath);
        console.error(`[ctxo] Removed from index: ${relativePath}`);
        noteModulePath(filePath, true);
      } else {
        debouncedReindex(filePath);
      }
    });

    // One pass at start, only when a module reports its artifacts stale against their inputs (cards edited
    // while watch was not running, say). Otherwise none.
    if (modulePasses && watchArtifactsStale(passModules)) {
      console.error('[ctxo] Module artifacts are stale against their inputs; refreshing them');
      modulePasses.requestStartPass();
    }

    console.error('[ctxo] Watching for file changes... (Ctrl+C to stop)');

    const onSignal = () => {
      console.error('\n[ctxo] Stopping watcher...');
      void this.stop().then(() => process.exit(0));
    };
    let stopped: Promise<void> | undefined;
    this.stopWatching = () =>
      (stopped ??= (async () => {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        for (const timeout of pendingFiles.values()) clearTimeout(timeout);
        pendingFiles.clear();
        if (communitySnapshotTimer) clearTimeout(communitySnapshotTimer);
        modulePasses?.dispose();
        // Shutdown all keep-alive capabilities (dedup via Set over Map values). A module pass in flight
        // finishes first, so no domain artifact is cut off by the exit.
        const uniques = new Set(keepAliveByExt.values());
        await Promise.all([...[...uniques].map((c) => c.dispose()), modulePasses?.idle()]);
        await watcher.stop();
        storage.close();
        console.error('[ctxo] Watcher stopped');
      })());

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  }

  /** Stops a running watcher without exiting: pending re-indexes are dropped, a module pass in flight is awaited. */
  async stop(): Promise<void> {
    await this.stopWatching?.();
  }

}

/** A watched path relative to the project root, forward slashes. */
function toRepoPath(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath).split('\\').join('/');
}

/** Whether a module reports its artifacts stale at start (a module whose check throws counts as fresh). */
function watchArtifactsStale(modules: readonly LoadedModule[]): boolean {
  return modules.some((module) => {
    try {
      return module.registration.watchArtifactsStale?.() === true;
    } catch (err) {
      console.error(`[ctxo] ${module.name} stale check failed: ${(err as Error).message}`);
      return false;
    }
  });
}

/** What set off a watch-time module pass, for the log line. */
export function describeTrigger(trigger: WatchPassTrigger): string {
  const parts: string[] = [];
  if (trigger.start) parts.push('start (stale artifacts)');
  if (trigger.inputs > 0) parts.push(`${trigger.inputs} module input change(s)`);
  if (trigger.sources > 0) parts.push(`${trigger.sources} source change(s)`);
  return parts.join(' and ');
}

/**
 * The options `ctxo watch` loads the plugins with: the same fact request and `index.tests` globs as
 * `ctxo index` (the globs only when set; the plugins get the default test globs either way).
 */
export function watchPluginOptions(config: CtxoConfig, modules: readonly LoadedModule[]): LoadPluginsOptions {
  const request = pluginFactRequest(config, modules);
  const testGlobs = indexTestPatterns(config);
  return testGlobs.length > 0 ? { ...request, testGlobs } : request;
}

/** What a watch re-index gathers for one file, before it becomes a `FileIndex`. */
export interface WatchFileIndexParts {
  readonly lastModified: number;
  readonly contentHash: string;
  readonly symbols: readonly SymbolNode[];
  readonly edges: readonly GraphEdge[];
  readonly complexity: readonly ComplexityMetrics[];
  readonly intent: readonly CommitIntent[];
  readonly antiPatterns: readonly AntiPattern[];
  readonly facts?: readonly CodeFact[];
  /** The `index.tests` globs; with the default test globs they decide which files lose retry-timeout facts. */
  readonly testGlobs?: readonly string[];
}

/**
 * The `FileIndex` a watch re-index writes. Symbols are kept whole, so annotations and offsets survive;
 * edges to `ns:` namespace placeholders are dropped; `facts` is set only when given, without the
 * retry-timeout facts of a test file (`dropTestFileRetryTimeouts`, the rule `ctxo index` applies).
 */
export function buildWatchFileIndex(file: string, parts: WatchFileIndexParts): FileIndex {
  const fileIndex: FileIndex = {
    file,
    lastModified: parts.lastModified,
    contentHash: parts.contentHash,
    symbols: [...parts.symbols],
    edges: parts.edges.filter((e) => !e.to.startsWith('ns:')),
    complexity: [...parts.complexity],
    intent: [...parts.intent],
    antiPatterns: [...parts.antiPatterns],
  };
  if (parts.facts) fileIndex.facts = dropTestFileRetryTimeouts(file, parts.symbols, parts.facts, parts.testGlobs ?? []);
  return fileIndex;
}

export function buildWatchCommunitySnapshot(
  storage: SqliteStorageAdapter,
  detectorOptions: CommunityDetectorOptions,
): CommunitySnapshot | undefined {
  const symbols = storage.getAllSymbols();
  if (symbols.length === 0) return undefined;
  const edges = storage.getAllEdges();

  const graph = new SymbolGraph();
  for (const symbol of symbols) graph.addNode(symbol);
  for (const edge of edges) graph.addEdge(edge);

  const pagerank = new PageRankCalculator().calculate(graph, { limit: graph.nodeCount });
  const pagerankMap = new Map<string, number>();
  for (const entry of pagerank.rankings) pagerankMap.set(entry.symbolId, entry.score);

  const detector = new CommunityDetector(detectorOptions);
  const detectResult = detector.detect(graph, pagerankMap, 'full');

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    commitSha: readHeadSha(),
    modularity: detectResult.modularity,
    communities: detectResult.communities,
    godNodes: detectResult.godNodes,
    edgeQuality: detectResult.edgeQuality,
    crossClusterEdges: detectResult.crossClusterEdges,
  };
}

function readHeadSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'nocommit';
  }
}
