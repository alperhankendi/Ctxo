import { describe, expect, it } from 'vitest';

import { clusterFiles, foldSmallGroups, type WeightLookup } from '../candidate-groups.js';
import type { FilePair } from '../file-graph.js';

function pair(x: string, y: string, weight: number): FilePair {
  const [a, b] = x < y ? [x, y] : [y, x];
  return { a, b, dependency: weight, coChange: 0, data: 0, weight };
}

function lookup(links: Array<[string, string, number]>): WeightLookup {
  const adjacency = new Map<string, Map<string, number>>();
  const link = (from: string, to: string, weight: number) => {
    const row = adjacency.get(from) ?? new Map<string, number>();
    row.set(to, weight);
    adjacency.set(from, row);
  };
  for (const [x, y, weight] of links) {
    link(x, y, weight);
    link(y, x, weight);
  }
  return adjacency;
}

const FIVE = ['g1/a.ts', 'g1/b.ts', 'g1/c.ts', 'g1/d.ts', 'g1/e.ts'];
const FOUR = ['g2/a.ts', 'g2/b.ts', 'g2/c.ts', 'g2/d.ts'];

describe('foldSmallGroups', () => {
  it('foldSmallGroups merges a small group into the neighbour with the strongest total weight', () => {
    const adjacency = lookup([
      ['x.ts', 'g1/a.ts', 0.1],
      ['y.ts', 'g1/b.ts', 0.2],
      ['x.ts', 'g2/a.ts', 0.9],
    ]);

    const result = foldSmallGroups([FIVE, FOUR, ['x.ts', 'y.ts']], adjacency, 3);

    expect(result.groups).toEqual([FIVE, [...FOUR, 'x.ts', 'y.ts']]);
    expect(result.unclustered).toEqual([]);
  });

  it('foldSmallGroups breaks equal weights by the larger group, then the first member', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point: totals are compared at 6 decimals, so it ties 0.3.
    const bySize = foldSmallGroups(
      [FOUR, FIVE, ['x.ts']],
      lookup([
        ['x.ts', 'g2/a.ts', 0.1],
        ['x.ts', 'g2/b.ts', 0.2],
        ['x.ts', 'g1/a.ts', 0.3],
      ]),
      3,
    );
    expect(bySize.groups).toEqual([[...FIVE, 'x.ts'], FOUR]);

    const otherFour = ['g3/a.ts', 'g3/b.ts', 'g3/c.ts', 'g3/d.ts'];
    const byMember = foldSmallGroups(
      [otherFour, FOUR, ['x.ts']],
      lookup([
        ['x.ts', 'g3/a.ts', 0.4],
        ['x.ts', 'g2/d.ts', 0.4],
      ]),
      3,
    );
    expect(byMember.groups).toEqual([[...FOUR, 'x.ts'], otherFour]);
  });

  it('foldSmallGroups keeps folding small groups into small groups until none has a neighbour', () => {
    // Smallest first, ties by first member: w has no neighbour, so x joins y; then z joins {x, y}.
    const result = foldSmallGroups(
      [['z.ts'], ['y.ts'], ['x.ts'], ['w.ts']],
      lookup([
        ['x.ts', 'y.ts', 0.2],
        ['y.ts', 'z.ts', 0.1],
      ]),
      3,
    );

    expect(result.groups).toEqual([['x.ts', 'y.ts', 'z.ts']]);
    expect(result.unclustered).toEqual(['w.ts']);
  });

  it('foldSmallGroups folds the smallest small group first', () => {
    // q (1 file) goes before {p1, p2} and joins it (0.5 against 0.4), which leaves nothing small. Taking
    // {p1, p2} first would send it to A (0.9), and q would then follow it into A.
    const result = foldSmallGroups(
      [FIVE, ['p1.ts', 'p2.ts'], ['q.ts']],
      lookup([
        ['p1.ts', 'g1/a.ts', 0.9],
        ['p2.ts', 'q.ts', 0.5],
        ['q.ts', 'g1/b.ts', 0.4],
      ]),
      3,
    );

    expect(result.groups).toEqual([FIVE, ['p1.ts', 'p2.ts', 'q.ts']]);
    expect(result.unclustered).toEqual([]);
  });

  it('foldSmallGroups sends isolated small groups to unclustered', () => {
    const result = foldSmallGroups(
      [FIVE, ['q.ts', 'p.ts'], ['o.ts']],
      lookup([['h.ts', 'p.ts', 0.7]]),
      3,
    );

    expect(result.groups).toEqual([FIVE]);
    expect(result.unclustered).toEqual(['o.ts', 'p.ts', 'q.ts']);
  });
});

describe('clusterFiles', () => {
  it('clusterFiles splits a community held together only by a hub', () => {
    const files = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'h'];
    const pairs = [
      pair('a1', 'a2', 0.1),
      pair('a2', 'a3', 0.1),
      pair('b1', 'b2', 0.1),
      pair('b2', 'b3', 0.1),
      ...files.filter((file) => file !== 'h').map((file) => pair(file, 'h', 5)),
    ];

    expect(clusterFiles(files, pairs, new Set(['h']), 1)).toEqual([
      ['a1', 'a2', 'a3'],
      ['b1', 'b2', 'b3'],
    ]);
  });

  it('clusterFiles returns sorted singletons without hubs when there is no edge', () => {
    expect(clusterFiles(['c.ts', 'a.ts', 'h.ts', 'b.ts'], [], new Set(['h.ts']), 1)).toEqual([
      ['a.ts'],
      ['b.ts'],
      ['c.ts'],
    ]);
  });
});
