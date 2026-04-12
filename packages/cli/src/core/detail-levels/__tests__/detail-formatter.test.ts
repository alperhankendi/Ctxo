import { describe, it, expect } from 'vitest';
import { DetailFormatter } from '../detail-formatter.js';
import type { LogicSliceResult, SymbolNode, GraphEdge } from '../../types.js';

function makeNode(id: string, lineSpan = 10): SymbolNode {
  const parts = id.split('::');
  return {
    symbolId: id,
    name: parts[1] ?? 'unknown',
    kind: (parts[2] ?? 'function') as SymbolNode['kind'],
    startLine: 0,
    endLine: lineSpan,
  };
}

function buildSlice(depCount: number, lineSpan = 10): LogicSliceResult {
  const root = makeNode('src/root.ts::root::function', lineSpan);
  const dependencies: SymbolNode[] = [];
  const edges: GraphEdge[] = [];

  for (let i = 0; i < depCount; i++) {
    const depId = `src/dep${i}.ts::dep${i}::function`;
    dependencies.push(makeNode(depId, lineSpan));
    edges.push({
      from: i === 0 ? root.symbolId : `src/dep${i - 1}.ts::dep${i - 1}::function`,
      to: depId,
      kind: 'calls',
    });
  }

  return { root, dependencies, edges };
}

describe('DetailFormatter', () => {
  const formatter = new DetailFormatter();

  it('L1 output contains root signature only and no dependencies', () => {
    const slice = buildSlice(5);
    const result = formatter.format(slice, 1);

    expect(result.level).toBe(1);
    expect(result.root.symbolId).toBe('src/root.ts::root::function');
    expect(result.dependencies).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('L2 output includes root + depth-1 dependencies only', () => {
    const slice = buildSlice(5);
    const result = formatter.format(slice, 2);

    expect(result.level).toBe(2);
    expect(result.dependencies.length).toBeLessThanOrEqual(1); // only direct dep
    expect(result.edges.every((e) => e.from === slice.root.symbolId)).toBe(true);
  });

  it('L3 output includes full transitive closure', () => {
    const slice = buildSlice(5);
    const result = formatter.format(slice, 3);

    expect(result.level).toBe(3);
    expect(result.dependencies).toHaveLength(5);
    expect(result.edges).toHaveLength(5);
  });

  it('L4 output includes full closure when within token budget', () => {
    const slice = buildSlice(3, 5); // small deps
    const result = formatter.format(slice, 4);

    expect(result.level).toBe(4);
    expect(result.dependencies).toHaveLength(3);
    expect(result.truncation).toBeUndefined();
  });

  it('L4 truncates and includes truncation metadata when budget exceeded', () => {
    // Create a slice with very large nodes to exceed 8000 token budget
    const slice = buildSlice(100, 500); // 100 deps × ~500 lines each
    const result = formatter.format(slice, 4);

    expect(result.level).toBe(4);
    expect(result.truncation).toEqual({
      truncated: true,
      reason: 'token_budget_exceeded',
    });
    expect(result.dependencies.length).toBeLessThan(100);
  });

  it('returns truncation info with reason "token_budget_exceeded"', () => {
    const slice = buildSlice(200, 300);
    const result = formatter.format(slice, 4);

    if (result.truncation) {
      expect(result.truncation.reason).toBe('token_budget_exceeded');
    }
  });

  it('handles empty dependency list at all levels', () => {
    const slice = buildSlice(0);

    for (const level of [1, 2, 3, 4] as const) {
      const result = formatter.format(slice, level);
      expect(result.dependencies).toEqual([]);
      expect(result.level).toBe(level);
    }
  });

  it('handles single-line function at L1', () => {
    const root = makeNode('src/a.ts::fn::function', 0); // single line
    const slice: LogicSliceResult = { root, dependencies: [], edges: [] };
    const result = formatter.format(slice, 1);

    expect(result.root.startLine).toBe(0);
    expect(result.root.endLine).toBe(0);
  });
});
