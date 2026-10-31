import { createModuleHost, type CodeFact, type FileIndex } from '@ctxo/cli/internal';
import { describe, expect, it } from 'vitest';
import { indexGraph, type GraphIndex } from '../domain-graph-query.js';
import { fingerprint, normalizeFingerprint } from '../fingerprint.js';
import { createOwnership } from '../ownership.js';
import type { RuleLinks } from '../rule-id-scan.js';
import {
  buildShadowCandidates,
  CANDIDATE_KINDS,
  candidatesOf,
  compareCandidates,
  type CandidateInput,
  type ShadowCandidate,
} from '../shadow-candidates.js';
import { buildFixtureGraph, parsedRegistry, type FixtureInput } from './lending-graph.fixture.js';

const host = createModuleHost({ cliVersion: '0.0.0', mode: 'cli', projectRoot: process.cwd() });
const { dataResourceKinds, makeGlobMatcher } = host.services;

const LENDING_CARD = 'docs/domain/lending/domain.md';
const BILLING_CARD = 'docs/domain/billing/domain.md';

const POLICY = 'src/Lending/LoanPolicy.cs';
const CAN_BORROW = `${POLICY}::LoanPolicy.CanBorrow::method`;
const RENEW = `${POLICY}::LoanPolicy.Renew::method`;
const FINES = 'src/Lending/Fines.cs';
const CHARGE = `${FINES}::Fines.Charge::method`;
const RATE = 'src/Lending/scripts/rate.py';
const RATE_MODULE = `${RATE}::rate::variable`;
const MIGRATION = 'db/migrations/lending/001_create_loans.sql';
const LOANS_TABLE = `${MIGRATION}::dbo.loans::table`;
const CLOSE_LOAN = `${MIGRATION}::dbo.close_loan::procedure`;
const TEST_FILE = 'tests/Lending.Tests/LoanLimitTests.cs';
const TEST = `${TEST_FILE}::LoanLimitTests.Max::method`;
const SHARED = 'src/Shared/Clock.cs';
const LOOSE = 'src/Loose.cs';
const INVOICE = 'src/Billing/Invoice.cs';
const SEND = `${INVOICE}::Invoice.Send::method`;

const REGISTRY_TEXT = `version: 1
contexts:
  - id: lending
    name: Lending
    card: ${LENDING_CARD}
    paths: ["src/Lending/**", "tests/Lending.Tests/**", "db/migrations/lending/**", "src/Shared/**"]
    rung: named
    rulePrefix: LEND
  - id: billing
    name: Billing
    card: ${BILLING_CARD}
    paths: ["src/Billing/**", "src/Shared/**"]
    rung: named
    rulePrefix: BILL
`;

const LENDING_TEXT = [
  '# Lending',
  '',
  '## Rules and invariants',
  '### LEND-01 A member holds at most five loans',
  `Code: \`${CAN_BORROW}\``,
  '',
  '### LEND-02 Fines are charged daily',
  `Code: \`${FINES}\``,
  'Untested: covered by manual QA',
  '',
  '### LEND-03 Renewals are limited',
  `Tests: \`${RENEW}\``,
  `Code: \`${CLOSE_LOAN}\``,
  '',
  '### LEND-04 Loans are counted',
  `Tests: \`${TEST}\``,
  `Code: \`${LOANS_TABLE}\``,
  '',
].join('\n');

const BILLING_TEXT = ['# Billing', '', '## Rules and invariants', '### BILL-01 An invoice is sent once', ''].join('\n');

/** 1-based line of a card heading. */
const headingLine = (text: string, heading: string): number => text.split('\n').indexOf(heading) + 1;

type Sym = [name: string, kind: string, start: number, end: number];

function fileIndex(file: string, symbols: Sym[], facts?: CodeFact[]): FileIndex {
  return {
    file,
    lastModified: 1,
    symbols: symbols.map(([name, kind, startLine, endLine]) => ({ symbolId: `${file}::${name}::${kind}`, name, kind, startLine, endLine })) as FileIndex['symbols'],
    edges: [],
    intent: [],
    antiPatterns: [],
    ...(facts === undefined ? {} : { facts }),
  };
}

const fact = (kind: CodeFact['kind'], symbolId: string, line: number, text: string, detail?: Record<string, string>): CodeFact => ({
  kind,
  symbolId,
  line,
  text,
  ...(detail === undefined ? {} : { detail }),
});

function indices(limit = 'openLoans >= 5', limitLine = 4): FileIndex[] {
  return [
    fileIndex(
      POLICY,
      [
        ['LoanPolicy', 'class', 0, 20],
        ['LoanPolicy.CanBorrow', 'method', 2, 8],
        ['LoanPolicy.Renew', 'method', 10, 15],
      ],
      [fact('literal-comparison', CAN_BORROW, limitLine, limit), fact('normalization', RENEW, 11, 'email.Trim()')],
    ),
    fileIndex(FINES, [
      ['Fines', 'class', 0, 9],
      ['Fines.Charge', 'method', 2, 8],
    ]),
    fileIndex(
      MIGRATION,
      [
        ['dbo.loans', 'table', 0, 5],
        ['dbo.open_loans', 'view', 10, 12],
        ['dbo.close_loan', 'procedure', 20, 30],
        ['dbo.open_loan', 'procedure', 40, 50],
      ],
      [],
    ),
    fileIndex(
      TEST_FILE,
      [
        ['LoanLimitTests', 'class', 0, 20],
        ['LoanLimitTests.Max', 'method', 2, 8],
        ['dbo.test_loans', 'table', 10, 12],
      ],
      [fact('literal-comparison', TEST, 3, 'loans.Count == 5')],
    ),
    fileIndex(SHARED, [['Clock.Now', 'method', 0, 4]], [fact('retry-timeout', `${SHARED}::Clock.Now::method`, 1, 'Delay = 5s')]),
    fileIndex(LOOSE, [['Loose.Run', 'method', 0, 4]], [fact('literal-comparison', `${LOOSE}::Loose.Run::method`, 1, 'x > 3')]),
    fileIndex(
      INVOICE,
      [
        ['Invoice', 'class', 0, 10],
        ['Invoice.Send', 'method', 2, 8],
      ],
      [fact('endpoint', SEND, 6, 'POST /invoices', { method: 'POST', route: '/invoices' })],
    ),
  ];
}

function textFacts(): Map<string, CodeFact[]> {
  return new Map<string, CodeFact[]>([
    [FINES, [fact('retry-timeout', CHARGE, 3, 'Timeout = 30s', { name: 'Timeout', value: '30s' })]],
    [RATE, [fact('literal-comparison', RATE_MODULE, 0, 'rate > 3')]],
    // An indexed file with a `facts` key keeps its native facts; the text facts are ignored.
    [MIGRATION, [fact('literal-comparison', `${MIGRATION}::dbo.loans::table`, 2, 'n > 7')]],
    ['tests/Lending.Tests/helper.py', [fact('literal-comparison', 'tests/Lending.Tests/helper.py::helper::variable', 0, 'a > 9')]],
    ['src/loose.py', [fact('literal-comparison', 'src/loose.py::loose::variable', 0, 'b > 9')]],
    ['src/Shared/util.py', [fact('literal-comparison', 'src/Shared/util.py::util::variable', 0, 'c > 9')]],
  ]);
}

const RULE_COMMENT: RuleLinks = {
  links: new Map([['LEND-04', [{ id: 'LEND-04', raw: 'LEND-04', file: POLICY, line: 3, kind: 'rule-comment' as const, symbolId: CAN_BORROW }]]]),
  unknown: [],
};

function fixture(fileIndices: FileIndex[], billingText = BILLING_TEXT): FixtureInput {
  return { registryText: REGISTRY_TEXT, cards: { [LENDING_CARD]: LENDING_TEXT, [BILLING_CARD]: billingText }, indices: fileIndices, codeRefs: RULE_COMMENT };
}

function input(fileIndices: FileIndex[] = indices(), facts: ReadonlyMap<string, readonly CodeFact[]> = textFacts(), graph?: GraphIndex): CandidateInput {
  const registry = parsedRegistry(REGISTRY_TEXT);
  return {
    registry,
    ownership: createOwnership(registry, makeGlobMatcher),
    isTestFile: (path) => path.startsWith('tests/'),
    indices: fileIndices,
    textFacts: facts,
    graph: graph ?? indexGraph(buildFixtureGraph(fixture(fileIndices))),
    dataResourceKinds,
  };
}

const FACT_KINDS = ['literal-comparison', 'normalization', 'retry-timeout', 'endpoint'] as const;

describe('buildShadowCandidates', () => {
  it('facts of a context\'s non-test files become candidates with native or text source', () => {
    const all = buildShadowCandidates(input());
    expect(candidatesOf(all, 'lending', FACT_KINDS)).toEqual<ShadowCandidate[]>([
      {
        fingerprint: 'retry-timeout | Fines.Charge | Timeout = 30s',
        kind: 'retry-timeout',
        context: 'lending',
        file: FINES,
        line: 4,
        symbolId: CHARGE,
        text: 'Timeout = 30s',
        detail: { name: 'Timeout', value: '30s' },
        source: 'text',
        resolution: { by: 'rule-link', rules: ['LEND-02'] },
      },
      {
        fingerprint: 'literal-comparison | LoanPolicy.CanBorrow | openLoans >= 5',
        kind: 'literal-comparison',
        context: 'lending',
        file: POLICY,
        line: 5,
        symbolId: CAN_BORROW,
        text: 'openLoans >= 5',
        source: 'native',
        resolution: { by: 'rule-link', rules: ['LEND-01', 'LEND-04'] },
      },
      {
        fingerprint: 'normalization | LoanPolicy.Renew | email.Trim()',
        kind: 'normalization',
        context: 'lending',
        file: POLICY,
        line: 12,
        symbolId: RENEW,
        text: 'email.Trim()',
        source: 'native',
      },
      {
        fingerprint: 'literal-comparison | rate | rate > 3',
        kind: 'literal-comparison',
        context: 'lending',
        file: RATE,
        line: 1,
        symbolId: RATE_MODULE,
        text: 'rate > 3',
        source: 'text',
      },
    ]);
    expect(candidatesOf(all, 'billing', FACT_KINDS)).toEqual<ShadowCandidate[]>([
      {
        fingerprint: 'endpoint | Invoice.Send | POST /invoices',
        kind: 'endpoint',
        context: 'billing',
        file: INVOICE,
        line: 7,
        symbolId: SEND,
        text: 'POST /invoices',
        detail: { method: 'POST', route: '/invoices' },
        source: 'native',
      },
    ]);
  });

  it('writes detail keys in codepoint order, whatever order the fact gave them in', () => {
    const base = input();
    const reordered = {
      ...base,
      indices: base.indices.map((index) => ({
        ...index,
        ...(index.facts === undefined
          ? {}
          : {
              facts: index.facts.map((f) =>
                f.detail === undefined ? f : { ...f, detail: Object.fromEntries(Object.entries(f.detail).reverse()) },
              ),
            }),
      })),
    };
    const bytes = (candidates: readonly ShadowCandidate[]) => JSON.stringify(candidates);
    expect(bytes(buildShadowCandidates(reordered))).toBe(bytes(buildShadowCandidates(base)));
    const endpoint = buildShadowCandidates(reordered).find((c) => c.kind === 'endpoint' && c.detail !== undefined)!;
    expect(Object.keys(endpoint.detail!)).toEqual([...Object.keys(endpoint.detail!)].sort());
  });

  it('facts of test files and of unowned or multiply owned files are left out', () => {
    const all = buildShadowCandidates(input());
    const files = new Set(all.map((c) => c.file));
    for (const file of [TEST_FILE, 'tests/Lending.Tests/helper.py', SHARED, 'src/Shared/util.py', LOOSE, 'src/loose.py']) {
      expect(files.has(file), file).toBe(false);
    }
    // The migration's `facts: []` is native: its text facts give nothing.
    expect(all.filter((c) => c.file === MIGRATION).map((c) => c.kind)).toEqual(['data-resource', 'data-resource', 'procedure', 'procedure']);
    expect(new Set(all.map((c) => c.context))).toEqual(new Set(['lending', 'billing']));
  });

  it('tables, views and procedures owned by the context become candidates with source index', () => {
    const all = buildShadowCandidates(input());
    expect(candidatesOf(all, 'lending', ['data-resource', 'procedure'])).toEqual<ShadowCandidate[]>([
      {
        fingerprint: 'data-resource | dbo.loans | table dbo.loans',
        kind: 'data-resource',
        context: 'lending',
        file: MIGRATION,
        line: 1,
        symbolId: LOANS_TABLE,
        text: 'table dbo.loans',
        source: 'index',
        resolution: { by: 'rule-link', rules: ['LEND-04'] },
      },
      {
        fingerprint: 'data-resource | dbo.open_loans | view dbo.open_loans',
        kind: 'data-resource',
        context: 'lending',
        file: MIGRATION,
        line: 11,
        symbolId: `${MIGRATION}::dbo.open_loans::view`,
        text: 'view dbo.open_loans',
        source: 'index',
      },
      {
        fingerprint: 'procedure | dbo.close_loan | procedure dbo.close_loan',
        kind: 'procedure',
        context: 'lending',
        file: MIGRATION,
        line: 21,
        symbolId: CLOSE_LOAN,
        text: 'procedure dbo.close_loan',
        source: 'index',
        resolution: { by: 'rule-link', rules: ['LEND-03'] },
      },
      {
        fingerprint: 'procedure | dbo.open_loan | procedure dbo.open_loan',
        kind: 'procedure',
        context: 'lending',
        file: MIGRATION,
        line: 41,
        symbolId: `${MIGRATION}::dbo.open_loan::procedure`,
        text: 'procedure dbo.open_loan',
        source: 'index',
      },
    ]);
    // The table of the test file is left out.
    expect(all.some((c) => c.text === 'table dbo.test_loans')).toBe(false);
  });

  it('rules without tests become candidates and an Untested line resolves them', () => {
    const all = buildShadowCandidates(input());
    expect(candidatesOf(all, 'lending', ['rule-without-tests'])).toEqual<ShadowCandidate[]>([
      {
        fingerprint: fingerprint('rule-without-tests', 'LEND-01', 'A member holds at most five loans'),
        kind: 'rule-without-tests',
        context: 'lending',
        file: LENDING_CARD,
        line: headingLine(LENDING_TEXT, '### LEND-01 A member holds at most five loans'),
        ruleId: 'LEND-01',
        text: 'LEND-01 A member holds at most five loans',
        source: 'card',
      },
      {
        fingerprint: 'rule-without-tests | LEND-02 | Fines are charged daily',
        kind: 'rule-without-tests',
        context: 'lending',
        file: LENDING_CARD,
        line: headingLine(LENDING_TEXT, '### LEND-02 Fines are charged daily'),
        ruleId: 'LEND-02',
        text: 'LEND-02 Fines are charged daily',
        source: 'card',
        resolution: { by: 'untested', reason: 'covered by manual QA' },
      },
    ]);
    expect(candidatesOf(all, 'billing', ['rule-without-tests'])).toEqual<ShadowCandidate[]>([
      {
        fingerprint: 'rule-without-tests | BILL-01 | An invoice is sent once',
        kind: 'rule-without-tests',
        context: 'billing',
        file: BILLING_CARD,
        line: 4,
        ruleId: 'BILL-01',
        text: 'BILL-01 An invoice is sent once',
        source: 'card',
      },
    ]);
  });

  it('a Code: link to the symbol or to its file resolves by rule-link; a test link does not', () => {
    const all = buildShadowCandidates(input());
    const bySymbol = (symbolId: string): ShadowCandidate | undefined => all.find((c) => c.symbolId === symbolId);
    // A card Code: line naming the symbol plus a rule: comment on it.
    expect(bySymbol(CAN_BORROW)?.resolution).toEqual({ by: 'rule-link', rules: ['LEND-01', 'LEND-04'] });
    // A card Code: line naming the file.
    expect(bySymbol(CHARGE)?.resolution).toEqual({ by: 'rule-link', rules: ['LEND-02'] });
    // LEND-03's Tests: line names Renew: a test link, no resolution.
    expect(bySymbol(RENEW)?.resolution).toBeUndefined();
    expect(bySymbol(SEND)?.resolution).toBeUndefined();
  });

  it('rule links resolve data-resource and procedure candidates; unlinked ones stay open (M2)', () => {
    const all = buildShadowCandidates(input());
    const bySymbol = (symbolId: string): ShadowCandidate | undefined => all.find((c) => c.symbolId === symbolId);
    expect(bySymbol(LOANS_TABLE)?.resolution).toEqual({ by: 'rule-link', rules: ['LEND-04'] });
    expect(bySymbol(`${MIGRATION}::dbo.open_loans::view`)?.resolution).toBeUndefined();
    expect(bySymbol(CLOSE_LOAN)?.resolution).toEqual({ by: 'rule-link', rules: ['LEND-03'] });
    expect(bySymbol(`${MIGRATION}::dbo.open_loan::procedure`)?.resolution).toBeUndefined();
  });

  it('a fact emitted twice gives one candidate (M1)', () => {
    const twice = indices();
    twice[0] = { ...twice[0]!, facts: [...twice[0]!.facts!, twice[0]!.facts![0]!] };
    const text = textFacts();
    text.set(FINES, [...text.get(FINES)!, ...text.get(FINES)!]);
    expect(buildShadowCandidates(input(twice, text))).toEqual(buildShadowCandidates(input()));
    // Same fingerprint on another line is a second candidate, not a duplicate.
    const otherLine = indices();
    otherLine[0] = { ...otherLine[0]!, facts: [...otherLine[0]!.facts!, { ...otherLine[0]!.facts![0]!, line: 6 }] };
    expect(buildShadowCandidates(input(otherLine)).filter((c) => c.symbolId === CAN_BORROW)).toHaveLength(2);
  });

  it('a rule heading without a title uses the rule ID as its text (N2)', () => {
    const graph = indexGraph(buildFixtureGraph(fixture(indices(), `${BILLING_TEXT}
### BILL-02
`)));
    const untitled = buildShadowCandidates(input(indices(), textFacts(), graph)).find((c) => c.ruleId === 'BILL-02');
    expect(untitled).toMatchObject({ fingerprint: 'rule-without-tests | BILL-02 | BILL-02', text: 'BILL-02', kind: 'rule-without-tests' });
    expect(normalizeFingerprint(untitled!.fingerprint)).toBe(untitled!.fingerprint);
  });

  it('TypeScript members of two classes whose names hold a dot get different fingerprints (N1)', () => {
    const file = 'src/Lending/collections.ts';
    const shelf = `${file}::Shelf.[Symbol.iterator]::method`;
    const queue = `${file}::Queue.[Symbol.iterator]::method`;
    const dotted = `${file}::Queue.'a.b.c'::method`;
    const collections = fileIndex(
      file,
      [
        ['Shelf', 'class', 0, 10],
        ['Shelf.[Symbol.iterator]', 'method', 2, 8],
        ['Queue', 'class', 12, 30],
        ['Queue.[Symbol.iterator]', 'method', 14, 20],
        ["Queue.'a.b.c'", 'method', 22, 28],
      ],
      [fact('literal-comparison', shelf, 4, 'i < 10'), fact('literal-comparison', queue, 16, 'i < 10'), fact('literal-comparison', dotted, 24, 'i < 10')],
    );
    const all = buildShadowCandidates(input([...indices(), collections]));
    expect(all.filter((c) => c.file === file).map((c) => c.fingerprint)).toEqual([
      'literal-comparison | Shelf.[Symbol.iterator] | i < 10',
      'literal-comparison | Queue.[Symbol.iterator] | i < 10',
      "literal-comparison | Queue.'a.b.c' | i < 10",
    ]);
  });

  it('explicit interface implementations of two classes in one context get different fingerprints (M3)', () => {
    const file = 'src/Lending/Models.cs';
    const member = `${file}::Lending.Member.System.IComparable<Lending.Member>.CompareTo::method`;
    const loan = `${file}::Lending.Loan.System.IComparable<Lending.Loan>.CompareTo::method`;
    const dispose = `${file}::Lending.Loan.System.IDisposable.Dispose::method`;
    const models = fileIndex(
      file,
      [
        ['Lending.Member', 'class', 0, 10],
        ['Lending.Member.System.IComparable<Lending.Member>.CompareTo', 'method', 2, 8],
        ['Lending.Loan', 'class', 12, 30],
        ['Lending.Loan.System.IComparable<Lending.Loan>.CompareTo', 'method', 14, 20],
        ['Lending.Loan.System.IDisposable.Dispose', 'method', 22, 28],
      ],
      [fact('literal-comparison', member, 4, 'x.Count >= 5'), fact('literal-comparison', loan, 16, 'x.Count >= 5'), fact('literal-comparison', dispose, 24, 'x.Count >= 5')],
    );
    const all = buildShadowCandidates(input([...indices(), models]));
    const fingerprints = all.filter((c) => c.file === file).map((c) => c.fingerprint);
    expect(fingerprints).toEqual([
      'literal-comparison | Member.IComparable<Lending.Member>.CompareTo | x.Count >= 5',
      'literal-comparison | Loan.IComparable<Lending.Loan>.CompareTo | x.Count >= 5',
      'literal-comparison | Loan.IDisposable.Dispose | x.Count >= 5',
    ]);
  });

  it('a changed literal changes the fingerprint', () => {
    const five = buildShadowCandidates(input(indices('openLoans >= 5')));
    const six = buildShadowCandidates(input(indices('openLoans >= 6')));
    const of = (all: ShadowCandidate[]): string | undefined => all.find((c) => c.symbolId === CAN_BORROW)?.fingerprint;
    expect(of(five)).toBe('literal-comparison | LoanPolicy.CanBorrow | openLoans >= 5');
    expect(of(six)).toBe('literal-comparison | LoanPolicy.CanBorrow | openLoans >= 6');
    // A moved line keeps it.
    const moved = buildShadowCandidates(input(indices('openLoans >= 5', 6)));
    expect(of(moved)).toBe(of(five));
    expect(moved.find((c) => c.symbolId === CAN_BORROW)?.line).toBe(7);
  });

  it('shuffled input gives deep-equal candidates', () => {
    const expected = buildShadowCandidates(input());
    const rand = seeded(7);
    for (let round = 0; round < 5; round++) {
      const shuffledIndices = shuffle(indices(), rand).map((index) => ({
        ...index,
        file: round % 2 === 0 ? index.file : index.file.replace(/\//g, '\\'),
        symbols: shuffle(index.symbols, rand),
        ...(index.facts === undefined ? {} : { facts: shuffle(index.facts, rand) }),
      }));
      const shuffledFacts = new Map(shuffle([...textFacts()], rand).map(([file, facts]) => [file, shuffle(facts, rand)] as const));
      const graph = indexGraph(buildFixtureGraph(fixture(indices())));
      expect(buildShadowCandidates(input(shuffledIndices, shuffledFacts, graph))).toEqual(expected);
    }
  });

  it('candidates are sorted by compareCandidates and every fingerprint is normalized', () => {
    const all = buildShadowCandidates(input());
    expect([...all].sort(compareCandidates)).toEqual(all);
    for (const candidate of all) expect(normalizeFingerprint(candidate.fingerprint)).toBe(candidate.fingerprint);
    expect(all.map((c) => `${c.context} ${c.file} ${c.line} ${c.kind}`)).toEqual([
      `billing ${BILLING_CARD} 4 rule-without-tests`,
      `billing ${INVOICE} 7 endpoint`,
      `lending ${MIGRATION} 1 data-resource`,
      `lending ${MIGRATION} 11 data-resource`,
      `lending ${MIGRATION} 21 procedure`,
      `lending ${MIGRATION} 41 procedure`,
      `lending ${LENDING_CARD} 4 rule-without-tests`,
      `lending ${LENDING_CARD} 7 rule-without-tests`,
      `lending ${FINES} 4 retry-timeout`,
      `lending ${POLICY} 5 literal-comparison`,
      `lending ${POLICY} 12 normalization`,
      `lending ${RATE} 1 literal-comparison`,
    ]);
  });

  it('a fact of an unknown kind is skipped', () => {
    const odd = indices();
    odd[0] = { ...odd[0]!, facts: [...odd[0]!.facts!, { kind: 'mystery', symbolId: CAN_BORROW, line: 1, text: 'x' } as unknown as CodeFact] };
    expect(buildShadowCandidates(input(odd))).toEqual(buildShadowCandidates(input()));
  });

  it('50,000 facts stay linear', () => {
    const files = 500;
    const perFile = 100;
    const big: FileIndex[] = [];
    for (let f = 0; f < files; f++) {
      const file = `src/Lending/gen/File${f}.cs`;
      const symbols: Sym[] = [];
      const facts: CodeFact[] = [];
      for (let s = 0; s < 10; s++) symbols.push([`Gen${f}.M${s}`, 'method', s * 20, s * 20 + 19]);
      for (let k = 0; k < perFile; k++) {
        facts.push(fact('literal-comparison', `${file}::Gen${f}.M${k % 10}::method`, k * 2, `count${k} >= ${k + 2}`));
      }
      big.push(fileIndex(file, symbols, facts));
    }
    const fixtureIndices = [...indices(), ...big];
    const graph = indexGraph(buildFixtureGraph(fixture(fixtureIndices)));
    const scaled = input(fixtureIndices, textFacts(), graph);
    const started = performance.now();
    const all = buildShadowCandidates(scaled);
    const elapsed = performance.now() - started;
    expect(all.length).toBe(files * perFile + 12);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('candidatesOf and compareCandidates', () => {
  it('candidatesOf keeps one context in order and filters by kind; no kinds or an empty list keep every kind', () => {
    const all = buildShadowCandidates(input());
    const lending = candidatesOf(all, 'lending');
    expect(lending.length).toBe(10);
    expect(lending.every((c) => c.context === 'lending')).toBe(true);
    expect(candidatesOf(all, 'lending', [])).toEqual(lending);
    expect(candidatesOf(all, 'lending', ['procedure']).map((c) => c.text)).toEqual(['procedure dbo.close_loan', 'procedure dbo.open_loan']);
    expect(candidatesOf(all, 'nobody')).toEqual([]);
  });

  it('compareCandidates orders by context, file, line, kind order, then fingerprint', () => {
    const base: ShadowCandidate = { fingerprint: 'b', kind: 'endpoint', context: 'x', file: 'f', line: 2, text: 't', source: 'native' };
    expect(compareCandidates({ ...base, context: 'a' }, base)).toBeLessThan(0);
    expect(compareCandidates({ ...base, file: 'F' }, base)).toBeLessThan(0);
    expect(compareCandidates({ ...base, line: 10 }, base)).toBeGreaterThan(0);
    expect(compareCandidates({ ...base, kind: 'literal-comparison' }, base)).toBeLessThan(0);
    expect(compareCandidates({ ...base, kind: 'rule-without-tests' }, base)).toBeGreaterThan(0);
    expect(compareCandidates({ ...base, fingerprint: 'a' }, base)).toBeLessThan(0);
    expect(compareCandidates(base, { ...base })).toBe(0);
    expect(CANDIDATE_KINDS.indexOf('endpoint')).toBe(3);
  });
});

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
