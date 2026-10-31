import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import { BlastRadiusCalculator, EDGE_KIND_CONFIDENCE } from '../blast-radius-calculator.js';
import { EDGE_KINDS } from '../../types.js';
import type { CoChangeEntry, SymbolNode } from '../../types.js';

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

  it('overallRiskScore does not saturate on a single direct dependent', () => {
    // 1 direct dependent → totalRisk = 1.0 → 1 / (1 + 5) ≈ 0.167
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'imports' });

    const result = calc.calculate(graph, 'b::B::function');
    expect(result.overallRiskScore).toBe(0.167);
  });

  it('overallRiskScore keeps heavily-depended-on symbols distinguishable', () => {
    const scoreFor = (n: number) => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('target::T::function'));
      for (let i = 0; i < n; i++) {
        const id = `dep${i}::D${i}::function`;
        graph.addNode(makeNode(id));
        graph.addEdge({ from: id, to: 'target::T::function', kind: 'calls' });
      }
      return calc.calculate(graph, 'target::T::function').overallRiskScore;
    };

    // 3 direct dependents (balanced gate floor) → medium band
    expect(scoreFor(3)).toBeGreaterThan(0.3);
    expect(scoreFor(3)).toBeLessThanOrEqual(0.7);
    // 50 vs 100 direct dependents must not collapse to the same score
    expect(scoreFor(50)).toBeLessThan(scoreFor(100));
    expect(scoreFor(100)).toBeLessThan(1);
  });

  it('overallRiskScore grows with the number of direct dependents', () => {
    const scoreFor = (n: number) => {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('target::T::function'));
      for (let i = 0; i < n; i++) {
        const id = `dep${i}::D${i}::function`;
        graph.addNode(makeNode(id));
        graph.addEdge({ from: id, to: 'target::T::function', kind: 'imports' });
      }
      return calc.calculate(graph, 'target::T::function').overallRiskScore;
    };

    expect(scoreFor(1)).toBeLessThan(scoreFor(3));
    expect(scoreFor(3)).toBeLessThan(scoreFor(10));
  });

  it('overallRiskScore counts transitive dependents, but less than direct ones', () => {
    // wide: 3 direct dependents of T
    const wide = new SymbolGraph();
    wide.addNode(makeNode('t::T::function'));
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function']) {
      wide.addNode(makeNode(id));
      wide.addEdge({ from: id, to: 't::T::function', kind: 'calls' });
    }

    // deep: chain C -> B -> A -> T (same 3 impacted symbols)
    const deep = new SymbolGraph();
    for (const id of ['t::T::function', 'a::A::function', 'b::B::function', 'c::C::function']) {
      deep.addNode(makeNode(id));
    }
    deep.addEdge({ from: 'a::A::function', to: 't::T::function', kind: 'calls' });
    deep.addEdge({ from: 'b::B::function', to: 'a::A::function', kind: 'calls' });
    deep.addEdge({ from: 'c::C::function', to: 'b::B::function', kind: 'calls' });

    // single: only A -> T
    const single = new SymbolGraph();
    for (const id of ['t::T::function', 'a::A::function']) single.addNode(makeNode(id));
    single.addEdge({ from: 'a::A::function', to: 't::T::function', kind: 'calls' });

    const wideScore = calc.calculate(wide, 't::T::function').overallRiskScore;
    const deepScore = calc.calculate(deep, 't::T::function').overallRiskScore;
    const singleScore = calc.calculate(single, 't::T::function').overallRiskScore;

    expect(wideScore).toBeGreaterThan(deepScore);
    expect(deepScore).toBeGreaterThan(singleScore);
  });

  it('overallRiskScore stays within (0, 1] for many direct dependents', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('target::T::function'));
    for (let i = 0; i < 50; i++) {
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

  it('classifies imports as potential, extends as confirmed, uses as likely (3-tier)', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::class', 'c::C::function', 'd::D::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'd::D::class', kind: 'imports' });
    graph.addEdge({ from: 'b::B::class', to: 'd::D::class', kind: 'extends' });
    graph.addEdge({ from: 'c::C::function', to: 'd::D::class', kind: 'uses' });

    const result = calc.calculate(graph, 'd::D::class');
    expect(result.confirmedCount).toBe(1);
    expect(result.likelyCount).toBe(1);
    expect(result.potentialCount).toBe(1);
    expect(result.confirmedCount + result.likelyCount + result.potentialCount).toBe(result.impactedSymbols.length);

    expect(result.impactedSymbols.find(e => e.symbolId === 'b::B::class')?.confidence).toBe('confirmed');
    expect(result.impactedSymbols.find(e => e.symbolId === 'c::C::function')?.confidence).toBe('likely');
    expect(result.impactedSymbols.find(e => e.symbolId === 'a::A::function')?.confidence).toBe('potential');
  });

  it('includes edgeKinds per entry', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::class', kind: 'calls' });

    const result = calc.calculate(graph, 'b::B::class');
    expect(result.impactedSymbols[0]!.edgeKinds).toEqual(['calls']);
  });

  it('collects multiple edgeKinds when node has mixed edges', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::class', kind: 'imports' });
    graph.addEdge({ from: 'a::A::function', to: 'b::B::class', kind: 'calls' });

    const result = calc.calculate(graph, 'b::B::class');
    expect(result.impactedSymbols[0]!.edgeKinds).toEqual(expect.arrayContaining(['imports', 'calls']));
    expect(result.impactedSymbols[0]!.edgeKinds).toHaveLength(2);
    // calls wins → confirmed
    expect(result.impactedSymbols[0]!.confidence).toBe('confirmed');
  });

  it('imports + uses → likely confidence with both edgeKinds', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::class', kind: 'imports' });
    graph.addEdge({ from: 'a::A::function', to: 'b::B::class', kind: 'uses' });

    const result = calc.calculate(graph, 'b::B::class');
    expect(result.impactedSymbols[0]!.confidence).toBe('likely');
    expect(result.impactedSymbols[0]!.edgeKinds).toEqual(expect.arrayContaining(['imports', 'uses']));
  });

  it('implements edge → confirmed confidence', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::class', 'b::B::interface']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::class', to: 'b::B::interface', kind: 'implements' });

    const result = calc.calculate(graph, 'b::B::interface');
    expect(result.impactedSymbols[0]!.confidence).toBe('confirmed');
    expect(result.impactedSymbols[0]!.edgeKinds).toEqual(['implements']);
  });

  it('co-change boost upgrades potential to likely when frequency > 0.5', () => {
    const graph = new SymbolGraph();
    for (const id of ['src/a.ts::A::function', 'src/b.ts::B::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'imports' });

    // Without co-change: imports → potential
    const resultNoCo = calc.calculate(graph, 'src/b.ts::B::class');
    expect(resultNoCo.impactedSymbols[0]!.confidence).toBe('potential');

    // With co-change: high frequency → potential upgraded to likely
    const coChangeMap = new Map<string, import('../../../core/types.js').CoChangeEntry[]>();
    coChangeMap.set('src/b.ts', [{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 10, frequency: 0.8 }]);

    const resultWithCo = calc.calculate(graph, 'src/b.ts::B::class', coChangeMap);
    expect(resultWithCo.impactedSymbols[0]!.confidence).toBe('likely');
    expect(resultWithCo.impactedSymbols[0]!.coChangeFrequency).toBe(0.8);
  });

  it('co-change does not upgrade confirmed or likely confidence', () => {
    const graph = new SymbolGraph();
    for (const id of ['src/a.ts::A::function', 'src/b.ts::B::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'calls' });

    const coChangeMap = new Map<string, import('../../../core/types.js').CoChangeEntry[]>();
    coChangeMap.set('src/b.ts', [{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 10, frequency: 0.9 }]);

    const result = calc.calculate(graph, 'src/b.ts::B::class', coChangeMap);
    // calls → confirmed, co-change should not change this
    expect(result.impactedSymbols[0]!.confidence).toBe('confirmed');
    expect(result.impactedSymbols[0]!.coChangeFrequency).toBe(0.9);
  });

  it('co-change with low frequency does not upgrade potential', () => {
    const graph = new SymbolGraph();
    for (const id of ['src/a.ts::A::function', 'src/b.ts::B::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'imports' });

    const coChangeMap = new Map<string, import('../../../core/types.js').CoChangeEntry[]>();
    coChangeMap.set('src/b.ts', [{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 2, frequency: 0.3 }]);

    const result = calc.calculate(graph, 'src/b.ts::B::class', coChangeMap);
    // frequency 0.3 <= 0.5 → stays potential
    expect(result.impactedSymbols[0]!.confidence).toBe('potential');
    expect(result.impactedSymbols[0]!.coChangeFrequency).toBe(0.3);
  });

  it('co-change frequency is undefined when no co-change data', () => {
    const graph = new SymbolGraph();
    for (const id of ['src/a.ts::A::function', 'src/b.ts::B::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'imports' });

    const result = calc.calculate(graph, 'src/b.ts::B::class');
    expect(result.impactedSymbols[0]!.coChangeFrequency).toBeUndefined();
  });

  it('co-change ignores a dependent in the root file itself, whatever the root file pairs with elsewhere', () => {
    const graph = new SymbolGraph();
    for (const id of ['src/a.ts::A::function', 'src/a.ts::Helper::function']) {
      graph.addNode(makeNode(id));
    }
    // Helper lives in the same file as A and only imports it.
    graph.addEdge({ from: 'src/a.ts::Helper::function', to: 'src/a.ts::A::function', kind: 'imports' });

    // a.ts co-changes strongly with other files; that says nothing about a symbol in a.ts itself.
    const coChangeMap = new Map<string, CoChangeEntry[]>();
    coChangeMap.set('src/a.ts', [
      { file1: 'src/a.ts', file2: 'src/x.ts', sharedCommits: 9, frequency: 0.9 },
      { file1: 'src/y.ts', file2: 'src/a.ts', sharedCommits: 7, frequency: 0.7 },
    ]);

    const helper = calc.calculate(graph, 'src/a.ts::A::function', coChangeMap).impactedSymbols[0]!;
    expect(helper.symbolId).toBe('src/a.ts::Helper::function');
    expect(helper.confidence).toBe('potential');
    expect(helper.coChangeFrequency).toBeUndefined();
  });

  it('co-change matches each dependent to the entry of its own file, whichever side of the pair the root is on', () => {
    const graph = new SymbolGraph();
    for (const id of ['src/a.ts::A::function', 'src/b.ts::B::function', 'src/c.ts::C::function', 'src/d.ts::D::function']) {
      graph.addNode(makeNode(id));
    }
    for (const dependent of ['B', 'C', 'D']) {
      graph.addEdge({ from: `src/${dependent.toLowerCase()}.ts::${dependent}::function`, to: 'src/a.ts::A::function', kind: 'imports' });
    }

    const coChangeMap = new Map<string, CoChangeEntry[]>();
    coChangeMap.set('src/a.ts', [
      { file1: 'src/a.ts', file2: 'src/c.ts', sharedCommits: 2, frequency: 0.3 }, // root first
      { file1: 'src/b.ts', file2: 'src/a.ts', sharedCommits: 9, frequency: 0.9 }, // root second
    ]);

    const byId = new Map(
      calc.calculate(graph, 'src/a.ts::A::function', coChangeMap).impactedSymbols.map((e) => [e.symbolId, e]),
    );
    expect(byId.get('src/b.ts::B::function')).toMatchObject({ confidence: 'likely', coChangeFrequency: 0.9 });
    expect(byId.get('src/c.ts::C::function')).toMatchObject({ confidence: 'potential', coChangeFrequency: 0.3 });
    expect(byId.get('src/d.ts::D::function')?.confidence).toBe('potential');
    expect(byId.get('src/d.ts::D::function')?.coChangeFrequency).toBeUndefined();
  });

  it('uses-only edge → likely confidence', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::class']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::class', kind: 'uses' });

    const result = calc.calculate(graph, 'b::B::class');
    expect(result.impactedSymbols[0]!.confidence).toBe('likely');
    expect(result.likelyCount).toBe(1);
    expect(result.confirmedCount).toBe(0);
    expect(result.potentialCount).toBe(0);
  });

  it('reads, writes and executes dependents are confirmed', () => {
    const graph = new SymbolGraph();
    for (const id of ['db/t.sql::dbo.t::table', 'src/r.ts::r::function', 'src/w.ts::w::function', 'src/e.ts::e::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'src/r.ts::r::function', to: 'db/t.sql::dbo.t::table', kind: 'reads' });
    graph.addEdge({ from: 'src/w.ts::w::function', to: 'db/t.sql::dbo.t::table', kind: 'writes' });
    graph.addEdge({ from: 'src/e.ts::e::function', to: 'db/t.sql::dbo.t::table', kind: 'executes' });
    const result = calc.calculate(graph, 'db/t.sql::dbo.t::table');
    expect(result.confirmedCount).toBe(3);
    expect(result.impactedSymbols.every((e) => e.confidence === 'confirmed')).toBe(true);
  });

  it('every edge kind has a confidence', () => {
    expect(Object.keys(EDGE_KIND_CONFIDENCE).sort()).toEqual([...EDGE_KINDS].sort());
  });

  describe('data resource copies', () => {
    const WINNER = 'db/migrations/V1__init.sql::dbo.loans::table';
    const DOCS_COPY = 'docs/db/schema.sql::dbo.loans::table';
    const PROC_V1 = 'db/migrations/V1__init.sql::dbo.usp_close::procedure';
    const PROC_V7 = 'db/migrations/V7__close_fix.sql::dbo.usp_close::procedure';
    const REPORT = 'src/LoanReport.cs::Lending.LoanReport.Run::method';
    const CLOSE = 'src/LoanService.cs::Lending.LoanService.Close::method';
    const DESK = 'src/Desk.cs::Lending.Desk.Checkout::method';

    function copiesGraph(): SymbolGraph {
      const graph = new SymbolGraph();
      for (const id of [DOCS_COPY, PROC_V7, WINNER, PROC_V1, 'db/audit.sql::dbo.audit::table', REPORT, CLOSE, DESK]) {
        graph.addNode(makeNode(id));
      }
      graph.addEdge({ from: REPORT, to: 'dbo.loans::table', kind: 'reads' });
      graph.addEdge({ from: DESK, to: REPORT, kind: 'calls' });
      graph.addEdge({ from: CLOSE, to: 'dbo.usp_close::procedure', kind: 'executes' });
      graph.addEdge({ from: PROC_V1, to: 'dbo.loans::table', kind: 'writes' });
      graph.addEdge({ from: PROC_V7, to: 'dbo.loans::table', kind: 'writes' });
      graph.addEdge({ from: PROC_V7, to: 'dbo.audit::table', kind: 'writes' });
      return graph;
    }

    it('a losing copy of a table reports the same dependents as the winning copy', () => {
      const graph = copiesGraph();
      const winner = calc.calculate(graph, WINNER);
      expect(winner.impactedSymbols.map((e) => e.symbolId).sort()).toEqual([CLOSE, DESK, PROC_V1, PROC_V7, REPORT].sort());
      expect(calc.calculate(graph, DOCS_COPY)).toEqual(winner);
      expect(calc.calculate(graph, 'dbo.loans::table')).toEqual(winner);
    });

    it('a new migration copy of a procedure has the procedure\'s dependents', () => {
      const graph = copiesGraph();
      const copy = calc.calculate(graph, PROC_V7);
      expect(copy.impactedSymbols.map((e) => e.symbolId)).toEqual([CLOSE]);
      expect(copy.confirmedCount).toBe(1);
      expect(copy).toEqual(calc.calculate(graph, PROC_V1));
    });

    it('a table only a later procedure copy writes reaches the procedure\'s executors', () => {
      const result = calc.calculate(copiesGraph(), 'db/audit.sql::dbo.audit::table');
      expect(result.impactedSymbols.map((e) => [e.symbolId, e.depth])).toEqual([[PROC_V7, 1], [CLOSE, 2]]);
    });
  });
});
