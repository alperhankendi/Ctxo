import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import { ContextAssembler } from '../context-assembler.js';
import type { CoChangeEntry, SymbolNode, FileIndex } from '../../types.js';

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

  it('synthesizes an orphan table id with kind table, not variable', () => {
    const graph = buildTestGraph();
    // The edge source has no symbols[] entry: the assembler builds a node from the id alone.
    graph.addEdge({ from: 'db/loans.sql::dbo.loans::table', to: 'src/a.ts::A::function', kind: 'uses' });
    const result = assembler.assembleForTask(graph, 'src/a.ts::A::function', 'refactor', buildTestIndices());

    expect(result).toBeDefined();
    const entry = result!.context.find((c) => c.symbolId === 'db/loans.sql::dbo.loans::table');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('table');
  });

  it('returns undefined for non-existent symbol', () => {
    const graph = buildTestGraph();
    const result = assembler.assembleForTask(graph, 'src/missing.ts::X::function', 'understand', []);
    expect(result).toBeUndefined();
  });

  it('a 2-part procedure id gives the winning copy\'s dependencies, dependents and file warnings', () => {
    const V1 = 'db/migrations/V1__init.sql::dbo.usp_close::procedure';
    const V7 = 'db/migrations/V7__close_fix.sql::dbo.usp_close::procedure';
    const CLOSE = 'src/LoanService.cs::Lending.LoanService.Close::method';
    const graph = new SymbolGraph();
    for (const id of [V7, V1, 'db/loans.sql::dbo.loans::table', CLOSE]) graph.addNode(makeNode(id));
    graph.addEdge({ from: V1, to: 'dbo.loans::table', kind: 'writes' });
    graph.addEdge({ from: CLOSE, to: 'dbo.usp_close::procedure', kind: 'executes' });
    const indices: FileIndex[] = [
      { file: 'db/migrations/V1__init.sql', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [{ hash: 'abc', message: 'Revert "close loans"', date: '2024-01-01' }] },
    ];

    const result = assembler.assembleForTask(graph, 'dbo.usp_close::procedure', 'refactor', indices)!;
    expect(result.target.symbolId).toBe(V1);
    expect(result.context.map((c) => c.symbolId).sort()).toEqual(['db/loans.sql::dbo.loans::table', CLOSE]);
    expect(result.warnings).toHaveLength(1);
  });

  it('get_context_for_task omits annotations from the target', () => {
    const CLOSE = 'src/LoanService.cs::Lending.LoanService.Close::method';
    const graph = new SymbolGraph();
    const annotated = { ...makeNode(CLOSE), annotations: [{ name: 'HttpPost', args: ['close'] }] };
    graph.addNode(annotated);

    const result = assembler.assembleForTask(graph, CLOSE, 'understand', [])!;
    expect(result.target).toEqual(makeNode(CLOSE));
    expect('annotations' in result.target).toBe(false);
    expect(graph.getNode(CLOSE)?.annotations).toEqual([{ name: 'HttpPost', args: ['close'] }]);
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

describe('ContextAssembler assembleForTask with co-change', () => {
  const assembler = new ContextAssembler();
  const ROOT = 'src/a.ts::A::function';

  /** The shared graph plus E, which only imports A: a potential dependent, next to D that calls it. */
  function graphWithImporter(): SymbolGraph {
    const graph = buildTestGraph();
    graph.addNode(makeNode('src/e.ts::E::function'));
    graph.addEdge({ from: 'src/e.ts::E::function', to: ROOT, kind: 'imports' });
    return graph;
  }

  const coChangeMap = new Map<string, CoChangeEntry[]>([
    ['src/a.ts', [{ file1: 'src/a.ts', file2: 'src/e.ts', sharedCommits: 4, frequency: 0.8 }]],
  ]);

  const entryNamed = (name: string, map?: Map<string, CoChangeEntry[]>) =>
    assembler.assembleForTask(graphWithImporter(), ROOT, 'refactor', buildTestIndices(), undefined, map)!
      .context.find((c) => c.name === name);

  it('tags every blast radius dependent with its confidence tier', () => {
    expect(entryNamed('D')?.confidence).toBe('confirmed');
    expect(entryNamed('E')?.confidence).toBe('potential');
  });

  it('leaves the tier off entries that are only dependencies of the target', () => {
    expect(entryNamed('B')).toBeDefined();
    expect(entryNamed('B')).not.toHaveProperty('confidence');
  });

  it('upgrades a potential dependent to likely when its file co-changes with the target above 0.5', () => {
    expect(entryNamed('E', coChangeMap)?.confidence).toBe('likely');
    // Other tiers are not touched by co-change.
    expect(entryNamed('D', coChangeMap)?.confidence).toBe('confirmed');
  });

  it('does not upgrade at a co-change frequency of exactly 0.5', () => {
    const atTheLimit = new Map<string, CoChangeEntry[]>([
      ['src/a.ts', [{ file1: 'src/a.ts', file2: 'src/e.ts', sharedCommits: 4, frequency: 0.5 }]],
    ]);

    expect(entryNamed('E', atTheLimit)?.confidence).toBe('potential');
  });

  it('keeps the ranking of the context the same: co-change changes the tier, not the score', () => {
    expect(entryNamed('E', coChangeMap)?.relevanceScore).toBe(entryNamed('E')?.relevanceScore);
    expect(entryNamed('E', coChangeMap)?.reason).toBe(entryNamed('E')?.reason);
  });

  it('tags a symbol that is both a dependency and a dependent with its dependent tier', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode(ROOT));
    graph.addNode(makeNode('src/b.ts::B::class', 50));
    graph.addEdge({ from: ROOT, to: 'src/b.ts::B::class', kind: 'imports' });
    graph.addEdge({ from: 'src/b.ts::B::class', to: ROOT, kind: 'calls' });

    const b = assembler.assembleForTask(graph, ROOT, 'refactor', buildTestIndices())!.context.find((c) => c.name === 'B');

    expect(b?.reason).toContain('direct dependency');
    expect(b?.reason).toContain('blast radius dependent');
    expect(b?.confidence).toBe('confirmed');
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
