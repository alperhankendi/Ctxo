import { describe, it, expect } from 'vitest';
import { createTestFileMatcher } from '../test-file-globs.js';
import { isTestFilePath } from '../test-blocks.js';
import { TsMorphAdapter } from '../ts-morph-adapter.js';

/** The core's DEFAULT_TEST_GLOBS, as a current host sends them before any `index.tests` glob. */
const HOST_DEFAULTS = [
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test/**',
  '**/tests/**',
  '**/*_test.go',
  '**/src/test/**',
  '**/*.Tests/**',
  '**/*.Test/**',
  '**/*Tests.cs',
  '**/*Test.cs',
  '**/test_*.py',
  '**/*_test.py',
];

const CUSTOM = [...HOST_DEFAULTS, 'spec/**/*.check.ts'];
const FILE = 'spec/loans/policy.check.ts';

const SOURCE = [
  "describe('LoanPolicy', () => {",
  "  it('LEND-03 a member holds at most five loans', () => {});",
  '});',
  '',
].join('\n');

async function testBlockNames(adapter: TsMorphAdapter, file: string, source = SOURCE): Promise<string[]> {
  const symbols = await adapter.extractSymbols(file, source);
  return symbols.filter((s) => s.annotations?.some((a) => a.name === 'test') === true).map((s) => s.name);
}

describe('createTestFileMatcher', () => {
  it('without host globs it is the built-in default rule', () => {
    expect(createTestFileMatcher(undefined)).toBe(isTestFilePath);
  });

  it('falls back to the default rule when no given value is a usable glob', () => {
    expect(createTestFileMatcher([])).toBe(isTestFilePath);
    expect(createTestFileMatcher([42, '', null])).toBe(isTestFilePath);
  });

  it('matches like the core: picomatch with dot, either separator', () => {
    const matches = createTestFileMatcher(CUSTOM);
    expect(matches('spec/loans/policy.check.ts')).toBe(true);
    expect(matches('spec\\loans\\policy.check.ts')).toBe(true);
    expect(matches('src/__tests__/a.ts')).toBe(true);
    expect(matches('.config/__tests__/a.ts')).toBe(true);
    expect(matches('src/loans/policy.ts')).toBe(false);
    expect(matches('spec/loans/policy.ts')).toBe(false);
  });

  it('skips a value that is not a glob and keeps the rest', () => {
    const matches = createTestFileMatcher([42, 'spec/**/*.check.ts']);
    expect(matches('spec/a.check.ts')).toBe(true);
    expect(matches('src/__tests__/a.ts')).toBe(false);
  });

  it('the host defaults agree with the built-in rule on TypeScript paths', () => {
    const matches = createTestFileMatcher(HOST_DEFAULTS);
    const paths = [
      'src/__tests__/a.ts',
      'src/a.test.ts',
      'web/a.spec.js',
      'test/a.ts',
      'tests/e2e/a.ts',
      'src/şube kaydı/b.test.tsx',
      'src/latest.ts',
      'src/contest/a.ts',
      'src/testing.ts',
      'src/a.tests.ts',
      'src/attest.spec-helper.ts',
    ];
    for (const path of paths) expect(matches(path), path).toBe(isTestFilePath(path));
  });
});

describe('test blocks follow the host test globs', () => {
  it('a custom index.tests glob makes test blocks appear in a file the defaults do not treat as a test', async () => {
    expect(await testBlockNames(new TsMorphAdapter(), FILE)).toEqual([]);
    expect(await testBlockNames(new TsMorphAdapter({ testGlobs: CUSTOM }), FILE)).toEqual([
      'LoanPolicy',
      'LoanPolicy > LEND-03 a member holds at most five loans',
    ]);
  });

  it('host globs replace the built-in rule: a default-only path is no test file when the host leaves it out', async () => {
    expect(await testBlockNames(new TsMorphAdapter({ testGlobs: ['spec/**/*.check.ts'] }), 'src/a.test.ts')).toEqual([]);
  });

  it('test-block edges and fact owners use the same rule', async () => {
    const source = [
      'export function loanCount(n: number): number { return n; }',
      "describe('LoanPolicy', () => {",
      "  it('checks', () => { if (loanCount(3) === 5) { return; } });",
      '});',
      '',
    ].join('\n');
    const adapter = new TsMorphAdapter({
      testGlobs: CUSTOM,
      facts: { trivialLiterals: [0, 1, -1, null, true, false, ''], normalizationMethods: [] },
    });
    const blockId = `${FILE}::LoanPolicy > checks::function`;
    const edges = await adapter.extractEdges(FILE, source);
    expect(edges.some((e) => e.from === blockId)).toBe(true);
    const facts = await adapter.extractFacts(FILE, source);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.symbolId === blockId)).toBe(true);
  });

  it('the output is the same on every run', async () => {
    const first = await new TsMorphAdapter({ testGlobs: CUSTOM }).extractSymbols(FILE, SOURCE);
    const second = await new TsMorphAdapter({ testGlobs: CUSTOM }).extractSymbols(FILE, SOURCE);
    expect(second).toEqual(first);
  });
});
