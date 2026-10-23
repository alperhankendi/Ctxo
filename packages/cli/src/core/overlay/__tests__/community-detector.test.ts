import { describe, it, expect } from 'vitest';

import { compareCodepoint } from '../../compare-codepoint.js';
import { SymbolGraph } from '../../graph/symbol-graph.js';
import type { SymbolNode } from '../../types.js';
import { CommunityDetector } from '../community-detector.js';
import {
  buildDisconnectedClusterGraph,
  buildGraphWithGodNode,
  buildIsolatedGraph,
  buildMultiClusterGraph,
} from './fixtures/multi-cluster.js';

function pagerankFor(graph: SymbolGraph): Map<string, number> {
  const pr = new Map<string, number>();
  const nodes = graph.allNodes();
  for (const node of nodes) {
    pr.set(node.symbolId, 1 / nodes.length);
  }
  return pr;
}

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

describe('CommunityDetector', () => {
  it('returns empty for empty graph', () => {
    const detector = new CommunityDetector();
    const result = detector.detect(new SymbolGraph(), new Map());
    expect(result.communities).toHaveLength(0);
    expect(result.godNodes).toHaveLength(0);
    expect(result.modularity).toBe(0);
    expect(result.crossClusterEdges).toBe(0);
  });

  it('assigns isolated singleton nodes a community', () => {
    const detector = new CommunityDetector();
    const graph = buildIsolatedGraph();
    const result = detector.detect(graph, pagerankFor(graph));
    expect(result.communities).toHaveLength(1);
    expect(result.modularity).toBe(0);
    expect(result.crossClusterEdges).toBe(0);
  });

  it('discovers three dense clusters in a multi-cluster graph', () => {
    const detector = new CommunityDetector({ godNodeMinBridged: 2 });
    const graph = buildMultiClusterGraph();
    const result = detector.detect(graph, pagerankFor(graph));

    const communityIds = new Set(result.communities.map((entry) => entry.communityId));
    expect(communityIds.size).toBe(3);
    expect(result.modularity).toBeGreaterThan(0.3);
    expect(result.crossClusterEdges).toBe(0);
  });

  it('detects a node bridging multiple clusters', () => {
    const detector = new CommunityDetector({ godNodeMinBridged: 2 });
    const graph = buildGraphWithGodNode();
    const pr = pagerankFor(graph);
    pr.set('shared/logger.ts::Logger::class', 0.5);
    const result = detector.detect(graph, pr);

    expect(result.godNodes.length).toBeGreaterThanOrEqual(1);
    const bridge = result.godNodes.find(
      (node) => node.symbolId === 'shared/logger.ts::Logger::class',
    );
    expect(bridge).toBeDefined();
    expect(bridge!.bridgedCommunities.length).toBeGreaterThanOrEqual(2);
  });

  it('splits disconnected components into separate communities', () => {
    const detector = new CommunityDetector();
    const graph = buildDisconnectedClusterGraph();
    const result = detector.detect(graph, pagerankFor(graph));

    const communityIds = new Set(result.communities.map((entry) => entry.communityId));
    // Two disconnected cliques → at least 2 distinct communities.
    expect(communityIds.size).toBeGreaterThanOrEqual(2);
  });

  it('produces deterministic community ids for identical input', () => {
    const detector = new CommunityDetector();
    const graph = buildMultiClusterGraph();
    const first = detector.detect(graph, pagerankFor(graph));
    const second = detector.detect(graph, pagerankFor(graph));

    const mapOf = (entries: typeof first.communities) => {
      const map = new Map<string, number>();
      for (const entry of entries) map.set(entry.symbolId, entry.communityId);
      return map;
    };
    expect(mapOf(first.communities)).toEqual(mapOf(second.communities));
    expect(first.modularity).toBe(second.modularity);
  });

  it('skips self-loop edges and dangling edge endpoints', () => {
    const detector = new CommunityDetector();
    const graph = new SymbolGraph();
    graph.addNode(makeNode('a/x.ts::X::function'));
    graph.addNode(makeNode('a/y.ts::Y::function'));
    graph.addEdge({ from: 'a/x.ts::X::function', to: 'a/x.ts::X::function', kind: 'calls' });
    graph.addEdge({ from: 'a/x.ts::X::function', to: 'a/y.ts::Y::function', kind: 'calls' });
    const result = detector.detect(graph, pagerankFor(graph));
    expect(result.communities).toHaveLength(2);
  });

  it('labels a cluster by its common path prefix', () => {
    const detector = new CommunityDetector();
    const graph = buildMultiClusterGraph();
    const result = detector.detect(graph, pagerankFor(graph));

    const labels = new Set(result.communities.map((entry) => entry.communityLabel));
    expect([...labels]).toEqual(
      expect.arrayContaining(['auth', 'billing', 'reporting']),
    );
  });

  it('propagates edgeQuality flag to the result', () => {
    const detector = new CommunityDetector();
    const graph = buildMultiClusterGraph();
    const result = detector.detect(graph, pagerankFor(graph), 'syntax-only');
    expect(result.edgeQuality).toBe('syntax-only');
  });

  it('caps god nodes by max results parameter', () => {
    const detector = new CommunityDetector({ godNodeMinBridged: 2, godNodeMaxResults: 1 });
    const graph = buildGraphWithGodNode();
    const result = detector.detect(graph, pagerankFor(graph));
    expect(result.godNodes.length).toBeLessThanOrEqual(1);
  });

  it('counts cross-cluster edges when clusters are connected by a bridge', () => {
    const detector = new CommunityDetector();
    const graph = buildGraphWithGodNode();
    const result = detector.detect(graph, pagerankFor(graph));
    expect(result.crossClusterEdges).toBeGreaterThan(0);
  });

  it('breaks god node ties by code point, never by locale', () => {
    // Two bridges wired the same way to the same three clusters, with the same PageRank: only the id
    // decides. "Index" and "ideal" differ only in case: a code point sort puts the upper-case I first,
    // a locale-aware sort ("ideal" before "index") puts it last.
    const detector = new CommunityDetector({ godNodeMinBridged: 2 });
    const graph = buildMultiClusterGraph();
    const bridges = ['src/ideal.ts::y::class', 'src/Index.ts::x::class'];
    const touches = [
      'auth/login.ts::login::function',
      'billing/invoice.ts::Invoice::class',
      'reporting/monthly.ts::monthlyReport::function',
    ];
    for (const bridge of bridges) {
      graph.addNode(makeNode(bridge));
      for (const target of touches) graph.addEdge({ from: target, to: bridge, kind: 'calls' });
    }
    const pr = pagerankFor(graph);

    const result = detector.detect(graph, pr);

    const godIds = result.godNodes.map((god) => god.symbolId);
    expect(godIds).toEqual(expect.arrayContaining(bridges));
    const [first, second] = result.godNodes.filter((god) => bridges.includes(god.symbolId));
    // The scores really tie, so the id is what orders them.
    expect(first!.centralityScore).toBe(second!.centralityScore);
    expect(first!.symbolId).toBe('src/Index.ts::x::class');
    expect(second!.symbolId).toBe('src/ideal.ts::y::class');
  });

  it('god nodes with equal centrality are ordered and capped by code point', () => {
    // Upper-case B sorts before lower-case a by code point; a locale-aware sort would keep a instead.
    const detector = new CommunityDetector({ godNodeMinBridged: 2, godNodeMaxResults: 1 });
    const graph = buildMultiClusterGraph();
    const bridges = ['hub/B.ts::B::class', 'hub/a.ts::a::class'];
    // Each cluster member touches at most one bridge, so only the two bridges reach two communities.
    const touches: Record<string, string[]> = {
      'hub/B.ts::B::class': [
        'auth/login.ts::login::function',
        'billing/invoice.ts::Invoice::class',
        'reporting/monthly.ts::monthlyReport::function',
      ],
      'hub/a.ts::a::class': [
        'auth/session.ts::Session::class',
        'billing/charge.ts::charge::function',
        'reporting/export.ts::exportCsv::function',
      ],
    };
    for (const bridge of bridges) {
      graph.addNode(makeNode(bridge));
      for (const target of touches[bridge]!) graph.addEdge({ from: target, to: bridge, kind: 'calls' });
    }

    const uncapped = new CommunityDetector({ godNodeMinBridged: 2 }).detect(graph, pagerankFor(graph));
    expect(uncapped.godNodes.map((god) => god.symbolId)).toEqual(bridges);
    const [first, second] = uncapped.godNodes;
    expect(first!.bridgedCommunities.length).toBe(second!.bridgedCommunities.length);
    expect(first!.centralityScore).toBe(second!.centralityScore);

    const result = detector.detect(graph, pagerankFor(graph));

    expect(result.godNodes.map((god) => god.symbolId)).toEqual(['hub/B.ts::B::class']);
  });

  it('returns god nodes sorted by centrality score descending', () => {
    const detector = new CommunityDetector({ godNodeMinBridged: 2 });
    const graph = buildGraphWithGodNode();
    const pr = pagerankFor(graph);
    pr.set('shared/logger.ts::Logger::class', 0.5);
    const result = detector.detect(graph, pr);
    for (let i = 1; i < result.godNodes.length; i++) {
      const prev = result.godNodes[i - 1]!;
      const curr = result.godNodes[i]!;
      const sortedCorrectly =
        prev.centralityScore > curr.centralityScore ||
        (prev.centralityScore === curr.centralityScore &&
          compareCodepoint(prev.symbolId, curr.symbolId) <= 0);
      expect(sortedCorrectly).toBe(true);
    }
  });

  describe('data edges', () => {
    function buildDataGraph(groups = 2): SymbolGraph {
      const graph = new SymbolGraph();
      const table = 'db/t.sql::dbo.t::table';
      graph.addNode(makeNode(table));
      const files = ['a/x.ts', 'b/y.ts', 'c/z.ts', 'd/w.ts'].slice(0, groups);
      files.forEach((file, i) => {
        const f1 = `${file}::F1::function`;
        const f2 = `${file}::F2::function`;
        graph.addNode(makeNode(f1));
        graph.addNode(makeNode(f2));
        graph.addEdge({ from: f1, to: f2, kind: 'calls' });
        graph.addEdge({ from: f2, to: f1, kind: 'calls' });
        graph.addEdge({ from: f1, to: table, kind: i % 2 === 0 ? 'reads' : 'writes' });
        graph.addEdge({ from: f2, to: table, kind: 'reads' });
      });
      return graph;
    }

    it('data edges do not join communities', () => {
      const graph = buildDataGraph();
      const result = new CommunityDetector().detect(graph, pagerankFor(graph));
      const idOf = (id: string) => result.communities.find((c) => c.symbolId === id)!.communityId;
      const tableCommunity = idOf('db/t.sql::dbo.t::table');
      const members = result.communities.filter((c) => c.communityId === tableCommunity);
      expect(members).toHaveLength(1);
      expect(idOf('a/x.ts::F1::function')).not.toBe(idOf('b/y.ts::F1::function'));
    });

    it('crossClusterEdges ignores data edges', () => {
      const graph = buildDataGraph();
      const result = new CommunityDetector().detect(graph, pagerankFor(graph));
      expect(result.crossClusterEdges).toBe(0);
    });

    it('a table is never a god node', () => {
      const graph = buildDataGraph(4);
      const result = new CommunityDetector({ godNodeMinBridged: 1 }).detect(graph, pagerankFor(graph));
      expect(result.godNodes.map((g) => g.symbolId)).not.toContain('db/t.sql::dbo.t::table');
    });
  });
});
