import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { SchemaManager } from '../adapters/storage/schema-manager.js';

export class StatusCommand {
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  run(): void {
    const indexDir = join(this.ctxoRoot, 'index');

    if (!existsSync(indexDir)) {
      console.error('[ctxo] No index found. Run "ctxo index" first.');
      return;
    }

    const schemaManager = new SchemaManager(this.ctxoRoot);
    const version = schemaManager.readStoredVersion() ?? 'unknown';

    const reader = new JsonIndexReader(this.ctxoRoot);
    const indices = reader.readAll();

    const totalSymbols = indices.reduce((sum, idx) => sum + idx.symbols.length, 0);
    const totalEdges = indices.reduce((sum, idx) => sum + idx.edges.length, 0);

    const oldest = indices.length > 0
      ? Math.min(...indices.map((idx) => idx.lastModified))
      : 0;
    const newest = indices.length > 0
      ? Math.max(...indices.map((idx) => idx.lastModified))
      : 0;

    console.error(`[ctxo] Index Status`);
    console.error(`  Schema version: ${version}`);
    console.error(`  Indexed files:  ${indices.length}`);
    console.error(`  Total symbols:  ${totalSymbols}`);
    console.error(`  Total edges:    ${totalEdges}`);

    if (indices.length > 0) {
      console.error(`  Oldest entry:   ${new Date(oldest * 1000).toISOString()}`);
      console.error(`  Newest entry:   ${new Date(newest * 1000).toISOString()}`);
    }

    const cacheExists = existsSync(join(this.ctxoRoot, '.cache', 'symbols.db'));
    console.error(`  SQLite cache:   ${cacheExists ? 'present' : 'missing (run ctxo sync)'}`);
  }
}
