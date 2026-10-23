import { mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { FileIndex, CoChangeMatrix } from '../../core/types.js';
import { atomicWrite } from './atomic-write.js';
import { COMMUNITY_HISTORY_DIR, INDEX_ARTIFACT_FILES } from './json-index-reader.js';

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

  /**
   * Writes `co-changes.json`. Returns false and leaves the file untouched when it already holds the
   * same `window` and `entries`: `timestamp` is metadata, so a run that found nothing new does not
   * show up as a change in git. Returns true when the file was (re)written.
   */
  writeCoChanges(matrix: CoChangeMatrix): boolean {
    mkdirSync(this.indexDir, { recursive: true });
    const targetPath = join(this.indexDir, 'co-changes.json');
    if (this.holdsSameCoChanges(targetPath, matrix)) return false;

    this.atomicWrite(targetPath, JSON.stringify(matrix, null, 2));
    return true;
  }

  /** True when the file at `targetPath` parses and has the same `window` and `entries` as `matrix`. */
  private holdsSameCoChanges(targetPath: string, matrix: CoChangeMatrix): boolean {
    if (!existsSync(targetPath)) return false;
    try {
      const existing: unknown = JSON.parse(readFileSync(targetPath, 'utf-8'));
      if (existing === null || typeof existing !== 'object') return false;
      const { window, entries } = existing as Partial<CoChangeMatrix>;
      return isDeepStrictEqual(window, matrix.window) && isDeepStrictEqual(entries, matrix.entries);
    } catch {
      // Unreadable or not JSON: treat it as different, so the write below replaces it.
      return false;
    }
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

  /**
   * Deletes the JSON file of one index entry, given the path it was read from (see `JsonIndexReader.readEntries`)
   * rather than the source path it claims to be for, which a corrupt or crafted file can set to any name,
   * an artifact's included. Returns true when a file was deleted and false when there was none.
   *
   * Throws for a path outside the index folder, and for the artifacts that live there but are not entries
   * (the co-change matrix, the community snapshot and its history, the architecture artifacts).
   */
  deleteEntryFile(jsonPath: string): boolean {
    const resolved = resolve(jsonPath);
    const indexDir = resolve(this.indexDir);
    if (!resolved.startsWith(indexDir + sep)) {
      throw new Error(`Not inside the index folder: ${jsonPath}`);
    }
    const inIndex = relative(indexDir, resolved).replace(/\\/g, '/');
    if (INDEX_ARTIFACT_FILES.includes(inIndex) || inIndex.startsWith(`${COMMUNITY_HISTORY_DIR}/`)) {
      throw new Error(`Refusing to delete the index artifact ${inIndex}`);
    }
    if (!existsSync(resolved)) return false;
    unlinkSync(resolved);
    return true;
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
