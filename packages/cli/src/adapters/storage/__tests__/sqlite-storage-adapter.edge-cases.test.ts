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

    writeFileSync(join(cacheDir, 'symbols.db'), 'this is not a valid SQLite file', 'utf-8');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = new SqliteStorageAdapter(tempDir);
    await adapter.init();

    expect(adapter.listIndexedFiles()).toEqual([]);
    expect(adapter.getAllSymbols()).toEqual([]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Corrupt DB'));

    adapter.close();
    spy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});

describe('SqliteStorageAdapter — no FK constraints', () => {
  it('stores edges even when target symbol does not exist (dangling edge)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-nofk-'));
    const adapter = new SqliteStorageAdapter(tempDir);
    await adapter.initEmpty();

    adapter.writeSymbolFile({
      file: 'src/foo.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/foo.ts::fn::function', name: 'fn', kind: 'function', startLine: 0, endLine: 5 }],
      edges: [{ from: 'src/foo.ts::fn::function', to: 'src/missing.ts::X::class', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    });

    // Edge IS stored (no FK to block it)
    const edges = adapter.getEdgesFrom('src/foo.ts::fn::function');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.to).toBe('src/missing.ts::X::class');

    // Symbol also written
    const sym = adapter.getSymbolById('src/foo.ts::fn::function');
    expect(sym?.name).toBe('fn');

    adapter.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('stores all edges in bulkWrite regardless of insert order', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ctxo-nofk2-'));
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

    const edges = adapter.getEdgesFrom('src/a.ts::A::function');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.to).toBe('src/b.ts::B::class');

    adapter.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});
