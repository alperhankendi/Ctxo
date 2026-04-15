import type { CommunityEntry, CommunitySnapshot, DriftEvent } from '../types.js';

export interface DriftDetectionResult {
  readonly events: DriftEvent[];
  readonly confidence: 'high' | 'medium' | 'low';
  readonly snapshotsAvailable: number;
  readonly hint?: string;
}

const DEFAULT_JACCARD_THRESHOLD = 0.5;

export interface DriftDetectorOptions {
  readonly jaccardThreshold?: number;
}

export class DriftDetector {
  private readonly jaccardThreshold: number;

  constructor(options: DriftDetectorOptions = {}) {
    this.jaccardThreshold = options.jaccardThreshold ?? DEFAULT_JACCARD_THRESHOLD;
  }

  detect(
    current: CommunitySnapshot,
    history: readonly CommunitySnapshot[],
  ): DriftDetectionResult {
    const snapshotsAvailable = history.length;
    const previous = history[0];

    if (!previous) {
      return {
        events: [],
        confidence: 'low',
        snapshotsAvailable,
        hint: 'No prior snapshot available — install the post-commit hook (`ctxo init`), run `ctxo watch`, or add `ctxo index --check` to CI so the drift history accumulates.',
      };
    }

    const currentByCommunityId = indexByCommunityId(current.communities);
    const previousByCommunityId = indexByCommunityId(previous.communities);
    const mapping = this.mapCommunities(currentByCommunityId, previousByCommunityId);

    const currentAssignments = assignmentMap(current.communities);
    const previousAssignments = assignmentMap(previous.communities);
    const previousLabels = labelMap(previous.communities);
    const currentLabels = labelMap(current.communities);

    const events: DriftEvent[] = [];
    for (const [symbolId, currentId] of currentAssignments) {
      const prevId = previousAssignments.get(symbolId);
      if (prevId === undefined) continue;
      // Translate previous cluster id to the equivalent "current" id via mapping.
      const mappedPrevId = mapping.get(prevId);
      if (mappedPrevId === currentId) continue;

      events.push({
        symbolId,
        movedFrom: {
          id: prevId,
          label: previousLabels.get(prevId) ?? `community-${prevId}`,
        },
        movedTo: {
          id: currentId,
          label: currentLabels.get(currentId) ?? `community-${currentId}`,
        },
        firstSeenInNewCluster: current.computedAt,
      });
    }

    events.sort((a, b) => a.symbolId.localeCompare(b.symbolId));

    return {
      events,
      confidence: confidenceFor(snapshotsAvailable),
      snapshotsAvailable,
      hint: hintFor(snapshotsAvailable),
    };
  }

  private mapCommunities(
    current: ReadonlyMap<number, Set<string>>,
    previous: ReadonlyMap<number, Set<string>>,
  ): Map<number, number> {
    // For each previous-community, pick the current-community with highest Jaccard.
    const mapping = new Map<number, number>();
    for (const [prevId, prevMembers] of previous) {
      let bestCurrentId: number | undefined;
      let bestOverlap = 0;
      for (const [currentId, currentMembers] of current) {
        const overlap = jaccard(prevMembers, currentMembers);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestCurrentId = currentId;
        }
      }
      if (bestCurrentId !== undefined && bestOverlap >= this.jaccardThreshold) {
        mapping.set(prevId, bestCurrentId);
      }
    }
    return mapping;
  }
}

function indexByCommunityId(
  entries: readonly CommunityEntry[],
): Map<number, Set<string>> {
  const index = new Map<number, Set<string>>();
  for (const entry of entries) {
    const bucket = index.get(entry.communityId) ?? new Set<string>();
    bucket.add(entry.symbolId);
    index.set(entry.communityId, bucket);
  }
  return index;
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

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function confidenceFor(snapshots: number): 'high' | 'medium' | 'low' {
  if (snapshots >= 7) return 'high';
  if (snapshots >= 3) return 'medium';
  return 'low';
}

function hintFor(snapshots: number): string | undefined {
  if (snapshots >= 3) return undefined;
  return 'Install post-commit hook or run `ctxo index` more often to build a richer drift history.';
}
