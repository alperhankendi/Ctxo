import { describe, it, expect } from 'vitest';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import { DeadCodeDetector } from '../dead-code-detector.js';
import type { SymbolNode } from '../../types.js';

function makeNode(id: string): SymbolNode {
  const parts = id.split('::');
  return { symbolId: id, name: parts[1] ?? 'x', kind: (parts[2] ?? 'function') as SymbolNode['kind'], startLine: 0, endLine: 10 };
}

describe('DeadCodeDetector', () => {
  const detector = new DeadCodeDetector();

  it('finds unreachable symbols (A→B, C isolated → C is dead)', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));
    graph.addNode(makeNode('src/b.ts::B::function'));
    graph.addNode(makeNode('src/c.ts::C::function'));
    graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::function', kind: 'imports' });

    const result = detector.detect(graph);

    // A is entry point (no reverse edges), B is reachable from A, C is dead
    expect(result.deadSymbols).toHaveLength(1);
    expect(result.deadSymbols[0]?.symbolId).toBe('src/c.ts::C::function');
    expect(result.deadSymbols[0]?.confidence).toBe(1.0);
  });

  it('returns empty when all symbols are reachable', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));
    graph.addNode(makeNode('src/b.ts::B::function'));
    graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::function', kind: 'calls' });

    const result = detector.detect(graph);

    expect(result.deadSymbols).toEqual([]);
    expect(result.deadCodePercentage).toBe(0);
  });

  it('detects dead files (all symbols in file are dead)', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));
    graph.addNode(makeNode('src/dead.ts::X::function'));
    graph.addNode(makeNode('src/dead.ts::Y::class'));

    const result = detector.detect(graph);

    expect(result.deadFiles).toContain('src/dead.ts');
  });

  it('excludes test files by default', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));
    graph.addNode(makeNode('src/__tests__/a.test.ts::testA::function'));

    const result = detector.detect(graph);

    // Test file excluded — should not appear in dead symbols
    expect(result.deadSymbols.every((s) => !s.file.includes('__tests__'))).toBe(true);
    expect(result.totalSymbols).toBe(1); // Only src/a.ts counted
  });

  it('includes test files when includeTests=true', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));
    graph.addNode(makeNode('src/__tests__/orphan.test.ts::orphanTest::function'));

    const result = detector.detect(graph, { includeTests: true });

    expect(result.totalSymbols).toBe(2);
  });

  it('handles circular dependencies — detects dead islands', () => {
    const graph = new SymbolGraph();
    // Entry point with a real dependency (so it's not isolated)
    graph.addNode(makeNode('src/main.ts::main::function'));
    graph.addNode(makeNode('src/app.ts::app::function'));
    graph.addEdge({ from: 'src/main.ts::main::function', to: 'src/app.ts::app::function', kind: 'calls' });
    // Dead island: X→Y→Z→X (circular, not reachable from main)
    graph.addNode(makeNode('src/x.ts::X::function'));
    graph.addNode(makeNode('src/y.ts::Y::function'));
    graph.addNode(makeNode('src/z.ts::Z::function'));
    graph.addEdge({ from: 'src/x.ts::X::function', to: 'src/y.ts::Y::function', kind: 'calls' });
    graph.addEdge({ from: 'src/y.ts::Y::function', to: 'src/z.ts::Z::function', kind: 'calls' });
    graph.addEdge({ from: 'src/z.ts::Z::function', to: 'src/x.ts::X::function', kind: 'calls' });

    const result = detector.detect(graph);

    // X, Y, Z are all dead (circular island, unreachable from main)
    const deadIds = result.deadSymbols.map((s) => s.symbolId);
    expect(deadIds).toContain('src/x.ts::X::function');
    expect(deadIds).toContain('src/y.ts::Y::function');
    expect(deadIds).toContain('src/z.ts::Z::function');
    expect(result.deadSymbols.length).toBe(3);
  });

  it('assigns confidence 1.0 for zero-importer symbols', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));
    graph.addNode(makeNode('src/orphan.ts::orphan::function'));

    const result = detector.detect(graph);

    const orphan = result.deadSymbols.find((s) => s.name === 'orphan');
    expect(orphan?.confidence).toBe(1.0);
    expect(orphan?.reason).toContain('Zero importers');
  });

  it('assigns confidence 0.7 for cascading dead code', () => {
    const graph = new SymbolGraph();
    // Real entry point with dependency
    graph.addNode(makeNode('src/main.ts::main::function'));
    graph.addNode(makeNode('src/app.ts::app::function'));
    graph.addEdge({ from: 'src/main.ts::main::function', to: 'src/app.ts::app::function', kind: 'calls' });
    // Dead island: deadA → deadB (circular island, both dead)
    // deadA has reverse from deadB, deadB has reverse from deadA → neither is entry point
    graph.addNode(makeNode('src/dead-a.ts::deadA::function'));
    graph.addNode(makeNode('src/dead-b.ts::deadB::function'));
    graph.addEdge({ from: 'src/dead-a.ts::deadA::function', to: 'src/dead-b.ts::deadB::function', kind: 'imports' });
    graph.addEdge({ from: 'src/dead-b.ts::deadB::function', to: 'src/dead-a.ts::deadA::function', kind: 'imports' });

    const result = detector.detect(graph);

    const deadB = result.deadSymbols.find((s) => s.name === 'deadB');
    expect(deadB?.confidence).toBe(0.7);
    expect(deadB?.reason).toContain('cascading');
  });

  it('returns deadCodePercentage as 0-100', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));
    graph.addNode(makeNode('src/b.ts::B::function'));
    graph.addNode(makeNode('src/c.ts::C::function'));
    graph.addNode(makeNode('src/d.ts::D::function'));
    // A→B, C and D are dead = 2/4 = 50%
    graph.addEdge({ from: 'src/a.ts::A::function', to: 'src/b.ts::B::function', kind: 'imports' });

    const result = detector.detect(graph);

    expect(result.deadCodePercentage).toBe(50);
    expect(result.totalSymbols).toBe(4);
    expect(result.reachableSymbols).toBe(2);
  });

  it('excludes config files by default', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('src/a.ts::A::function'));
    graph.addNode(makeNode('vitest.config.ts::config::variable'));

    const result = detector.detect(graph);

    expect(result.totalSymbols).toBe(1);
  });

  it('handles empty graph', () => {
    const graph = new SymbolGraph();
    const result = detector.detect(graph);

    expect(result.totalSymbols).toBe(0);
    expect(result.deadSymbols).toEqual([]);
    expect(result.deadFiles).toEqual([]);
    expect(result.deadCodePercentage).toBe(0);
  });
});
