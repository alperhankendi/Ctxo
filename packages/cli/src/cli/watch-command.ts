import { join, extname, relative } from 'node:path';
import { readFileSync } from 'node:fs';
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
import { CommunityDetector } from '../core/overlay/community-detector.js';
import type { FileIndex, CommitIntent, AntiPattern, CommunitySnapshot } from '../core/types.js';

const DEBOUNCE_MS = 300;
const COMMUNITY_SNAPSHOT_DEBOUNCE_MS = 5000;

interface RoslynLike {
  isReady(): boolean;
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
}

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

    // Plugins via discovery
    let roslynAdapter: RoslynLike | null = null;
    for (const { plugin, adapter } of await loadPlugins(this.projectRoot)) {
      if (typeof adapter.initialize === 'function') {
        try {
          await adapter.initialize(this.projectRoot);
        } catch (err) {
          console.error(`[ctxo] Plugin ${plugin.id} initialize failed: ${(err as Error).message}`);
          continue;
        }
      }

      registry.register(plugin.extensions, adapter);

      // If the plugin exposes a Roslyn delegate, attempt keep-alive for fast re-index
      const csCandidate = adapter as unknown as Partial<CSharpCompositeLike>;
      if (typeof csCandidate.getRoslynDelegate === 'function') {
        const roslyn = csCandidate.getRoslynDelegate();
        if (roslyn?.isReady()) {
          const started = await roslyn.startKeepAlive();
          if (started) {
            roslynAdapter = roslyn;
            console.error('[ctxo] C# watch: Roslyn keep-alive active (full tier, <100ms per change)');
          }
        }
      }

      console.error(`[ctxo] Plugin ${plugin.id}@${plugin.version} (${plugin.tier} tier)`);
    }

    const supportedExtensions = registry.getSupportedExtensions();
    const writer = new JsonIndexWriter(this.ctxoRoot);
    const storage = new SqliteStorageAdapter(this.ctxoRoot);
    await storage.init();
    const hasher = new ContentHasher();

    const gitAdapter = new SimpleGitAdapter(this.projectRoot);
    const revertDetector = new RevertDetector();
    const watcher = new ChokidarWatcherAdapter(this.projectRoot);
    const pendingFiles = new Map<string, NodeJS.Timeout>();

    const reindexFile = async (filePath: string) => {
      const adapter = registry.getAdapter(filePath);
      if (!adapter) return;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');

      try {
        // For .cs files with Roslyn keep-alive: use incremental re-index
        if (roslynAdapter?.isReady() && filePath.endsWith('.cs')) {
          const result = await roslynAdapter.reindexFile(relativePath);
          if (result) {
            const commits = await gitAdapter.getCommitHistory(relativePath);
            const intent: CommitIntent[] = commits.map((c) => ({
              hash: c.hash, message: c.message, date: c.date, kind: 'commit' as const,
            }));
            const antiPatterns: AntiPattern[] = revertDetector.detect(commits);
            const source = readFileSync(filePath, 'utf-8');

            const fileIndex: FileIndex = {
              file: relativePath,
              lastModified: Math.floor(Date.now() / 1000),
              contentHash: hasher.hash(source),
              symbols: result.symbols.map(s => ({
                symbolId: s.symbolId, name: s.name,
                kind: s.kind as FileIndex['symbols'][0]['kind'],
                startLine: s.startLine, endLine: s.endLine,
              })),
              edges: result.edges
                .filter(e => !e.to.startsWith('ns:'))
                .map(e => ({
                  from: e.from, to: e.to,
                  kind: e.kind as FileIndex['edges'][0]['kind'],
                })),
              complexity: result.complexity.map(c => ({
                symbolId: c.symbolId, cyclomatic: c.cyclomatic,
              })),
              intent,
              antiPatterns,
            };

            writer.write(fileIndex);
            storage.writeSymbolFile(fileIndex);
            console.error(`[ctxo] Re-indexed (Roslyn): ${relativePath}`);
            return;
          }
        }

        // Default path: use adapter from registry (tree-sitter or ts-morph)
        const source = readFileSync(filePath, 'utf-8');
        const lastModified = Math.floor(Date.now() / 1000);

        const symbols = await adapter.extractSymbols(relativePath, source);
        const edges = await adapter.extractEdges(relativePath, source);
        const complexity = await adapter.extractComplexity(relativePath, source);

        const commits = await gitAdapter.getCommitHistory(relativePath);
        const intent: CommitIntent[] = commits.map((c) => ({
          hash: c.hash, message: c.message, date: c.date, kind: 'commit' as const,
        }));
        const antiPatterns: AntiPattern[] = revertDetector.detect(commits);

        const fileIndex: FileIndex = {
          file: relativePath,
          lastModified,
          contentHash: hasher.hash(source),
          symbols,
          edges,
          complexity,
          intent,
          antiPatterns,
        };

        writer.write(fileIndex);
        storage.writeSymbolFile(fileIndex);
        console.error(`[ctxo] Re-indexed: ${relativePath}`);
      } catch (err) {
        console.error(`[ctxo] Failed to re-index ${relativePath}: ${(err as Error).message}`);
      }
    };

    let communitySnapshotTimer: NodeJS.Timeout | undefined;
    const scheduleCommunitySnapshot = () => {
      if (communitySnapshotTimer) clearTimeout(communitySnapshotTimer);
      communitySnapshotTimer = setTimeout(() => {
        communitySnapshotTimer = undefined;
        try {
          const snapshot = buildWatchCommunitySnapshot(storage);
          if (snapshot) {
            storage.writeCommunities(snapshot);
            console.error(
              `[ctxo] Community snapshot refreshed (modularity ${snapshot.modularity.toFixed(3)})`,
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
      // Shutdown Roslyn keep-alive
      const roslynShutdown = roslynAdapter ? roslynAdapter.dispose() : Promise.resolve();
      roslynShutdown.then(() => {
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

function buildWatchCommunitySnapshot(storage: SqliteStorageAdapter): CommunitySnapshot | undefined {
  const symbols = storage.getAllSymbols();
  if (symbols.length === 0) return undefined;
  const edges = storage.getAllEdges();

  const graph = new SymbolGraph();
  for (const symbol of symbols) graph.addNode(symbol);
  for (const edge of edges) graph.addEdge(edge);

  const pagerank = new PageRankCalculator().calculate(graph, { limit: graph.nodeCount });
  const pagerankMap = new Map<string, number>();
  for (const entry of pagerank.rankings) pagerankMap.set(entry.symbolId, entry.score);

  const detector = new CommunityDetector();
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
