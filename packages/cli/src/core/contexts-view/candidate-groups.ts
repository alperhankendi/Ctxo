import { UndirectedGraph } from 'graphology';

import { compareCodepoint } from '../compare-codepoint.js';
import { runLouvain, splitDisconnectedCommunities } from '../overlay/louvain.js';
import type { FilePair } from './file-graph.js';

/** Symmetric adjacency of final pair weights: `adjacency.get(x).get(y) === adjacency.get(y).get(x)`. */
export type WeightLookup = ReadonlyMap<string, ReadonlyMap<string, number>>;

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Sorts each group's members, then the groups by their first member. Empty groups are dropped. */
function sortGroups(groups: readonly (readonly string[])[]): string[][] {
  return groups
    .filter((group) => group.length > 0)
    .map((group) => [...group].sort(compareCodepoint))
    .sort((x, y) => compareCodepoint(x[0]!, y[0]!));
}

/**
 * Clusters files with Louvain (no random walk, sorted node and pair insertion). Hubs take part in Louvain,
 * so their damped edges count, then leave their group before each group is split into its connected
 * parts. Returns the groups sorted (members by code point, groups by first member). Without any edge,
 * every non-hub file is its own group and Louvain does not run.
 */
export function clusterFiles(
  files: readonly string[],
  pairs: readonly FilePair[],
  hubFiles: ReadonlySet<string>,
  resolution: number,
): string[][] {
  const nodes = [...new Set(files)].sort(compareCodepoint);
  const graph = new UndirectedGraph();
  for (const file of nodes) graph.addNode(file);

  const sortedPairs = [...pairs].sort((x, y) => compareCodepoint(x.a, y.a) || compareCodepoint(x.b, y.b));
  for (const pair of sortedPairs) {
    if (pair.a === pair.b || !(pair.weight > 0)) continue;
    if (!graph.hasNode(pair.a) || !graph.hasNode(pair.b) || graph.hasEdge(pair.a, pair.b)) continue;
    graph.addEdge(pair.a, pair.b, { weight: pair.weight });
  }

  const kept = nodes.filter((file) => !hubFiles.has(file));
  if (graph.size === 0) return kept.map((file) => [file]);

  const { communities } = runLouvain(graph, resolution);
  // A null prototype keeps a file literally named `__proto__` an ordinary key.
  const assignments = Object.create(null) as Record<string, number>;
  for (const file of kept) assignments[file] = communities[file]!;
  const split = splitDisconnectedCommunities(graph, assignments);

  const byId = new Map<number, string[]>();
  for (const file of kept) {
    const id = split.get(file)!;
    const group = byId.get(id);
    if (group) group.push(file);
    else byId.set(id, [file]);
  }
  return sortGroups([...byId.values()]);
}

/**
 * Folds groups smaller than `minFiles` into a neighbouring group (Designer call 4): the smallest small
 * group first (ties: first member) joins the group it has the largest total weight to (totals compared at
 * 6 decimals; ties: the larger group, then the first member). Repeats until no small group has a
 * neighbour; the small groups left over go to `unclustered`. Files absent from every group (hubs) are
 * not neighbours.
 */
export function foldSmallGroups(
  groups: readonly (readonly string[])[],
  adjacency: WeightLookup,
  minFiles: number,
): { readonly groups: string[][]; readonly unclustered: string[] } {
  const live = new Map<number, string[]>();
  const groupOf = new Map<string, number>();
  sortGroups(groups).forEach((members, id) => {
    live.set(id, members);
    for (const file of members) groupOf.set(file, id);
  });

  const isBetter = (candidate: number, best: number): boolean => {
    const x = live.get(candidate)!;
    const y = live.get(best)!;
    return x.length !== y.length ? x.length > y.length : compareCodepoint(x[0]!, y[0]!) < 0;
  };

  const strongestNeighbour = (id: number, members: readonly string[]): number | undefined => {
    const totals = new Map<number, number>();
    for (const file of members) {
      for (const [other, weight] of adjacency.get(file) ?? []) {
        const neighbour = groupOf.get(other);
        if (neighbour === undefined || neighbour === id || !(weight > 0)) continue;
        totals.set(neighbour, (totals.get(neighbour) ?? 0) + weight);
      }
    }
    let best: number | undefined;
    let bestTotal = 0;
    for (const [neighbour, raw] of totals) {
      const total = round6(raw);
      if (!(total > 0)) continue;
      if (best === undefined || total > bestTotal || (total === bestTotal && isBetter(neighbour, best))) {
        best = neighbour;
        bestTotal = total;
      }
    }
    return best;
  };

  // With a symmetric adjacency a group without a neighbour never gains one, so it is not rescanned.
  const stranded = new Set<number>();
  for (;;) {
    const small = [...live.entries()]
      .filter(([id, members]) => members.length < minFiles && !stranded.has(id))
      .sort(([, x], [, y]) => x.length - y.length || compareCodepoint(x[0]!, y[0]!));
    let merged = false;
    for (const [id, members] of small) {
      const target = strongestNeighbour(id, members);
      if (target === undefined) {
        stranded.add(id);
        continue;
      }
      const combined = [...live.get(target)!, ...members].sort(compareCodepoint);
      live.set(target, combined);
      live.delete(id);
      stranded.delete(target);
      for (const file of members) groupOf.set(file, target);
      merged = true;
      break;
    }
    if (!merged) break;
  }

  const kept: string[][] = [];
  const unclustered: string[] = [];
  for (const members of live.values()) {
    if (members.length < minFiles) unclustered.push(...members);
    else kept.push(members);
  }
  return { groups: sortGroups(kept), unclustered: unclustered.sort(compareCodepoint) };
}
