import { compareCodepoint } from '../compare-codepoint.js';
import type { CommunityEntry, CommunitySnapshot, DriftEvent } from '../types.js';
import { distinctCommitCount, priorCommitSnapshots } from './snapshot-history.js';

export type DriftStability = 'stable' | 'transient' | 'unverified';

export interface DriftEventWithStability extends DriftEvent {
  readonly stability: DriftStability;
}

export interface DriftStabilitySummary {
  /** Events confirmed across ≥2 snapshots (real drift). */
  readonly stable: number;
  /** Events that bounced back to a prior cluster (likely Louvain jitter). */
  readonly transient: number;
  /** Events seen only once because history is too shallow to classify. */
  readonly unverified: number;
}

export interface DriftDetectionResult {
  readonly events: DriftEventWithStability[];
  readonly confidence: 'high' | 'medium' | 'low';
  /** The number of history entries passed in (kept for compatibility; confidence is built on `distinctCommits`). */
  readonly snapshotsAvailable: number;
  /** Commits other than the current one that the history covers; `confidence` is built on this. */
  readonly distinctCommits: number;
  readonly stability: DriftStabilitySummary;
  readonly hint?: string;
}

// Issue #56: lowered from 0.5 → 0.3 to be more forgiving when Louvain
// renumbers clusters between runs. Jaccard 0.3 still requires meaningful
// membership overlap but tolerates routine re-clustering.
const DEFAULT_JACCARD_THRESHOLD = 0.3;

export interface DriftDetectorOptions {
  readonly jaccardThreshold?: number;
  /**
   * Filter out transient drift — i.e., events where the symbol bounced back
   * to a previously-seen cluster within the retained snapshot window. Enabled
   * by default so callers don't have to wade through Louvain jitter.
   */
  readonly suppressTransient?: boolean;
}

export class DriftDetector {
  private readonly jaccardThreshold: number;
  private readonly suppressTransient: boolean;

  constructor(options: DriftDetectorOptions = {}) {
    this.jaccardThreshold = options.jaccardThreshold ?? DEFAULT_JACCARD_THRESHOLD;
    this.suppressTransient = options.suppressTransient ?? true;
  }

  detect(
    current: CommunitySnapshot,
    history: readonly CommunitySnapshot[],
  ): DriftDetectionResult {
    const snapshotsAvailable = history.length;
    const distinctCommits = distinctCommitCount(history, current.commitSha);
    const confidence = confidenceFor(distinctCommits);
    const hint = hintFor(distinctCommits);
    // `previous` is the newest history entry from a different commit than `current`; `anchor` is the
    // newest one from a third, older commit. A snapshot of the current commit, or a second snapshot of
    // one commit, is not another point in time to compare with.
    const [previous, anchor] = priorCommitSnapshots(history, current.commitSha);

    if (!previous) {
      return {
        events: [],
        confidence,
        snapshotsAvailable,
        distinctCommits,
        stability: { stable: 0, transient: 0, unverified: 0 },
        hint,
      };
    }

    const currentByCommunityId = indexByCommunityId(current.communities);
    const previousByCommunityId = indexByCommunityId(previous.communities);
    const mapping = this.mapCommunities(currentByCommunityId, previousByCommunityId);

    const currentAssignments = assignmentMap(current.communities);
    const previousAssignments = assignmentMap(previous.communities);
    const anchorAssignments = anchor ? assignmentMap(anchor.communities) : undefined;
    const previousLabels = labelMap(previous.communities);
    const currentLabels = labelMap(current.communities);

    // Compute anchor→previous mapping so we can translate the symbol's anchor
    // cluster id into the "previous snapshot" id space for comparison.
    const anchorToPrev = anchor
      ? this.mapCommunities(previousByCommunityId, indexByCommunityId(anchor.communities))
      : new Map<number, number>();

    const rawEvents: DriftEventWithStability[] = [];
    const stability = { stable: 0, transient: 0, unverified: 0 };

    for (const [symbolId, currentId] of currentAssignments) {
      const prevId = previousAssignments.get(symbolId);
      if (prevId === undefined) continue;
      const mappedPrevId = mapping.get(prevId);
      if (mappedPrevId === currentId) continue;

      // Stability classification:
      //   stable    — anchor's cluster maps to `prevId` (the symbol was settled in the
      //               prior cluster for ≥2 snapshots, then moved; real drift).
      //   transient — anchor's cluster maps to `currentId` (the symbol bounced between
      //               clusters; likely Louvain jitter — worth suppressing by default).
      //   unverified — no anchor snapshot, or anchor has no entry for this symbol.
      let classification: DriftStability;
      if (!anchorAssignments) {
        classification = 'unverified';
      } else {
        const anchorId = anchorAssignments.get(symbolId);
        if (anchorId === undefined) {
          classification = 'unverified';
        } else {
          const anchorInPrevSpace = anchorToPrev.get(anchorId);
          if (anchorInPrevSpace === prevId) {
            classification = 'stable';
          } else if (anchorInPrevSpace !== undefined) {
            // Anchor maps to some previous cluster that is not the movedFrom cluster.
            // If that translates forward to the current cluster, this is a bounce.
            const anchorInCurrentSpace = mapping.get(anchorInPrevSpace);
            classification =
              anchorInCurrentSpace === currentId ? 'transient' : 'unverified';
          } else {
            classification = 'unverified';
          }
        }
      }

      stability[classification]++;
      rawEvents.push({
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
        stability: classification,
      });
    }

    const events = (this.suppressTransient
      ? rawEvents.filter((e) => e.stability !== 'transient')
      : rawEvents
    ).sort((a, b) => compareCodepoint(a.symbolId, b.symbolId));

    return {
      events,
      confidence,
      snapshotsAvailable,
      distinctCommits,
      stability,
      hint,
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

function confidenceFor(distinctCommits: number): 'high' | 'medium' | 'low' {
  if (distinctCommits >= 7) return 'high';
  if (distinctCommits >= 3) return 'medium';
  return 'low';
}

function hintFor(distinctCommits: number): string | undefined {
  if (distinctCommits >= 3) return undefined;
  return 'Install the post-commit hook (`ctxo init`) or run `ctxo index` after commits to build history; `ctxo index --check` does not record snapshots.';
}
