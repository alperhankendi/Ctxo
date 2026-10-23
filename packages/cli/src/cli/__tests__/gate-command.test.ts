import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateCommand } from '../gate-command.js';

function fixture(edgeKinds: Record<string, string> = { B: 'calls', C: 'calls', D: 'calls' }): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-gp-'));
  const idxDir = join(root, '.ctxo', 'index', 'src');
  mkdirSync(idxDir, { recursive: true });
  writeFileSync(join(idxDir, 'a.ts.json'), JSON.stringify({
    file: 'src/a.ts', lastModified: 0,
    symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 5 }],
    edges: [], intent: [], antiPatterns: [],
  }));
  for (const [n, kind] of Object.entries(edgeKinds)) {
    writeFileSync(join(idxDir, `${n.toLowerCase()}.ts.json`), JSON.stringify({
      file: `src/${n.toLowerCase()}.ts`, lastModified: 0,
      symbols: [{ symbolId: `src/${n.toLowerCase()}.ts::${n}::function`, name: n, kind: 'function', startLine: 1, endLine: 3 }],
      edges: [{ from: `src/${n.toLowerCase()}.ts::${n}::function`, to: 'src/a.ts::A::function', kind }],
      intent: [], antiPatterns: [],
    }));
  }
  return root;
}

describe('GateCommand --preview', () => {
  it('reports symbols that would fire as JSON', () => {
    const root = fixture();
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new GateCommand(root).preview({ json: true });
    const printed = JSON.parse(out.mock.calls.map(c => c[0]).join(''));
    expect(printed.wouldFireCount).toBeGreaterThanOrEqual(1);
    expect(printed.symbols.some((s: { symbolId: string }) => s.symbolId === 'src/a.ts::A::function')).toBe(true);
    out.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists every migration copy of a procedure that three methods execute, as the hook guards them', () => {
    const root = mkdtempSync(join(tmpdir(), 'ctxo-gp-sql-'));
    const index = join(root, '.ctxo', 'index');
    const write = (file: string, symbols: unknown[], edges: unknown[] = []) => {
      mkdirSync(join(index, file, '..'), { recursive: true });
      writeFileSync(join(index, `${file}.json`), JSON.stringify({ file, lastModified: 0, symbols, edges, intent: [], antiPatterns: [] }));
    };
    const procedure = (file: string) => ({ symbolId: `${file}::dbo.usp_close::procedure`, name: 'dbo.usp_close', kind: 'procedure', startLine: 0, endLine: 3 });
    write('db/migrations/V1__init.sql', [procedure('db/migrations/V1__init.sql')]);
    write('db/migrations/V7__close_fix.sql', [procedure('db/migrations/V7__close_fix.sql')]);
    for (const name of ['Close', 'Renew', 'Waive']) {
      const symbolId = `src/Loan${name}.cs::Lending.Loan${name}.Run::method`;
      write(`src/Loan${name}.cs`, [{ symbolId, name: `Lending.Loan${name}.Run`, kind: 'method', startLine: 0, endLine: 3 }], [
        { from: symbolId, to: 'dbo.usp_close::procedure', kind: 'executes' },
      ]);
    }
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    new GateCommand(root).preview({ json: true });
    const printed = JSON.parse(out.mock.calls.map(c => c[0]).join(''));
    out.mockRestore();
    rmSync(root, { recursive: true, force: true });

    expect(printed.symbols.map((s: { symbolId: string; riskCount: number }) => [s.symbolId, s.riskCount])).toEqual([
      ['db/migrations/V1__init.sql::dbo.usp_close::procedure', 3],
      ['db/migrations/V7__close_fix.sql::dbo.usp_close::procedure', 3],
    ]);
  });
});

describe('GateCommand --preview with co-change', () => {
  /** A is called by B and C (2 confirmed) and only imported by D (potential): one short of minDependents (3). */
  const BORDERLINE = { B: 'calls', C: 'calls', D: 'imports' };

  afterEach(() => vi.restoreAllMocks());

  function preview(root: string): { wouldFireCount: number; symbols: Array<{ symbolId: string; riskCount: number }> } {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new GateCommand(root).preview({ json: true });
    const printed = JSON.parse(out.mock.calls.map(c => c[0]).join(''));
    out.mockRestore();
    rmSync(root, { recursive: true, force: true });
    return printed;
  }

  function withCoChanges(root: string, content: string): string {
    writeFileSync(join(root, '.ctxo', 'index', 'co-changes.json'), content);
    return root;
  }

  const aWithD = (frequency: number) => JSON.stringify({
    version: 1, timestamp: 1,
    entries: [{ file1: 'src/a.ts', file2: 'src/d.ts', sharedCommits: 4, frequency }],
  });

  it('leaves a symbol out when its dependents only reach minDependents through an unupgraded import', () => {
    const printed = preview(fixture(BORDERLINE));

    expect(printed.symbols.some((s) => s.symbolId === 'src/a.ts::A::function')).toBe(false);
  });

  it('includes a symbol that crosses minDependents once co-change upgrades a dependent to likely', () => {
    const printed = preview(withCoChanges(fixture(BORDERLINE), aWithD(0.8)));

    const a = printed.symbols.find((s) => s.symbolId === 'src/a.ts::A::function');
    expect(a).toBeDefined();
    expect(a!.riskCount).toBe(3);
  });

  it('does not count a dependent whose file co-changes at only 0.5', () => {
    const printed = preview(withCoChanges(fixture(BORDERLINE), aWithD(0.5)));

    expect(printed.symbols.some((s) => s.symbolId === 'src/a.ts::A::function')).toBe(false);
  });

  it('previews on the graph alone when co-changes.json is invalid', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const printed = preview(withCoChanges(fixture(), '{ not json'));

    expect(printed.symbols.some((s) => s.symbolId === 'src/a.ts::A::function')).toBe(true);
  });

  it('ignores an invalid co-changes.json as a whole: nothing is upgraded from the part that looks usable', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The a.ts/d.ts entry alone would make D likely and A fire; the second entry breaks the schema.
    const invalid = JSON.stringify({
      version: 1, timestamp: 1,
      entries: [
        { file1: 'src/a.ts', file2: 'src/d.ts', sharedCommits: 4, frequency: 0.8 },
        { file1: 'src/a.ts', file2: 'src/x.ts', sharedCommits: 2, frequency: 1.5 },
      ],
    });
    const printed = preview(withCoChanges(fixture(BORDERLINE), invalid));

    expect(printed.symbols.some((s) => s.symbolId === 'src/a.ts::A::function')).toBe(false);
    expect(printed.wouldFireCount).toBe(0);
    expect(warn).toHaveBeenCalled(); // the broken file is reported, not silently skipped
  });
});
