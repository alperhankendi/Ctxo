import { join } from 'node:path';
import { SqliteStorageAdapter } from '../adapters/storage/sqlite-storage-adapter.js';

export class SyncCommand {
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  async run(): Promise<void> {
    console.error('[ctxo] Rebuilding SQLite cache from committed JSON index...');

    const storage = new SqliteStorageAdapter(this.ctxoRoot);
    await storage.init(); // init() rebuilds from JSON automatically
    storage.close();

    console.error('[ctxo] Sync complete');
  }
}
