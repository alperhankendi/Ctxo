import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import { LogicSliceQuery } from '../logic-slice-query.js';
import type { SymbolNode, GraphEdge } from '../../types.js';

function makeNode(id: string): SymbolNode {
  const parts = id.split('::');
  return {
    symbolId: id,
    name: parts[1] ?? 'unknown',
    kind: (parts[2] ?? 'function') as SymbolNode['kind'],
    startLine: 0,
    endLine: 10,
  };
}

function buildLinearGraph(): SymbolGraph {
  // A → B → C → D
  const graph = new SymbolGraph();
  const ids = ['src/a.ts::A::function', 'src/b.ts::B::function', 'src/c.ts::C::function', 'src/d.ts::D::function'];
  for (const id of ids) graph.addNode(makeNode(id));
  graph.addEdge({ from: ids[0]!, to: ids[1]!, kind: 'calls' });
  graph.addEdge({ from: ids[1]!, to: ids[2]!, kind: 'calls' });
  graph.addEdge({ from: ids[2]!, to: ids[3]!, kind: 'calls' });
  return graph;
}

function buildCyclicGraph(): SymbolGraph {
  // A → B → C → A
  const graph = new SymbolGraph();
  const ids = ['src/a.ts::A::function', 'src/b.ts::B::function', 'src/c.ts::C::function'];
  for (const id of ids) graph.addNode(makeNode(id));
  graph.addEdge({ from: ids[0]!, to: ids[1]!, kind: 'calls' });
  graph.addEdge({ from: ids[1]!, to: ids[2]!, kind: 'calls' });
  graph.addEdge({ from: ids[2]!, to: ids[0]!, kind: 'calls' });
  return graph;
}

describe('LogicSliceQuery', () => {
  const query = new LogicSliceQuery();

  describe('data resource copies', () => {
    const V1 = 'db/migrations/V1__init.sql::dbo.usp_close::procedure';
    const V7 = 'db/migrations/V7__close_fix.sql::dbo.usp_close::procedure';

    function copiesGraph(): SymbolGraph {
      const graph = new SymbolGraph();
      for (const id of [V7, V1, 'db/loans.sql::dbo.loans::table', 'db/audit.sql::dbo.audit::table']) graph.addNode(makeNode(id));
      graph.addEdge({ from: V1, to: 'dbo.loans::table', kind: 'writes' });
      graph.addEdge({ from: V7, to: 'dbo.loans::table', kind: 'writes' });
      graph.addEdge({ from: V7, to: 'dbo.audit::table', kind: 'writes' });
      return graph;
    }

    it('a 2-part procedure id walks the winner\'s dependencies', () => {
      const result = query.getLogicSlice(copiesGraph(), 'dbo.usp_close::procedure');
      expect(result?.root.symbolId).toBe(V1);
      expect(result?.dependencies.map((node) => node.symbolId)).toEqual(['db/loans.sql::dbo.loans::table']);
      expect(result?.edges.map((edge) => edge.from)).toEqual([V1]);
    });

    it('a later procedure copy keeps its own body\'s dependencies', () => {
      const result = query.getLogicSlice(copiesGraph(), V7);
      expect(result?.dependencies.map((node) => node.symbolId)).toEqual([
        'db/loans.sql::dbo.loans::table',
        'db/audit.sql::dbo.audit::table',
      ]);
    });
  });

  it('returns root symbol with no dependencies when isolated', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));

    const result = query.getLogicSlice(graph, 'src/a.ts::A::function');
    expect(result).toBeDefined();
    expect(result?.root.symbolId).toBe('src/a.ts::A::function');
    expect(result?.dependencies).toEqual([]);
    expect(result?.edges).toEqual([]);
  });

  it('returns direct dependency at depth 1', () => {
    const graph = buildLinearGraph();
    const result = query.getLogicSlice(graph, 'src/a.ts::A::function', 1);

    expect(result?.dependencies).toHaveLength(1);
    expect(result?.dependencies[0]?.symbolId).toBe('src/b.ts::B::function');
  });

  it('returns transitive dependencies 3 levels deep', () => {
    const graph = buildLinearGraph();
    const result = query.getLogicSlice(graph, 'src/a.ts::A::function');

    expect(result?.dependencies).toHaveLength(3);
    const depIds = result?.dependencies.map((d) => d.symbolId);
    expect(depIds).toContain('src/b.ts::B::function');
    expect(depIds).toContain('src/c.ts::C::function');
    expect(depIds).toContain('src/d.ts::D::function');
  });

  it('terminates safely on circular dependency (A→B→C→A)', () => {
    const graph = buildCyclicGraph();
    const result = query.getLogicSlice(graph, 'src/a.ts::A::function');

    expect(result).toBeDefined();
    expect(result?.dependencies).toHaveLength(2);
    const depIds = result?.dependencies.map((d) => d.symbolId);
    expect(depIds).toContain('src/b.ts::B::function');
    expect(depIds).toContain('src/c.ts::C::function');
  });

  it('respects depth limit parameter', () => {
    const graph = buildLinearGraph();
    const result = query.getLogicSlice(graph, 'src/a.ts::A::function', 2);

    expect(result?.dependencies).toHaveLength(2);
    const depIds = result?.dependencies.map((d) => d.symbolId);
    expect(depIds).toContain('src/b.ts::B::function');
    expect(depIds).toContain('src/c.ts::C::function');
    expect(depIds).not.toContain('src/d.ts::D::function');
  });

  it('returns undefined for non-existent symbolId', () => {
    const graph = new SymbolGraph();
    const result = query.getLogicSlice(graph, 'src/missing.ts::X::function');
    expect(result).toBeUndefined();
  });

  it('returns empty dependencies for leaf node', () => {
    const graph = buildLinearGraph();
    const result = query.getLogicSlice(graph, 'src/d.ts::D::function');

    expect(result?.dependencies).toEqual([]);
    expect(result?.edges).toEqual([]);
  });

  it('includes all edges in the returned slice', () => {
    const graph = buildLinearGraph();
    const result = query.getLogicSlice(graph, 'src/a.ts::A::function');

    expect(result?.edges).toHaveLength(3);
  });

  it('does not include nodes outside the transitive closure', () => {
    const graph = buildLinearGraph();
    graph.addNode(makeNode('src/x.ts::X::function')); // disconnected

    const result = query.getLogicSlice(graph, 'src/a.ts::A::function');
    const allIds = [result?.root.symbolId, ...result!.dependencies.map((d) => d.symbolId)];
    expect(allIds).not.toContain('src/x.ts::X::function');
  });

  it('handles graph with 1000 nodes in reasonable time', () => {
    const graph = new SymbolGraph();
    for (let i = 0; i < 1000; i++) {
      graph.addNode(makeNode(`src/f${i}.ts::fn${i}::function`));
    }
    for (let i = 0; i < 999; i++) {
      graph.addEdge({
        from: `src/f${i}.ts::fn${i}::function`,
        to: `src/f${i + 1}.ts::fn${i + 1}::function`,
        kind: 'calls',
      });
    }

    const start = performance.now();
    const result = query.getLogicSlice(graph, 'src/f0.ts::fn0::function');
    const elapsed = performance.now() - start;

    expect(result?.dependencies).toHaveLength(999);
    expect(elapsed).toBeLessThan(100); // Should be well under 100ms
  });
});
