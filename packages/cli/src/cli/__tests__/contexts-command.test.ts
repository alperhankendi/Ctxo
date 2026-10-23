import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContextsCommand } from '../contexts-command.js';
import { resolveContextsViewConfig } from '../../core/config/load-config.js';
import type { ContextsView } from '../../core/contexts-view/contexts-view-builder.js';

const HINT = 'No contexts view. Run ctxo index (without --skip-community).';
const roots: string[] = [];
let stdoutSpy: MockInstance<typeof process.stdout.write>;
let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sampleView(): ContextsView {
  return {
    version: 1,
    commitSha: 'abc1234',
    settings: resolveContextsViewConfig({ version: '1.0' }),
    coverage: { files: 4, covered: 3, ratio: 0.75 },
    candidates: [
      {
        id: 1, label: 'src/billing', fingerprint: '0123456789abcdef', fileCount: 3,
        files: ['src/billing/a.ts', 'src/billing/b.ts', 'src/billing/c.ts'], cohesion: 0.82,
        topTerms: [{ term: 'invoice', files: 2 }, { term: 'tax', files: 2 }, { term: 'ledger', files: 1 }, { term: 'extra', files: 1 }],
        crossEdges: [], coChangePairs: [], sharedTables: [],
      },
      {
        id: 2, label: 'src/auth', fingerprint: 'fedcba9876543210', fileCount: 2,
        files: ['src/auth/x.ts', 'src/auth/y.ts'], cohesion: 1,
        topTerms: [{ term: 'token', files: 2 }], crossEdges: [], coChangePairs: [], sharedTables: [],
      },
    ],
    hubs: [
      { file: 'src/types.ts', reasons: ['fan-in', 'god-node'], dependents: 12, damping: 0.267, candidate: 1 },
      { file: 'src/util.ts', reasons: ['configured'], dependents: 5, damping: 0.5 },
    ],
    unclustered: { count: 1, files: ['src/lonely.ts'] },
    collisions: [{ name: 'Invoice', minJaccard: 0.5, occurrences: [] }],
    dataResources: [],
  };
}

/** sampleView with three candidates and data: two shared tables, a shared external resource and an unshared view. */
function dataView(): ContextsView {
  const base = sampleView();
  const loans = {
    name: 'dbo.loans', kind: 'table' as const, external: false,
    accesses: [{ candidate: 1, modes: ['reads' as const, 'writes' as const] }, { candidate: 2, modes: ['reads' as const] }],
  };
  const members = {
    name: 'dbo.members', kind: 'view' as const, external: false,
    accesses: [{ candidate: 1, modes: ['reads' as const] }, { candidate: 2, modes: ['reads' as const] }, { candidate: 3, modes: ['reads' as const] }],
  };
  const audit = {
    name: 'dbo.audit_log', external: true,
    accesses: [{ candidate: 2, modes: ['writes' as const] }, { candidate: 3, modes: ['writes' as const] }],
  };
  const third = {
    ...base.candidates[1]!, id: 3, label: 'src/shipping', fingerprint: '00112233445566aa',
    files: ['src/shipping/p.ts', 'src/shipping/q.ts'], topTerms: [{ term: 'parcel', files: 2 }],
  };
  const shared = { 1: [{ ...loans, owner: 1 }, members], 2: [audit, { ...loans, owner: 1 }, members], 3: [audit, members] } as const;
  return {
    ...base,
    candidates: [base.candidates[0]!, base.candidates[1]!, third].map((c) => ({ ...c, sharedTables: [...shared[c.id as 1 | 2 | 3]] })),
    dataResources: [
      { ...audit, writers: [2, 3] },
      { ...loans, writers: [1], owner: 1 },
      { ...members, writers: [] },
      { name: 'dbo.open_loans', kind: 'view', external: false, accesses: [{ candidate: 1, modes: ['reads'] }], writers: [] },
    ],
  };
}

function project(view?: ContextsView | string): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-contexts-cmd-'));
  roots.push(root);
  mkdirSync(join(root, '.ctxo', 'index'), { recursive: true });
  if (view !== undefined) {
    writeFileSync(join(root, '.ctxo', 'index', 'contexts-view.json'), typeof view === 'string' ? view : JSON.stringify(view));
  }
  return root;
}

const stdout = () => stdoutSpy.mock.calls.map((a) => String(a[0])).join('');
const stderr = () => errorSpy.mock.calls.map((a) => String(a[0])).join('\n');

describe('ContextsCommand', () => {
  it('--json prints the full contexts view to stdout', () => {
    const view = sampleView();
    new ContextsCommand(project(view)).run({ json: true });
    expect(stdout()).toBe(JSON.stringify(view, null, 2) + '\n');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('without --json prints the table to stderr and nothing to stdout', () => {
    new ContextsCommand(project(sampleView())).run({});
    expect(stdoutSpy).not.toHaveBeenCalled();
    const out = stderr();
    expect(out).toContain('[ctxo] Contexts view at abc1234: 2 candidates cover 3/4 files (75%), 2 hubs, 1 unclustered, 1 collisions, 0 shared tables');
    expect(out).toContain('#1  3 files  cohesion 0.82  src/billing  terms: invoice, tax, ledger');
    expect(out).not.toContain('extra');
    expect(out).toContain('#2  2 files  cohesion 1  src/auth  terms: token');
    expect(out).not.toContain('shared tables:');
    expect(out).not.toMatch(/^shared /m);
    expect(out).toContain('hub src/types.ts (fan-in, god-node, 12 dependents) -> #1');
    expect(out).toContain('hub src/util.ts (configured, 5 dependents) -> unassigned');
  });

  it('the header counts shared tables and each shared resource gets a line with modes and owner', () => {
    new ContextsCommand(project(dataView())).run({});
    const lines = stderr().split('\n');

    expect(lines[0]).toBe(
      '[ctxo] Contexts view at abc1234: 3 candidates cover 3/4 files (75%), 2 hubs, 1 unclustered, 1 collisions, 3 shared tables',
    );
    expect(lines).toContain('#1  3 files  cohesion 0.82  src/billing  terms: invoice, tax, ledger shared tables: 2');
    expect(lines).toContain('#2  2 files  cohesion 1  src/auth  terms: token shared tables: 3');
    expect(lines).toContain('#3  2 files  cohesion 1  src/shipping  terms: parcel shared tables: 2');
    expect(lines.filter((line) => line.startsWith('shared '))).toEqual([
      'shared external dbo.audit_log  #2 writes, #3 writes  several writers',
      'shared table dbo.loans  #1 reads+writes, #2 reads  owner #1',
      'shared view dbo.members  #1 reads, #2 reads, #3 reads  read only',
    ]);
    expect(stderr()).not.toContain('dbo.open_loans');
  });

  it('a view with zero candidates prints the header and the unclustered count', () => {
    const view: ContextsView = {
      ...sampleView(), coverage: { files: 2, covered: 0, ratio: 0 }, candidates: [], hubs: [],
      unclustered: { count: 2, files: ['a.ts', 'b.ts'] }, collisions: [],
    };
    new ContextsCommand(project(view)).run({});
    expect(stderr()).toBe('[ctxo] Contexts view at abc1234: 0 candidates cover 0/2 files (0%), 0 hubs, 2 unclustered, 0 collisions, 0 shared tables');
  });

  it('a missing or invalid view prints found:false with --json and the hint on stderr without it', () => {
    for (const root of [project(), project('{ not json')]) {
      stdoutSpy.mockClear();
      errorSpy.mockClear();
      new ContextsCommand(root).run({ json: true });
      expect(JSON.parse(stdout())).toEqual({ found: false, hint: HINT });
      stdoutSpy.mockClear();
      errorSpy.mockClear();
      new ContextsCommand(root).run({});
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderr()).toContain(HINT);
    }
  });
});
