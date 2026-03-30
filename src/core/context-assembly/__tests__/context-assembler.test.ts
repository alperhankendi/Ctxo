import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import { ContextAssembler } from '../context-assembler.js';
import type { SymbolNode, FileIndex } from '../../types.js';

function makeNode(id: string, endLine = 10): SymbolNode {
  const parts = id.split('::');
  return { symbolId: id, name: parts[1] ?? 'x', kind: (parts[2] ?? 'function') as SymbolNode['kind'], startLine: 0, endLine };
}

function buildTestGraph(): SymbolGraph {
  const graph = new SymbolGraph();
  // Root: A depends on B (class) and C (interface)
  graph.addNode(makeNode('src/a.ts::A::function'));
  graph.addNode(makeNode('src/b.ts::B::class', 50));
  graph.addNode(makeNode('src/c.ts::C::interface', 5));
  graph.addNode(makeNode('src/d.ts::D::function', 100)); // high complexity candidate
  graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'imports' });
  graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/c.ts::C::interface', kind: 'implements' });
  // D depends on A (blast radius dependent)
  graph.addEdge({ from: 'src/d.ts::D::function', to: 'src/a.ts::A::function', kind: 'calls' });
  return graph;
}

function buildTestIndices(): FileIndex[] {
  return [
    { file: 'src/a.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/b.ts', lastModified: 1, symbols: [], edges: [], complexity: [{ symbolId: 'src/b.ts::B::class', cyclomatic: 8 }], intent: [], antiPatterns: [] },
    { file: 'src/c.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/d.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [{ hash: 'abc', message: 'Revert "add feature"', date: '2024-01-01' }] },
  ];
}

describe('ContextAssembler — assembleForTask', () => {
  const assembler = new ContextAssembler();

  it('ranks direct dependencies higher for "understand" task', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleForTask(graph, 'src/a.ts::A::function', 'understand', buildTestIndices());

    expect(result).toBeDefined();
    expect(result!.context.length).toBeGreaterThan(0);

    // B and C are direct deps — should be in context
    const names = result!.context.map((c) => c.name);
    expect(names).toContain('B');
    expect(names).toContain('C');
  });

  it('ranks interfaces higher for "extend" task', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleForTask(graph, 'src/a.ts::A::function', 'extend', buildTestIndices());

    expect(result).toBeDefined();
    // C (interface) should score high for extend
    const cEntry = result!.context.find((c) => c.name === 'C');
    expect(cEntry).toBeDefined();
    expect(cEntry!.reason).toContain('type/interface');
  });

  it('ranks blast radius dependents higher for "refactor" task', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleForTask(graph, 'src/a.ts::A::function', 'refactor', buildTestIndices());

    expect(result).toBeDefined();
    // D depends on A — should appear for refactor
    const dEntry = result!.context.find((c) => c.name === 'D');
    expect(dEntry).toBeDefined();
    expect(dEntry!.reason).toContain('blast radius');
  });

  it('ranks anti-pattern symbols higher for "fix" task', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleForTask(graph, 'src/a.ts::A::function', 'fix', buildTestIndices());

    expect(result).toBeDefined();
    // D has anti-pattern history
    const dEntry = result!.context.find((c) => c.name === 'D');
    expect(dEntry).toBeDefined();
    expect(dEntry!.reason).toContain('anti-pattern');
  });

  it('respects token budget (greedy packing)', () => {
    const graph = buildTestGraph();
    // Very small budget — should not include all
    const result = assembler.assembleForTask(graph, 'src/a.ts::A::function', 'understand', buildTestIndices(), 100);

    expect(result).toBeDefined();
    expect(result!.totalTokens).toBeLessThanOrEqual(100);
  });

  it('returns undefined for non-existent symbol', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleForTask(graph, 'src/missing.ts::X::function', 'understand', []);
    expect(result).toBeUndefined();
  });

  it('includes warnings for anti-patterns in target file', () => {
    const graph = buildTestGraph();
    // D has anti-patterns in its file
    const result = assembler.assembleForTask(graph, 'src/d.ts::D::function', 'fix', buildTestIndices());
    expect(result).toBeDefined();
    expect(result!.warnings.length).toBeGreaterThan(0);
    expect(result!.warnings[0]).toContain('anti-pattern');
  });
});

describe('ContextAssembler — assembleRanked', () => {
  const assembler = new ContextAssembler();

  it('returns results ranked by combined score', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleRanked(graph, 'B');

    expect(result.results.length).toBeGreaterThan(0);
    // B exact match should be first or near top
    expect(result.results[0]?.name).toBe('B');
  });

  it('exact name match scores highest relevance', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleRanked(graph, 'C');

    const cResult = result.results.find((r) => r.name === 'C');
    expect(cResult?.relevanceScore).toBe(1.0);
  });

  it('respects tokenBudget parameter', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleRanked(graph, 'A', 'combined', 50);

    expect(result.totalTokens).toBeLessThanOrEqual(50);
  });

  it('importance strategy ranks by reverse edge count', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleRanked(graph, '', 'importance', 10000);

    // A has most reverse edges (D calls A) — should rank high
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('returns zero relevance for no-match query', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleRanked(graph, 'zzzznonexistent');

    // No symbol matches the query text
    for (const r of result.results) {
      expect(r.relevanceScore).toBe(0);
    }
  });
});
