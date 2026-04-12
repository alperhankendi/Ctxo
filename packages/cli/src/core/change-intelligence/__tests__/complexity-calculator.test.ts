import { describe, it, expect } from 'vitest';
import { ComplexityCalculator } from '../complexity-calculator.js';

describe('ComplexityCalculator', () => {
  const calc = new ComplexityCalculator();

  it('returns complexity 1 for function with no decision points', () => {
    const result = calc.calculate('a::b::function', 1);
    expect(result.cyclomatic).toBe(1);
  });

  it('returns provided complexity for valid value', () => {
    const result = calc.calculate('a::b::function', 5);
    expect(result.cyclomatic).toBe(5);
  });

  it('handles zero decision points (baseline 1)', () => {
    const result = calc.calculate('a::b::function', 0);
    expect(result.cyclomatic).toBe(1);
  });

  it('handles NaN input gracefully', () => {
    const result = calc.calculate('a::b::function', NaN);
    expect(result.cyclomatic).toBe(1);
  });

  it('handles Infinity input gracefully', () => {
    const result = calc.calculate('a::b::function', Infinity);
    expect(result.cyclomatic).toBe(1);
  });

  it('handles negative input gracefully', () => {
    const result = calc.calculate('a::b::function', -3);
    expect(result.cyclomatic).toBe(1);
  });

  it('preserves symbolId in result', () => {
    const result = calc.calculate('src/foo.ts::bar::function', 3);
    expect(result.symbolId).toBe('src/foo.ts::bar::function');
  });
});
