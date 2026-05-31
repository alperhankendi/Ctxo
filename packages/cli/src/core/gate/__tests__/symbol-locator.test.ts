import { describe, it, expect } from 'vitest';
import { lineOfSnippet, locateSymbolAtLine } from '../symbol-locator.js';
import type { FileIndex } from '../../types.js';

const source = `line1\nfunction foo() {\n  return 1;\n}\n`;

const index: FileIndex = {
  file: 'src/foo.ts',
  lastModified: 0,
  symbols: [
    { symbolId: 'src/foo.ts::foo::function', name: 'foo', kind: 'function', startLine: 2, endLine: 4 },
    { symbolId: 'src/foo.ts::big::function', name: 'big', kind: 'function', startLine: 1, endLine: 10 },
  ],
  edges: [],
  intent: [],
  antiPatterns: [],
};

describe('lineOfSnippet', () => {
  it('returns the 1-based line where a snippet starts', () => {
    expect(lineOfSnippet(source, 'return 1;')).toBe(3);
  });
  it('returns null when the snippet is absent', () => {
    expect(lineOfSnippet(source, 'nope')).toBeNull();
  });
});

describe('locateSymbolAtLine', () => {
  it('picks the innermost (smallest) enclosing symbol', () => {
    expect(locateSymbolAtLine(index, 3)).toBe('src/foo.ts::foo::function');
  });
  it('returns null when no symbol encloses the line', () => {
    const empty: FileIndex = { ...index, symbols: [] };
    expect(locateSymbolAtLine(empty, 3)).toBeNull();
  });
});
