import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../sqlite-storage-adapter.js';
import { JsonIndexWriter } from '../json-index-writer.js';
import { buildFileIndex, buildSecondFileIndex } from './test-fixtures.js';

describe('SqliteStorageAdapter — IStoragePort contract', () => {
  let tempDir: string;
  let adapter: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-sqlite-'));
    adapter = new SqliteStorageAdapter(tempDir);
    await adapter.init();
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('writes and reads back a symbol file', () => {
    const fileIndex = buildFileIndex();
    adapter.writeSymbolFile(fileIndex);

    const result = adapter.readSymbolFile('src/foo.ts');
    expect(result).toBeDefined();
    expect(result?.file).toBe('src/foo.ts');
    expect(result?.lastModified).toBe(1711620000);
    expect(result?.symbols).toHaveLength(1);
    expect(result?.symbols[0]?.name).toBe('myFn');
  });

  it('lists all indexed files after multiple writes', () => {
    adapter.writeSymbolFile(buildFileIndex());
    adapter.writeSymbolFile(buildSecondFileIndex());

    const files = adapter.listIndexedFiles();
    expect(files).toEqual(['src/bar.ts', 'src/foo.ts']);
  });

  it('deletes a symbol file and confirms removal', () => {
    adapter.writeSymbolFile(buildFileIndex());
    expect(adapter.readSymbolFile('src/foo.ts')).toBeDefined();

    adapter.deleteSymbolFile('src/foo.ts');
    expect(adapter.readSymbolFile('src/foo.ts')).toBeUndefined();
  });

  it('returns undefined for non-existent symbol ID', () => {
    const result = adapter.getSymbolById('src/nonexistent.ts::nothing::function');
    expect(result).toBeUndefined();
  });

  it('returns empty array for edges from non-existent symbol', () => {
    const edges = adapter.getEdgesFrom('src/nonexistent.ts::nothing::function');
    expect(edges).toEqual([]);
  });

  it('returns forward edges for a given symbol', () => {
    adapter.writeSymbolFile(buildFileIndex());

    const edges = adapter.getEdgesFrom('src/foo.ts::myFn::function');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({
      from: 'src/foo.ts::myFn::function',
      to: 'src/bar.ts::TokenValidator::class',
      kind: 'imports',
    });
  });

  it('returns reverse edges pointing to a given symbol', () => {
    adapter.writeSymbolFile(buildFileIndex());

    const edges = adapter.getEdgesTo('src/bar.ts::TokenValidator::class');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.from).toBe('src/foo.ts::myFn::function');
  });

  it('bulk writes multiple file indices atomically', () => {
    adapter.bulkWrite([buildFileIndex(), buildSecondFileIndex()]);

    const files = adapter.listIndexedFiles();
    expect(files).toEqual(['src/bar.ts', 'src/foo.ts']);

    const allSymbols = adapter.getAllSymbols();
    expect(allSymbols).toHaveLength(2);
  });

  it('returns all edges across all files', () => {
    adapter.bulkWrite([buildFileIndex(), buildSecondFileIndex()]);

    const allEdges = adapter.getAllEdges();
    expect(allEdges).toHaveLength(1);
    expect(allEdges[0]?.kind).toBe('imports');
  });

  it('overwrites file data on re-write without duplication', () => {
    adapter.writeSymbolFile(buildFileIndex({ lastModified: 1000 }));
    adapter.writeSymbolFile(buildFileIndex({ lastModified: 2000 }));

    const result = adapter.readSymbolFile('src/foo.ts');
    expect(result?.lastModified).toBe(2000);
    expect(adapter.getAllSymbols()).toHaveLength(1);
  });

  it('handles symbol ID with special characters (::)', () => {
    adapter.writeSymbolFile(buildFileIndex());

    const sym = adapter.getSymbolById('src/foo.ts::myFn::function');
    expect(sym?.symbolId).toBe('src/foo.ts::myFn::function');
    expect(sym?.name).toBe('myFn');
    expect(sym?.kind).toBe('function');
    expect(sym?.startLine).toBe(12);
    expect(sym?.endLine).toBe(45);
  });
});

describe('SqliteStorageAdapter — cold start rebuild', () => {
  it('rebuilds from JSON index when no SQLite DB exists', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-cold-'));

    // Write JSON index first
    const writer = new JsonIndexWriter(tempDir);
    writer.write(buildFileIndex());
    writer.write(buildSecondFileIndex());

    // Create adapter — should rebuild from JSON
    const adapter = new SqliteStorageAdapter(tempDir);
    await adapter.init();

    const files = adapter.listIndexedFiles();
    expect(files).toEqual(['src/bar.ts', 'src/foo.ts']);

    const allSymbols = adapter.getAllSymbols();
    expect(allSymbols).toHaveLength(2);

    adapter.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});
