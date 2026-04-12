import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import { SchemaManager } from '../adapters/storage/schema-manager.js';

export class StatusCommand {
  private readonly projectRoot: string;
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
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

    console.error(`[ctxo] Index Status`);
    console.error(`  Schema version: ${version}`);
    console.error(`  Indexed files:  ${indices.length}`);
    console.error(`  Total symbols:  ${totalSymbols}`);
    console.error(`  Total edges:    ${totalEdges}`);

    const cacheExists = existsSync(join(this.ctxoRoot, '.cache', 'symbols.db'));
    console.error(`  SQLite cache:   ${cacheExists ? 'present' : 'missing (run ctxo sync)'}`);

    // Per-file listing with timestamps
    if (indices.length > 0) {
      console.error('');
      console.error('  Files:');

      // Get source files to detect orphans
      const sourceFiles = this.getSourceFiles();

      for (const idx of indices.sort((a, b) => a.file.localeCompare(b.file))) {
        const ts = new Date(idx.lastModified * 1000).toISOString();
        const isOrphaned = sourceFiles.size > 0 && !sourceFiles.has(idx.file);
        const badge = isOrphaned ? ' [orphaned]' : '';
        console.error(`    ${idx.file}  ${ts}  (${idx.symbols.length} symbols, ${idx.edges.length} edges)${badge}`);
      }
    }
  }

  private getSourceFiles(): Set<string> {
    try {
      const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
      });
      return new Set(output.split('\n').map((l) => l.trim()).filter((l) => l.length > 0));
    } catch {
      return new Set();
    }
  }
}
