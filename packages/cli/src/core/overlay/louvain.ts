import type { UndirectedGraph } from 'graphology';
import type { DetailedLouvainOutput, LouvainOptions } from 'graphology-communities-louvain';
import louvainModule from 'graphology-communities-louvain';

interface LouvainRunner {
  detailed(graph: UndirectedGraph, options?: LouvainOptions): DetailedLouvainOutput;
}

// graphology-communities-louvain is a CJS module exposed via default export; under
// Node16 module resolution the TS type is the module namespace, so we normalize here.
const louvain: LouvainRunner =
  ((louvainModule as unknown) as { default?: LouvainRunner }).default ??
  (louvainModule as unknown as LouvainRunner);

/**
 * Deterministic Louvain over an undirected graph whose edges carry a `weight` attribute: no random walk,
 * so the same graph built in the same node and edge order always gives the same assignment. Callers add
 * nodes and edges in sorted order.
 */
export function runLouvain(
  graph: UndirectedGraph,
  resolution: number,
): { readonly communities: Record<string, number>; readonly modularity: number } {
  const result = louvain.detailed(graph, {
    resolution,
    randomWalk: false,
    fastLocalMoves: true,
    getEdgeWeight: 'weight',
  });
  return { communities: result.communities as Record<string, number>, modularity: result.modularity };
}

/**
 * Splits every community into its connected parts (Louvain can return a community whose members only
 * connect through other communities). New ids are given in ascending order of the original id, then of
 * each part's smallest member.
 */
export function splitDisconnectedCommunities(
  gph: UndirectedGraph,
  assignments: Readonly<Record<string, number>>,
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
