import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { TsMorphAdapter } from '../adapters/language/ts-morph-adapter.js';
import { LanguageAdapterRegistry } from '../adapters/language/language-adapter-registry.js';
import { JsonIndexWriter } from '../adapters/storage/json-index-writer.js';
import { SqliteStorageAdapter } from '../adapters/storage/sqlite-storage-adapter.js';
import { SchemaManager } from '../adapters/storage/schema-manager.js';
import type { FileIndex } from '../core/types.js';

export class IndexCommand {
  private readonly projectRoot: string;
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  async run(): Promise<void> {
    console.error('[ctxo] Building codebase index...');

    // Set up adapters
    const registry = new LanguageAdapterRegistry();
    registry.register(new TsMorphAdapter());

    const writer = new JsonIndexWriter(this.ctxoRoot);
    const schemaManager = new SchemaManager(this.ctxoRoot);

    // Discover files
    const files = this.discoverFiles();
    console.error(`[ctxo] Found ${files.length} source files`);

    // Extract symbols and edges for each file
    const indices: FileIndex[] = [];
    let processed = 0;

    for (const filePath of files) {
      const adapter = registry.getAdapter(filePath);
      if (!adapter) continue;

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
        indices.push(fileIndex);
        processed++;

        if (processed % 50 === 0) {
          console.error(`[ctxo] Processed ${processed}/${files.length} files`);
        }
      } catch (err) {
        console.error(`[ctxo] Skipped ${relativePath}: ${(err as Error).message}`);
      }
    }

    // Write schema version
    schemaManager.writeVersion();

    // Populate SQLite cache (skip rebuildFromJson since we just wrote the JSON)
    const storage = new SqliteStorageAdapter(this.ctxoRoot);
    await storage.initEmpty();
    storage.bulkWrite(indices);
    storage.close();

    // Ensure .ctxo/.cache/ is in .gitignore
    this.ensureGitignore();

    console.error(`[ctxo] Index complete: ${processed} files indexed`);
  }

  private discoverFiles(): string[] {
    try {
      // Use git ls-files to discover tracked files (respects .gitignore)
      const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => this.isSupportedExtension(line))
        .map((line) => join(this.projectRoot, line));
    } catch {
      console.error('[ctxo] git ls-files failed, falling back to manual discovery');
      return [];
    }
  }

  private isSupportedExtension(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
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
}
