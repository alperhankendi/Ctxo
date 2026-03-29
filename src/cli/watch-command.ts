import { join, extname, relative } from 'node:path';
import { readFileSync } from 'node:fs';
import { watch } from 'chokidar';
import { TsMorphAdapter } from '../adapters/language/ts-morph-adapter.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { JsonIndexWriter } from '../adapters/storage/json-index-writer.js';
import { SqliteStorageAdapter } from '../adapters/storage/sqlite-storage-adapter.js';
import type { FileIndex } from '../core/types.js';

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
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

    const writer = new JsonIndexWriter(this.ctxoRoot);
    const storage = new SqliteStorageAdapter(this.ctxoRoot);
    await storage.init();

    const pendingFiles = new Map<string, NodeJS.Timeout>();

    const watcher = watch(this.projectRoot, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.ctxo/**',
        '**/dist/**',
        '**/coverage/**',
      ],
      persistent: true,
      ignoreInitial: true,
    });

    const reindexFile = (filePath: string) => {
      const ext = extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) return;

      const adapter = registry.getAdapter(filePath);
      if (!adapter) return;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');

      try {
        const source = readFileSync(filePath, 'utf-8');
        const lastModified = Math.floor(Date.now() / 1000);

        const symbols = adapter.extractSymbols(relativePath, source);
        const edges = adapter.extractEdges(relativePath, source);

        const fileIndex: FileIndex = {
          file: relativePath,
          lastModified,
          symbols,
          edges,
          intent: [],
          antiPatterns: [],
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

    watcher.on('change', debouncedReindex);
    watcher.on('add', debouncedReindex);
    watcher.on('unlink', (filePath) => {
      const ext = extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) return;

      const relativePath = relative(this.projectRoot, filePath).replace(/\\/g, '/');

      writer.delete(relativePath);
      storage.deleteSymbolFile(relativePath);
      console.error(`[ctxo] Removed from index: ${relativePath}`);
    });

    console.error('[ctxo] Watching for file changes... (Ctrl+C to stop)');

    // Graceful shutdown
    const cleanup = () => {
      console.error('\n[ctxo] Stopping watcher...');
      for (const timeout of pendingFiles.values()) {
        clearTimeout(timeout);
      }
      watcher.close().then(() => {
        storage.close();
        console.error('[ctxo] Watcher stopped');
        process.exit(0);
      });
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
}
