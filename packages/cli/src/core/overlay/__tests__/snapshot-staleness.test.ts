import { describe, expect, it, vi } from 'vitest';

import type { IGitPort } from '../../../ports/i-git-port.js';
import type { IStoragePort } from '../../../ports/i-storage-port.js';
import type { CommunitySnapshot } from '../../../core/types.js';
import { buildSnapshotStaleness } from '../snapshot-staleness.js';

function makeSnapshot(commitSha: string): CommunitySnapshot {
  return {
    version: 1,
    computedAt: '2026-04-16T10:00:00.000Z',
    commitSha,
    modularity: 0.5,
    communities: [],
    godNodes: [],
    edgeQuality: 'full',
    crossClusterEdges: 0,
  };
}

function makeStorage(snapshot: CommunitySnapshot | undefined): IStoragePort {
  return {
    readCommunities: () => snapshot,
  } as unknown as IStoragePort;
}

function makeGit(
  headSha: string | undefined,
  commitsBehind: number | undefined,
): IGitPort {
  return {
    getHeadSha: vi.fn().mockResolvedValue(headSha),
    countCommitsBetween: vi.fn().mockResolvedValue(commitsBehind),
  } as unknown as IGitPort;
}

describe('buildSnapshotStaleness', () => {
  it('returns undefined when no snapshot exists', async () => {
    const result = await buildSnapshotStaleness(makeStorage(undefined), makeGit('abc123', 0));
    expect(result).toBeUndefined();
  });

  it('returns undefined when snapshot commitSha is nocommit', async () => {
    const result = await buildSnapshotStaleness(makeStorage(makeSnapshot('nocommit')), makeGit('abc123', 0));
    expect(result).toBeUndefined();
  });

  it('returns anchor only when git is unavailable', async () => {
    const storage = makeStorage(makeSnapshot('abc1234'));
    const brokenGit = { getHeadSha: vi.fn().mockResolvedValue(undefined) } as unknown as IGitPort;
    const result = await buildSnapshotStaleness(storage, brokenGit);
    expect(result).toEqual({ snapshotCommit: 'abc1234' });
  });

  it('reports commitsBehind: 0 when HEAD matches snapshot sha', async () => {
    const storage = makeStorage(makeSnapshot('abc1234'));
    const git = makeGit('abc1234', 0);
    const result = await buildSnapshotStaleness(storage, git);
    expect(result).toMatchObject({
      snapshotCommit: 'abc1234',
      currentHeadCommit: 'abc1234',
      commitsBehind: 0,
    });
    expect(result?.hint).toBeUndefined();
  });

  it('includes a refresh hint when HEAD is ahead of snapshot', async () => {
    const storage = makeStorage(makeSnapshot('abc1234'));
    const git = makeGit('def5678', 3);
    const result = await buildSnapshotStaleness(storage, git);
    expect(result).toMatchObject({
      snapshotCommit: 'abc1234',
      currentHeadCommit: 'def5678',
      commitsBehind: 3,
    });
    expect(result?.hint).toMatch(/3 commits behind HEAD/);
    expect(result?.hint).toMatch(/ctxo index/);
  });

  it('pluralises hint correctly for a single commit behind', async () => {
    const storage = makeStorage(makeSnapshot('abc1234'));
    const git = makeGit('def5678', 1);
    const result = await buildSnapshotStaleness(storage, git);
    expect(result?.hint).toMatch(/1 commit behind HEAD/);
  });

  it('flags unreachable snapshot when HEAD advanced but rev-list cannot resolve base', async () => {
    const storage = makeStorage(makeSnapshot('rebased'));
    const git = makeGit('def5678', undefined);
    const result = await buildSnapshotStaleness(storage, git);
    expect(result?.hint).toMatch(/rebased away|re-anchor/);
  });
});
