import { describe, it, expect } from 'vitest';
import { parseJavaMajor } from '../detect-java-runtime.js';

describe('parseJavaMajor', () => {
  it('parses 21', () => expect(parseJavaMajor('openjdk version "21.0.11" 2026')).toBe(21));
  it('parses 1.8 -> 8', () => expect(parseJavaMajor('java version "1.8.0_392"')).toBe(8));
  it('parses 17', () => expect(parseJavaMajor('openjdk version "17.0.10"')).toBe(17));
  it('null on junk', () => expect(parseJavaMajor('nope')).toBeUndefined());
});
