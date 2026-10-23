import type { CommunitySnapshot } from '../types.js';

/**
 * The snapshots of the commits before `currentSha`: newest first, one per commit.
 *
 * History is a chain of commits, not of runs, so two kinds of entry in a history list are not earlier
 * commits. One is a snapshot of the current commit itself: indexes written by older versions archived
 * the previous run's snapshot even at the same HEAD. The other is a further snapshot of a commit the list
 * already has: the post-commit hook used to archive one per changed file. The first (newest) snapshot of
 * a commit stands for that commit.
 */
export function priorCommitSnapshots(
  history: readonly CommunitySnapshot[],
  currentSha?: string,
): CommunitySnapshot[] {
  const seen = new Set<string>();
  const prior: CommunitySnapshot[] = [];
  for (const snapshot of history) {
    if (snapshot.commitSha === currentSha || seen.has(snapshot.commitSha)) continue;
    seen.add(snapshot.commitSha);
    prior.push(snapshot);
  }
  return prior;
}

/**
 * How many commits other than `currentSha` the history reaches back over. Drift and boundary confidence
 * is built on this number, not on the number of snapshot files.
 */
export function distinctCommitCount(
  history: readonly CommunitySnapshot[],
  currentSha?: string,
): number {
  return priorCommitSnapshots(history, currentSha).length;
}
