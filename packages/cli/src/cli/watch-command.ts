import { join, extname, relative } from 'node:path';
import { readSourceText } from './read-source.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { loadPlugins } from './plugin-loader.js';
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
import { communityDetectorOptions, factsRequested, loadConfig, watchSnapshotMinFileChanges } from '../core/config/load-config.js';
import { extractFileFacts } from './index-facts.js';
import type {
  FileIndex, CommitIntent, AntiPattern, CommunitySnapshot, SymbolNode, GraphEdge, ComplexityMetrics,
} from '../core/types.js';
import type { CodeFact, IIncrementalReindex, IncrementalReindexCapable } from '@ctxo/plugin-api';

const DEBOUNCE_MS = 300;
const COMMUNITY_SNAPSHOT_DEBOUNCE_MS = 5000;

export class WatchCommand {
  private readonly projectRoot: string;
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  async run(): Promise<void> {
    console.error('[ctxo] Starting file watcher...');

    const registry = new LanguageAdapterRegistry();

    // Config is read before the plugins load, so the facts capability reaches every createAdapter.
    const watchConfig = loadConfig(this.ctxoRoot).config;
    const watchFacts = factsRequested(watchConfig);

    // Plugins via discovery
    const keepAliveByExt = new Map<string, IIncrementalReindex>();
    for (const { plugin, adapter } of await loadPlugins(this.projectRoot, { facts: watchFacts })) {
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
          await reindexFile(filePath);
          pathsChangedSinceSnapshot.add(filePath);
          scheduleCommunitySnapshot();
        }, DEBOUNCE_MS),
      );
    };

    watcher.start((event, filePath) => {
      if (event === 'unlink') {
        const ext = extname(filePath).toLowerCase();
        if (!supportedExtensions.has(ext)) return;

        const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');
        writer.delete(relativePath);
        storage.deleteSymbolFile(relativePath);
        console.error(`[ctxo] Removed from index: ${relativePath}`);
      } else {
        debouncedReindex(filePath);
      }
    });

    console.error('[ctxo] Watching for file changes... (Ctrl+C to stop)');

    const cleanup = () => {
      console.error('\n[ctxo] Stopping watcher...');
      for (const timeout of pendingFiles.values()) {
        clearTimeout(timeout);
      }
      if (communitySnapshotTimer) clearTimeout(communitySnapshotTimer);
      // Shutdown all keep-alive capabilities (dedup via Set over Map values)
      const uniques = new Set(keepAliveByExt.values());
      const shutdowns = Promise.all([...uniques].map((c) => c.dispose()));
      shutdowns.then(() => {
        watcher.stop().then(() => {
          storage.close();
          console.error('[ctxo] Watcher stopped');
          process.exit(0);
        });
      });
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

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
}

/**
 * The `FileIndex` a watch re-index writes. Symbols are kept whole, so annotations and offsets survive;
 * edges to `ns:` namespace placeholders are dropped; `facts` is set only when given.
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
  if (parts.facts) fileIndex.facts = [...parts.facts];
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
