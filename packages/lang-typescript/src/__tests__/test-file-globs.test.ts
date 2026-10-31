import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestFileMatcher } from '../test-file-globs.js';
import { isTestFilePath } from '../test-blocks.js';
import { TsMorphAdapter } from '../ts-morph-adapter.js';

/**
 * The core's DEFAULT_TEST_GLOBS (`hostDefaults`, what a current host sends before any `index.tests` glob) and
 * their TypeScript and JavaScript part (`typescriptFallback`, what `isTestFilePath` implements). The plugin cannot
 * import the CLI; a CLI test pins this fixture to the core list, so a change there fails until it is updated here.
 */
const HOST_GLOBS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'host-test-globs.json'), 'utf-8'),
) as { hostDefaults: string[]; typescriptFallback: string[] };
const HOST_DEFAULTS = HOST_GLOBS.hostDefaults;

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

  it('skips a string glob that does not compile and keeps the rest', () => {
    const matches = createTestFileMatcher(['a'.repeat(70_000), 'spec/**/*.check.ts']);
    expect(matches('spec/a.check.ts')).toBe(true);
    expect(matches('src/__tests__/a.ts')).toBe(false);
    expect(createTestFileMatcher(['a'.repeat(70_000)])).toBe(isTestFilePath);
  });

  it('skips negated globs, so a !**/fixtures/** entry does not turn every file into a test file', () => {
    const matches = createTestFileMatcher([...HOST_DEFAULTS, '!**/fixtures/**']);
    expect(matches('src/loans/policy.ts')).toBe(false);
    expect(matches('src/__tests__/a.ts')).toBe(true);
    expect(createTestFileMatcher(['!**/fixtures/**'])).toBe(isTestFilePath);
  });

  it('the built-in rule is the TypeScript part of the host defaults', () => {
    const fallback = createTestFileMatcher(HOST_GLOBS.typescriptFallback);
    const hostDefaults = createTestFileMatcher(HOST_DEFAULTS);
    const paths = [
      'src/__tests__/a.ts',
      'src/a.test.ts',
      'web/a.spec.js',
      'test/a.ts',
      'tests/e2e/a.ts',
      'src/latest.ts',
      'src/contest/a.ts',
      'src/a.tests.ts',
    ];
    for (const path of paths) {
      expect(fallback(path), path).toBe(isTestFilePath(path));
      expect(hostDefaults(path), path).toBe(isTestFilePath(path));
    }
    // The host defaults add .NET test folders, so a TypeScript file under one is a test file with a current CLI.
    expect(hostDefaults('src/App.Tests/a.ts')).toBe(true);
    expect(isTestFilePath('src/App.Tests/a.ts')).toBe(false);
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

  it('a negated index.tests glob gives no test blocks in a production file', async () => {
    const source = "describe('not a test', () => { it('runs at import', () => {}); });\n";
    const adapter = new TsMorphAdapter({ testGlobs: [...HOST_DEFAULTS, '!**/fixtures/**'] });
    expect(await testBlockNames(adapter, 'src/loans/policy.ts', source)).toEqual([]);
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

  it('the glob order and duplicates do not change the output', async () => {
    const first = await new TsMorphAdapter({ testGlobs: CUSTOM }).extractSymbols(FILE, SOURCE);
    const reordered = await new TsMorphAdapter({ testGlobs: [...CUSTOM].reverse() }).extractSymbols(FILE, SOURCE);
    const duplicated = await new TsMorphAdapter({ testGlobs: [...CUSTOM, ...CUSTOM] }).extractSymbols(FILE, SOURCE);
    expect(first.some((symbol) => symbol.name === 'LoanPolicy')).toBe(true);
    expect(reordered).toEqual(first);
    expect(duplicated).toEqual(first);
  });
});
