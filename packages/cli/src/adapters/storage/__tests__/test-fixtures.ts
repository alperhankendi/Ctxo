import type { FileIndex } from '../../../core/types.js';

const SYMBOL_DEFAULTS = {
  symbolId: 'src/foo.ts::myFn::function',
  name: 'myFn',
  kind: 'function' as const,
  startLine: 12,
  endLine: 45,
};

const EDGE_DEFAULTS = {
  from: 'src/foo.ts::myFn::function',
  to: 'src/bar.ts::TokenValidator::class',
  kind: 'imports' as const,
};

export function buildFileIndex(overrides: Partial<FileIndex> = {}): FileIndex {
  return {
    file: 'src/foo.ts',
    lastModified: 1711620000,
    symbols: [{ ...SYMBOL_DEFAULTS }],
    edges: [{ ...EDGE_DEFAULTS }],
    intent: [
      {
        hash: 'abc123',
        message: 'fix race condition',
        date: '2024-03-15',
        kind: 'commit',
      },
    ],
    antiPatterns: [],
    ...overrides,
  };
}

export function buildSecondFileIndex(): FileIndex {
  return {
    file: 'src/bar.ts',
    lastModified: 1711620100,
    symbols: [
      {
        symbolId: 'src/bar.ts::TokenValidator::class',
        name: 'TokenValidator',
        kind: 'class',
        startLine: 1,
        endLine: 50,
      },
    ],
    edges: [],
    intent: [],
    antiPatterns: [],
  };
}
