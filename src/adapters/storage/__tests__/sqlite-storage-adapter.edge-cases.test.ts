import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../sqlite-storage-adapter.js';

describe('SqliteStorageAdapter — corrupt DB recovery', () => {
  it('auto-rebuilds when SQLite DB file is corrupt', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-corrupt-'));
    const cacheDir = join(tempDir, '.cache');
    mkdirSync(cacheDir, { recursive: true });

    // Write corrupt data as DB file
    writeFileSync(join(cacheDir, 'symbols.db'), 'this is not a valid SQLite file', 'utf-8');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = new SqliteStorageAdapter(tempDir);
    await adapter.init();

    // Should recover and have empty but functional DB
    expect(adapter.listIndexedFiles()).toEqual([]);
    expect(adapter.getAllSymbols()).toEqual([]);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Corrupt DB'));

    adapter.close();
    spy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('SqliteStorageAdapter — FK constraint handling', () => {
  it('skips edge insert gracefully when target symbol is not indexed', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-fk-'));
    const adapter = new SqliteStorageAdapter(tempDir);
    await adapter.initEmpty();

    // Write file with edge to non-existent target
    adapter.writeSymbolFile({
      file: 'src/foo.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/foo.ts::fn::function', name: 'fn', kind: 'function', startLine: 0, endLine: 5 }],
      edges: [{ from: 'src/foo.ts::fn::function', to: 'src/missing.ts::X::class', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    });

    // Edge should be silently skipped
    const edges = adapter.getEdgesFrom('src/foo.ts::fn::function');
    expect(edges).toEqual([]);

    // Symbol should still be written
    const sym = adapter.getSymbolById('src/foo.ts::fn::function');
    expect(sym?.name).toBe('fn');

    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('inserts edge successfully when target symbol exists via bulkWrite', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-fk2-'));
    const adapter = new SqliteStorageAdapter(tempDir);
    await adapter.initEmpty();

    adapter.bulkWrite([
      {
        file: 'src/a.ts',
        lastModified: 1,
        symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 0, endLine: 5 }],
        edges: [{ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'imports' }],
        intent: [],
        antiPatterns: [],
      },
      {
        file: 'src/b.ts',
        lastModified: 1,
        symbols: [{ symbolId: 'src/b.ts::B::class', name: 'B', kind: 'class', startLine: 0, endLine: 10 }],
        edges: [],
        intent: [],
        antiPatterns: [],
      },
    ]);

    // Edge should exist because both symbols were inserted in symbols-first phase
    const edges = adapter.getEdgesFrom('src/a.ts::A::function');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.to).toBe('src/b.ts::B::class');

    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('SqliteStorageAdapter — initEmpty', () => {
  it('creates tables without rebuilding from JSON', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-empty-'));
    const adapter = new SqliteStorageAdapter(tempDir);
    await adapter.initEmpty();

    expect(adapter.listIndexedFiles()).toEqual([]);
    expect(adapter.getAllSymbols()).toEqual([]);

    adapter.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
});
