import { describe, it, expect } from 'vitest';
import { ChurnAnalyzer } from '../churn-analyzer.js';

describe('ChurnAnalyzer', () => {
  const analyzer = new ChurnAnalyzer();

  it('normalizes churn to 0-1 range relative to repo max', () => {
    expect(analyzer.normalize(5, 10)).toBe(0.5);
  });

  it('returns 0 for file with zero commits', () => {
    expect(analyzer.normalize(0, 10)).toBe(0);
  });

  it('returns 1 for file with maximum churn in repo', () => {
    expect(analyzer.normalize(10, 10)).toBe(1);
  });

  it('handles repo with single file (churn = 1.0)', () => {
    expect(analyzer.normalize(5, 5)).toBe(1);
  });

  it('clamps to 1 when commitCount exceeds maxCommitCount', () => {
    expect(analyzer.normalize(15, 10)).toBe(1);
  });

  it('returns 0 when maxCommitCount is 0', () => {
    expect(analyzer.normalize(0, 0)).toBe(0);
  });

  it('throws for negative churn value (invalid input)', () => {
    expect(() => analyzer.normalize(-1, 10)).toThrow('Invalid commit count');
  });
});
