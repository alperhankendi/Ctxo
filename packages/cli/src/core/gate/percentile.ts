/**
 * The score value at the top-`topPercent`% boundary. A score >= the returned
 * cutoff is in the top `topPercent`% of the distribution. Empty input returns
 * Infinity so that "in top P%" is always false (nothing to gate on).
 */
export function percentileCutoff(scores: readonly number[], topPercent: number): number {
  if (scores.length === 0) return Infinity;
  const sorted = [...scores].sort((a, b) => a - b);
  const rank = Math.ceil(((100 - topPercent) / 100) * sorted.length);
  const idx = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[idx]!;
}
