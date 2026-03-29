import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileIndex } from '../../core/types.js';

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
    writeFileSync(targetPath, json, 'utf-8');
  }

  delete(relativePath: string): void {
    const targetPath = this.resolveIndexPath(relativePath);
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
  }

  private resolveIndexPath(relativePath: string): string {
    return join(this.indexDir, `${relativePath}.json`);
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
