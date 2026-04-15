import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FileIndexSchema, type FileIndex } from '../../core/types.js';

export class JsonIndexReader {
  private readonly indexDir: string;

  constructor(ctxoRoot: string) {
    this.indexDir = join(ctxoRoot, 'index');
  }

  readAll(): FileIndex[] {
    if (!existsSync(this.indexDir)) {
      return [];
    }

    const jsonFiles = this.collectJsonFiles(this.indexDir);
    const results: FileIndex[] = [];

    for (const filePath of jsonFiles) {
      const parsed = this.readSingle(filePath);
      if (parsed) {
        results.push(parsed);
      }
    }

    return results;
  }

  readSingle(absolutePath: string): FileIndex | undefined {
    try {
      const raw = readFileSync(absolutePath, 'utf-8');
      const data: unknown = JSON.parse(raw);
      const result = FileIndexSchema.safeParse(data);

      if (!result.success) {
        const rel = relative(this.indexDir, absolutePath);
        console.error(
          `[ctxo:json-reader] Invalid schema in ${rel}: ${result.error.message}`,
        );
        return undefined;
      }

      return result.data;
    } catch (err) {
      const rel = relative(this.indexDir, absolutePath);
      console.error(
        `[ctxo:json-reader] Failed to read ${rel}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private collectJsonFiles(dir: string, visited: Set<string> = new Set()): string[] {
    const realDir = realpathSync(dir);
    if (visited.has(realDir)) return []; // Guard against symlink loops
    visited.add(realDir);

    const files: string[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue; // Skip symlinks entirely

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip non-FileIndex directories under .ctxo/index/
        if (entry.name === 'communities.history') continue;
        files.push(...this.collectJsonFiles(fullPath, visited));
      } else if (
        entry.name.endsWith('.json') &&
        entry.name !== 'co-changes.json' &&
        entry.name !== 'communities.json'
      ) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
