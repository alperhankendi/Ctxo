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

  it('picks strongest confidence when multiple edges exist between same nodes (BUG-26)', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::class']) {
      graph.addNode(makeNode(id));
    }
    // A both imports and calls B — should be confirmed (calls wins over imports)
    graph.addEdge({ from: 'a::A::function', to: 'b::B::class', kind: 'imports' });
    graph.addEdge({ from: 'a::A::function', to: 'b::B::class', kind: 'calls' });

    const result = calc.calculate(graph, 'b::B::class');
    expect(result.impactedSymbols).toHaveLength(1);
    expect(result.impactedSymbols[0]!.confidence).toBe('confirmed');
    expect(result.confirmedCount).toBe(1);
    expect(result.potentialCount).toBe(0);
  });

  it('dependentCount reflects blast-scope in-degree, not global (GAP-30)', () => {
    // D <- C <- A, D <- C <- B, plus X <- A (X is outside blast of D)
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function', 'd::D::function', 'x::X::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'c::C::function', to: 'd::D::function', kind: 'imports' });
    graph.addEdge({ from: 'a::A::function', to: 'c::C::function', kind: 'imports' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'imports' });
    graph.addEdge({ from: 'a::A::function', to: 'x::X::function', kind: 'imports' }); // X not in blast of D

    const result = calc.calculate(graph, 'd::D::function');
    const cEntry = result.impactedSymbols.find(e => e.symbolId === 'c::C::function');
    // C has 2 reverse edges in blast scope (A and B), not counting X
    expect(cEntry!.dependentCount).toBe(2);

    const aEntry = result.impactedSymbols.find(e => e.symbolId === 'a::A::function');
    // A has 0 reverse edges within blast scope (X is not in blast)
    expect(aEntry!.dependentCount).toBe(0);
  });

  it('overallRiskScore uses direct-dependent-weighted formula (GAP-29)', () => {
    // 1 direct dependent → totalRisk = 1.0, directDependentsCount = 1, score = 1.0
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'imports' });

    const result = calc.calculate(graph, 'b::B::function');
    expect(result.overallRiskScore).toBe(1);
  });

  it('overallRiskScore > 1 is capped at 1.0 for many direct dependents', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('target::T::function'));
    for (let i = 0; i < 5; i++) {
      const id = `dep${i}::D${i}::function`;
      graph.addNode(makeNode(id));
      graph.addEdge({ from: id, to: 'target::T::function', kind: 'imports' });
    }

    const result = calc.calculate(graph, 'target::T::function');
    expect(result.overallRiskScore).toBeLessThanOrEqual(1);
    expect(result.overallRiskScore).toBeGreaterThan(0);
  });

  it('handles depth > 3 chain correctly', () => {
    const graph = new SymbolGraph();
    const chain = ['a::A::function', 'b::B::function', 'c::C::function', 'd::D::function', 'e::E::function'];
    for (const id of chain) graph.addNode(makeNode(id));
    // E <- D <- C <- B <- A
    graph.addEdge({ from: 'd::D::function', to: 'e::E::function', kind: 'imports' });
    graph.addEdge({ from: 'c::C::function', to: 'd::D::function', kind: 'imports' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'imports' });
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'imports' });

    const result = calc.calculate(graph, 'e::E::function');
    expect(result.impactedSymbols).toHaveLength(4);

    const depths = result.impactedSymbols.map(e => e.depth);
    expect(depths).toEqual([1, 2, 3, 4]);

    // Verify risk score decreases with depth
    const scores = result.impactedSymbols.map(e => e.riskScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]!);
    }
  });

  it('cycle test asserts exact count (TEST-GAP-32)', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'calls' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'calls' });
    graph.addEdge({ from: 'c::C::function', to: 'a::A::function', kind: 'calls' });

    const { impactedSymbols } = calc.calculate(graph, 'a::A::function');
    // A's blast: C→A (reverse), so C at depth 1. B→C (reverse of C), so B at depth 2.
    expect(impactedSymbols).toHaveLength(2);
    expect(impactedSymbols[0]!.symbolId).toBe('c::C::function');
    expect(impactedSymbols[1]!.symbolId).toBe('b::B::function');
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
