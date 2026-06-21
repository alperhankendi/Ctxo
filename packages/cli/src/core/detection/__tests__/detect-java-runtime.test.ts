import { describe, it, expect } from 'vitest';
import { parseJavaMajor, detectJavaMajor } from '../detect-java-runtime.js';

describe('parseJavaMajor', () => {
  it('parses 21', () => expect(parseJavaMajor('openjdk version "21.0.11" 2026')).toBe(21));
  it('parses 1.8 -> 8', () => expect(parseJavaMajor('java version "1.8.0_392"')).toBe(8));
  it('parses 17', () => expect(parseJavaMajor('openjdk version "17.0.10"')).toBe(17));
  it('null on junk', () => expect(parseJavaMajor('nope')).toBeUndefined());
});

describe('detectJavaMajor', () => {
  it('is exported and returns number | undefined without throwing', () => {
    // Java may or may not be installed in CI; we just assert the contract.
    let result: number | undefined;
    expect(() => {
      result = detectJavaMajor();
    }).not.toThrow();
    expect(result === undefined || typeof result === 'number').toBe(true);
  });
});
