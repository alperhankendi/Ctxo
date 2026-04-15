import { describe, it, expect } from 'vitest';

import type { CommunityEntry, CommunitySnapshot } from '../../types.js';
import { DriftDetector } from '../drift-detector.js';

function snapshot(
  communities: CommunityEntry[],
  overrides: Partial<CommunitySnapshot> = {},
): CommunitySnapshot {
  return {
    version: 1,
    computedAt: '2026-04-16T10:00:00.000Z',
    commitSha: 'sha',
    modularity: 0.42,
    communities,
    godNodes: [],
    edgeQuality: 'full',
    crossClusterEdges: 0,
    ...overrides,
  };
}

function entry(symbolId: string, communityId: number, label: string): CommunityEntry {
  return { symbolId, communityId, communityLabel: label };
}

describe('DriftDetector', () => {
  const detector = new DriftDetector();

  it('returns no events + low confidence when history is empty', () => {
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const result = detector.detect(current, []);
    expect(result.events).toEqual([]);
    expect(result.confidence).toBe('low');
    expect(result.snapshotsAvailable).toBe(0);
    expect(result.hint).toBeDefined();
  });

  it('returns no events when cluster ids shuffle but membership is stable', () => {
    const prev = snapshot([
      entry('a.ts::A::function', 0, 'core'),
      entry('b.ts::B::function', 0, 'core'),
      entry('c.ts::C::function', 1, 'infra'),
    ]);
    const current = snapshot([
      // Louvain reassigned ids but labels + members match.
      entry('a.ts::A::function', 5, 'core'),
      entry('b.ts::B::function', 5, 'core'),
      entry('c.ts::C::function', 7, 'infra'),
    ]);
    const result = detector.detect(current, [prev]);
    expect(result.events).toEqual([]);
  });

  it('emits a drift event when a symbol moves to a different cluster', () => {
    const prev = snapshot([
      entry('a.ts::A::function', 0, 'core'),
      entry('b.ts::B::function', 0, 'core'),
      entry('c.ts::C::function', 1, 'infra'),
      entry('d.ts::D::function', 1, 'infra'),
    ]);
    const current = snapshot([
      entry('a.ts::A::function', 0, 'core'),
      entry('b.ts::B::function', 0, 'core'),
      entry('c.ts::C::function', 0, 'core'), // C moved core
      entry('d.ts::D::function', 1, 'infra'),
    ]);
    const result = detector.detect(current, [prev]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.symbolId).toBe('c.ts::C::function');
    expect(result.events[0]!.movedFrom.label).toBe('infra');
    expect(result.events[0]!.movedTo.label).toBe('core');
  });

  it('ignores newly-added symbols that have no prior cluster', () => {
    const prev = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const current = snapshot([
      entry('a.ts::A::function', 0, 'core'),
      entry('new.ts::New::function', 1, 'features'),
    ]);
    const result = detector.detect(current, [prev]);
    expect(result.events).toEqual([]);
  });

  it('sorts drift events by symbol id', () => {
    // prev alpha cluster has 3 symbols; the three symbols below each moved to separate
    // clusters so alpha does not map anywhere with high overlap.
    const prev = snapshot([
      entry('z.ts::Z::function', 0, 'alpha'),
      entry('m.ts::M::function', 0, 'alpha'),
      entry('a.ts::A::function', 0, 'alpha'),
      entry('k1.ts::K1::function', 1, 'beta'),
      entry('k2.ts::K2::function', 1, 'beta'),
      entry('k3.ts::K3::function', 1, 'beta'),
      entry('k4.ts::K4::function', 1, 'beta'),
    ]);
    const current = snapshot([
      entry('z.ts::Z::function', 1, 'beta'),
      entry('m.ts::M::function', 1, 'beta'),
      entry('a.ts::A::function', 1, 'beta'),
      entry('k1.ts::K1::function', 1, 'beta'),
      entry('k2.ts::K2::function', 1, 'beta'),
      entry('k3.ts::K3::function', 1, 'beta'),
      entry('k4.ts::K4::function', 1, 'beta'),
    ]);
    const result = detector.detect(current, [prev]);
    expect(result.events.map((e) => e.symbolId)).toEqual([
      'a.ts::A::function',
      'm.ts::M::function',
      'z.ts::Z::function',
    ]);
  });

  it('flags confidence as medium with 3-6 snapshots', () => {
    const prev = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const history = [prev, prev, prev];
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const result = detector.detect(current, history);
    expect(result.confidence).toBe('medium');
    expect(result.hint).toBeUndefined();
  });

  it('flags confidence as high with 7+ snapshots', () => {
    const prev = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const history = Array.from({ length: 7 }, () => prev);
    const current = snapshot([entry('a.ts::A::function', 0, 'core')]);
    const result = detector.detect(current, history);
    expect(result.confidence).toBe('high');
  });

  it('uses the recorded community label when a drift event is emitted', () => {
    const prev = snapshot([
      entry('a.ts::A::function', 0, 'core'),
      entry('b.ts::B::function', 0, 'core'),
    ]);
    const current = snapshot([
      // Membership shifts enough that mapping 0→X does not apply; a moves to a labelled cluster.
      entry('a.ts::A::function', 5, 'infra'),
      entry('c.ts::C::function', 5, 'infra'),
      entry('d.ts::D::function', 5, 'infra'),
    ]);
    const result = detector.detect(current, [prev]);
    expect(result.events.some((e) => e.movedTo.label === 'infra')).toBe(true);
  });

  it('treats completely disjoint clusters as unrelated (no mapping)', () => {
    const prev = snapshot([
      entry('a.ts::A::function', 0, 'alpha'),
      entry('b.ts::B::function', 0, 'alpha'),
    ]);
    const current = snapshot([
      // Different members + different label; mapping falls below jaccard threshold.
      entry('x.ts::X::function', 0, 'gamma'),
    ]);
    const result = detector.detect(current, [prev]);
    // No drift because X was not present before.
    expect(result.events).toEqual([]);
  });

  it('respects a custom jaccard threshold', () => {
    const strict = new DriftDetector({ jaccardThreshold: 0.99 });
    const prev = snapshot([
      entry('a.ts::A::function', 0, 'core'),
      entry('b.ts::B::function', 0, 'core'),
      entry('c.ts::C::function', 0, 'core'),
      entry('d.ts::D::function', 0, 'core'),
    ]);
    const current = snapshot([
      // Roughly the same group with some churn — jaccard ~0.66, well under 0.99.
      entry('a.ts::A::function', 5, 'revised'),
      entry('b.ts::B::function', 5, 'revised'),
      entry('x.ts::X::function', 5, 'revised'),
      entry('y.ts::Y::function', 5, 'revised'),
    ]);
    const result = strict.detect(current, [prev]);
    // Strict threshold prevents mapping, so a/b look like they moved.
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('handles empty community sets in jaccard correctly', () => {
    const prev = snapshot([]);
    const current = snapshot([]);
    const result = detector.detect(current, [prev]);
    expect(result.events).toEqual([]);
  });
});
