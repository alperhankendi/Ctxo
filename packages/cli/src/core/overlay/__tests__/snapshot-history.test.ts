import { describe, it, expect } from 'vitest';

import type { CommunitySnapshot } from '../../types.js';
import { distinctCommitCount, priorCommitSnapshots } from '../snapshot-history.js';

function snapshot(commitSha: string, computedAt = '2026-04-16T10:00:00.000Z'): CommunitySnapshot {
  return {
    version: 1,
    computedAt,
    commitSha,
    modularity: 0.4,
    communities: [],
    godNodes: [],
    edgeQuality: 'full',
    crossClusterEdges: 0,
  };
}

describe('distinctCommitCount', () => {
  it('is 0 for an empty history', () => {
    expect(distinctCommitCount([])).toBe(0);
    expect(distinctCommitCount([], 'head')).toBe(0);
  });

  it('counts each commit once, however many snapshots it has', () => {
    const history = [snapshot('a'), snapshot('a'), snapshot('b'), snapshot('a'), snapshot('c')];
    expect(distinctCommitCount(history, 'head')).toBe(3);
  });

  it('does not count the current commit', () => {
    const history = [snapshot('head'), snapshot('a'), snapshot('head'), snapshot('b')];
    expect(distinctCommitCount(history, 'head')).toBe(2);
  });

  it('is 0 when every snapshot belongs to the current commit', () => {
    expect(distinctCommitCount([snapshot('head'), snapshot('head')], 'head')).toBe(0);
  });

  it('counts every commit when no current sha is given', () => {
    const history = [snapshot('head'), snapshot('a'), snapshot('a')];
    expect(distinctCommitCount(history)).toBe(2);
  });
});

describe('priorCommitSnapshots', () => {
  it('keeps the newest snapshot of each commit, newest first', () => {
    const history = [
      snapshot('b', 'b-newest'),
      snapshot('a', 'a-newest'),
      snapshot('b', 'b-older'),
      snapshot('a', 'a-older'),
      snapshot('c', 'c-only'),
    ];
    const prior = priorCommitSnapshots(history, 'head');
    expect(prior.map((s) => s.commitSha)).toEqual(['b', 'a', 'c']);
    expect(prior.map((s) => s.computedAt)).toEqual(['b-newest', 'a-newest', 'c-only']);
  });

  it('leaves out snapshots of the current commit', () => {
    const history = [snapshot('head'), snapshot('a'), snapshot('head'), snapshot('b')];
    expect(priorCommitSnapshots(history, 'head').map((s) => s.commitSha)).toEqual(['a', 'b']);
  });

  it('agrees with distinctCommitCount', () => {
    const history = [snapshot('head'), snapshot('a'), snapshot('a'), snapshot('b')];
    expect(priorCommitSnapshots(history, 'head')).toHaveLength(distinctCommitCount(history, 'head'));
  });

  it('does not change the history it is given', () => {
    const history = [snapshot('a'), snapshot('a'), snapshot('b')];
    priorCommitSnapshots(history, 'b');
    expect(history.map((s) => s.commitSha)).toEqual(['a', 'a', 'b']);
  });
});
