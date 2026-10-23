import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../config/config-schema.js';
import { resolveContextsViewConfig, type ResolvedContextsViewConfig } from '../../config/load-config.js';
import type { CoChangeEntry, EdgeKind, FileIndex, SymbolKind, SymbolNode } from '../../types.js';
import { buildContextsView, type ContextCandidate, type ContextsViewInput } from '../contexts-view-builder.js';

const DEFAULTS = resolveContextsViewConfig(DEFAULT_CONFIG);

type Edge = [from: string, to: string, kind: EdgeKind];

function sym(file: string, name: string, kind: SymbolKind = 'function'): SymbolNode {
  return { symbolId: `${file}::${name}::${kind}`, name, kind, startLine: 1, endLine: 2 };
}

function fileIndex(file: string, symbols: SymbolNode[], edges: Edge[] = []): FileIndex {
  return {
    file,
    lastModified: 1,
    symbols,
    edges: edges.map(([from, to, kind]) => ({ from, to, kind })),
    intent: [],
    antiPatterns: [],
  };
}

/** One function per file, named after the file's base name. */
function fnOf(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1).replace(/\.ts$/, '');
  return `${file}::${base}::function`;
}

function plain(file: string, edges: Edge[] = [], extra: SymbolNode[] = []): FileIndex {
  const base = file.slice(file.lastIndexOf('/') + 1).replace(/\.ts$/, '');
  return fileIndex(file, [sym(file, base), ...extra], edges);
}

/** Files that call each other in every pair (one `calls` edge per pair). */
function clique(files: string[], extraEdges: Record<string, Edge[]> = {}): FileIndex[] {
  return files.map((file, i) =>
    plain(file, [
      ...files.slice(i + 1).map((other): Edge => [fnOf(file), fnOf(other), 'calls']),
      ...(extraEdges[file] ?? []),
    ]),
  );
}

function withSettings(patch: Partial<ResolvedContextsViewConfig>): ResolvedContextsViewConfig {
  return { ...DEFAULTS, ...patch };
}

function input(indices: FileIndex[], overrides: Partial<ContextsViewInput> = {}): ContextsViewInput {
  return {
    indices,
    isNode: () => true,
    godNodeFiles: new Set(),
    filePageRank: new Map(),
    settings: DEFAULTS,
    commitSha: 'abc1234',
    ...overrides,
  };
}

function fingerprintOf(files: readonly string[]): string {
  return createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16);
}

function byLabel(candidates: readonly ContextCandidate[], label: string): ContextCandidate {
  const found = candidates.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`no candidate labelled ${label}`);
  return found;
}

const DB = 'src/shared/db.ts';
const DB_FUNCTIONS = Array.from({ length: 40 }, (_, i) => `q${String(i).padStart(2, '0')}`);
const BILLING = [1, 2, 3, 4, 5].map((i) => `src/billing/b${i}.ts`);
const SHIPPING = [1, 2, 3, 4, 5].map((i) => `src/shipping/s${i}.ts`);

/**
 * Spec 7.5: two areas, each a chain of one `imports` edge per neighbour, that share only `src/shared/db.ts`.
 * Every area file calls all 40 functions of the hub.
 */
function hubFixture(extra: Record<string, SymbolNode[]> = {}): FileIndex[] {
  const db = fileIndex(DB, DB_FUNCTIONS.map((name) => sym(DB, name)));
  const area = (files: string[]) =>
    files.map((file, i) => {
      const edges: Edge[] = DB_FUNCTIONS.map((name): Edge => [fnOf(file), `${DB}::${name}::function`, 'calls']);
      const next = files[i + 1];
      if (next) edges.push([fnOf(file), fnOf(next), 'imports']);
      return plain(file, edges, extra[file] ?? []);
    });
  return [db, ...area(BILLING), ...area(SHIPPING)];
}

describe('buildContextsView', () => {
  it('buildContextsView separates two areas that share only a hub and merges them with hub damping off', () => {
    const damped = buildContextsView(input(hubFixture()));

    expect(damped.candidates.map(({ id, label, files }) => ({ id, label, files }))).toEqual([
      { id: 1, label: 'src/billing', files: BILLING },
      { id: 2, label: 'src/shipping', files: SHIPPING },
    ]);
    expect(damped.hubs).toEqual([
      { file: DB, reasons: ['fan-in'], dependents: 10, damping: 0.279, candidate: 1 },
    ]);

    const undamped = buildContextsView(
      input(hubFixture(), { settings: withSettings({ hubs: { ...DEFAULTS.hubs, auto: false } }) }),
    );

    expect(undamped.hubs).toEqual([]);
    expect(undamped.candidates).toHaveLength(1);
    expect(undamped.candidates[0]!.files).toEqual([...BILLING, DB, ...SHIPPING]);
    expect(undamped.candidates[0]!.fileCount).toBe(11);
    // The longest common directory, and no other candidate shares it.
    expect(undamped.candidates[0]!.label).toBe('src');
  });

  it('configured hubs lose every edge and are reported without a candidate', () => {
    const view = buildContextsView(
      input(hubFixture(), { settings: withSettings({ hubs: { ...DEFAULTS.hubs, paths: ['src/shared/**'] } }) }),
    );

    expect(view.hubs).toEqual([{ file: DB, reasons: ['configured', 'fan-in'], dependents: 10, damping: 0 }]);
    expect('candidate' in view.hubs[0]!).toBe(false);
    expect(view.candidates.map((candidate) => candidate.files)).toEqual([BILLING, SHIPPING]);
    expect(view.coverage).toEqual({ files: 11, covered: 10, ratio: 0.909 });
  });

  it('a hub goes to the candidate of its strongest neighbour inside a candidate, past stronger unclustered ones', () => {
    // u.ts calls all three hub functions (the hub's strongest edge) but has no other edge, so it ends up
    // unclustered; a/x.ts calls one hub function and sits in candidate 1.
    const hubFunctions = ['h1', 'h2', 'h3'].map((name) => sym('h.ts', name));
    const view = buildContextsView(
      input(
        [
          fileIndex('h.ts', hubFunctions),
          plain(
            'u.ts',
            hubFunctions.map((target): Edge => [fnOf('u.ts'), target.symbolId, 'calls']),
          ),
          ...clique(['a/x.ts', 'a/y.ts', 'a/z.ts'], { 'a/x.ts': [[fnOf('a/x.ts'), 'h.ts::h1::function', 'calls']] }),
        ],
        { godNodeFiles: new Set(['h.ts']) },
      ),
    );

    expect(view.unclustered).toEqual({ count: 1, files: ['u.ts'] });
    expect(view.candidates.map((candidate) => [candidate.id, candidate.files])).toEqual([
      [1, ['a/x.ts', 'a/y.ts', 'a/z.ts']],
    ]);
    expect(view.hubs).toEqual([{ file: 'h.ts', reasons: ['god-node'], dependents: 2, damping: 0.5, candidate: 1 }]);
  });

  it('ids are sequential by size desc, then label, and fingerprints hash the sorted members', () => {
    const view = buildContextsView(
      input([
        ...clique(['b/x.ts', 'b/y.ts', 'b/z.ts']),
        ...clique(['z/w.ts', 'z/x.ts', 'z/y.ts', 'z/z.ts']),
        ...clique(['a/x.ts', 'a/y.ts', 'a/z.ts']),
      ]),
    );

    expect(view.candidates.map(({ id, label, fileCount }) => ({ id, label, fileCount }))).toEqual([
      { id: 1, label: 'z', fileCount: 4 },
      { id: 2, label: 'a', fileCount: 3 },
      { id: 3, label: 'b', fileCount: 3 },
    ]);
    for (const candidate of view.candidates) {
      expect(candidate.files).toEqual([...candidate.files].sort());
      expect(candidate.fingerprint).toBe(fingerprintOf(candidate.files));
      expect(candidate.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('labels use the longest common directory, else the directory of the top-PageRank member', () => {
    const indices = [
      plain('src/billing/a.ts', [[fnOf('src/billing/a.ts'), fnOf('src/billing/sub/b.ts'), 'calls']]),
      plain('src/billing/sub/b.ts'),
      plain('lib/x.ts', [[fnOf('lib/x.ts'), fnOf('src/y.ts'), 'calls']]),
      plain('src/y.ts'),
      plain('a.ts', [[fnOf('a.ts'), fnOf('b.ts'), 'calls']]),
      plain('b.ts'),
    ];
    const settings = withSettings({ minCandidateFiles: 2 });
    const labelOf = (view: ReturnType<typeof buildContextsView>, file: string) =>
      view.candidates.find((candidate) => candidate.files.includes(file))!.label;

    const yRanksHigher = buildContextsView(
      input(indices, { settings, filePageRank: new Map([['lib/x.ts', 0.1], ['src/y.ts', 0.9]]) }),
    );
    expect(labelOf(yRanksHigher, 'src/billing/a.ts')).toBe('src/billing');
    expect(labelOf(yRanksHigher, 'lib/x.ts')).toBe('src');
    expect(labelOf(yRanksHigher, 'a.ts')).toBe('.');

    const xRanksHigher = buildContextsView(
      input(indices, { settings, filePageRank: new Map([['lib/x.ts', 0.9], ['src/y.ts', 0.1]]) }),
    );
    expect(labelOf(xRanksHigher, 'lib/x.ts')).toBe('lib');
  });

  describe('duplicate labels (K34)', () => {
    const PAIRS = withSettings({ minCandidateFiles: 2 });
    const BILLING_APP = ['src/App/Billing/Invoice.ts', 'src/App/Common/Money.ts'];
    const SHIPPING_APP = ['src/App/Common/Address.ts', 'src/App/Shipping/Parcel.ts'];
    const LIB = ['lib/p.ts', 'lib/q.ts'];
    const APP_RANK: Array<[string, number]> = [
      ['src/App/Billing/Invoice.ts', 0.9],
      ['src/App/Common/Money.ts', 0.1],
      ['src/App/Common/Address.ts', 0.2],
      ['src/App/Shipping/Parcel.ts', 0.8],
    ];

    /** Each list becomes one candidate: its files call each other and nothing else. */
    function pairs(...groups: string[][]): FileIndex[] {
      return groups.flatMap((files) => clique(files));
    }

    it('candidates whose common directory is the same get the directory of their own top-PageRank member', () => {
      const view = buildContextsView(
        input(pairs(BILLING_APP, SHIPPING_APP, LIB), { settings: PAIRS, filePageRank: new Map(APP_RANK) }),
      );

      // Both src/App candidates share the common directory src/App; lib is unique and keeps it.
      expect(view.candidates.map((candidate) => [candidate.id, candidate.label, candidate.files])).toEqual([
        [1, 'lib', LIB],
        [2, 'src/App/Billing', BILLING_APP],
        [3, 'src/App/Shipping', SHIPPING_APP],
      ]);
    });

    it('a unique label is kept even when its top-PageRank member sits deeper', () => {
      const loans = ['src/App/Loans/Loan.ts', 'src/App/Loans/Rules/Limit.ts'];
      const view = buildContextsView(
        input(pairs(loans), { settings: PAIRS, filePageRank: new Map([['src/App/Loans/Rules/Limit.ts', 0.9]]) }),
      );

      expect(view.candidates.map((candidate) => candidate.label)).toEqual(['src/App/Loans']);
    });

    it('ids follow the refined labels: size desc, then final label, then first member', () => {
      // By first member alpha would come first; by refined label (src/App/Beta < src/App/Zeta) beta does.
      const alpha = ['src/App/Alpha/a.ts', 'src/App/Zeta/z.ts'];
      const beta = ['src/App/Beta/y.ts', 'src/App/Common/b.ts'];
      const view = buildContextsView(
        input(pairs(alpha, beta, LIB), {
          settings: PAIRS,
          filePageRank: new Map([['src/App/Zeta/z.ts', 0.9], ['src/App/Beta/y.ts', 0.9]]),
        }),
      );

      expect(view.candidates.map((candidate) => [candidate.id, candidate.label, candidate.files])).toEqual([
        [1, 'lib', LIB],
        [2, 'src/App/Beta', beta],
        [3, 'src/App/Zeta', alpha],
      ]);
    });

    it('the repo-root rule: the top-PageRank member\'s directory, else "."; labels may still repeat', () => {
      const mixed = ['a.ts', 'lib/x.ts'];
      const rootOnly = ['b.ts', 'c.ts'];
      const rootTop = ['d.ts', 'src/e.ts'];
      const view = buildContextsView(
        input(pairs(mixed, rootOnly, rootTop), {
          settings: PAIRS,
          filePageRank: new Map([['lib/x.ts', 0.9], ['a.ts', 0.1], ['d.ts', 0.9], ['src/e.ts', 0.1]]),
        }),
      );

      // rootOnly and rootTop both start as "." and their top members sit at the root too, so both stay ".".
      expect(view.candidates.map((candidate) => [candidate.id, candidate.label, candidate.files])).toEqual([
        [1, '.', rootOnly],
        [2, '.', rootTop],
        [3, 'lib', mixed],
      ]);
    });

    it('the same input in reversed order gives the same labels and ids', () => {
      const forward = buildContextsView(
        input(pairs(BILLING_APP, SHIPPING_APP, LIB), { settings: PAIRS, filePageRank: new Map(APP_RANK) }),
      );
      const reversed = buildContextsView(
        input(
          pairs(BILLING_APP, SHIPPING_APP, LIB)
            .reverse()
            .map((index) => ({ ...index, symbols: [...index.symbols].reverse(), edges: [...index.edges].reverse() })),
          { settings: PAIRS, filePageRank: new Map([...APP_RANK].reverse()) },
        ),
      );

      expect(forward.candidates.map((candidate) => candidate.label)).toEqual(['lib', 'src/App/Billing', 'src/App/Shipping']);
      expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    });
  });

  it('labels treat backslashes as directory separators', () => {
    const view = buildContextsView(
      input(
        [
          plain('src\\billing\\a.ts', [[fnOf('src\\billing\\a.ts'), fnOf('src\\billing\\b.ts'), 'calls']]),
          plain('src\\billing\\b.ts'),
        ],
        { settings: withSettings({ minCandidateFiles: 2 }) },
      ),
    );

    expect(view.candidates.map((candidate) => [candidate.label, candidate.files])).toEqual([
      ['src/billing', ['src\\billing\\a.ts', 'src\\billing\\b.ts']],
    ]);
  });

  it('cohesion is internal weight over internal plus boundary weight', () => {
    // Each clique pair carries one `calls` edge (weight 1); the bridge carries one `imports` edge, so its weight
    // is log2(1.5) / log2(2). Hub edges are not boundary: the damped db edges leave billing at cohesion 1.
    const view = buildContextsView(
      input([
        ...clique(['a/x.ts', 'a/y.ts', 'a/z.ts'], { 'a/x.ts': [[fnOf('a/x.ts'), fnOf('b/x.ts'), 'imports']] }),
        ...clique(['b/x.ts', 'b/y.ts', 'b/z.ts']),
      ]),
    );
    const bridge = Math.round((Math.log2(1.5) / Math.log2(2)) * 1e6) / 1e6;
    const expected = Math.round((3 / (3 + bridge)) * 1000) / 1000;

    expect(view.candidates.map((candidate) => [candidate.label, candidate.cohesion])).toEqual([
      ['a', expected],
      ['b', expected],
    ]);
    expect(expected).toBe(0.837);

    const hub = buildContextsView(input(hubFixture()));
    expect(byLabel(hub.candidates, 'src/billing').cohesion).toBe(1);
  });

  it('crossEdges count symbol edges to other candidates by kind', () => {
    const view = buildContextsView(
      input([
        ...clique(['a/x.ts', 'a/y.ts', 'a/z.ts'], {
          'a/x.ts': [
            [fnOf('a/x.ts'), fnOf('b/x.ts'), 'calls'],
            [fnOf('a/x.ts'), 'b/x.ts::helper::function', 'calls'],
          ],
          'a/y.ts': [[fnOf('a/y.ts'), fnOf('b/y.ts'), 'imports']],
        }),
        ...clique(['b/x.ts', 'b/y.ts', 'b/z.ts'], {
          'b/z.ts': [[fnOf('b/z.ts'), fnOf('a/z.ts'), 'uses']],
        }).map((index) =>
          index.file === 'b/x.ts' ? { ...index, symbols: [...index.symbols, sym('b/x.ts', 'helper')] } : index,
        ),
      ]),
    );
    const a = byLabel(view.candidates, 'a');
    const b = byLabel(view.candidates, 'b');

    expect(a.crossEdges).toEqual([{ candidate: b.id, total: 3, byKind: { calls: 2, imports: 1 } }]);
    expect(b.crossEdges).toEqual([{ candidate: a.id, total: 1, byKind: { uses: 1 } }]);
  });

  it('candidates list sharedTables and the view lists dataResources', () => {
    const dataEdges: Record<string, Edge[]> = {
      'src/billing/b1.ts': [[fnOf('src/billing/b1.ts'), 'dbo.loans::table', 'writes']],
      'src/shipping/s1.ts': [
        [fnOf('src/shipping/s1.ts'), 'dbo.loans::table', 'reads'],
        [fnOf('src/shipping/s1.ts'), 'dbo.members::table', 'writes'],
        [fnOf('src/shipping/s1.ts'), 'dbo.audit_log::table', 'writes'],
      ],
      // The hub is assigned to billing, so its read counts for billing.
      [DB]: [[`${DB}::q00::function`, 'dbo.members::table', 'reads']],
    };
    const indices = [
      ...hubFixture().map((index) =>
        dataEdges[index.file]
          ? { ...index, edges: [...index.edges, ...fileIndex(index.file, [], dataEdges[index.file]).edges] }
          : index,
      ),
      // Unclustered: its write is ignored.
      plain('src/lonely.ts', [[fnOf('src/lonely.ts'), 'dbo.members::table', 'writes']]),
      fileIndex('db/schema.sql', [sym('db/schema.sql', 'dbo.loans', 'table'), sym('db/schema.sql', 'dbo.members', 'table')]),
    ];

    const view = buildContextsView(input(indices));
    const billing = byLabel(view.candidates, 'src/billing');
    const shipping = byLabel(view.candidates, 'src/shipping');
    expect([billing.id, shipping.id]).toEqual([1, 2]);
    expect(view.hubs[0]!.candidate).toBe(1);
    expect(view.unclustered.files).toEqual(['db/schema.sql', 'src/lonely.ts']);

    const loans = {
      name: 'dbo.loans',
      kind: 'table',
      external: false,
      accesses: [
        { candidate: 1, modes: ['writes'] },
        { candidate: 2, modes: ['reads'] },
      ],
    };
    const members = {
      name: 'dbo.members',
      kind: 'table',
      external: false,
      accesses: [
        { candidate: 1, modes: ['reads'] },
        { candidate: 2, modes: ['writes'] },
      ],
    };
    expect(view.dataResources).toEqual([
      { name: 'dbo.audit_log', external: true, accesses: [{ candidate: 2, modes: ['writes'] }], writers: [2], owner: 2 },
      { ...loans, writers: [1], owner: 1 },
      { ...members, writers: [2], owner: 2 },
    ]);
    const shared = [
      { ...loans, owner: 1 },
      { ...members, owner: 2 },
    ];
    expect(billing.sharedTables).toEqual(shared);
    expect(shipping.sharedTables).toEqual(shared);
  });

  it('crossEdges leave out data edges between candidates', () => {
    const view = buildContextsView(
      input([
        ...clique(['a/x.ts', 'a/y.ts', 'a/z.ts'], {
          'a/x.ts': [
            [fnOf('a/x.ts'), fnOf('b/x.ts'), 'calls'],
            [fnOf('a/x.ts'), 'dbo.loans::table', 'reads'],
            [fnOf('a/x.ts'), 'dbo.usp_close::procedure', 'executes'],
          ],
        }),
        ...clique(['b/x.ts', 'b/y.ts', 'b/z.ts']).map((index) =>
          index.file === 'b/x.ts'
            ? {
                ...index,
                symbols: [...index.symbols, sym('b/x.ts', 'dbo.loans', 'table'), sym('b/x.ts', 'dbo.usp_close', 'procedure')],
              }
            : index,
        ),
      ]),
    );
    const a = byLabel(view.candidates, 'a');
    const b = byLabel(view.candidates, 'b');

    expect(a.crossEdges).toEqual([{ candidate: b.id, total: 1, byKind: { calls: 1 } }]);
    expect(b.crossEdges).toEqual([]);
    // Only candidate a reads dbo.loans: listed as a resource, shared by no one.
    expect(view.dataResources.map((resource) => resource.name)).toEqual(['dbo.loans']);
    expect(a.sharedTables).toEqual([]);
  });

  it('coChangePairs keep the top 10 crossing pairs', () => {
    const left = ['a/w.ts', 'a/x.ts', 'a/y.ts', 'a/z.ts'];
    const right = ['b/w.ts', 'b/x.ts', 'b/y.ts', 'b/z.ts'];
    const entries: CoChangeEntry[] = [{ file1: 'a/w.ts', file2: 'a/x.ts', sharedCommits: 9, frequency: 0.5 }];
    let frequency = 12;
    for (const l of left) {
      for (const r of right.slice(0, 3)) {
        entries.push({ file1: l, file2: r, sharedCommits: 5, frequency: frequency / 100 });
        frequency--;
      }
    }
    const coChangeMap = new Map<string, CoChangeEntry[]>();
    for (const entry of entries) {
      for (const file of [entry.file1, entry.file2]) coChangeMap.set(file, [...(coChangeMap.get(file) ?? []), entry]);
    }

    const view = buildContextsView(input([...clique(left), ...clique(right)], { coChangeMap }));
    const a = byLabel(view.candidates, 'a');
    const b = byLabel(view.candidates, 'b');

    expect(a.coChangePairs).toHaveLength(10);
    expect(a.coChangePairs[0]).toEqual({
      file: 'a/w.ts',
      otherFile: 'b/w.ts',
      otherCandidate: b.id,
      frequency: 0.12,
      sharedCommits: 5,
    });
    expect(a.coChangePairs.map((p) => p.frequency)).toEqual([
      0.12, 0.11, 0.1, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03,
    ]);
    expect(b.coChangePairs[0]).toEqual({
      file: 'b/w.ts',
      otherFile: 'a/w.ts',
      otherCandidate: a.id,
      frequency: 0.12,
      sharedCommits: 5,
    });
    expect(b.coChangePairs).toHaveLength(10);
  });

  it('coverage counts candidate files plus assigned hubs over all nodes', () => {
    const view = buildContextsView(input([...hubFixture(), plain('src/lonely.ts')]));

    expect(view.coverage).toEqual({ files: 12, covered: 11, ratio: 0.917 });
    expect(view.unclustered).toEqual({ count: 1, files: ['src/lonely.ts'] });
  });

  it('the same input in reversed order gives byte-identical JSON', () => {
    const extra: Record<string, SymbolNode[]> = {
      'src/billing/b1.ts': [
        sym('src/billing/b1.ts', 'Invoice', 'class'),
        sym('src/billing/b1.ts', 'Invoice.total', 'method'),
        sym('src/billing/b1.ts', 'InvoiceStatus', 'type'),
        sym('src/billing/b1.ts', 'InvoiceStatus.Paid', 'variable'),
      ],
      'src/shipping/s1.ts': [
        sym('src/shipping/s1.ts', 'Invoice', 'class'),
        sym('src/shipping/s1.ts', 'Invoice.weight', 'method'),
        sym('src/shipping/s1.ts', 'Parcel', 'interface'),
      ],
    };
    const entries: CoChangeEntry[] = [
      { file1: 'src/billing/b2.ts', file2: 'src/shipping/s2.ts', sharedCommits: 3, frequency: 0.02 },
      { file1: 'src/billing/b1.ts', file2: 'src/billing/b3.ts', sharedCommits: 4, frequency: 0.4 },
    ];
    const mapOf = (list: CoChangeEntry[]) => {
      const map = new Map<string, CoChangeEntry[]>();
      for (const entry of list) {
        for (const file of [entry.file1, entry.file2]) map.set(file, [...(map.get(file) ?? []), entry]);
      }
      return map;
    };
    const pageRank = [...BILLING, ...SHIPPING, DB].map((file, i): [string, number] => [file, (i + 1) / 100]);

    // SQL symbols and data edges: a table with columns, a view and a procedure chain, written and read from
    // both candidates, the hub and the unclustered file.
    const withData = (): FileIndex[] => [
      ...hubFixture(extra).map((index) => {
        const extraEdges: Record<string, Edge[]> = {
          'src/billing/b1.ts': [
            [fnOf('src/billing/b1.ts'), 'dbo.loans::table', 'writes'],
            [fnOf('src/billing/b1.ts'), 'dbo.open_loans::table', 'reads'],
            [fnOf('src/billing/b1.ts'), 'dbo.audit_log::table', 'reads'],
          ],
          'src/shipping/s1.ts': [
            [fnOf('src/shipping/s1.ts'), 'dbo.usp_close::procedure', 'executes'],
            [fnOf('src/shipping/s1.ts'), 'dbo.audit_log::table', 'writes'],
          ],
          [DB]: [[`${DB}::q00::function`, 'dbo.loans::table', 'reads']],
        };
        return extraEdges[index.file] ? { ...index, edges: [...index.edges, ...fileIndex(index.file, [], extraEdges[index.file]).edges] } : index;
      }),
      plain('src/lonely.ts', [[fnOf('src/lonely.ts'), 'dbo.loans::table', 'writes']]),
      fileIndex(
        'db/loans.sql',
        [
          { ...sym('db/loans.sql', 'dbo.loans', 'table'), name: 'dbo.Loans', annotations: [{ name: 'columns', args: ['due_date', 'member_id'] }] },
          sym('db/loans.sql', 'dbo.open_loans', 'view'),
          sym('db/loans.sql', 'dbo.usp_close', 'procedure'),
          sym('db/loans.sql', 'dbo.usp_log', 'procedure'),
        ],
        [
          ['db/loans.sql::dbo.open_loans::view', 'dbo.loans::table', 'reads'],
          ['db/loans.sql::dbo.usp_close::procedure', 'dbo.loans::table', 'writes'],
          ['db/loans.sql::dbo.usp_close::procedure', 'dbo.usp_log::procedure', 'executes'],
          ['db/loans.sql::dbo.usp_log::procedure', 'dbo.usp_close::procedure', 'executes'],
          ['db/loans.sql::dbo.usp_log::procedure', 'dbo.audit_log::table', 'reads'],
        ],
      ),
    ];

    const forward = buildContextsView(
      input(withData(), {
        coChangeMap: mapOf(entries),
        filePageRank: new Map(pageRank),
      }),
    );
    const reversed = buildContextsView(
      input(
        withData()
          .reverse()
          .map((index) => ({ ...index, symbols: [...index.symbols].reverse(), edges: [...index.edges].reverse() })),
        { coChangeMap: mapOf([...entries].reverse()), filePageRank: new Map([...pageRank].reverse()) },
      ),
    );

    expect(forward.candidates).toHaveLength(2);
    expect(forward.candidates[0]!.coChangePairs).toHaveLength(1);
    expect(forward.collisions.map((collision) => collision.name)).toEqual(['invoice']);
    expect(forward.candidates[0]!.topTerms.length).toBeGreaterThan(0);
    expect(forward.dataResources.map((resource) => resource.name)).toEqual(['dbo.audit_log', 'dbo.loans', 'dbo.open_loans']);
    expect(forward.candidates.map((candidate) => candidate.sharedTables.map((table) => table.name))).toEqual([
      ['dbo.audit_log', 'dbo.loans'],
      ['dbo.audit_log', 'dbo.loans'],
    ]);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));

    // Regression: b/x.ts declares Foo as a type and as a variable, and the Foo::class edge resolves by
    // file::name. Symbol order inside a file must not decide which Foo it lands on.
    const fooIndices = () => [
      ...clique(['a/x.ts', 'a/y.ts', 'a/z.ts'], {
        'a/x.ts': [
          [fnOf('a/x.ts'), 'b/x.ts::Foo::type', 'uses'],
          [fnOf('a/x.ts'), 'b/x.ts::Foo::class', 'uses'],
        ],
      }),
      ...clique(['b/x.ts', 'b/y.ts', 'b/z.ts']).map((index) =>
        index.file === 'b/x.ts'
          ? { ...index, symbols: [...index.symbols, sym('b/x.ts', 'Foo', 'type'), sym('b/x.ts', 'Foo', 'variable')] }
          : index,
      ),
    ];
    const fooForward = buildContextsView(input(fooIndices()));
    const fooReversed = buildContextsView(
      input(
        fooIndices()
          .reverse()
          .map((index) => ({ ...index, symbols: [...index.symbols].reverse(), edges: [...index.edges].reverse() })),
      ),
    );

    expect(byLabel(fooForward.candidates, 'a').crossEdges).toEqual([
      { candidate: byLabel(fooForward.candidates, 'b').id, total: 2, byKind: { uses: 2 } },
    ]);
    expect(JSON.stringify(fooReversed)).toBe(JSON.stringify(fooForward));
  });

  it('an index without edges puts every node in unclustered', () => {
    const view = buildContextsView(input([plain('c.ts'), plain('a.ts'), plain('b.ts')]));

    expect(view.candidates).toEqual([]);
    expect(view.hubs).toEqual([]);
    expect(view.unclustered).toEqual({ count: 3, files: ['a.ts', 'b.ts', 'c.ts'] });
    expect(view.coverage).toEqual({ files: 3, covered: 0, ratio: 0 });
  });

  it('no node gives an empty view with ratio 0', () => {
    const empty = {
      version: 1,
      commitSha: 'abc1234',
      settings: DEFAULTS,
      coverage: { files: 0, covered: 0, ratio: 0 },
      candidates: [],
      hubs: [],
      unclustered: { count: 0, files: [] },
      collisions: [],
      dataResources: [],
    };

    expect(buildContextsView(input([]))).toEqual(empty);
    // Everything excluded (contextsView.exclude: ["**"]) leaves no node either.
    expect(buildContextsView(input(hubFixture(), { isNode: () => false }))).toEqual(empty);
  });

  it('a candidate under a non-ASCII directory with spaces keeps that spelling as its label and the same fingerprint across runs', () => {
    const files = ['src/ödünç kaydı/a.ts', 'src/ödünç kaydı/b.ts', 'src/ödünç kaydı/c.ts'];
    const first = buildContextsView(input(clique(files)));
    const second = buildContextsView(input(clique(files).reverse()));

    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0]!.label).toBe('src/ödünç kaydı');
    expect(first.candidates[0]!.files).toEqual(files);
    expect(first.candidates[0]!.fingerprint).toBe(fingerprintOf(files));
    expect(second.candidates[0]!.fingerprint).toBe(first.candidates[0]!.fingerprint);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
