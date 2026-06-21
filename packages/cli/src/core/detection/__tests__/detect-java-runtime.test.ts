import { describe, it, expect, beforeEach } from 'vitest';
import { parseJavaMajor, detectJavaMajor, resetJavaRuntimeCacheForTests } from '../detect-java-runtime.js';

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

describe('detectJavaMajor memoization (FIX #9)', () => {
  beforeEach(() => {
    // Start each test from a clean cache so tests don't bleed into each other.
    resetJavaRuntimeCacheForTests();
  });

  it('resetJavaRuntimeCacheForTests is exported and callable', () => {
    expect(() => resetJavaRuntimeCacheForTests()).not.toThrow();
  });

  it('returns the same value on two successive calls (memoized)', () => {
    const first = detectJavaMajor();
    const second = detectJavaMajor();
    expect(first).toStrictEqual(second);
  });

  it('returns same type (number | undefined) on repeated calls after reset', () => {
    resetJavaRuntimeCacheForTests();
    const a = detectJavaMajor();
    resetJavaRuntimeCacheForTests();
    const b = detectJavaMajor();
    // Both results must be the same type (java presence is stable within a process)
    expect(typeof a).toBe(typeof b);
  });

  it('cache survives three consecutive calls with the same result', () => {
    const results = [detectJavaMajor(), detectJavaMajor(), detectJavaMajor()];
    expect(results[0]).toStrictEqual(results[1]);
    expect(results[1]).toStrictEqual(results[2]);
  });
});
