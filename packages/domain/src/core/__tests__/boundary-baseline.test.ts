import { describe, expect, it } from 'vitest';
import { createModuleHost, type FileIndex, type RangeCommit } from '@ctxo/cli/internal';
import { baselineKeys, branchRenames, classifyViolations, violationKey } from '../boundary-baseline.js';
import { computeBoundaries, type BoundaryViolationRecord } from '../boundaries.js';
import { createOwnership } from '../ownership.js';
import { parseRegistry } from '../registry.js';

const REGISTRY = `version: 1
contexts:
  - id: lending
    name: Lending
    paths: ["src/Lending/**"]
    rung: bounded
  - id: billing
    name: Billing
    paths: ["src/Billing/**"]
    rung: named
`;

const host = createModuleHost({ cliVersion: '0.0.0', mode: 'cli', projectRoot: process.cwd() });

const LOAN = 'src/Lending/Loan.ts::Loan::class';
const FEE = 'src/Lending/Fee.ts::Fee::class';
const INVOICE = 'src/Billing/Invoice.ts::Invoice::class';

function file(path: string, symbol: string | undefined, to: readonly string[], line = 0): FileIndex {
  return {
    file: path,
    lastModified: 1,
    symbols: symbol === undefined ? [] : [{ symbolId: symbol, name: symbol.split('::')[1]!, kind: 'class', startLine: line, endLine: line + 3 }],
    edges: symbol === undefined ? [] : to.map((target) => ({ from: symbol, to: target, kind: 'imports' as const })),
    intent: [],
    antiPatterns: [],
  };
}

function violationsOf(indices: readonly FileIndex[]): readonly BoundaryViolationRecord[] {
  const registry = parseRegistry(REGISTRY).registry!;
  return computeBoundaries(host.services.buildGraph(indices).allEdges(), {
    registry,
    ownership: createOwnership(registry, host.services.makeGlobMatcher),
    isTestFile: () => false,
    mode: 'new-only',
    blockingRungs: ['bounded', 'boring'],
  }).violations;
}

function v(from: string, to: string, edgeKind = 'imports', severity: 'error' | 'warning' = 'error'): BoundaryViolationRecord {
  const end = (symbolId: string) => {
    const path = symbolId.split('::')[0]!;
    return { symbolId, file: path, context: path.startsWith('src/Lending/') ? 'lending' : 'billing' };
  };
  return { from: end(from), to: end(to), edgeKind, severity };
}

function renameCommit(...pairs: [string, string][]): RangeCommit {
  return { hash: 'h', subject: 's', isMerge: false, trailers: [], changes: pairs.map(([oldPath, path]) => ({ status: 'R' as const, oldPath, path })) };
}

describe('violationKey', () => {
  it('is context, target context, source symbol, edge kind and target symbol, with no line number', () => {
    expect(violationKey(v(LOAN, INVOICE)).split('\u0000')).toEqual(['lending', 'billing', LOAN, 'imports', INVOICE]);
    expect(violationKey(v(LOAN, INVOICE, 'calls'))).not.toBe(violationKey(v(LOAN, INVOICE)));
  });

  it('stays the same across a line shift and an unrelated file change', () => {
    const base = violationsOf([file('src/Lending/Loan.ts', LOAN, [INVOICE], 3), file('src/Billing/Invoice.ts', INVOICE, [])]);
    const head = violationsOf([
      file('src/Lending/Loan.ts', LOAN, [INVOICE], 40),
      file('src/Billing/Invoice.ts', INVOICE, [], 12),
      file('src/Billing/Other.ts', 'src/Billing/Other.ts::Other::class', []),
    ]);
    expect(head.map(violationKey)).toEqual(base.map(violationKey));
    expect(classifyViolations(head, baselineKeys(base, new Map())).map((x) => x.baseline)).toEqual(['existing']);
  });
});

describe('branchRenames', () => {
  it('composes renames oldest first and keeps only the project directory', () => {
    // Newest first, as the range log gives them.
    const commits = [renameCommit(['src/B.ts', 'src/C.ts']), renameCommit(['src/A.ts', 'src/B.ts'], ['other/X.ts', 'other/Y.ts'])];
    expect([...branchRenames(commits)]).toEqual([
      ['src/A.ts', 'src/C.ts'],
      ['other/X.ts', 'other/Y.ts'],
    ]);
    const prefixed = [renameCommit(['app/src/A.ts', 'app/src/B.ts'], ['lib/X.ts', 'lib/Y.ts'])];
    expect([...branchRenames(prefixed, 'app/')]).toEqual([['src/A.ts', 'src/B.ts']]);
  });

  it('drops a rename that comes back to its first path, and ignores other statuses', () => {
    const commits: RangeCommit[] = [
      renameCommit(['src/B.ts', 'src/A.ts']),
      { hash: 'm', subject: 's', isMerge: false, trailers: [], changes: [{ status: 'M', path: 'src/A.ts' }, { status: 'C', oldPath: 'src/Z.ts', path: 'src/Q.ts' }] },
      renameCommit(['src/A.ts', 'src/B.ts']),
    ];
    expect(branchRenames(commits).size).toBe(0);
  });
});

describe('classifyViolations', () => {
  it('marks the base violations existing (as warnings) and the others new, new ones first', () => {
    const head = [v(FEE, INVOICE), v(LOAN, INVOICE)];
    const classified = classifyViolations(head, baselineKeys([v(LOAN, INVOICE)], new Map()));
    expect(classified.map((x) => [x.from.symbolId, x.baseline, x.severity])).toEqual([
      [FEE, 'new', 'error'],
      [LOAN, 'existing', 'warning'],
    ]);
  });

  it('a new violation in a non-blocking pair stays a warning', () => {
    const classified = classifyViolations([v(INVOICE, LOAN, 'imports', 'warning')], new Set());
    expect(classified[0]).toMatchObject({ baseline: 'new', severity: 'warning' });
  });

  it('maps the base through renames; a changed context pair or a renamed symbol is new', () => {
    const renames = new Map([['src/Lending/Loan.ts', 'src/Lending/Loans.ts']]);
    const keys = baselineKeys([v(LOAN, INVOICE)], renames);
    const moved = v('src/Lending/Loans.ts::Loan::class', INVOICE);
    expect(classifyViolations([moved], keys)[0]!.baseline).toBe('existing');

    const renamedSymbol = v('src/Lending/Loans.ts::LoanRecord::class', INVOICE);
    expect(classifyViolations([renamedSymbol], keys)[0]!.baseline).toBe('new');

    // The same symbol IDs judged under another context pair (its file moved into another context) is new.
    const otherPair = { ...moved, from: { ...moved.from, context: 'catalog' } };
    expect(classifyViolations([otherPair], keys)[0]!.baseline).toBe('new');
  });
});
