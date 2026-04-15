import type { IGitPort } from '../../ports/i-git-port.js';
import type { IStoragePort } from '../../ports/i-storage-port.js';

export interface SnapshotStaleness {
  readonly snapshotCommit: string;
  readonly currentHeadCommit?: string;
  readonly commitsBehind?: number;
  readonly hint?: string;
}

/**
 * Summarise how far the persisted community snapshot has drifted from the
 * current git HEAD. Callers merge this into MCP `_meta` so AI agents know
 * whether cluster / drift / boundary data reflects the HEAD they are about
 * to edit or a stale history point.
 *
 * Returns undefined when no snapshot exists (nothing to report) or when git
 * is unavailable and no comparison is possible.
 */
export async function buildSnapshotStaleness(
  storage: IStoragePort,
  git: IGitPort,
): Promise<SnapshotStaleness | undefined> {
  const snapshot = storage.readCommunities();
  if (!snapshot || !snapshot.commitSha || snapshot.commitSha === 'nocommit') return undefined;

  const getHead = git.getHeadSha?.bind(git);
  const countBetween = git.countCommitsBetween?.bind(git);
  const head = getHead ? await getHead() : undefined;

  if (!head) {
    // Git unavailable — still report the snapshot anchor so callers know what
    // commit the snapshot was computed against.
    return { snapshotCommit: snapshot.commitSha };
  }

  if (head === snapshot.commitSha) {
    return {
      snapshotCommit: snapshot.commitSha,
      currentHeadCommit: head,
      commitsBehind: 0,
    };
  }

  const behind = countBetween ? await countBetween(snapshot.commitSha) : undefined;

  const result: SnapshotStaleness = {
    snapshotCommit: snapshot.commitSha,
    currentHeadCommit: head,
    ...(typeof behind === 'number' ? { commitsBehind: behind } : {}),
  };

  if (typeof behind === 'number' && behind > 0) {
    return {
      ...result,
      hint: `Community snapshot is ${behind} commit${behind === 1 ? '' : 's'} behind HEAD. Run \`ctxo index\` to refresh cluster / drift / boundary data.`,
    };
  }
  if (behind === undefined) {
    // HEAD resolved but snapshot sha unknown to git (force-push, rebased, etc.).
    return {
      ...result,
      hint: 'Snapshot commit is not reachable from HEAD — it may have been rebased away. Run `ctxo index` to re-anchor.',
    };
  }
  return result;
}
