import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import { PageRankCalculator } from '../pagerank-calculator.js';
import type { SymbolNode } from '../../types.js';

function makeNode(id: string): SymbolNode {
  const parts = id.split('::');
  return { symbolId: id, name: parts[1] ?? 'x', kind: (parts[2] ?? 'function') as SymbolNode['kind'], startLine: 0, endLine: 10 };
}

describe('PageRankCalculator', () => {
  const calc = new PageRankCalculator();

  it('returns empty result for empty graph', () => {
    const graph = new SymbolGraph();
    const result = calc.calculate(graph);

    expect(result.rankings).toEqual([]);
    expect(result.totalSymbols).toBe(0);
    expect(result.converged).toBe(true);
  });

  it('ranks most-depended-on symbol highest', () => {
    // A→C, B→C, D→C — C is depended on by everyone
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function', 'd::D::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'c::C::function', kind: 'imports' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'imports' });
    graph.addEdge({ from: 'd::D::function', to: 'c::C::function', kind: 'imports' });

    const result = calc.calculate(graph);

    expect(result.rankings[0]!.symbolId).toBe('c::C::function');
    expect(result.rankings[0]!.score).toBeGreaterThan(result.rankings[1]!.score);
    expect(result.converged).toBe(true);
  });

  it('scores are valid numbers between 0 and 1', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'imports' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'imports' });

    const result = calc.calculate(graph);

    for (const entry of result.rankings) {
      expect(entry.score).toBeGreaterThan(0);
      expect(entry.score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(entry.score)).toBe(true);
    }
  });

  it('reports inDegree and outDegree per symbol', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'c::C::function', kind: 'imports' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'calls' });

    const result = calc.calculate(graph);
    const cEntry = result.rankings.find(e => e.symbolId === 'c::C::function');

    expect(cEntry!.inDegree).toBe(2);
    expect(cEntry!.outDegree).toBe(0);

    const aEntry = result.rankings.find(e => e.symbolId === 'a::A::function');
    expect(aEntry!.inDegree).toBe(0);
    expect(aEntry!.outDegree).toBe(1);
  });

  it('handles circular dependencies without infinite loop', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'calls' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'calls' });
    graph.addEdge({ from: 'c::C::function', to: 'a::A::function', kind: 'calls' });

    const result = calc.calculate(graph);

    expect(result.rankings).toHaveLength(3);
    expect(result.converged).toBe(true);
    // All should have similar scores in a pure cycle
    const scores = result.rankings.map(e => e.score);
    const spread = Math.max(...scores) - Math.min(...scores);
    expect(spread).toBeLessThan(0.01);
  });

  it('handles dangling nodes (no outgoing edges)', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'leaf::Leaf::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'imports' });
    // leaf has no edges at all — dangling node

    const result = calc.calculate(graph);

    expect(result.rankings).toHaveLength(3);
    const leafEntry = result.rankings.find(e => e.symbolId === 'leaf::Leaf::function');
    expect(leafEntry!.score).toBeGreaterThan(0);
  });

  it('respects limit parameter', () => {
    const graph = new SymbolGraph();
    for (let i = 0; i < 10; i++) {
      graph.addNode(makeNode(`f${i}::F${i}::function`));
    }
    graph.addEdge({ from: 'f0::F0::function', to: 'f1::F1::function', kind: 'imports' });

    const result = calc.calculate(graph, { limit: 3 });
    expect(result.rankings).toHaveLength(3);
    expect(result.totalSymbols).toBe(10);
  });

  it('respects custom damping factor', () => {
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'imports' });

    const result085 = calc.calculate(graph, { damping: 0.85 });
    const result050 = calc.calculate(graph, { damping: 0.5 });

    // Different damping produces different scores
    const b085 = result085.rankings.find(e => e.symbolId === 'b::B::function')!.score;
    const b050 = result050.rankings.find(e => e.symbolId === 'b::B::function')!.score;
    expect(b085).not.toBe(b050);
  });

  it('converges within max iterations', () => {
    const graph = new SymbolGraph();
    for (let i = 0; i < 50; i++) {
      graph.addNode(makeNode(`n${i}::N${i}::function`));
      if (i > 0) {
        graph.addEdge({ from: `n${i}::N${i}::function`, to: `n${i - 1}::N${i - 1}::function`, kind: 'imports' });
      }
    }

    const result = calc.calculate(graph, { maxIterations: 100 });
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(100);
  });

  it('returns correct file field from symbolId', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/core/graph.ts::SymbolGraph::class'));

    const result = calc.calculate(graph);
    expect(result.rankings[0]!.file).toBe('src/core/graph.ts');
  });

  it('transitive importance propagates correctly', () => {
    // A→B→C: C is most important (depended on by B which is depended on by A)
    const graph = new SymbolGraph();
    for (const id of ['a::A::function', 'b::B::function', 'c::C::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'a::A::function', to: 'b::B::function', kind: 'imports' });
    graph.addEdge({ from: 'b::B::function', to: 'c::C::function', kind: 'imports' });

    const result = calc.calculate(graph);
    const scores = new Map(result.rankings.map(e => [e.symbolId, e.score]));

    // C > B > A (transitive importance)
    expect(scores.get('c::C::function')!).toBeGreaterThan(scores.get('b::B::function')!);
    expect(scores.get('b::B::function')!).toBeGreaterThan(scores.get('a::A::function')!);
  });

  it('single node returns score of 1/1', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('only::Only::function'));

    const result = calc.calculate(graph);
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0]!.score).toBe(1);
  });
});
