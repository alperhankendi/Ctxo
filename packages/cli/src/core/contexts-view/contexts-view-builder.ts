import { createHash } from 'node:crypto';

import { compareCodepoint } from '../compare-codepoint.js';
import type { ResolvedContextsViewConfig } from '../config/load-config.js';
import type { CoChangeEntry, EdgeKind, FileIndex, SymbolNode } from '../types.js';
import { clusterFiles, foldSmallGroups, type WeightLookup } from './candidate-groups.js';
import { findTermCollisions, harvestTopTerms, type ContextTerm, type TermCollision } from './context-terms.js';
import { computeDataCoupling, type CandidateSharedTable, type DataResourceUsage } from './data-coupling.js';
import {
  applyHubDamping,
  buildFileGraph,
  buildIndexGraph,
  detectHubs,
  type FilePair,
  type HubReason,
} from './file-graph.js';

export interface CandidateCrossEdges {
  readonly candidate: number;
  readonly total: number;
  readonly byKind: Readonly<Partial<Record<EdgeKind, number>>>;
}

export interface CandidateCoChangePair {
  readonly file: string;
  readonly otherFile: string;
  readonly otherCandidate: number;
  readonly frequency: number;
  readonly sharedCommits: number;
}

export interface ContextCandidate {
  readonly id: number;
  readonly label: string;
  readonly fingerprint: string;
  readonly fileCount: number;
  readonly files: readonly string[];
  readonly cohesion: number;
  readonly topTerms: readonly ContextTerm[];
  readonly crossEdges: readonly CandidateCrossEdges[];
  readonly coChangePairs: readonly CandidateCoChangePair[];
  /** Tables and views that this candidate and at least one other read or write, by name. */
  readonly sharedTables: readonly CandidateSharedTable[];
}

export interface ContextHub {
  readonly file: string;
  readonly reasons: readonly HubReason[];
  readonly dependents: number;
  readonly damping: number;
  readonly candidate?: number;
}

export interface ContextsView {
  readonly version: 1;
  readonly commitSha: string;
  readonly settings: ResolvedContextsViewConfig;
  readonly coverage: { readonly files: number; readonly covered: number; readonly ratio: number };
  readonly candidates: readonly ContextCandidate[];
  readonly hubs: readonly ContextHub[];
  readonly unclustered: { readonly count: number; readonly files: readonly string[] };
  readonly collisions: readonly TermCollision[];
  /** Every table or view that a candidate file (members and assigned hubs) reads or writes, by name. */
  readonly dataResources: readonly DataResourceUsage[];
}

export interface ContextsViewInput {
  readonly indices: readonly FileIndex[];
  readonly isNode: (file: string) => boolean;
  readonly coChangeMap?: ReadonlyMap<string, readonly CoChangeEntry[]>;
  readonly godNodeFiles: ReadonlySet<string>;
  readonly filePageRank: ReadonlyMap<string, number>;
  readonly settings: ResolvedContextsViewConfig;
  readonly commitSha: string;
}

/** Crossing co-change pairs kept per candidate (Designer call 7). */
const CO_CHANGE_PAIR_LIMIT = 10;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A fresh copy with a fixed key order, so the artifact's bytes never depend on how the caller built it. */
function copySettings(settings: ResolvedContextsViewConfig): ResolvedContextsViewConfig {
  return {
    weights: {
      dependency: settings.weights.dependency,
      coChange: settings.weights.coChange,
      data: settings.weights.data,
    },
    exclude: [...settings.exclude],
    hubs: {
      auto: settings.hubs.auto,
      topPercent: settings.hubs.topPercent,
      minDependents: settings.hubs.minDependents,
      paths: [...settings.hubs.paths],
    },
    resolution: settings.resolution,
    minCandidateFiles: settings.minCandidateFiles,
    technicalTerms: [...settings.technicalTerms],
  };
}

/** Each file's symbols, deduplicated and sorted by id, so term harvest never sees the input order. */
function symbolsByFileOf(indices: readonly FileIndex[]): Map<string, SymbolNode[]> {
  const byFile = new Map<string, Map<string, SymbolNode>>();
  for (const index of indices) {
    const symbols = byFile.get(index.file) ?? new Map<string, SymbolNode>();
    for (const symbol of index.symbols) if (!symbols.has(symbol.symbolId)) symbols.set(symbol.symbolId, symbol);
    byFile.set(index.file, symbols);
  }
  const result = new Map<string, SymbolNode[]>();
  for (const [file, symbols] of byFile) {
    result.set(file, [...symbols.values()].sort((x, y) => compareCodepoint(x.symbolId, y.symbolId)));
  }
  return result;
}

function adjacencyOf(pairs: readonly FilePair[]): WeightLookup {
  const adjacency = new Map<string, Map<string, number>>();
  const link = (from: string, to: string, weight: number): void => {
    const row = adjacency.get(from);
    if (row) row.set(to, weight);
    else adjacency.set(from, new Map([[to, weight]]));
  };
  for (const pair of pairs) {
    link(pair.a, pair.b, pair.weight);
    link(pair.b, pair.a, pair.weight);
  }
  return adjacency;
}

/** Directory segments of a path, split on `/` and `\`; a root file has none. */
function directorySegments(file: string): string[] {
  const parts = file.split(/[\\/]/);
  parts.pop();
  return parts;
}

/** The longest common directory segments of the given files; empty when they share none. */
function commonDirectory(files: readonly string[]): string[] {
  if (files.length === 0) return [];
  let common = directorySegments(files[0]!);
  for (const file of files.slice(1)) {
    const segments = directorySegments(file);
    let length = 0;
    while (length < common.length && length < segments.length && common[length] === segments[length]) length++;
    common = common.slice(0, length);
  }
  return common;
}

/** Directory segments joined with `/`, the repo root as `.`. The segments keep their spelling (spaces, non-ASCII, case). */
function directoryLabel(segments: readonly string[]): string {
  return segments.length === 0 ? '.' : segments.join('/');
}

/** The directory of the member with the highest file-level PageRank (ties: first member). */
function topMemberDirectory(files: readonly string[], pageRank: ReadonlyMap<string, number>): string {
  let top = files[0]!;
  for (const file of files) {
    if ((pageRank.get(file) ?? 0) > (pageRank.get(top) ?? 0)) top = file;
  }
  return directoryLabel(directorySegments(top));
}

/**
 * The labels of the groups (K34): the longest common directory of the members or, when that is the repo
 * root, the directory of the top-PageRank member. Then every label that two or more groups share is
 * replaced, for each of them, by the directory of its own top-PageRank member. One pass: labels may still
 * repeat. Independent of the group order.
 */
function labelsOf(groups: readonly (readonly string[])[], pageRank: ReadonlyMap<string, number>): string[] {
  const base = groups.map((files) => {
    const common = commonDirectory(files);
    return common.length > 0 ? directoryLabel(common) : topMemberDirectory(files, pageRank);
  });
  const uses = new Map<string, number>();
  for (const label of base) uses.set(label, (uses.get(label) ?? 0) + 1);
  return base.map((label, index) =>
    (uses.get(label) ?? 0) > 1 ? topMemberDirectory(groups[index]!, pageRank) : label,
  );
}

function fingerprintOf(files: readonly string[]): string {
  return createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16);
}

/** One entry per unordered pair of distinct files, the highest frequency (then shared commits) winning. */
function distinctCoChanges(coChangeMap: ReadonlyMap<string, readonly CoChangeEntry[]> | undefined): CoChangeEntry[] {
  const byPair = new Map<string, CoChangeEntry>();
  for (const entries of coChangeMap?.values() ?? []) {
    for (const entry of entries) {
      if (entry.file1 === entry.file2) continue;
      const [file1, file2] =
        compareCodepoint(entry.file1, entry.file2) < 0 ? [entry.file1, entry.file2] : [entry.file2, entry.file1];
      const key = `${file1}\n${file2}`;
      const known = byPair.get(key);
      if (
        !known ||
        entry.frequency > known.frequency ||
        (entry.frequency === known.frequency && entry.sharedCommits > known.sharedCommits)
      ) {
        byPair.set(key, { file1, file2, sharedCommits: entry.sharedCommits, frequency: entry.frequency });
      }
    }
  }
  return [...byPair.values()];
}

/**
 * Builds the contexts view (spec 7.2 and 7.3): file graph, hubs, damping, Louvain groups, folding, hub
 * assignment, IDs and labels, per-candidate fields, collisions and coverage. Pure and deterministic: the
 * same input in any order gives a byte-identical `JSON.stringify`.
 *
 * `cohesion` and the folding use the final weights without hub endpoints: hubs belong to no candidate,
 * and their edges, damped on purpose, do not count against a candidate's cohesion. `crossEdges` and
 * `coChangePairs` likewise only connect candidate members. Data coupling (`sharedTables`, `dataResources`)
 * counts members and assigned hubs for their candidate; unclustered files are left out.
 */
export function buildContextsView(input: ContextsViewInput): ContextsView {
  const settings = copySettings(input.settings);

  const indexGraph = buildIndexGraph(input.indices);
  const graph = buildFileGraph({
    indices: input.indices,
    isNode: input.isNode,
    ...(input.coChangeMap ? { coChangeMap: input.coChangeMap } : {}),
    weights: settings.weights,
    graph: indexGraph,
  });
  const hubDecisions = detectHubs(graph, { hubs: settings.hubs, godNodeFiles: input.godNodeFiles });
  const pairs = applyHubDamping(graph.pairs, hubDecisions);
  const hubFiles = new Set(hubDecisions.map((hub) => hub.file));

  const clusters = clusterFiles(graph.files, pairs, hubFiles, settings.resolution);
  const memberPairs = pairs.filter((pair) => !hubFiles.has(pair.a) && !hubFiles.has(pair.b));
  const folded = foldSmallGroups(clusters, adjacencyOf(memberPairs), settings.minCandidateFiles);

  // Hub assignment: the strongest neighbour that sits in a group (ties: neighbour path).
  const groupIndex = new Map<string, number>();
  folded.groups.forEach((files, index) => {
    for (const file of files) groupIndex.set(file, index);
  });
  const hubNeighbour = new Map<string, { file: string; weight: number }>();
  for (const pair of pairs) {
    for (const [hub, other] of [
      [pair.a, pair.b],
      [pair.b, pair.a],
    ] as const) {
      if (!hubFiles.has(hub) || !groupIndex.has(other)) continue;
      const best = hubNeighbour.get(hub);
      if (!best || pair.weight > best.weight || (pair.weight === best.weight && compareCodepoint(other, best.file) < 0)) {
        hubNeighbour.set(hub, { file: other, weight: pair.weight });
      }
    }
  }

  // Labels first, then IDs: size desc, then final label, then first member; IDs start at 1.
  const labels = labelsOf(folded.groups, input.filePageRank);
  const ordered = folded.groups
    .map((files, index) => ({ files, label: labels[index]! }))
    .sort(
      (x, y) =>
        y.files.length - x.files.length || compareCodepoint(x.label, y.label) || compareCodepoint(x.files[0]!, y.files[0]!),
    );
  const candidateOf = new Map<string, number>();
  ordered.forEach(({ files }, index) => {
    for (const file of files) candidateOf.set(file, index + 1);
  });

  const hubs: ContextHub[] = hubDecisions.map((hub) => {
    const neighbour = hubNeighbour.get(hub.file);
    const candidate = neighbour ? candidateOf.get(neighbour.file) : undefined;
    return {
      file: hub.file,
      reasons: [...hub.reasons],
      dependents: hub.dependents,
      damping: hub.damping,
      ...(candidate !== undefined ? { candidate } : {}),
    };
  });

  // Data coupling: members and assigned hubs count for their candidate.
  const fileCandidate = new Map(candidateOf);
  for (const hub of hubs) if (hub.candidate !== undefined) fileCandidate.set(hub.file, hub.candidate);
  const dataCoupling = computeDataCoupling({ graph: indexGraph, fileCandidate });

  // Cohesion: internal weight over internal plus boundary weight, hub endpoints left out.
  const internal = new Map<number, number>();
  const boundary = new Map<number, number>();
  for (const pair of memberPairs) {
    const ca = candidateOf.get(pair.a);
    const cb = candidateOf.get(pair.b);
    if (ca !== undefined && ca === cb) {
      internal.set(ca, (internal.get(ca) ?? 0) + pair.weight);
      continue;
    }
    if (ca !== undefined) boundary.set(ca, (boundary.get(ca) ?? 0) + pair.weight);
    if (cb !== undefined) boundary.set(cb, (boundary.get(cb) ?? 0) + pair.weight);
  }

  // Cross edges: outgoing distinct symbol edges into another candidate, by kind.
  const crossCounts = new Map<number, Map<number, Map<EdgeKind, number>>>();
  for (const edge of graph.edgeCounts) {
    const from = candidateOf.get(edge.from);
    const to = candidateOf.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const byTarget = crossCounts.get(from) ?? new Map<number, Map<EdgeKind, number>>();
    const byKind = byTarget.get(to) ?? new Map<EdgeKind, number>();
    byKind.set(edge.kind, (byKind.get(edge.kind) ?? 0) + edge.count);
    byTarget.set(to, byKind);
    crossCounts.set(from, byTarget);
  }

  // Co-change pairs crossing candidates, listed from both sides.
  const coPairs = new Map<number, CandidateCoChangePair[]>();
  const addCoPair = (candidate: number, pair: CandidateCoChangePair): void => {
    const list = coPairs.get(candidate);
    if (list) list.push(pair);
    else coPairs.set(candidate, [pair]);
  };
  for (const entry of distinctCoChanges(input.coChangeMap)) {
    const c1 = candidateOf.get(entry.file1);
    const c2 = candidateOf.get(entry.file2);
    if (c1 === undefined || c2 === undefined || c1 === c2) continue;
    const { frequency, sharedCommits } = entry;
    addCoPair(c1, { file: entry.file1, otherFile: entry.file2, otherCandidate: c2, frequency, sharedCommits });
    addCoPair(c2, { file: entry.file2, otherFile: entry.file1, otherCandidate: c1, frequency, sharedCommits });
  }

  const symbolsByFile = symbolsByFileOf(input.indices);
  const candidates: ContextCandidate[] = ordered.map(({ files, label }, index) => {
    const id = index + 1;
    const inside = internal.get(id) ?? 0;
    const total = inside + (boundary.get(id) ?? 0);
    const crossEdges = [...(crossCounts.get(id) ?? new Map<number, Map<EdgeKind, number>>()).entries()]
      .sort(([x], [y]) => x - y)
      .map(([candidate, kinds]): CandidateCrossEdges => {
        const sortedKinds = [...kinds.entries()].sort(([x], [y]) => compareCodepoint(x, y));
        return {
          candidate,
          total: sortedKinds.reduce((sum, [, count]) => sum + count, 0),
          byKind: Object.fromEntries(sortedKinds) as Partial<Record<EdgeKind, number>>,
        };
      });
    const coChangePairs = (coPairs.get(id) ?? [])
      .sort(
        (x, y) =>
          y.frequency - x.frequency ||
          y.sharedCommits - x.sharedCommits ||
          compareCodepoint(x.file, y.file) ||
          compareCodepoint(x.otherFile, y.otherFile),
      )
      .slice(0, CO_CHANGE_PAIR_LIMIT);
    return {
      id,
      label,
      fingerprint: fingerprintOf(files),
      fileCount: files.length,
      files,
      cohesion: total > 0 ? round3(inside / total) : 0,
      topTerms: harvestTopTerms(files, symbolsByFile, settings.technicalTerms),
      crossEdges,
      coChangePairs,
      sharedTables: dataCoupling.sharedTables.get(id) ?? [],
    };
  });

  const collisions = findTermCollisions(
    candidates.map((candidate) => ({ id: candidate.id, files: candidate.files })),
    symbolsByFile,
  );

  const covered =
    candidates.reduce((sum, candidate) => sum + candidate.fileCount, 0) +
    hubs.filter((hub) => hub.candidate !== undefined).length;
  const fileCount = graph.files.length;

  return {
    version: 1,
    commitSha: input.commitSha,
    settings,
    coverage: { files: fileCount, covered, ratio: fileCount > 0 ? round3(covered / fileCount) : 0 },
    candidates,
    hubs,
    unclustered: { count: folded.unclustered.length, files: folded.unclustered },
    collisions,
    dataResources: dataCoupling.resources,
  };
}
