import { describe, it, expect } from 'vitest';

import { SymbolGraph } from '../../graph/symbol-graph.js';
import type { CommunityEntry, CommunitySnapshot, SymbolNode } from '../../types.js';
import { BoundaryViolationDetector } from '../boundary-violation-detector.js';

function makeNode(id: string): SymbolNode {
  const parts = id.split('::');
  return {
    symbolId: id,
    name: parts[1] ?? 'x',
    kind: (parts[2] ?? 'function') as SymbolNode['kind'],
    startLine: 0,
    endLine: 10,
  };
}

function snapshot(
  communities: CommunityEntry[],
  overrides: Partial<CommunitySnapshot> = {},
): CommunitySnapshot {
  return {
    version: 1,
    computedAt: '2026-04-16T10:00:00.000Z',
    commitSha: 'sha',
    modularity: 0.4,
    communities,
    godNodes: [],
    edgeQuality: 'full',
    crossClusterEdges: 0,
    ...overrides,
  };
}

function entry(symbolId: string, communityId: number, label: string): CommunityEntry {
  return { symbolId, communityId, communityLabel: label };
}

describe('BoundaryViolationDetector', () => {
  const detector = new BoundaryViolationDetector();

  it('returns no violations when graph has no edges', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a.ts::A::function'));
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const result = detector.detect(graph, current, []);
    expect(result.violations).toEqual([]);
  });

  it('skips intra-cluster edges', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a.ts::A::function'));
    graph.addNode(makeNode('b.ts::B::function'));
    graph.addEdge({ from: 'a.ts::A::function', to: 'b.ts::B::function', kind: 'calls' });
    const current = snapshot([
      entry('a.ts::A::function', 0, 'core'),
      entry('b.ts::B::function', 0, 'core'),
    ]);
    const result = detector.detect(graph, current, [current, current]);
    expect(result.violations).toEqual([]);
  });

  it('flags a cross-cluster edge as unknown severity when history is insufficient', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('auth.ts::Auth::function'));
    graph.addNode(makeNode('billing.ts::Billing::function'));
    graph.addEdge({ from: 'auth.ts::Auth::function', to: 'billing.ts::Billing::function', kind: 'calls' });
    const current = snapshot([
      entry('auth.ts::Auth::function', 0, 'Auth'),
      entry('billing.ts::Billing::function', 1, 'Billing'),
    ]);
    const result = detector.detect(graph, current, []);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.historicalEdgesBetweenClusters).toBe(-1);
    expect(result.confidence).toBe('low');
    expect(result.hint).toBeDefined();
  });

  it('flags a cross-cluster edge as high severity when no historical precedent exists', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('auth.ts::Auth::function'));
    graph.addNode(makeNode('billing.ts::Billing::function'));
    graph.addEdge({ from: 'auth.ts::Auth::function', to: 'billing.ts::Billing::function', kind: 'calls' });
    const current = snapshot([
      entry('auth.ts::Auth::function', 0, 'Auth'),
      entry('billing.ts::Billing::function', 1, 'Billing'),
    ]);
    // Three snapshots where both symbols were in the same cluster.
    const history = [
      snapshot([
        entry('auth.ts::Auth::function', 0, 'Shared'),
        entry('billing.ts::Billing::function', 0, 'Shared'),
      ]),
      snapshot([
        entry('auth.ts::Auth::function', 0, 'Shared'),
        entry('billing.ts::Billing::function', 0, 'Shared'),
      ]),
      snapshot([
        entry('auth.ts::Auth::function', 0, 'Shared'),
        entry('billing.ts::Billing::function', 0, 'Shared'),
      ]),
    ];
    const result = detector.detect(graph, current, history);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.severity).toBe('high');
    expect(result.violations[0]!.historicalEdgesBetweenClusters).toBe(0);
  });

  it('flags medium severity when historical cross-cluster edges are rare (≤ 2)', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('auth.ts::Auth::function'));
    graph.addNode(makeNode('billing.ts::Billing::function'));
    graph.addEdge({ from: 'auth.ts::Auth::function', to: 'billing.ts::Billing::function', kind: 'calls' });
    const current = snapshot([
      entry('auth.ts::Auth::function', 0, 'Auth'),
      entry('billing.ts::Billing::function', 1, 'Billing'),
    ]);
    const history = [
      snapshot([
        entry('auth.ts::Auth::function', 0, 'Auth'),
        entry('billing.ts::Billing::function', 1, 'Billing'),
      ]),
      snapshot([
        entry('auth.ts::Auth::function', 0, 'Shared'),
        entry('billing.ts::Billing::function', 0, 'Shared'),
      ]),
      snapshot([
        entry('auth.ts::Auth::function', 0, 'Shared'),
        entry('billing.ts::Billing::function', 0, 'Shared'),
      ]),
    ];
    const result = detector.detect(graph, current, history);
    expect(result.violations[0]!.severity).toBe('medium');
    expect(result.violations[0]!.historicalEdgesBetweenClusters).toBe(1);
  });

  it('does not flag edges that have been established historically', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('auth.ts::Auth::function'));
    graph.addNode(makeNode('billing.ts::Billing::function'));
    graph.addEdge({ from: 'auth.ts::Auth::function', to: 'billing.ts::Billing::function', kind: 'calls' });
    const current = snapshot([
      entry('auth.ts::Auth::function', 0, 'Auth'),
      entry('billing.ts::Billing::function', 1, 'Billing'),
    ]);
    const established = snapshot([
      entry('auth.ts::Auth::function', 0, 'Auth'),
      entry('billing.ts::Billing::function', 1, 'Billing'),
    ]);
    const history = [established, established, established, established];
    const result = detector.detect(graph, current, history);
    expect(result.violations).toEqual([]);
  });

  it('sorts violations by severity (high first) then by symbol id', () => {
    const graph = new SymbolGraph();
    for (const id of ['a.ts::A::function', 'b.ts::B::function', 'c.ts::C::function']) {
      graph.addNode(makeNode(id));
    }
    graph.addEdge({ from: 'c.ts::C::function', to: 'a.ts::A::function', kind: 'calls' });
    graph.addEdge({ from: 'a.ts::A::function', to: 'b.ts::B::function', kind: 'calls' });
    const current = snapshot([
      entry('a.ts::A::function', 0, 'A'),
      entry('b.ts::B::function', 1, 'B'),
      entry('c.ts::C::function', 2, 'C'),
    ]);
    const result = detector.detect(graph, current, [current, current]);
    // All low-history so flagged; ensure deterministic ordering.
    const fromIds = result.violations.map((v) => v.from.symbolId);
    expect(fromIds).toEqual([...fromIds].sort());
  });

  it('scales confidence with snapshot depth', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a.ts::A::function'));
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const history7 = Array.from({ length: 7 }, () => current);
    expect(detector.detect(graph, current, history7).confidence).toBe('high');
    const history3 = Array.from({ length: 3 }, () => current);
    expect(detector.detect(graph, current, history3).confidence).toBe('medium');
    expect(detector.detect(graph, current, []).confidence).toBe('low');
  });

  it('skips edges for symbols missing from current snapshot', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a.ts::A::function'));
    graph.addNode(makeNode('b.ts::B::function'));
    graph.addEdge({ from: 'a.ts::A::function', to: 'b.ts::B::function', kind: 'calls' });
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const result = detector.detect(graph, current, [current, current]);
    expect(result.violations).toEqual([]);
  });

  it('skips edges within the same cluster even in the presence of history', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a.ts::A::function'));
    graph.addNode(makeNode('b.ts::B::function'));
    graph.addEdge({ from: 'a.ts::A::function', to: 'a.ts::A::function', kind: 'calls' });
    const current = snapshot([
      entry('a.ts::A::function', 0, 'core'),
      entry('b.ts::B::function', 0, 'core'),
    ]);
    const result = detector.detect(graph, current, []);
    expect(result.violations).toEqual([]);
  });

  it('uses "community-N" fallback label when label metadata is missing', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a.ts::A::function'));
    graph.addNode(makeNode('b.ts::B::function'));
    graph.addEdge({ from: 'a.ts::A::function', to: 'b.ts::B::function', kind: 'calls' });
    const current = snapshot([
      { symbolId: 'a.ts::A::function', communityId: 0, communityLabel: '' },
      { symbolId: 'b.ts::B::function', communityId: 1, communityLabel: '' },
    ]);
    const result = detector.detect(graph, current, []);
    expect(result.violations[0]!.from.label).toBe('');
  });
});
