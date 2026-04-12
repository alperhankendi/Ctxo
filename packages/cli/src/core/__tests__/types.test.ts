import { describe, it, expect } from 'vitest';
import {
  SymbolKindSchema,
  SymbolNodeSchema,
  GraphEdgeSchema,
  FileIndexSchema,
  SymbolIdSchema,
  EdgeKindSchema,
  DetailLevelSchema,
} from '../types.js';

// ── Fixtures ────────────────────────────────────────────────────

function buildSymbolNode(overrides: Record<string, unknown> = {}) {
  return {
    symbolId: 'src/foo.ts::myFn::function',
    name: 'myFn',
    kind: 'function',
    startLine: 12,
    endLine: 45,
    ...overrides,
  };
}

function buildGraphEdge(overrides: Record<string, unknown> = {}) {
  return {
    from: 'src/foo.ts::myFn::function',
    to: 'src/bar.ts::TokenValidator::class',
    kind: 'imports',
    ...overrides,
  };
}

function buildFileIndex(overrides: Record<string, unknown> = {}) {
  return {
    file: 'src/foo.ts',
    lastModified: 1711620000,
    symbols: [buildSymbolNode()],
    edges: [buildGraphEdge()],
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

// ── SymbolKindSchema ────────────────────────────────────────────

describe('SymbolKindSchema', () => {
  it.each(['function', 'class', 'interface', 'method', 'variable', 'type'])(
    'parses valid kind "%s"',
    (kind) => {
      const result = SymbolKindSchema.safeParse(kind);
      expect(result.success).toBe(true);
    },
  );

  it('rejects unknown kind "widget"', () => {
    const result = SymbolKindSchema.safeParse('widget');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = SymbolKindSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects undefined', () => {
    const result = SymbolKindSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });

  it('rejects null', () => {
    const result = SymbolKindSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

// ── EdgeKindSchema ──────────────────────────────────────────────

describe('EdgeKindSchema', () => {
  it.each(['imports', 'calls', 'extends', 'implements', 'uses'])(
    'parses valid edge kind "%s"',
    (kind) => {
      const result = EdgeKindSchema.safeParse(kind);
      expect(result.success).toBe(true);
    },
  );

  it('rejects unknown edge kind "inherits"', () => {
    const result = EdgeKindSchema.safeParse('inherits');
    expect(result.success).toBe(false);
  });
});

// ── DetailLevelSchema ───────────────────────────────────────────

describe('DetailLevelSchema', () => {
  it.each([1, 2, 3, 4])('parses valid level %d', (level) => {
    const result = DetailLevelSchema.safeParse(level);
    expect(result.success).toBe(true);
  });

  it('rejects level 0', () => {
    const result = DetailLevelSchema.safeParse(0);
    expect(result.success).toBe(false);
  });

  it('rejects level 5', () => {
    const result = DetailLevelSchema.safeParse(5);
    expect(result.success).toBe(false);
  });

  it('rejects NaN', () => {
    const result = DetailLevelSchema.safeParse(NaN);
    expect(result.success).toBe(false);
  });

  it('rejects string "1"', () => {
    const result = DetailLevelSchema.safeParse('1');
    expect(result.success).toBe(false);
  });
});

// ── SymbolIdSchema ──────────────────────────────────────────────

describe('SymbolIdSchema', () => {
  it('accepts "src/foo.ts::myFn::function"', () => {
    const result = SymbolIdSchema.safeParse('src/foo.ts::myFn::function');
    expect(result.success).toBe(true);
  });

  it('accepts symbolId with nested path "src/adapters/storage/sqlite.ts::query::method"', () => {
    const result = SymbolIdSchema.safeParse(
      'src/adapters/storage/sqlite.ts::query::method',
    );
    expect(result.success).toBe(true);
  });

  it('rejects symbolId without "::" separator', () => {
    const result = SymbolIdSchema.safeParse('src/foo.ts-myFn-function');
    expect(result.success).toBe(false);
  });

  it('rejects symbolId with invalid kind segment', () => {
    const result = SymbolIdSchema.safeParse('src/foo.ts::myFn::widget');
    expect(result.success).toBe(false);
  });

  it('rejects symbolId with only two parts', () => {
    const result = SymbolIdSchema.safeParse('src/foo.ts::myFn');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = SymbolIdSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects symbolId with empty name segment', () => {
    const result = SymbolIdSchema.safeParse('src/foo.ts::::function');
    expect(result.success).toBe(false);
  });

  it('rejects symbolId with empty file segment', () => {
    const result = SymbolIdSchema.safeParse('::myFn::function');
    expect(result.success).toBe(false);
  });
});

// ── SymbolNodeSchema ────────────────────────────────────────────

describe('SymbolNodeSchema', () => {
  it('parses valid symbol node with all required fields', () => {
    const result = SymbolNodeSchema.safeParse(buildSymbolNode());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        symbolId: 'src/foo.ts::myFn::function',
        name: 'myFn',
        kind: 'function',
        startLine: 12,
        endLine: 45,
      });
    }
  });

  it('rejects symbol node missing symbolId', () => {
    const { symbolId: _, ...nodeWithoutId } = buildSymbolNode();
    const result = SymbolNodeSchema.safeParse(nodeWithoutId);
    expect(result.success).toBe(false);
  });

  it('rejects symbol node with negative startLine', () => {
    const result = SymbolNodeSchema.safeParse(
      buildSymbolNode({ startLine: -1 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects symbol node where endLine < startLine', () => {
    const result = SymbolNodeSchema.safeParse(
      buildSymbolNode({ startLine: 45, endLine: 12 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects symbol node with empty name', () => {
    const result = SymbolNodeSchema.safeParse(buildSymbolNode({ name: '' }));
    expect(result.success).toBe(false);
  });

  it('parses symbol node where startLine equals endLine', () => {
    const result = SymbolNodeSchema.safeParse(
      buildSymbolNode({ startLine: 10, endLine: 10 }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects symbol node with fractional startLine', () => {
    const result = SymbolNodeSchema.safeParse(
      buildSymbolNode({ startLine: 3.14 }),
    );
    expect(result.success).toBe(false);
  });
});

// ── GraphEdgeSchema ─────────────────────────────────────────────

describe('GraphEdgeSchema', () => {
  it('parses valid edge with "imports" kind', () => {
    const result = GraphEdgeSchema.safeParse(buildGraphEdge());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('imports');
    }
  });

  it('rejects edge with empty "from" field', () => {
    const result = GraphEdgeSchema.safeParse(buildGraphEdge({ from: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects edge with empty "to" field', () => {
    const result = GraphEdgeSchema.safeParse(buildGraphEdge({ to: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects edge with invalid edge kind', () => {
    const result = GraphEdgeSchema.safeParse(
      buildGraphEdge({ kind: 'inherits' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects edge with invalid "from" symbolId format', () => {
    const result = GraphEdgeSchema.safeParse(
      buildGraphEdge({ from: 'invalid-id' }),
    );
    expect(result.success).toBe(false);
  });
});

// ── FileIndexSchema ─────────────────────────────────────────────

describe('FileIndexSchema', () => {
  it('parses valid file index with symbols and edges', () => {
    const result = FileIndexSchema.safeParse(buildFileIndex());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.file).toBe('src/foo.ts');
      expect(result.data.symbols).toHaveLength(1);
      expect(result.data.edges).toHaveLength(1);
      expect(result.data.intent).toHaveLength(1);
    }
  });

  it('parses file index with empty symbols array', () => {
    const result = FileIndexSchema.safeParse(
      buildFileIndex({ symbols: [], edges: [] }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects file index with missing "file" field', () => {
    const { file: _, ...indexWithoutFile } = buildFileIndex();
    const result = FileIndexSchema.safeParse(indexWithoutFile);
    expect(result.success).toBe(false);
  });

  it('rejects file index with empty "file" field', () => {
    const result = FileIndexSchema.safeParse(buildFileIndex({ file: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects file index with negative lastModified', () => {
    const result = FileIndexSchema.safeParse(
      buildFileIndex({ lastModified: -1 }),
    );
    expect(result.success).toBe(false);
  });

  it('parses file index with antiPatterns present', () => {
    const result = FileIndexSchema.safeParse(
      buildFileIndex({
        antiPatterns: [
          {
            hash: 'def456',
            message: 'revert: remove mutex',
            date: '2024-02-01',
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.antiPatterns).toHaveLength(1);
      expect(result.data.antiPatterns[0]?.message).toBe(
        'revert: remove mutex',
      );
    }
  });

  it('rejects file index with invalid symbol inside symbols array', () => {
    const result = FileIndexSchema.safeParse(
      buildFileIndex({
        symbols: [{ symbolId: 'bad-id', name: '', kind: 'widget' }],
      }),
    );
    expect(result.success).toBe(false);
  });
});
