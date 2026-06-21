import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonIndexReader } from '../json-index-reader.js';
import { JsonIndexWriter } from '../json-index-writer.js';
import { buildFileIndex, buildSecondFileIndex } from './test-fixtures.js';

describe('JsonIndexReader', () => {
  let tempDir: string;
  let reader: JsonIndexReader;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-test-'));
    reader = new JsonIndexReader(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('reads valid JSON index file and returns FileIndex', () => {
    const writer = new JsonIndexWriter(tempDir);
    const fileIndex = buildFileIndex();
    writer.write(fileIndex);

    const results = reader.readAll();
    expect(results).toHaveLength(1);
    expect(results[0]?.file).toBe('src/foo.ts');
    expect(results[0]?.symbols).toHaveLength(1);
    expect(results[0]?.symbols[0]?.name).toBe('myFn');
  });

  it('reads multiple JSON index files', () => {
    const writer = new JsonIndexWriter(tempDir);
    writer.write(buildFileIndex());
    writer.write(buildSecondFileIndex());

    const results = reader.readAll();
    expect(results).toHaveLength(2);
  });

  it('rejects JSON with invalid schema and logs warning', () => {
    const indexDir = join(tempDir, 'index', 'src');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(
      join(indexDir, 'bad.ts.json'),
      JSON.stringify({ file: '', symbols: 'not-an-array' }),
      'utf-8',
    );

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const results = reader.readAll();
    expect(results).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[ctxo:json-reader]'),
    );
    spy.mockRestore();
  });

  it('returns empty array for empty index directory', () => {
    mkdirSync(join(tempDir, 'index'), { recursive: true });
    const results = reader.readAll();
    expect(results).toEqual([]);
  });

  it('returns empty array when index directory does not exist', () => {
    const results = reader.readAll();
    expect(results).toEqual([]);
  });

  it('skips non-JSON files in index directory', () => {
    const indexDir = join(tempDir, 'index');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'schema-version'), '1.0.0', 'utf-8');
    writeFileSync(join(indexDir, 'notes.txt'), 'ignore me', 'utf-8');

    const writer = new JsonIndexWriter(tempDir);
    writer.write(buildFileIndex());

    const results = reader.readAll();
    expect(results).toHaveLength(1);
  });

  it('logs warning to stderr for corrupt JSON file', () => {
    const indexDir = join(tempDir, 'index', 'src');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'corrupt.ts.json'), '{invalid json', 'utf-8');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const results = reader.readAll();
    expect(results).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[ctxo:json-reader] Failed to read'),
    );
    spy.mockRestore();
  });

  it('keeps valid symbols+edges when one edge has an invalid schema (resilient read)', () => {
    const indexDir = join(tempDir, 'index', 'src');
    mkdirSync(indexDir, { recursive: true });

    // One valid edge + one structurally-invalid edge (missing "kind" field)
    const data = {
      file: 'src/Foo.java',
      lastModified: 1711620000,
      symbols: [
        { symbolId: 'src/Foo.java::Foo::class', name: 'Foo', kind: 'class', startLine: 1, endLine: 10 },
      ],
      edges: [
        { from: 'src/Foo.java::Foo::class', to: 'Bar::class', kind: 'extends' },
        { from: 'src/Foo.java::Foo::class', to: 'MISSING_REQUIRED_KIND_FIELD' },
      ],
      intent: [],
      antiPatterns: [],
    };
    writeFileSync(join(indexDir, 'Foo.java.json'), JSON.stringify(data), 'utf-8');

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const results = reader.readAll();
    spy.mockRestore();

    expect(results).toHaveLength(1);
    const fileIndex = results[0]!;
    expect(fileIndex.file).toBe('src/Foo.java');
    // Valid symbol is preserved
    expect(fileIndex.symbols).toHaveLength(1);
    expect(fileIndex.symbols[0]?.name).toBe('Foo');
    // Valid edge is preserved; invalid edge is dropped
    expect(fileIndex.edges).toHaveLength(1);
    expect(fileIndex.edges[0]?.kind).toBe('extends');
    expect(fileIndex.edges[0]?.to).toBe('Bar::class');
  });

  it('keeps file with valid 2-part name-ref edge target (Java inheritance edge)', () => {
    const indexDir = join(tempDir, 'index', 'src');
    mkdirSync(indexDir, { recursive: true });

    const data = {
      file: 'src/Dog.java',
      lastModified: 1711620000,
      symbols: [
        { symbolId: 'src/Dog.java::Dog::class', name: 'Dog', kind: 'class', startLine: 1, endLine: 20 },
      ],
      edges: [
        { from: 'src/Dog.java::Dog::class', to: 'Animal::class', kind: 'extends' },
        { from: 'src/Dog.java::Dog::class', to: 'Runnable::interface', kind: 'implements' },
      ],
      intent: [],
      antiPatterns: [],
    };
    writeFileSync(join(indexDir, 'Dog.java.json'), JSON.stringify(data), 'utf-8');

    const results = reader.readAll();

    expect(results).toHaveLength(1);
    const fileIndex = results[0]!;
    expect(fileIndex.edges).toHaveLength(2);
    expect(fileIndex.edges[0]?.to).toBe('Animal::class');
    expect(fileIndex.edges[1]?.to).toBe('Runnable::interface');
  });
});
