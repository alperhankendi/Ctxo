import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { FileIndex, CoChangeMatrix } from '../../core/types.js';
import { atomicWrite } from './atomic-write.js';

export class JsonIndexWriter {
  private readonly indexDir: string;

  constructor(ctxoRoot: string) {
    this.indexDir = join(ctxoRoot, 'index');
  }

  write(fileIndex: FileIndex): void {
    if (!fileIndex.file) {
      throw new Error('FileIndex.file must not be empty');
    }

    const targetPath = this.resolveIndexPath(fileIndex.file);
    mkdirSync(dirname(targetPath), { recursive: true });

    const sorted = this.sortKeys(fileIndex);
    const json = JSON.stringify(sorted, null, 2);
    this.atomicWrite(targetPath, json);
  }

  writeCoChanges(matrix: CoChangeMatrix): void {
    mkdirSync(this.indexDir, { recursive: true });
    const targetPath = join(this.indexDir, 'co-changes.json');
    this.atomicWrite(targetPath, JSON.stringify(matrix, null, 2));
  }

  private atomicWrite(targetPath: string, content: string): void {
    atomicWrite(targetPath, content);
  }

  delete(relativePath: string): void {
    const targetPath = this.resolveIndexPath(relativePath);
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
  }

  private resolveIndexPath(relativePath: string): string {
    const resolved = resolve(this.indexDir, `${relativePath}.json`);
    const normalizedDir = resolve(this.indexDir) + sep;
    if (!resolved.startsWith(normalizedDir)) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return resolved;
  }

  private sortKeys(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortKeys(item));
    }
    if (obj !== null && typeof obj === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(obj).sort()) {
        sorted[key] = this.sortKeys((obj as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return obj;
  }
}
