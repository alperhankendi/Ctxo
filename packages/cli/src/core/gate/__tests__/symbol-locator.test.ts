import { describe, it, expect } from 'vitest';
import { lineOfSnippet, locateSymbolAtLine } from '../symbol-locator.js';
import type { FileIndex } from '../../types.js';

const source = `line1\nfunction foo() {\n  return 1;\n}\n`;

// 0-based line numbers, matching the ctxo index (language adapters store
// `getStartLineNumber() - 1`). foo spans physical lines 2-4 => 0-based 1-3.
const index: FileIndex = {
  file: 'src/foo.ts',
  lastModified: 0,
  symbols: [
    { symbolId: 'src/foo.ts::foo::function', name: 'foo', kind: 'function', startLine: 1, endLine: 3 },
    { symbolId: 'src/foo.ts::big::function', name: 'big', kind: 'function', startLine: 0, endLine: 9 },
  ],
  edges: [],
  intent: [],
  antiPatterns: [],
};

describe('lineOfSnippet', () => {
  it('returns the 0-based line where a snippet starts', () => {
    // 'return 1;' is on physical line 3 => 0-based line 2.
    expect(lineOfSnippet(source, 'return 1;')).toBe(2);
  });
  it('returns null when the snippet is absent', () => {
    expect(lineOfSnippet(source, 'nope')).toBeNull();
  });
});

describe('locateSymbolAtLine', () => {
  it('picks the innermost (smallest) enclosing symbol', () => {
    expect(locateSymbolAtLine(index, 2)).toBe('src/foo.ts::foo::function');
  });
  it('returns null when no symbol encloses the line', () => {
    const empty: FileIndex = { ...index, symbols: [] };
    expect(locateSymbolAtLine(empty, 2)).toBeNull();
  });
});

// Regression: the snippet's 0-based line must align with the 0-based index so
// the real gate-hook path (lineOfSnippet -> locateSymbolAtLine) resolves the
// edited symbol. A 1-based/0-based mismatch here makes the guard silently
// fail-open on every real edit.
describe('lineOfSnippet + locateSymbolAtLine (composed, real path)', () => {
  it('resolves the enclosing symbol for an edited snippet', () => {
    const line = lineOfSnippet(source, 'return 1;');
    if (line === null) throw new Error('snippet not found');
    expect(locateSymbolAtLine(index, line)).toBe('src/foo.ts::foo::function');
  });
});
