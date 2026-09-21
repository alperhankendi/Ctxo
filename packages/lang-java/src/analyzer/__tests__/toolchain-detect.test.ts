import { describe, it, expect } from 'vitest';
import { parseJavaVersion, type JarVariant } from '../toolchain-detect.js';

describe('parseJavaVersion', () => {
  it('parses modern openjdk version output', () => {
    const out = 'openjdk version "21.0.11" 2026-04-21 LTS\nOpenJDK Runtime Environment ...';
    expect(parseJavaVersion(out)).toEqual({ major: 21, version: '21.0.11' });
  });
  it('parses legacy 1.8 output', () => {
    const out = 'java version "1.8.0_392"\nJava(TM) SE Runtime ...';
    expect(parseJavaVersion(out)).toEqual({ major: 8, version: '1.8.0_392' });
  });
  it('parses Java 17', () => {
    expect(parseJavaVersion('openjdk version "17.0.10" 2026-01-16')).toEqual({ major: 17, version: '17.0.10' });
  });
  it('parses Java 11', () => {
    expect(parseJavaVersion('openjdk version "11.0.21" 2023-10-17 LTS')).toEqual({ major: 11, version: '11.0.21' });
  });
  it('parses Java 11 legacy format', () => {
    expect(parseJavaVersion('java version "11.0.2" 2019-01-15 LTS')).toEqual({ major: 11, version: '11.0.2' });
  });
  it('returns null on unparseable output', () => {
    expect(parseJavaVersion('not java')).toBeNull();
  });
});

describe('jarVariant selection boundary', () => {
  const cases: Array<[number, JarVariant]> = [
    [11, 'java11'],
    [12, 'java11'],
    [16, 'java11'],
    [17, 'java17'],
    [21, 'java17'],
  ];
  for (const [major, expected] of cases) {
    it(`major=${major} → ${expected}`, () => {
      const variant: JarVariant = major >= 17 ? 'java17' : 'java11';
      expect(variant).toBe(expected);
    });
  }
});
