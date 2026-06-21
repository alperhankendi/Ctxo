import { describe, it, expect } from 'vitest';
import { parseJavaVersion } from '../toolchain-detect.js';

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
  it('returns null on unparseable output', () => {
    expect(parseJavaVersion('not java')).toBeNull();
  });
});
