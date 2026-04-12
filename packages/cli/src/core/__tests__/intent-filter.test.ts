import { describe, it, expect } from 'vitest';
import { filterByIntent } from '../intent-filter.js';

describe('filterByIntent', () => {
  const items = [
    { symbolId: 'src/adapters/mcp/get-blast-radius.ts::handleGetBlastRadius::function', name: 'handleGetBlastRadius', kind: 'function', file: 'src/adapters/mcp/get-blast-radius.ts', edgeKind: 'imports' },
    { symbolId: 'src/core/graph/symbol-graph.ts::SymbolGraph::class', name: 'SymbolGraph', kind: 'class', file: 'src/core/graph/symbol-graph.ts', edgeKind: 'calls' },
    { symbolId: 'src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class', name: 'SqliteStorageAdapter', kind: 'class', file: 'src/adapters/storage/sqlite-storage-adapter.ts', edgeKind: 'implements' },
    { symbolId: 'tests/e2e/cross-client-smoke.test.ts::testSmoke::function', name: 'testSmoke', kind: 'function', file: 'tests/e2e/cross-client-smoke.test.ts', edgeKind: 'imports' },
    { symbolId: 'src/core/types.ts::SymbolNode::type', name: 'SymbolNode', kind: 'type', file: 'src/core/types.ts', edgeKind: 'imports' },
  ];

  it('returns all items when intent is undefined', () => {
    expect(filterByIntent(items, undefined)).toHaveLength(5);
  });

  it('returns all items when intent is empty string', () => {
    expect(filterByIntent(items, '')).toHaveLength(5);
  });

  it('returns all items when intent is whitespace only', () => {
    expect(filterByIntent(items, '   ')).toHaveLength(5);
  });

  it('filters by file path keyword', () => {
    const result = filterByIntent(items, 'adapter');
    expect(result).toHaveLength(2);
    expect(result.every(r => r.file.includes('adapter'))).toBe(true);
  });

  it('filters by symbol name keyword', () => {
    const result = filterByIntent(items, 'Symbol');
    expect(result).toHaveLength(2); // SymbolGraph + SymbolNode
    expect(result.map(r => r.name)).toContain('SymbolGraph');
    expect(result.map(r => r.name)).toContain('SymbolNode');
  });

  it('filters by kind keyword', () => {
    const result = filterByIntent(items, 'type');
    expect(result.some(r => r.kind === 'type')).toBe(true);
  });

  it('filters by edgeKind keyword', () => {
    const result = filterByIntent(items, 'implements');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('SqliteStorageAdapter');
  });

  it('matches case-insensitively', () => {
    const result = filterByIntent(items, 'GRAPH');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('SymbolGraph');
  });

  it('supports multiple keywords (OR logic)', () => {
    const result = filterByIntent(items, 'test storage');
    expect(result).toHaveLength(2); // testSmoke + SqliteStorageAdapter
  });

  it('ignores very short keywords (< 2 chars)', () => {
    const result = filterByIntent(items, 'a');
    expect(result).toHaveLength(5); // all returned, 'a' is too short
  });

  it('returns empty array when no matches', () => {
    const result = filterByIntent(items, 'nonexistent-keyword-xyz');
    expect(result).toHaveLength(0);
  });

  it('matches against edgeKinds array field', () => {
    const itemsWithArray = [
      { symbolId: 'a::A::class', edgeKinds: ['imports', 'calls'] },
      { symbolId: 'b::B::class', edgeKinds: ['extends'] },
    ];
    const result = filterByIntent(itemsWithArray, 'calls');
    expect(result).toHaveLength(1);
    expect(result[0]!.symbolId).toBe('a::A::class');
  });

  it('matches against reason field', () => {
    const deadItems = [
      { symbolId: 'a::A::function', reason: 'Zero importers — never referenced', confidence: 1.0 },
      { symbolId: 'b::B::class', reason: 'All importers are themselves dead (cascading)', confidence: 0.7 },
    ];
    const result = filterByIntent(deadItems, 'cascading');
    expect(result).toHaveLength(1);
    expect(result[0]!.symbolId).toBe('b::B::class');
  });

  it('matches against confidence field as string', () => {
    const blastItems = [
      { symbolId: 'a::A::class', confidence: 'confirmed', edgeKinds: ['calls'] },
      { symbolId: 'b::B::class', confidence: 'potential', edgeKinds: ['imports'] },
    ];
    const result = filterByIntent(blastItems, 'confirmed');
    expect(result).toHaveLength(1);
    expect(result[0]!.symbolId).toBe('a::A::class');
  });
});
