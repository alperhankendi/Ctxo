import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

  private collectJsonFiles(dir: string): string[] {
    const files: string[] = [];

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.collectJsonFiles(fullPath));
      } else if (entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }

    return files;
  }
}
