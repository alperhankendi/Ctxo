import { describe, it, expect } from 'vitest';
import { SYMBOL_KINDS as PLUGIN_SYMBOL_KINDS, EDGE_KINDS as PLUGIN_EDGE_KINDS } from '@ctxo/plugin-api';
import {
  SymbolKindSchema,
  SymbolNodeSchema,
  GraphEdgeSchema,
  FileIndexSchema,
  SymbolIdSchema,
  EdgeKindSchema,
  DetailLevelSchema,
  EdgeTargetSchema,
  CoChangeMatrixSchema,
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
  it.each([...PLUGIN_SYMBOL_KINDS])(
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

  it('accepts edge with 2-part name-ref "to" (Bar::class)', () => {
    const result = GraphEdgeSchema.safeParse(buildGraphEdge({ to: 'Bar::class' }));
    expect(result.success).toBe(true);
  });

  it('accepts edge with 2-part name-ref "to" for interface (IFoo::interface)', () => {
    const result = GraphEdgeSchema.safeParse(buildGraphEdge({ to: 'IFoo::interface' }));
    expect(result.success).toBe(true);
  });

  it('accepts edge with 3-part full symbol-id "to" (src/Foo.java::Foo::class)', () => {
    const result = GraphEdgeSchema.safeParse(
      buildGraphEdge({ to: 'src/Foo.java::Foo::class' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects 2-part "from" — from must remain strict 3-part', () => {
    const result = GraphEdgeSchema.safeParse(buildGraphEdge({ from: 'Bar::class' }));
    expect(result.success).toBe(false);
  });

  it('rejects "to" with invalid kind (Bar::widget)', () => {
    const result = GraphEdgeSchema.safeParse(buildGraphEdge({ to: 'Bar::widget' }));
    expect(result.success).toBe(false);
  });

  it('rejects "to" with empty name part (::class)', () => {
    const result = GraphEdgeSchema.safeParse(buildGraphEdge({ to: '::class' }));
    expect(result.success).toBe(false);
  });
});

// ── EdgeTargetSchema ────────────────────────────────────────────

describe('EdgeTargetSchema', () => {
  it('accepts 3-part full symbol ID', () => {
    const result = EdgeTargetSchema.safeParse('src/foo.ts::myFn::function');
    expect(result.success).toBe(true);
  });

  it('accepts 2-part name-ref with valid kind (Bar::class)', () => {
    const result = EdgeTargetSchema.safeParse('Bar::class');
    expect(result.success).toBe(true);
  });

  it('accepts 2-part name-ref with interface kind (IFoo::interface)', () => {
    const result = EdgeTargetSchema.safeParse('IFoo::interface');
    expect(result.success).toBe(true);
  });

  it('rejects 1-part string', () => {
    const result = EdgeTargetSchema.safeParse('Bar');
    expect(result.success).toBe(false);
  });

  it('rejects 4-part string', () => {
    const result = EdgeTargetSchema.safeParse('a::b::c::d');
    expect(result.success).toBe(false);
  });

  it('rejects 2-part with invalid kind (Bar::widget)', () => {
    const result = EdgeTargetSchema.safeParse('Bar::widget');
    expect(result.success).toBe(false);
  });

  it('rejects 2-part with empty name (::class)', () => {
    const result = EdgeTargetSchema.safeParse('::class');
    expect(result.success).toBe(false);
  });

  it('rejects 3-part with invalid kind (src/foo.ts::myFn::widget)', () => {
    const result = EdgeTargetSchema.safeParse('src/foo.ts::myFn::widget');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = EdgeTargetSchema.safeParse('');
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

// ── CoChangeMatrixSchema ────────────────────────────────────────

function buildCoChangeMatrix(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    timestamp: 1760000000,
    window: {
      maxCommits: 2000,
      head: 'abc1234',
      commitsScanned: 120,
      commitsUsed: 100,
      massSkipped: 3,
      maxFilesPerCommit: 30,
      minShared: 2,
    },
    entries: [{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 5, frequency: 0.8 }],
    ...overrides,
  };
}

describe('CoChangeMatrixSchema', () => {
  it('parses a matrix with window metadata', () => {
    const input = buildCoChangeMatrix();

    const result = CoChangeMatrixSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it('parses a matrix written before the window was recorded', () => {
    const { window: _window, ...legacy } = buildCoChangeMatrix();

    const result = CoChangeMatrixSchema.safeParse(legacy);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.window).toBeUndefined();
      expect(result.data.entries).toHaveLength(1);
    }
  });

  it('parses an empty matrix', () => {
    expect(CoChangeMatrixSchema.safeParse({ version: 1, timestamp: 0, entries: [] }).success).toBe(true);
  });

  it("parses a window with maxCommits 'all' and a since duration", () => {
    const base = buildCoChangeMatrix();
    const result = CoChangeMatrixSchema.safeParse(
      buildCoChangeMatrix({ window: { ...base.window, maxCommits: 'all', since: '12m' } }),
    );

    expect(result.success).toBe(true);
  });

  it('requires entries', () => {
    const { entries: _entries, ...withoutEntries } = buildCoChangeMatrix();

    expect(CoChangeMatrixSchema.safeParse(withoutEntries).success).toBe(false);
    expect(CoChangeMatrixSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unsupported version', () => {
    expect(CoChangeMatrixSchema.safeParse(buildCoChangeMatrix({ version: 2 })).success).toBe(false);
    expect(CoChangeMatrixSchema.safeParse(buildCoChangeMatrix({ version: '1' })).success).toBe(false);
  });

  it('rejects a missing or non-numeric timestamp', () => {
    const { timestamp: _timestamp, ...withoutTimestamp } = buildCoChangeMatrix();

    expect(CoChangeMatrixSchema.safeParse(withoutTimestamp).success).toBe(false);
    expect(CoChangeMatrixSchema.safeParse(buildCoChangeMatrix({ timestamp: 'now' })).success).toBe(false);
  });

  it.each([
    ['a missing file', { file1: 'src/a.ts', sharedCommits: 5, frequency: 0.8 }],
    ['an empty file name', { file1: '', file2: 'src/b.ts', sharedCommits: 5, frequency: 0.8 }],
    ['a non-string file', { file1: 'src/a.ts', file2: 7, sharedCommits: 5, frequency: 0.8 }],
    ['a string frequency', { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 5, frequency: '0.8' }],
    ['a frequency above 1', { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 5, frequency: 1.5 }],
    ['a negative frequency', { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 5, frequency: -0.1 }],
    ['a fractional shared count', { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 2.5, frequency: 0.8 }],
    ['a zero shared count', { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 0, frequency: 0.8 }],
    ['a missing shared count', { file1: 'src/a.ts', file2: 'src/b.ts', frequency: 0.8 }],
  ])('rejects an entry with %s', (_name, entry) => {
    expect(CoChangeMatrixSchema.safeParse(buildCoChangeMatrix({ entries: [entry] })).success).toBe(false);
  });

  it('rejects the whole matrix when one entry is malformed', () => {
    const good = { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 5, frequency: 0.8 };
    const bad = { file1: 'src/c.ts', file2: 'src/d.ts', sharedCommits: 'many', frequency: 0.8 };

    expect(CoChangeMatrixSchema.safeParse(buildCoChangeMatrix({ entries: [good, bad] })).success).toBe(false);
  });

  it.each([
    ['a missing head', { head: undefined }],
    ['a zero maxCommits', { maxCommits: 0 }],
    ['an unknown maxCommits string', { maxCommits: 'everything' }],
    ['a negative scan count', { commitsScanned: -1 }],
    ['a fractional used count', { commitsUsed: 1.5 }],
    ['a string skip count', { massSkipped: '3' }],
    ['a zero maxFilesPerCommit', { maxFilesPerCommit: 0 }],
    ['a zero minShared', { minShared: 0 }],
    ['a non-string since', { since: 12 }],
  ])('rejects window metadata with %s', (_name, patch) => {
    const base = buildCoChangeMatrix();

    expect(
      CoChangeMatrixSchema.safeParse(buildCoChangeMatrix({ window: { ...base.window, ...patch } })).success,
    ).toBe(false);
  });

  it('ignores keys it does not know so newer files stay readable', () => {
    const result = CoChangeMatrixSchema.safeParse(buildCoChangeMatrix({ generatedBy: 'future' }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect('generatedBy' in result.data).toBe(false);
    }
  });
});

describe('plugin-api kind lists', () => {
  it('core kind schemas use the plugin-api lists', () => {
    expect([...SymbolKindSchema.options]).toEqual([...PLUGIN_SYMBOL_KINDS]);
    expect([...EdgeKindSchema.options]).toEqual([...PLUGIN_EDGE_KINDS]);
  });

  it('SymbolIdSchema accepts table, view and procedure ids', () => {
    expect(SymbolIdSchema.safeParse('db/loans.sql::dbo.loans::table').success).toBe(true);
    expect(SymbolIdSchema.safeParse('db/loans.sql::dbo.v_loans::view').success).toBe(true);
    expect(SymbolIdSchema.safeParse('db/loans.sql::dbo.usp_closeloan::procedure').success).toBe(true);
  });

  it('EdgeTargetSchema accepts 2-part data references', () => {
    expect(EdgeTargetSchema.safeParse('dbo.loans::table').success).toBe(true);
    expect(EdgeTargetSchema.safeParse('dbo.usp_closeloan::procedure').success).toBe(true);
  });

  it('GraphEdgeSchema accepts reads, writes and executes', () => {
    for (const kind of ['reads', 'writes', 'executes']) {
      const target = kind === 'executes' ? 'dbo.usp_closeloan::procedure' : 'dbo.loans::table';
      expect(GraphEdgeSchema.safeParse({ from: 'src/a.cs::A.M::method', to: target, kind }).success).toBe(true);
    }
  });
});

describe('annotation and fact schemas', () => {
  it('SymbolNodeSchema keeps annotations', () => {
    const input = buildSymbolNode({
      annotations: [
        { name: 'Route', args: ['loans'], named: { Name: 'list' } },
        { name: 'Obsolete' },
      ],
    });
    const result = SymbolNodeSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(input);
  });

  it('SymbolNodeSchema rejects an annotation without a name or with a non-string arg', () => {
    expect(SymbolNodeSchema.safeParse(buildSymbolNode({ annotations: [{ args: ['x'] }] })).success).toBe(false);
    expect(SymbolNodeSchema.safeParse(buildSymbolNode({ annotations: [{ name: '' }] })).success).toBe(false);
    expect(SymbolNodeSchema.safeParse(buildSymbolNode({ annotations: [{ name: 'A', args: [1] }] })).success).toBe(false);
  });

  it('FileIndexSchema keeps facts and rejects an unknown fact kind', () => {
    const fact = {
      kind: 'endpoint',
      symbolId: 'src/foo.ts::myFn::function',
      line: 3,
      text: 'GET /loans',
      detail: { verb: 'GET' },
    };
    const kept = FileIndexSchema.safeParse(buildFileIndex({ facts: [fact] }));
    expect(kept.success).toBe(true);
    if (kept.success) expect(kept.data.facts).toEqual([fact]);

    const rejected = FileIndexSchema.safeParse(buildFileIndex({ facts: [{ ...fact, kind: 'mystery' }] }));
    expect(rejected.success).toBe(false);
  });
});
