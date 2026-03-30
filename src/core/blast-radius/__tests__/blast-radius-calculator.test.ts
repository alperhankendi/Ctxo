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
    const { impactedSymbols } = calc.calculate(graph, 'c::C::function');

    expect(impactedSymbols).toHaveLength(2);
    const ids = impactedSymbols.map((e) => e.symbolId);
    expect(ids).toContain('a::A::function');
    expect(ids).toContain('b::B::function');
  });

  it('returns transitive dependents (blast of D includes A, B, C)', () => {
    const graph = buildDiamondGraph();
    const { impactedSymbols } = calc.calculate(graph, 'd::D::function');

    expect(impactedSymbols).toHaveLength(3);
    const ids = impactedSymbols.map((e) => e.symbolId);
    expect(ids).toContain('c::C::function');
    expect(ids).toContain('a::A::function');
    expect(ids).toContain('b::B::function');
  });

  it('ranks dependents by depth ascending', () => {
    const graph = buildDiamondGraph();
    const { impactedSymbols } = calc.calculate(graph, 'd::D::function');

    expect(impactedSymbols[0]?.depth).toBe(1);
    const depth2 = impactedSymbols.filter((e) => e.depth === 2);
    expect(depth2).toHaveLength(2);
  });

  it('returns empty result for leaf symbol (no dependents)', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'a::A::function');
    expect(result.impactedSymbols).toEqual([]);
    expect(result.directDependentsCount).toBe(0);
    expect(result.overallRiskScore).toBe(0);
  });

  it('terminates safely on circular dependency', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'calls' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'calls' });
    graph.addEdge({ from: 'c::C::function', to: 'a::A::function', kind: 'calls' });

    const { impactedSymbols } = calc.calculate(graph, 'a::A::function');
    expect(impactedSymbols.length).toBeLessThanOrEqual(2);
  });

  it('includes riskScore per entry (1/depth^0.7)', () => {
    const graph = buildDiamondGraph();
    const { impactedSymbols } = calc.calculate(graph, 'd::D::function');

    // Depth 1: riskScore = 1/1^0.7 = 1.0
    const depth1 = impactedSymbols.find((e) => e.depth === 1);
    expect(depth1?.riskScore).toBe(1);

    // Depth 2: riskScore = 1/2^0.7 ≈ 0.616
    const depth2 = impactedSymbols.find((e) => e.depth === 2);
    expect(depth2?.riskScore).toBeGreaterThan(0.5);
    expect(depth2?.riskScore).toBeLessThan(0.7);
  });

  it('returns directDependentsCount correctly', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'c::C::function');
    expect(result.directDependentsCount).toBe(2);
  });

  it('returns overallRiskScore between 0 and 1', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'd::D::function');
    expect(result.overallRiskScore).toBeGreaterThan(0);
    expect(result.overallRiskScore).toBeLessThanOrEqual(1);
  });

  it('returns empty result for non-existent symbol', () => {
    const graph = buildDiamondGraph();
    const result = calc.calculate(graph, 'x::X::function');
    expect(result.impactedSymbols).toEqual([]);
    expect(result.overallRiskScore).toBe(0);
  });

  it('classifies imports edges as potential and calls/extends as confirmed', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::class', 'c::C::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'c::C::class', kind: 'imports' });
    graph.addEdge({ from: 'b::B::class', to: 'c::C::class', kind: 'extends' });

    const result = calc.calculate(graph, 'c::C::class');
    expect(result.confirmedCount).toBe(1); // extends
    expect(result.potentialCount).toBe(1); // imports

    const confirmed = result.impactedSymbols.find((e) => e.confidence === 'confirmed');
    expect(confirmed?.symbolId).toBe('b::B::class');

    const potential = result.impactedSymbols.find((e) => e.confidence === 'potential');
    expect(potential?.symbolId).toBe('a::A::function');
  });
});
