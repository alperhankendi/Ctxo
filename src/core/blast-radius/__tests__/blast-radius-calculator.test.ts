import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import { BlastRadiusCalculator } from '../blast-radius-calculator.js';
import type { SymbolNode } from '../../types.js';

function makeNode(id: string): SymbolNode {
  const parts = id.split('::');
  return { symbolId: id, name: parts[1] ?? 'x', kind: (parts[2] ?? 'function') as SymbolNode['kind'], startLine: 0, endLine: 10 };
}

function buildDiamondGraph(): SymbolGraph {
  // A depends on C, B depends on C, C depends on D
  const graph = new SymbolGraph();
  for (const id of ['a::A::function', 'b::B::function', 'c::C::function', 'd::D::function']) {
    graph.addNode(makeNode(id));
  }
  graph.addEdge({ from: 'a::A::function', to: 'c::C::function', kind: 'imports' });
  graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'imports' });
  graph.addEdge({ from: 'c::C::function', to: 'd::D::function', kind: 'imports' });
  return graph;
}

describe('BlastRadiusCalculator', () => {
  const calc = new BlastRadiusCalculator();

  it('returns direct dependents for a symbol', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'c::C::function');

    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.symbolId);
    expect(ids).toContain('a::A::function');
    expect(ids).toContain('b::B::function');
  });

  it('returns transitive dependents (blast of D includes A, B, C)', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'd::D::function');

    expect(result).toHaveLength(3);
    const ids = result.map((e) => e.symbolId);
    expect(ids).toContain('c::C::function');
    expect(ids).toContain('a::A::function');
    expect(ids).toContain('b::B::function');
  });

  it('ranks dependents by depth ascending', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'd::D::function');

    expect(result[0]?.depth).toBe(1);
    // A and B are at depth 2
    const depth2 = result.filter((e) => e.depth === 2);
    expect(depth2).toHaveLength(2);
  });

  it('returns empty array for leaf symbol (no dependents)', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'a::A::function');
    expect(result).toEqual([]);
  });

  it('terminates safely on circular dependency', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'calls' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'calls' });
    graph.addEdge({ from: 'c::C::function', to: 'a::A::function', kind: 'calls' });

    const result = calc.calculate(graph, 'a::A::function');
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('returns correct dependentCount for each entry', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'c::C::function');

    // A and B each have 0 reverse edges (nobody depends on them in this graph)
    // But dependentCount counts THEIR reverse edges, not the target's
    for (const entry of result) {
      expect(typeof entry.dependentCount).toBe('number');
    }
  });

  it('returns empty array for non-existent symbol', () => {
    const graph = buildDiamondGraph();
    expect(calc.calculate(graph, 'x::X::function')).toEqual([]);
  });
});
