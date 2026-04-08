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
    this.registerTreeSitterAdapters(registry);
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
        const source = readFileSync(filePath, 'utf-8');
        const lastModified = Math.floor(Date.now() / 1000);

        const symbols = adapter.extractSymbols(relativePath, source);
        const edges = adapter.extractEdges(relativePath, source);
        const complexity = adapter.extractComplexity(relativePath, source);

        // Git history and anti-patterns
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
      watcher.stop().then(() => {
        storage.close();
        console.error('[ctxo] Watcher stopped');
        process.exit(0);
      });
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  private registerTreeSitterAdapters(registry: LanguageAdapterRegistry): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoAdapter } = require('../adapters/language/go-adapter.js');
      registry.register(new GoAdapter());
    } catch {
      console.error('[ctxo] Go adapter unavailable (tree-sitter-go not installed)');
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CSharpAdapter } = require('../adapters/language/csharp-adapter.js');
      registry.register(new CSharpAdapter());
    } catch {
      console.error('[ctxo] C# adapter unavailable (tree-sitter-c-sharp not installed)');
    }
  }
}
