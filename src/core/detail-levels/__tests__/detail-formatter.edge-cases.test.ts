import { describe, it, expect } from 'vitest';
import { DetailFormatter } from '../detail-formatter.js';
import type { LogicSliceResult, SymbolNode } from '../../types.js';

function makeNode(id: string, lineSpan: number): SymbolNode {
  const parts = id.split('::');
  return { symbolId: id, name: parts[1] ?? 'x', kind: (parts[2] ?? 'function') as SymbolNode['kind'], startLine: 0, endLine: lineSpan };
}

describe('DetailFormatter — L1 line constraint', () => {
  const formatter = new DetailFormatter();

  it('L1 output never includes dependencies regardless of root size', () => {
    const root = makeNode('src/big.ts::bigFn::function', 200);
    const dep = makeNode('src/dep.ts::dep::function', 50);
    const slice: LogicSliceResult = {
      root,
      dependencies: [dep],
      edges: [{ from: root.symbolId, to: dep.symbolId, kind: 'calls' }],
    };

    const result = formatter.format(slice, 1);
    expect(result.dependencies).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

describe('DetailFormatter — L4 token budget enforcement', () => {
  const formatter = new DetailFormatter();

  it('includes truncation metadata only when budget is actually exceeded', () => {
    const root = makeNode('src/small.ts::fn::function', 2);
    const slice: LogicSliceResult = { root, dependencies: [], edges: [] };

    const result = formatter.format(slice, 4);
    expect(result.truncation).toBeUndefined();
  });

  it('truncation preserves root even when budget is tight', () => {
    const root = makeNode('src/root.ts::root::function', 500);
    const deps = Array.from({ length: 50 }, (_, i) =>
      makeNode(`src/dep${i}.ts::dep${i}::function`, 500),
    );
    const edges = deps.map((d) => ({
      from: root.symbolId,
      to: d.symbolId,
      kind: 'calls' as const,
    }));

    const slice: LogicSliceResult = { root, dependencies: deps, edges };
    const result = formatter.format(slice, 4);

    expect(result.root.symbolId).toBe(root.symbolId);
    expect(result.truncation?.truncated).toBe(true);
    expect(result.dependencies.length).toBeLessThan(50);
  });

  it('L4 without truncation includes all edges matching included dependencies', () => {
    const root = makeNode('src/a.ts::a::function', 2);
    const dep = makeNode('src/b.ts::b::function', 2);
    const slice: LogicSliceResult = {
      root,
      dependencies: [dep],
      edges: [{ from: root.symbolId, to: dep.symbolId, kind: 'imports' }],
    };

    const result = formatter.format(slice, 4);
    expect(result.edges).toHaveLength(1);
    expect(result.truncation).toBeUndefined();
  });
});

describe('DetailFormatter — L2 direct dependencies only', () => {
  const formatter = new DetailFormatter();

  it('L2 excludes transitive dependencies (depth > 1)', () => {
    const root = makeNode('src/a.ts::A::function', 5);
    const direct = makeNode('src/b.ts::B::function', 5);
    const transitive = makeNode('src/c.ts::C::function', 5);

    const slice: LogicSliceResult = {
      root,
      dependencies: [direct, transitive],
      edges: [
        { from: root.symbolId, to: direct.symbolId, kind: 'calls' },
        { from: direct.symbolId, to: transitive.symbolId, kind: 'calls' },
      ],
    };

    const result = formatter.format(slice, 2);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]?.symbolId).toBe(direct.symbolId);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.from).toBe(root.symbolId);
  });
});
