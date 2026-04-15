import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleSearchSymbols } from '../search-symbols.js';
import type { FileIndex } from '../../../core/types.js';

function buildIndices(): FileIndex[] {
  return [
    {
      file: 'src/core/graph.ts',
      lastModified: 1,
      symbols: [
        { symbolId: 'src/core/graph.ts::SymbolGraph::class', name: 'SymbolGraph', kind: 'class', startLine: 1, endLine: 80 },
        { symbolId: 'src/core/graph.ts::addNode::method', name: 'addNode', kind: 'method', startLine: 10, endLine: 15 },
      ],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/adapters/storage.ts',
      lastModified: 1,
      symbols: [
        { symbolId: 'src/adapters/storage.ts::SqliteStorageAdapter::class', name: 'SqliteStorageAdapter', kind: 'class', startLine: 1, endLine: 200 },
        { symbolId: 'src/adapters/storage.ts::getSymbolById::method', name: 'getSymbolById', kind: 'method', startLine: 50, endLine: 60 },
      ],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
  ];
}

describe('SearchSymbolsHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-search-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('finds symbols by exact name match', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: 'SymbolGraph' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.totalMatches).toBe(1);
    expect(payload.results[0].name).toBe('SymbolGraph');
    expect(payload.results[0].kind).toBe('class');
  });

  it('finds symbols by substring match', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: 'Symbol' });
    const payload = JSON.parse(result.content[0]!.text);

    // SymbolGraph + getSymbolById
    expect(payload.totalMatches).toBe(2);
  });

  it('supports regex patterns', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: '^get' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.totalMatches).toBe(1);
    expect(payload.results[0].name).toBe('getSymbolById');
  });

  it('falls back to literal match on invalid regex', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: '[invalid' });
    const payload = JSON.parse(result.content[0]!.text);

    // Should not crash — falls back to substring
    expect(payload.totalMatches).toBe(0);
  });

  it('filters by kind', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: '.*', kind: 'class' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.totalMatches).toBe(2); // SymbolGraph + SqliteStorageAdapter
    expect(payload.results.every((r: { kind: string }) => r.kind === 'class')).toBe(true);
  });

  it('filters by filePattern', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: '.*', filePattern: 'adapters' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.results.every((r: { file: string }) => r.file.includes('adapters'))).toBe(true);
  });

  it('respects limit', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: '.*', limit: 1 });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.results.length).toBe(1);
    expect(payload.totalMatches).toBeGreaterThan(1);
  });

  it('returns empty for no matches', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: 'NonExistentSymbol' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.totalMatches).toBe(0);
    expect(payload.results).toEqual([]);
  });

  it('returns error for empty pattern', () => {
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: '' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.error).toBe(true);
  });

  it('prepends staleness warning when stale', () => {
    const mockStaleness = { check: () => ({ message: 'Index stale' }) };
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({ pattern: 'SymbolGraph' });

    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0]!.text).toContain('stale');
  });

  it('no staleness warning when index is fresh', () => {
    const mockStaleness = { check: () => undefined };
    const handler = handleSearchSymbols(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({ pattern: 'SymbolGraph' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.text).not.toContain('stale');
  });

  it('applies masking to response', () => {
    const sensitiveIndex: FileIndex = {
      file: 'src/config.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE', kind: 'variable', startLine: 0, endLine: 1 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(sensitiveIndex);

    const handler = handleSearchSymbols(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ pattern: 'AKIA' });

    expect(result.content[0]!.text).toContain('[REDACTED:AWS_KEY]');
  });
});
