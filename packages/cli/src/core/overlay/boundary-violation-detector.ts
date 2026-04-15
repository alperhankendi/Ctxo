import type { SymbolGraph } from '../graph/symbol-graph.js';
import type {
  BoundaryViolation,
  CommunityEntry,
  CommunitySnapshot,
} from '../types.js';

export interface BoundaryViolationDetectionResult {
  readonly violations: BoundaryViolation[];
  readonly confidence: 'high' | 'medium' | 'low';
  readonly snapshotsAvailable: number;
  readonly hint?: string;
}

const HIGH_SEVERITY_THRESHOLD = 0;
const MEDIUM_SEVERITY_THRESHOLD = 2;
const MIN_SNAPSHOTS_FOR_CONFIDENCE = 2;

export class BoundaryViolationDetector {
  detect(
    graph: SymbolGraph,
    current: CommunitySnapshot,
    history: readonly CommunitySnapshot[],
  ): BoundaryViolationDetectionResult {
    const snapshotsAvailable = history.length;
    const currentAssignments = assignmentMap(current.communities);
    const currentLabels = labelMap(current.communities);
    const historicalAssignments = history.map((snapshot) => ({
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
        snapshotsAvailable < MIN_SNAPSHOTS_FOR_CONFIDENCE
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
      const cmp = a.from.symbolId.localeCompare(b.from.symbolId);
      return cmp !== 0 ? cmp : a.to.symbolId.localeCompare(b.to.symbolId);
    });

    return {
      violations,
      confidence: confidenceFor(snapshotsAvailable),
      snapshotsAvailable,
      hint: hintFor(snapshotsAvailable),
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

function confidenceFor(snapshots: number): 'high' | 'medium' | 'low' {
  if (snapshots >= 7) return 'high';
  if (snapshots >= 3) return 'medium';
  return 'low';
}

function hintFor(snapshots: number): string | undefined {
  if (snapshots >= MIN_SNAPSHOTS_FOR_CONFIDENCE) return undefined;
  return 'Insufficient snapshot history — enable `ctxo init` hook or add `ctxo index --check` to CI for boundary-violation signal.';
}
