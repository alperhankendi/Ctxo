import { describe, it, expect } from 'vitest';
import { HealthScorer } from '../health-scorer.js';

describe('HealthScorer', () => {
  const scorer = new HealthScorer();

  it('returns "low" band for score 0.0 - 0.3', () => {
    const result = scorer.score('a::b::function', 0.2, 0.5);
    expect(result.band).toBe('low');
    expect(result.composite).toBe(0.1);
  });

  it('returns "medium" band for score 0.3 - 0.7', () => {
    const result = scorer.score('a::b::function', 0.5, 0.8);
    expect(result.band).toBe('medium');
    expect(result.composite).toBeCloseTo(0.4);
  });

  it('returns "high" band for score 0.7 - 1.0', () => {
    const result = scorer.score('a::b::function', 0.9, 0.9);
    expect(result.band).toBe('high');
    expect(result.composite).toBeCloseTo(0.81);
  });

  it('handles boundary value 0.0 as "low"', () => {
    const result = scorer.score('a::b::function', 0, 0);
    expect(result.band).toBe('low');
    expect(result.composite).toBe(0);
  });

  it('handles boundary value 0.3 as "medium" (0.3 is not < 0.3)', () => {
    const result = scorer.score('a::b::function', 0.3, 1);
    expect(result.band).toBe('medium');
  });

  it('handles boundary value 0.7 as "high" (0.7 is not < 0.7)', () => {
    const result = scorer.score('a::b::function', 0.7, 1);
    expect(result.band).toBe('high');
  });

  it('handles boundary value 1.0 as "high"', () => {
    const result = scorer.score('a::b::function', 1, 1);
    expect(result.band).toBe('high');
    expect(result.composite).toBe(1);
  });

  it('handles new symbol with zero churn → "low"', () => {
    const result = scorer.score('a::b::function', 0.8, 0);
    expect(result.band).toBe('low');
    expect(result.composite).toBe(0);
  });

  it('computes composite as complexity × churn', () => {
    const result = scorer.score('a::b::function', 0.4, 0.5);
    expect(result.composite).toBeCloseTo(0.2);
  });

  it('preserves symbolId in result', () => {
    const result = scorer.score('src/foo.ts::bar::function', 0.5, 0.5);
    expect(result.symbolId).toBe('src/foo.ts::bar::function');
  });
});
