import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonIndexWriter } from '../json-index-writer.js';
import { INDEX_ARTIFACT_FILES } from '../json-index-reader.js';
import { buildFileIndex } from './test-fixtures.js';
import type { CoChangeMatrix } from '../../../core/types.js';

describe('JsonIndexWriter', () => {
  let tempDir: string;
  let writer: JsonIndexWriter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-test-'));
    writer = new JsonIndexWriter(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('writes deterministic JSON with sorted keys for identical input', () => {
    const fileIndex = buildFileIndex();
    writer.write(fileIndex);

    const outputPath = join(tempDir, 'index', 'src', 'foo.ts.json');
    const content = readFileSync(outputPath, 'utf-8');
    const parsed = JSON.parse(content);

    const keys = Object.keys(parsed);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  it('produces 2-space indented output', () => {
    writer.write(buildFileIndex());

    const outputPath = join(tempDir, 'index', 'src', 'foo.ts.json');
    const content = readFileSync(outputPath, 'utf-8');

    expect(content).toContain('  "');
    expect(content).not.toContain('\t');
  });

  it('creates nested directories for deep file paths', () => {
    const fileIndex = buildFileIndex({ file: 'src/adapters/storage/deep/file.ts' });
    writer.write(fileIndex);

    const outputPath = join(tempDir, 'index', 'src', 'adapters', 'storage', 'deep', 'file.ts.json');
    expect(existsSync(outputPath)).toBe(true);
  });

  it('overwrites existing index file without corruption', () => {
    const original = buildFileIndex({ lastModified: 1000 });
    writer.write(original);

    const updated = buildFileIndex({ lastModified: 2000 });
    writer.write(updated);

    const outputPath = join(tempDir, 'index', 'src', 'foo.ts.json');
    const content = readFileSync(outputPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.lastModified).toBe(2000);
  });

  it('deletes index file for removed source file', () => {
    writer.write(buildFileIndex());
    const outputPath = join(tempDir, 'index', 'src', 'foo.ts.json');
    expect(existsSync(outputPath)).toBe(true);

    writer.delete('src/foo.ts');
    expect(existsSync(outputPath)).toBe(false);
  });

  it('throws when file path is empty string', () => {
    const fileIndex = buildFileIndex({ file: '' });
    expect(() => writer.write(fileIndex)).toThrow('FileIndex.file must not be empty');
  });

  it('handles file path with spaces', () => {
    const fileIndex = buildFileIndex({ file: 'src/my folder/file.ts' });
    writer.write(fileIndex);

    const outputPath = join(tempDir, 'index', 'src', 'my folder', 'file.ts.json');
    expect(existsSync(outputPath)).toBe(true);
  });

  it('produces byte-identical output across repeated writes', () => {
    const fileIndex = buildFileIndex();
    writer.write(fileIndex);
    const outputPath = join(tempDir, 'index', 'src', 'foo.ts.json');
    const first = readFileSync(outputPath, 'utf-8');

    writer.write(fileIndex);
    const second = readFileSync(outputPath, 'utf-8');

    expect(first).toBe(second);
  });

  it('does not throw when deleting non-existent file', () => {
    expect(() => writer.delete('src/nonexistent.ts')).not.toThrow();
  });

  describe('deleteEntryFile', () => {
    it('deletes the entry file at that path and says so', () => {
      writer.write(buildFileIndex());
      const entryPath = join(tempDir, 'index', 'src', 'foo.ts.json');

      expect(writer.deleteEntryFile(entryPath)).toBe(true);
      expect(existsSync(entryPath)).toBe(false);
    });

    it('returns false when the file is not there, so nothing is counted as deleted', () => {
      writer.write(buildFileIndex());

      expect(writer.deleteEntryFile(join(tempDir, 'index', 'src', 'missing.ts.json'))).toBe(false);
    });

    it.each([...INDEX_ARTIFACT_FILES])(
      'refuses the artifact %s that lives next to the entries',
      (artifact) => {
        const artifactPath = join(tempDir, 'index', artifact);
        mkdirSync(join(tempDir, 'index'), { recursive: true });
        writeFileSync(artifactPath, '{}', 'utf-8');

        expect(() => writer.deleteEntryFile(artifactPath)).toThrow(/artifact/);
        expect(existsSync(artifactPath)).toBe(true);
      },
    );

    it('refuses a snapshot in communities.history', () => {
      const snapshotPath = join(tempDir, 'index', 'communities.history', '2026-01-01T00-00-00-000Z-abc1234.json');
      mkdirSync(join(tempDir, 'index', 'communities.history'), { recursive: true });
      writeFileSync(snapshotPath, '{}', 'utf-8');

      expect(() => writer.deleteEntryFile(snapshotPath)).toThrow(/artifact/);
      expect(existsSync(snapshotPath)).toBe(true);
    });

    it('refuses a path outside the index folder', () => {
      const outside = join(tempDir, 'outside.json');
      writeFileSync(outside, '{}', 'utf-8');

      expect(() => writer.deleteEntryFile(outside)).toThrow(/index folder/);
      expect(existsSync(outside)).toBe(true);
    });
  });

  it('does not leave .tmp files after write', () => {
    writer.write(buildFileIndex());

    const indexDir = join(tempDir, 'index', 'src');
    const files = require('node:fs').readdirSync(indexDir) as string[];
    const tmpFiles = files.filter((f: string) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  describe('writeCoChanges', () => {
    const LONG_AGO = new Date('2001-01-01T00:00:00Z');

    function matrix(overrides: Partial<CoChangeMatrix> = {}): CoChangeMatrix {
      return {
        version: 1,
        timestamp: 1_760_000_000,
        window: {
          maxCommits: 2000,
          head: 'abc1234',
          commitsScanned: 10,
          commitsUsed: 9,
          massSkipped: 1,
          maxFilesPerCommit: 30,
          minShared: 2,
        },
        entries: [{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 3, frequency: 0.75 }],
        ...overrides,
      };
    }

    function coChangesPath(): string {
      return join(tempDir, 'index', 'co-changes.json');
    }

    /** Pins the file's mtime far in the past, so a rewrite shows up as a newer mtime. */
    function ageFile(path: string): number {
      utimesSync(path, LONG_AGO, LONG_AGO);
      return statSync(path).mtimeMs;
    }

    it('writes co-changes.json and returns true on the first write', () => {
      const written = writer.writeCoChanges(matrix());

      expect(written).toBe(true);
      expect(JSON.parse(readFileSync(coChangesPath(), 'utf-8'))).toEqual(matrix());
    });

    it('writeCoChanges returns false and keeps the file when only the timestamp differs', () => {
      writer.writeCoChanges(matrix({ timestamp: 1_760_000_000 }));
      const before = readFileSync(coChangesPath(), 'utf-8');
      const agedMtime = ageFile(coChangesPath());

      const written = writer.writeCoChanges(matrix({ timestamp: 1_770_000_000 }));

      expect(written).toBe(false);
      expect(readFileSync(coChangesPath(), 'utf-8')).toBe(before);
      // The file was not even touched: same mtime, no leftover temp file.
      expect(statSync(coChangesPath()).mtimeMs).toBe(agedMtime);
      expect(readdirSync(join(tempDir, 'index')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });

    it('returns true and rewrites the file when an entry changes', () => {
      writer.writeCoChanges(matrix());
      const agedMtime = ageFile(coChangesPath());

      const written = writer.writeCoChanges(
        matrix({ entries: [{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 4, frequency: 0.8 }] }),
      );

      expect(written).toBe(true);
      expect(statSync(coChangesPath()).mtimeMs).toBeGreaterThan(agedMtime);
      expect(JSON.parse(readFileSync(coChangesPath(), 'utf-8')).entries[0].sharedCommits).toBe(4);
    });

    it('returns true and rewrites the file when only the window changes', () => {
      const base = matrix();
      writer.writeCoChanges(base);

      const written = writer.writeCoChanges(matrix({ window: { ...base.window!, head: 'def5678', commitsScanned: 11 } }));

      expect(written).toBe(true);
      expect(JSON.parse(readFileSync(coChangesPath(), 'utf-8')).window.head).toBe('def5678');
    });

    it('returns false for an identical window without since and true once since is set', () => {
      const withoutSince = matrix();
      writer.writeCoChanges(withoutSince);

      expect(writer.writeCoChanges(matrix({ timestamp: 1 }))).toBe(false);
      expect(writer.writeCoChanges(matrix({ window: { ...withoutSince.window!, since: '12m' } }))).toBe(true);
    });

    it('rewrites a legacy file that has the same entries but no window', () => {
      const current = matrix();
      const { window: _window, ...legacy } = current;
      writer.writeCoChanges(legacy);
      expect(JSON.parse(readFileSync(coChangesPath(), 'utf-8'))).not.toHaveProperty('window');

      const written = writer.writeCoChanges(current);

      expect(written).toBe(true);
      expect(JSON.parse(readFileSync(coChangesPath(), 'utf-8')).window).toEqual(current.window);
    });

    it('rewrites a file that is not valid JSON', () => {
      writer.writeCoChanges(matrix());
      writeFileSync(coChangesPath(), '{ not json', 'utf-8');

      const written = writer.writeCoChanges(matrix());

      expect(written).toBe(true);
      expect(JSON.parse(readFileSync(coChangesPath(), 'utf-8'))).toEqual(matrix());
    });
  });
});
