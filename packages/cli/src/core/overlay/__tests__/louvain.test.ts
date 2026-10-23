import { UndirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import { runLouvain, splitDisconnectedCommunities } from '../louvain.js';

function graphOf(nodes: string[], edges: Array<[string, string, number]>): UndirectedGraph {
  const graph = new UndirectedGraph();
  for (const node of nodes) graph.addNode(node);
  for (const [a, b, weight] of edges) graph.addEdge(a, b, { weight });
  return graph;
}

describe('louvain helpers', () => {
  it('splitDisconnectedCommunities gives each connected part its own id in sorted start order', () => {
    // Community 7 holds two parts that do not touch: {a, b} and {d, e}. Community 3 holds c alone.
    const graph = graphOf(['a', 'b', 'c', 'd', 'e'], [
      ['a', 'b', 1],
      ['d', 'e', 1],
      ['b', 'c', 1],
    ]);
    // Insertion order is scrambled on purpose: ids follow the sorted community ids, then the sorted start node.
    const assignments = { e: 7, d: 7, c: 3, b: 7, a: 7 };

    const split = splitDisconnectedCommunities(graph, assignments);

    expect(Object.fromEntries([...split.entries()].sort(([x], [y]) => (x < y ? -1 : 1)))).toEqual({
      a: 1,
      b: 1,
      c: 0,
      d: 2,
      e: 2,
    });
  });

  it('runLouvain returns the same assignment for the same graph', () => {
    const build = () =>
      graphOf(
        ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'],
        [
          ['a1', 'a2', 1],
          ['a2', 'a3', 1],
          ['a1', 'a3', 1],
          ['b1', 'b2', 1],
          ['b2', 'b3', 1],
          ['b1', 'b3', 1],
          ['a3', 'b1', 0.1],
        ],
      );

    const first = runLouvain(build(), 1);
    const second = runLouvain(build(), 1);

    expect(second).toEqual(first);
    expect(first.communities['a1']).toBe(first.communities['a3']);
    expect(first.communities['b1']).toBe(first.communities['b3']);
    expect(first.communities['a1']).not.toBe(first.communities['b1']);
    expect(first.modularity).toBeGreaterThan(0);
  });
});
