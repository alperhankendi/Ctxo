import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleFindImporters } from '../find-importers.js';
import type { FileIndex } from '../../../core/types.js';

function buildIndices(): FileIndex[] {
  return [
    {
      file: 'src/a.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 10 }],
      edges: [{ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/b.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/b.ts::B::class', name: 'B', kind: 'class', startLine: 1, endLine: 20 }],
      edges: [
        { from: 'src/b.ts::B::class', to: 'src/c.ts::C::interface', kind: 'implements' },
        { from: 'src/b.ts::B::class', to: 'src/d.ts::D::class', kind: 'calls' },
      ],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/c.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/c.ts::C::interface', name: 'C', kind: 'interface', startLine: 1, endLine: 10 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/d.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/d.ts::D::class', name: 'D', kind: 'class', startLine: 1, endLine: 30 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
  ];
}

describe('FindImportersHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-importers-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns direct importers', () => {
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/b.ts::B::class' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.importerCount).toBe(1);
    expect(payload.importers[0].symbolId).toBe('src/a.ts::A::function');
    expect(payload.importers[0].edgeKind).toBe('imports');
    expect(payload.importers[0].depth).toBe(1);
  });

  it('returns transitive importers via BFS', () => {
    // C is implemented by B, B is imported by A → transitive: A imports C indirectly
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/c.ts::C::interface', transitive: true });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.importerCount).toBe(2); // B at depth 1, A at depth 2
    expect(payload.importers[0].symbolId).toBe('src/b.ts::B::class');
    expect(payload.importers[0].depth).toBe(1);
    expect(payload.importers[1].symbolId).toBe('src/a.ts::A::function');
    expect(payload.importers[1].depth).toBe(2);
  });

  it('filters by edgeKinds', () => {
    // D has importers: B (via calls). Filter to imports only → empty
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/d.ts::D::class', edgeKinds: ['imports'] });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.importerCount).toBe(0);
  });

  it('returns calls edge when filtering by calls', () => {
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/d.ts::D::class', edgeKinds: ['calls'] });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.importerCount).toBe(1);
    expect(payload.importers[0].edgeKind).toBe('calls');
  });

  it('returns empty for symbol with no importers', () => {
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/a.ts::A::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.importerCount).toBe(0);
    expect(payload.importers).toEqual([]);
  });

  it('returns { found: false } for missing symbol', () => {
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/missing.ts::X::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.found).toBe(false);
  });

  it('respects maxDepth in transitive mode', () => {
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/c.ts::C::interface', transitive: true, maxDepth: 1 });
    const payload = JSON.parse(result.content[0]!.text);

    // Only depth 1 (B), not depth 2 (A)
    expect(payload.importerCount).toBe(1);
    expect(payload.importers[0].depth).toBe(1);
  });

  it('returns error for empty symbolId', () => {
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: '' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.error).toBe(true);
  });

  it('filters by edgeKinds in transitive mode', () => {
    // C ← B (implements) ← A (imports). Filter to implements only → only B at depth 1
    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/c.ts::C::interface', transitive: true, edgeKinds: ['implements'] });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.importerCount).toBe(1);
    expect(payload.importers[0].edgeKind).toBe('implements');
  });

  it('handles circular dependencies in transitive mode without infinite loop', () => {
    // Add circular edge: D → A → B → D
    const circularIndex: FileIndex = {
      file: 'src/d.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/d.ts::D::class', name: 'D', kind: 'class', startLine: 1, endLine: 30 }],
      edges: [{ from: 'src/d.ts::D::class', to: 'src/a.ts::A::function', kind: 'calls' }],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(circularIndex);

    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/c.ts::C::interface', transitive: true });
    const payload = JSON.parse(result.content[0]!.text);

    // Should complete without hanging
    expect(payload.importerCount).toBeGreaterThanOrEqual(1);
  });

  it('prepends staleness warning when stale', () => {
    const mockStaleness = { check: () => ({ message: 'Index stale' }) };
    const handler = handleFindImporters(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({ symbolId: 'src/c.ts::C::interface' });

    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0]!.text).toContain('stale');
  });

  it('no staleness warning when index is fresh', () => {
    const mockStaleness = { check: () => undefined };
    const handler = handleFindImporters(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({ symbolId: 'src/c.ts::C::interface' });

    expect(result.content).toHaveLength(1);
  });

  it('applies masking to response', () => {
    const sensitiveIndex: FileIndex = {
      file: 'src/config.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE', kind: 'variable', startLine: 0, endLine: 1 }],
      edges: [{ from: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable', to: 'src/c.ts::C::interface', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(sensitiveIndex);

    const handler = handleFindImporters(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ symbolId: 'src/c.ts::C::interface' });

    expect(result.content[0]!.text).toContain('[REDACTED:AWS_KEY]');
  });
});
