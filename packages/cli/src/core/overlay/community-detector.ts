import { UndirectedGraph } from 'graphology';
import type { DetailedLouvainOutput, LouvainOptions } from 'graphology-communities-louvain';
import louvainModule from 'graphology-communities-louvain';

type LouvainGraph = UndirectedGraph;

interface LouvainRunner {
  detailed(graph: LouvainGraph, options?: LouvainOptions): DetailedLouvainOutput;
}

// graphology-communities-louvain is a CJS module exposed via default export; under
// Node16 module resolution the TS type is the module namespace, so we normalize here.
const louvain: LouvainRunner =
  ((louvainModule as unknown) as { default?: LouvainRunner }).default ??
  (louvainModule as unknown as LouvainRunner);

import type { SymbolGraph } from '../graph/symbol-graph.js';
import type { CommunityEntry, EdgeQuality, GodNode } from '../types.js';
import { labelCommunities } from './community-labeler.js';

export interface CommunityComputeResult {
  readonly communities: CommunityEntry[];
  readonly godNodes: GodNode[];
  readonly modularity: number;
  readonly crossClusterEdges: number;
  readonly edgeQuality: EdgeQuality;
}

export interface CommunityDetectorOptions {
  readonly resolution?: number;
  readonly godNodeMinBridged?: number;
  readonly godNodeMaxResults?: number;
}

const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_GOD_NODE_MIN_BRIDGED = 3;
const DEFAULT_GOD_NODE_MAX_RESULTS = 25;

export class CommunityDetector {
  private readonly resolution: number;
  private readonly godNodeMinBridged: number;
  private readonly godNodeMaxResults: number;

  constructor(options: CommunityDetectorOptions = {}) {
    this.resolution = options.resolution ?? DEFAULT_RESOLUTION;
    this.godNodeMinBridged = options.godNodeMinBridged ?? DEFAULT_GOD_NODE_MIN_BRIDGED;
    this.godNodeMaxResults = options.godNodeMaxResults ?? DEFAULT_GOD_NODE_MAX_RESULTS;
  }

  detect(
    graph: SymbolGraph,
    pagerank: ReadonlyMap<string, number>,
    edgeQuality: EdgeQuality = 'full',
  ): CommunityComputeResult {
    const nodes = graph.allNodes();
    if (nodes.length === 0) {
      return {
        communities: [],
        godNodes: [],
        modularity: 0,
        crossClusterEdges: 0,
        edgeQuality,
      };
    }

    // Sort for determinism. Louvain result depends on node insertion order.
    // Use codepoint comparison (NOT localeCompare) — localeCompare is
    // locale-sensitive and can produce different orders on different machines
    // (e.g., Turkish locale treats dotted/dotless i specially), which would
    // poison snapshot drift comparisons across teammates or CI runners.
    const sortedNodes = [...nodes].sort((a, b) =>
      a.symbolId < b.symbolId ? -1 : a.symbolId > b.symbolId ? 1 : 0,
    );

    const gph = new UndirectedGraph();
    for (const node of sortedNodes) {
      gph.addNode(node.symbolId);
    }

    // Collapse directed edges to undirected weights. A→B and B→A contribute to same undirected edge.
    const weightByPair = new Map<string, number>();
    for (const edge of graph.allEdges()) {
      if (edge.from === edge.to) continue;
      if (!gph.hasNode(edge.from) || !gph.hasNode(edge.to)) continue;
      const [a, b] = edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
      const key = `${a}|${b}`;
      weightByPair.set(key, (weightByPair.get(key) ?? 0) + 1);
    }

    for (const [key, weight] of weightByPair) {
      const [from, to] = key.split('|') as [string, string];
      gph.addEdge(from, to, { weight });
    }

    if (gph.size === 0) {
      return {
        communities: this.singletonCommunities(sortedNodes),
        godNodes: [],
        modularity: 0,
        crossClusterEdges: 0,
        edgeQuality,
      };
    }

    const result = louvain.detailed(gph, {
      resolution: this.resolution,
      randomWalk: false,
      fastLocalMoves: true,
      getEdgeWeight: 'weight',
    });

    const rawAssignments = result.communities as Record<string, number>;
    const splitAssignments = this.splitDisconnectedCommunities(gph, rawAssignments);
    const normalizedAssignments = this.normalizeCommunityIds(splitAssignments, sortedNodes);

    const memberIndex = this.buildMemberIndex(normalizedAssignments);
    const labels = labelCommunities(memberIndex, pagerank);

    const communities: CommunityEntry[] = sortedNodes.map((node) => {
      const communityId = normalizedAssignments.get(node.symbolId) ?? 0;
      return {
        symbolId: node.symbolId,
        communityId,
        communityLabel: labels.get(communityId) ?? `community-${communityId}`,
      };
    });

    const crossClusterEdges = this.countCrossClusterEdges(graph, normalizedAssignments);
    const godNodes = this.detectGodNodes(graph, normalizedAssignments, pagerank);

    return {
      communities,
      godNodes,
      modularity: result.modularity,
      crossClusterEdges,
      edgeQuality,
    };
  }

  private singletonCommunities(nodes: ReadonlyArray<{ symbolId: string }>): CommunityEntry[] {
    return nodes.map((node, i) => ({
      symbolId: node.symbolId,
      communityId: i,
      communityLabel: `isolated-${i}`,
    }));
  }

  private splitDisconnectedCommunities(
    gph: LouvainGraph,
    assignments: Record<string, number>,
  ): Map<string, number> {
    const result = new Map<string, number>();
    const membersByCommunity = new Map<number, string[]>();
    for (const [node, communityId] of Object.entries(assignments)) {
      const list = membersByCommunity.get(communityId) ?? [];
      list.push(node);
      membersByCommunity.set(communityId, list);
    }

    let nextCommunityId = 0;
    const sortedCommunities = [...membersByCommunity.entries()].sort(([a], [b]) => a - b);

    for (const [, members] of sortedCommunities) {
      const visited = new Set<string>();
      for (const start of [...members].sort()) {
        if (visited.has(start)) continue;
        const componentId = nextCommunityId++;
        const queue = [start];
        visited.add(start);
        while (queue.length > 0) {
          const node = queue.shift()!;
          result.set(node, componentId);
          for (const neighbor of gph.neighbors(node)) {
            if (visited.has(neighbor)) continue;
            if (!members.includes(neighbor)) continue;
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    return result;
  }

  private normalizeCommunityIds(
    assignments: Map<string, number>,
    sortedNodes: ReadonlyArray<{ symbolId: string }>,
  ): Map<string, number> {
    const remap = new Map<number, number>();
    const result = new Map<string, number>();
    let nextId = 0;
    for (const node of sortedNodes) {
      const raw = assignments.get(node.symbolId);
      if (raw === undefined) {
        result.set(node.symbolId, nextId);
        remap.set(nextId, nextId);
        nextId++;
        continue;
      }
      let normalized = remap.get(raw);
      if (normalized === undefined) {
        normalized = nextId++;
        remap.set(raw, normalized);
      }
      result.set(node.symbolId, normalized);
    }
    return result;
  }

  private buildMemberIndex(assignments: Map<string, number>): Map<number, string[]> {
    const index = new Map<number, string[]>();
    for (const [symbolId, communityId] of assignments) {
      const list = index.get(communityId) ?? [];
      list.push(symbolId);
      index.set(communityId, list);
    }
    for (const list of index.values()) list.sort();
    return index;
  }

  private countCrossClusterEdges(
    graph: SymbolGraph,
    assignments: Map<string, number>,
  ): number {
    let count = 0;
    for (const edge of graph.allEdges()) {
      const from = assignments.get(edge.from);
      const to = assignments.get(edge.to);
      if (from === undefined || to === undefined) continue;
      if (from !== to) count++;
    }
    return count;
  }

  private detectGodNodes(
    graph: SymbolGraph,
    assignments: Map<string, number>,
    pagerank: ReadonlyMap<string, number>,
  ): GodNode[] {
    const candidates: GodNode[] = [];
    for (const node of graph.allNodes()) {
      const ownCommunity = assignments.get(node.symbolId);
      if (ownCommunity === undefined) continue;
      const bridged = new Set<number>();
      const forward = graph.getForwardEdges(node.symbolId);
      const reverse = graph.getReverseEdges(node.symbolId);
      for (const edge of forward) {
        const other = assignments.get(edge.to);
        if (other !== undefined && other !== ownCommunity) bridged.add(other);
      }
      for (const edge of reverse) {
        const other = assignments.get(edge.from);
        if (other !== undefined && other !== ownCommunity) bridged.add(other);
      }
      if (bridged.size >= this.godNodeMinBridged) {
        const pr = pagerank.get(node.symbolId) ?? 0;
        candidates.push({
          symbolId: node.symbolId,
          bridgedCommunities: [...bridged].sort((a, b) => a - b),
          centralityScore: bridged.size * (pr > 0 ? pr : 1 / graph.nodeCount),
        });
      }
    }

    candidates.sort((a, b) => {
      if (b.centralityScore !== a.centralityScore) {
        return b.centralityScore - a.centralityScore;
      }
      return a.symbolId.localeCompare(b.symbolId);
    });

    return candidates.slice(0, this.godNodeMaxResults);
  }
}
