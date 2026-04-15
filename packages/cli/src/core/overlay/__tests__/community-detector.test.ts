import { describe, it, expect } from 'vitest';

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
          prev.symbolId.localeCompare(curr.symbolId) <= 0);
      expect(sortedCorrectly).toBe(true);
    }
  });
});
