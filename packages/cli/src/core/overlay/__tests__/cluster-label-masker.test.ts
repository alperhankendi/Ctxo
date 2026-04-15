import { describe, expect, it } from 'vitest';

import type { CommunitySnapshot } from '../../types.js';
import { ClusterLabelMasker } from '../cluster-label-masker.js';

function snapshot(labels: string[]): CommunitySnapshot {
  return {
    version: 1,
    computedAt: '2026-04-16T10:00:00.000Z',
    commitSha: 'abc1234',
    modularity: 0.5,
    communities: labels.map((label, i) => ({
      symbolId: `src/file${i}.ts::Sym${i}::function`,
      communityId: i,
      communityLabel: label,
    })),
    godNodes: [],
    edgeQuality: 'full',
    crossClusterEdges: 0,
  };
}

describe('ClusterLabelMasker', () => {
  it('no-op when no patterns configured', () => {
    const m = new ClusterLabelMasker([]);
    expect(m.isEnabled()).toBe(false);
    expect(m.mask('internal-vault')).toBe('internal-vault');
  });

  it('masks labels matching a configured glob', () => {
    const m = new ClusterLabelMasker(['internal-*']);
    expect(m.isEnabled()).toBe(true);
    expect(m.mask('internal-vault')).toBe('[masked-cluster-1]');
  });

  it('does not mask labels that do not match any pattern', () => {
    const m = new ClusterLabelMasker(['internal-*']);
    expect(m.mask('src/core')).toBe('src/core');
  });

  it('returns the same masked identifier for the same input label (stable rewrite)', () => {
    const m = new ClusterLabelMasker(['*-vault']);
    const first = m.mask('payment-vault');
    const second = m.mask('payment-vault');
    expect(first).toBe(second);
    expect(first).toBe('[masked-cluster-1]');
  });

  it('assigns distinct identifiers to different masked labels', () => {
    const m = new ClusterLabelMasker(['internal-*', 'secret-*']);
    const a = m.mask('internal-foo');
    const b = m.mask('secret-bar');
    expect(a).not.toBe(b);
    expect([a, b]).toEqual(expect.arrayContaining(['[masked-cluster-1]', '[masked-cluster-2]']));
  });

  it('masks every matching entry in a snapshot and leaves non-matching ones alone', () => {
    const m = new ClusterLabelMasker(['internal-*']);
    const input = snapshot(['internal-auth', 'src/core', 'internal-billing']);
    const output = m.maskSnapshot(input);
    const labels = output.communities.map((c) => c.communityLabel);
    expect(labels[0]).toMatch(/^\[masked-cluster-\d+\]$/);
    expect(labels[1]).toBe('src/core');
    expect(labels[2]).toMatch(/^\[masked-cluster-\d+\]$/);
    expect(labels[0]).not.toBe(labels[2]);
  });

  it('uses sorted seeding so two masked snapshots are byte-stable', () => {
    const m1 = new ClusterLabelMasker(['internal-*']);
    const m2 = new ClusterLabelMasker(['internal-*']);
    const s1 = m1.maskSnapshot(snapshot(['internal-auth', 'internal-billing']));
    const s2 = m2.maskSnapshot(snapshot(['internal-auth', 'internal-billing']));
    expect(s1.communities.map((c) => c.communityLabel)).toEqual(
      s2.communities.map((c) => c.communityLabel),
    );
  });

  it('leaves the original snapshot unmodified (returns a new object)', () => {
    const m = new ClusterLabelMasker(['internal-*']);
    const input = snapshot(['internal-auth']);
    const originalLabel = input.communities[0]!.communityLabel;
    m.maskSnapshot(input);
    expect(input.communities[0]!.communityLabel).toBe(originalLabel);
  });

  it('passes the snapshot through unmodified when disabled', () => {
    const m = new ClusterLabelMasker([]);
    const input = snapshot(['internal-foo']);
    const output = m.maskSnapshot(input);
    expect(output).toBe(input);
  });
});
