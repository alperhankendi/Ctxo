import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonIndexWriter } from '../json-index-writer.js';
import { buildFileIndex } from './test-fixtures.js';

describe('JsonIndexWriter', () => {
  let tempDir: string;
  let writer: JsonIndexWriter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-test-'));
    writer = new JsonIndexWriter(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
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
});
