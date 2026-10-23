import { describe, it, expect } from 'vitest';
import { compareCodepoint } from '../compare-codepoint.js';

describe('compareCodepoint', () => {
  it('returns a negative number, zero or a positive number like a comparator', () => {
    expect(compareCodepoint('a', 'b')).toBe(-1);
    expect(compareCodepoint('b', 'a')).toBe(1);
    expect(compareCodepoint('a', 'a')).toBe(0);
    expect(compareCodepoint('', '')).toBe(0);
    expect(compareCodepoint('', 'a')).toBe(-1);
  });

  it('orders by code point, so upper case sorts before lower case', () => {
    expect(['b.ts', 'B.ts', 'a.ts', 'A.ts'].sort(compareCodepoint)).toEqual(['A.ts', 'B.ts', 'a.ts', 'b.ts']);
  });

  it('puts a prefix before the longer string and compares digits as text', () => {
    expect(['src/ab', 'src/a', 'src/a10', 'src/a2'].sort(compareCodepoint)).toEqual([
      'src/a',
      'src/a10',
      'src/a2',
      'src/ab',
    ]);
  });

  it('does not depend on the locale', () => {
    // A locale-aware comparison puts 'a' before 'B'; code point order does not.
    expect(compareCodepoint('B', 'a')).toBeLessThan(0);
    expect(compareCodepoint('i', 'ı')).toBeLessThan(0);
  });
});
