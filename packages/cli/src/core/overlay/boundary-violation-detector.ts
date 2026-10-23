import { compareCodepoint } from '../compare-codepoint.js';
import type { SymbolGraph } from '../graph/symbol-graph.js';
import type {
  BoundaryViolation,
  CommunityEntry,
  CommunitySnapshot,
} from '../types.js';
import { distinctCommitCount, priorCommitSnapshots } from './snapshot-history.js';

export interface BoundaryViolationDetectionResult {
  readonly violations: BoundaryViolation[];
  readonly confidence: 'high' | 'medium' | 'low';
  /** The number of history entries passed in (kept for compatibility; confidence is built on `distinctCommits`). */
  readonly snapshotsAvailable: number;
  /** Commits other than the current one that the history covers; `confidence` is built on this. */
  readonly distinctCommits: number;
  readonly hint?: string;
}

const HIGH_SEVERITY_THRESHOLD = 0;
const MEDIUM_SEVERITY_THRESHOLD = 2;
const MIN_DISTINCT_COMMITS_FOR_CONFIDENCE = 2;

export class BoundaryViolationDetector {
  detect(
    graph: SymbolGraph,
    current: CommunitySnapshot,
    history: readonly CommunitySnapshot[],
  ): BoundaryViolationDetectionResult {
    const snapshotsAvailable = history.length;
    const distinctCommits = distinctCommitCount(history, current.commitSha);
    const currentAssignments = assignmentMap(current.communities);
    const currentLabels = labelMap(current.communities);
    // The evidence is one snapshot per earlier commit: a snapshot of the current commit is not history,
    // and several snapshots of one commit are one data point, not several.
    const earlierCommits = priorCommitSnapshots(history, current.commitSha);
    const historicalAssignments = earlierCommits.map((snapshot) => ({
      snapshot,
      assignments: assignmentMap(snapshot.communities),
      labels: labelMap(snapshot.communities),
    }));

    const violations: BoundaryViolation[] = [];

    for (const edge of graph.allEdges()) {
      if (edge.from === edge.to) continue;
      const fromCommunity = currentAssignments.get(edge.from);
      const toCommunity = currentAssignments.get(edge.to);
      if (fromCommunity === undefined || toCommunity === undefined) continue;
      if (fromCommunity === toCommunity) continue;

      const fromLabel = currentLabels.get(fromCommunity) ?? `community-${fromCommunity}`;
      const toLabel = currentLabels.get(toCommunity) ?? `community-${toCommunity}`;

      const historicalCount =
        distinctCommits < MIN_DISTINCT_COMMITS_FOR_CONFIDENCE
          ? -1
          : countHistoricalCrossCluster(historicalAssignments, edge.from, edge.to);

      if (historicalCount === -1 || historicalCount <= MEDIUM_SEVERITY_THRESHOLD) {
        violations.push({
          from: {
            symbolId: edge.from,
            communityId: fromCommunity,
            label: fromLabel,
          },
          to: {
            symbolId: edge.to,
            communityId: toCommunity,
            label: toLabel,
          },
          edgeKind: edge.kind,
          historicalEdgesBetweenClusters: historicalCount,
          severity:
            historicalCount === HIGH_SEVERITY_THRESHOLD ? 'high' : 'medium',
        });
      }
    }

    violations.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
      const cmp = compareCodepoint(a.from.symbolId, b.from.symbolId);
      return cmp !== 0 ? cmp : compareCodepoint(a.to.symbolId, b.to.symbolId);
    });

    return {
      violations,
      confidence: confidenceFor(distinctCommits),
      snapshotsAvailable,
      distinctCommits,
      hint: hintFor(distinctCommits),
    };
  }
}

function countHistoricalCrossCluster(
  history: ReadonlyArray<{
    readonly snapshot: CommunitySnapshot;
    readonly assignments: ReadonlyMap<string, number>;
    readonly labels: ReadonlyMap<number, string>;
  }>,
  fromSymbol: string,
  toSymbol: string,
): number {
  let count = 0;
  for (const snap of history) {
    const fromId = snap.assignments.get(fromSymbol);
    const toId = snap.assignments.get(toSymbol);
    if (fromId === undefined || toId === undefined) continue;
    if (fromId !== toId) count++;
  }
  return count;
}

function assignmentMap(entries: readonly CommunityEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(entry.symbolId, entry.communityId);
  }
  return map;
}

function labelMap(entries: readonly CommunityEntry[]): Map<number, string> {
  const labels = new Map<number, string>();
  for (const entry of entries) {
    if (!labels.has(entry.communityId)) {
      labels.set(entry.communityId, entry.communityLabel);
    }
  }
  return labels;
}

function confidenceFor(distinctCommits: number): 'high' | 'medium' | 'low' {
  if (distinctCommits >= 7) return 'high';
  if (distinctCommits >= 3) return 'medium';
  return 'low';
}

function hintFor(distinctCommits: number): string | undefined {
  if (distinctCommits >= MIN_DISTINCT_COMMITS_FOR_CONFIDENCE) return undefined;
  return 'Install the post-commit hook (`ctxo init`) or run `ctxo index` after commits to build history; `ctxo index --check` does not record snapshots.';
}
