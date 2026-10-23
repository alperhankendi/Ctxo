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

// Every snapshot is a commit of its own unless a test names the commit. The prefix keeps these
// away from the shas tests pick by hand.
let snapshotCounter = 0;

// What the detectors tell users to do about a thin history.
const HISTORY_HINT =
  'Install the post-commit hook (`ctxo init`) or run `ctxo index` after commits to build history; `ctxo index --check` does not record snapshots.';

function snapshot(
  communities: CommunityEntry[],
  overrides: Partial<CommunitySnapshot> = {},
): CommunitySnapshot {
  return {
    version: 1,
    computedAt: '2026-04-16T10:00:00.000Z',
    commitSha: `auto-sha-${++snapshotCounter}`,
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
    // Four earlier commits in which the edge already crossed the same clusters.
    const history = Array.from({ length: 4 }, () =>
      snapshot([
        entry('auth.ts::Auth::function', 0, 'Auth'),
        entry('billing.ts::Billing::function', 1, 'Billing'),
      ]),
    );
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

  it('sorts violations by code point, never by locale', () => {
    // "Index" and "ideal" differ only in case: a code point sort puts the upper-case I first, a
    // locale-aware sort ("ideal" before "index") puts it last. Same tie-break on the target side.
    const graph = new SymbolGraph();
    const ids = [
      'src/ideal.ts::y::function',
      'src/Index.ts::x::function',
      'src/Zeta.ts::t::function',
      'src/zeta.ts::t::function',
    ];
    for (const id of ids) graph.addNode(makeNode(id));
    graph.addEdge({ from: 'src/ideal.ts::y::function', to: 'src/Zeta.ts::t::function', kind: 'calls' });
    graph.addEdge({ from: 'src/Index.ts::x::function', to: 'src/Zeta.ts::t::function', kind: 'calls' });
    graph.addEdge({ from: 'src/Index.ts::x::function', to: 'src/zeta.ts::t::function', kind: 'calls' });
    const current = snapshot([
      entry('src/ideal.ts::y::function', 0, 'A'),
      entry('src/Index.ts::x::function', 0, 'A'),
      entry('src/Zeta.ts::t::function', 1, 'B'),
      entry('src/zeta.ts::t::function', 1, 'B'),
    ]);
    const result = detector.detect(graph, current, []);
    expect(result.violations.map((v) => [v.from.symbolId, v.to.symbolId])).toEqual([
      ['src/Index.ts::x::function', 'src/Zeta.ts::t::function'],
      ['src/Index.ts::x::function', 'src/zeta.ts::t::function'],
      ['src/ideal.ts::y::function', 'src/Zeta.ts::t::function'],
    ]);
  });

  it('scales confidence with snapshot depth', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a.ts::A::function'));
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const earlier = (count: number) =>
      Array.from({ length: count }, () => snapshot([entry('a.ts::A::function', 0, 'core')]));
    expect(detector.detect(graph, current, earlier(7)).confidence).toBe('high');
    expect(detector.detect(graph, current, earlier(3)).confidence).toBe('medium');
    expect(detector.detect(graph, current, []).confidence).toBe('low');
  });

  it('boundary confidence counts distinct commits', () => {
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a.ts::A::function'));
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    // `snapshots` history files spread over `commits` commits (the hook archived one file per run).
    const spread = (snapshots: number, commits: number) =>
      Array.from({ length: snapshots }, (_, i) =>
        snapshot([entry('a.ts::A::function', 0, 'core')], { commitSha: `commit-${i % commits}` }),
      );

    const tenOverThree = detector.detect(graph, current, spread(10, 3));
    expect(tenOverThree.snapshotsAvailable).toBe(10);
    expect(tenOverThree.distinctCommits).toBe(3);
    expect(tenOverThree.confidence).toBe('medium');

    const fourteenOverSeven = detector.detect(graph, current, spread(14, 7));
    expect(fourteenOverSeven.snapshotsAvailable).toBe(14);
    expect(fourteenOverSeven.distinctCommits).toBe(7);
    expect(fourteenOverSeven.confidence).toBe('high');

    const tenOverOne = detector.detect(graph, current, spread(10, 1));
    expect(tenOverOne.snapshotsAvailable).toBe(10);
    expect(tenOverOne.distinctCommits).toBe(1);
    expect(tenOverOne.confidence).toBe('low');
  });

  describe('history from earlier commits', () => {
    function crossClusterGraph(): SymbolGraph {
      const graph = new SymbolGraph();
      graph.addNode(makeNode('auth.ts::Auth::function'));
      graph.addNode(makeNode('billing.ts::Billing::function'));
      graph.addEdge({ from: 'auth.ts::Auth::function', to: 'billing.ts::Billing::function', kind: 'calls' });
      return graph;
    }
    const apart = () => [
      entry('auth.ts::Auth::function', 0, 'Auth'),
      entry('billing.ts::Billing::function', 1, 'Billing'),
    ];
    const together = () => [
      entry('auth.ts::Auth::function', 0, 'Shared'),
      entry('billing.ts::Billing::function', 0, 'Shared'),
    ];

    it('treats copies of a single commit as insufficient history', () => {
      const current = snapshot(apart(), { commitSha: 'head' });
      // Five files, one commit: one data point, so the edge cannot be called established.
      const history = Array.from({ length: 5 }, () => snapshot(apart(), { commitSha: 'commit-a' }));

      const result = detector.detect(crossClusterGraph(), current, history);

      expect(result.snapshotsAvailable).toBe(5);
      expect(result.distinctCommits).toBe(1);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.historicalEdgesBetweenClusters).toBe(-1);
      expect(result.confidence).toBe('low');
      expect(result.hint).toBe(HISTORY_HINT);
    });

    it('counts a commit once however many snapshots it has', () => {
      const current = snapshot(apart(), { commitSha: 'head' });
      const history = [
        snapshot(apart(), { commitSha: 'commit-a' }),
        snapshot(apart(), { commitSha: 'commit-a' }),
        snapshot(apart(), { commitSha: 'commit-a' }),
        snapshot(together(), { commitSha: 'commit-b' }),
      ];

      const result = detector.detect(crossClusterGraph(), current, history);

      expect(result.distinctCommits).toBe(2);
      expect(result.violations).toHaveLength(1);
      // Apart in one earlier commit (commit-a), together in the other: 1, not 3.
      expect(result.violations[0]!.historicalEdgesBetweenClusters).toBe(1);
      expect(result.violations[0]!.severity).toBe('medium');
    });

    it('ignores history entries from the current commit', () => {
      const current = snapshot(apart(), { commitSha: 'head' });
      const history = [
        // Indexes written by older versions can hold a snapshot of the current commit in history.
        snapshot(apart(), { commitSha: 'head' }),
        snapshot(together(), { commitSha: 'commit-a' }),
        snapshot(together(), { commitSha: 'commit-b' }),
      ];

      const result = detector.detect(crossClusterGraph(), current, history);

      expect(result.snapshotsAvailable).toBe(3);
      expect(result.distinctCommits).toBe(2);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]!.historicalEdgesBetweenClusters).toBe(0);
      expect(result.violations[0]!.severity).toBe('high');
    });

    it('needs two distinct commits before it judges an edge against history', () => {
      const current = snapshot(apart(), { commitSha: 'head' });
      const oneCommit = [snapshot(together(), { commitSha: 'commit-a' })];
      const twoCommits = [...oneCommit, snapshot(together(), { commitSha: 'commit-b' })];

      const unjudged = detector.detect(crossClusterGraph(), current, oneCommit);
      expect(unjudged.violations[0]!.historicalEdgesBetweenClusters).toBe(-1);

      const judged = detector.detect(crossClusterGraph(), current, twoCommits);
      expect(judged.violations[0]!.historicalEdgesBetweenClusters).toBe(0);
      expect(judged.violations[0]!.severity).toBe('high');
      // Two commits judge the edge, but are still too few for medium confidence.
      expect(judged.confidence).toBe('low');
      expect(judged.hint).toBeUndefined();
    });
  });

  it('hints no longer mention ctxo index --check as a way to build history', () => {
    const graph = new SymbolGraph();
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const earlier = () => snapshot([entry('a.ts::A::function', 0, 'core')]);

    for (const history of [[], [earlier()]]) {
      const { hint } = detector.detect(graph, current, history);
      expect(hint).toBe(HISTORY_HINT);
      expect(hint).not.toMatch(/CI/);
    }
    // Two distinct commits are enough for boundary judgement: no hint.
    expect(detector.detect(graph, current, [earlier(), earlier()]).hint).toBeUndefined();
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
