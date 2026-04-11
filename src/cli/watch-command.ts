import { join, extname, relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { TsMorphAdapter } from '../adapters/language/ts-morph-adapter.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { JsonIndexWriter } from '../adapters/storage/json-index-writer.js';
import { SqliteStorageAdapter } from '../adapters/storage/sqlite-storage-adapter.js';
import { ChokidarWatcherAdapter } from '../adapters/watcher/chokidar-watcher-adapter.js';
import { ContentHasher } from '../core/staleness/content-hasher.js';
import { SimpleGitAdapter } from '../adapters/git/simple-git-adapter.js';
import { RevertDetector } from '../core/why-context/revert-detector.js';
import { RoslynAdapter } from '../adapters/language/roslyn/roslyn-adapter.js';
import type { FileIndex, CommitIntent, AntiPattern } from '../core/types.js';

const DEBOUNCE_MS = 300;

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
    registry.register(new TsMorphAdapter());

    // C# - try Roslyn keep-alive, fallback to tree-sitter
    let roslynAdapter: RoslynAdapter | null = null;
    try {
      const roslyn = new RoslynAdapter();
      await roslyn.initialize(this.projectRoot);
      if (roslyn.isReady()) {
        // Batch index first to warm cache, then start keep-alive
        await roslyn.batchIndex();
        const started = await roslyn.startKeepAlive();
        if (started) {
          registry.register(roslyn);
          roslynAdapter = roslyn;
          console.error('[ctxo] C# watch: Roslyn keep-alive active (full tier, <100ms per change)');
        } else {
          await roslyn.dispose();
          this.registerTreeSitterCSharp(registry);
        }
      } else {
        this.registerTreeSitterCSharp(registry);
      }
    } catch {
      this.registerTreeSitterCSharp(registry);
    }

    // Go - tree-sitter
    this.registerTreeSitterGo(registry);

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

    const debouncedReindex = (filePath: string) => {
      const existing = pendingFiles.get(filePath);
      if (existing) clearTimeout(existing);

      pendingFiles.set(
        filePath,
        setTimeout(() => {
          pendingFiles.delete(filePath);
          reindexFile(filePath);
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

  private registerTreeSitterCSharp(registry: LanguageAdapterRegistry): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CSharpAdapter } = require('../adapters/language/csharp-adapter.js');
      registry.register(new CSharpAdapter());
    } catch {
      console.error('[ctxo] C# adapter unavailable (tree-sitter-c-sharp not installed)');
    }
  }

  private registerTreeSitterGo(registry: LanguageAdapterRegistry): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoAdapter } = require('../adapters/language/go-adapter.js');
      registry.register(new GoAdapter());
    } catch {
      console.error('[ctxo] Go adapter unavailable (tree-sitter-go not installed)');
    }
  }
}
