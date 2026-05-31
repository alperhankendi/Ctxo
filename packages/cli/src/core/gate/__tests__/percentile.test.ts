import { describe, it, expect } from 'vitest';
import { percentileCutoff } from '../percentile.js';

describe('percentileCutoff', () => {
  it('returns the value at the top-P% boundary', () => {
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileCutoff(scores, 30)).toBe(8);
  });
  it('top 100% includes everything (cutoff = min)', () => {
    expect(percentileCutoff([5, 1, 3], 100)).toBe(1);
  });
  it('returns Infinity for an empty list (nothing qualifies)', () => {
    expect(percentileCutoff([], 15)).toBe(Infinity);
  });
});
