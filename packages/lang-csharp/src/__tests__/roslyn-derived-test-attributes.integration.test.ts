import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SymbolNode } from '@ctxo/plugin-api';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';
import { CSharpAdapter } from '../csharp-adapter.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/csharp-v2-sample');
const TESTS_FILE = 'CsharpV2Sample/Tests/DerivedAttributeTests.cs';
const TEST_CLASS = 'CsharpV2Sample.Tests.DerivedAttributeTests';
const OWN = 'CsharpV2Sample.Tests';

/**
 * The 11 names the host's test-file classifier matches (`TEST_FRAMEWORK_ANNOTATIONS` in
 * `@ctxo/cli`), copied: a plugin never imports the CLI.
 */
const TEST_FRAMEWORK_ANNOTATIONS = new Set([
  'Fact', 'Theory', 'SkippableFact', 'SkippableTheory', 'Test', 'TestCase', 'TestCaseSource', 'TestFixture',
  'TestMethod', 'DataTestMethod', 'TestClass',
]);

describe.skipIf(!HAS_DOTNET)('Roslyn test attributes by base type', () => {
  let adapter: RoslynAdapter;
  let symbols: SymbolNode[] = [];

  beforeAll(async () => {
    adapter = new RoslynAdapter();
    await adapter.initialize(FIXTURE_DIR);
    if (adapter.isReady()) await adapter.batchIndex();
    symbols = await adapter.extractSymbols(TESTS_FILE, '');
  }, 120_000);

  afterAll(async () => {
    await adapter.dispose();
  });

  function annotationsOf(name: string): SymbolNode['annotations'] {
    const symbol = symbols.find(s => s.name === `${TEST_CLASS}.${name}` && s.kind === 'method');
    expect(symbol, `method ${name}`).toBeDefined();
    return symbol!.annotations;
  }

  function isMarkedAsTest(name: string): boolean {
    return annotationsOf(name)?.some(a => TEST_FRAMEWORK_ANNOTATIONS.has(a.name)) === true;
  }

  it('an attribute derived from FactAttribute is followed by Fact', () => {
    expect(annotationsOf('Direct')).toEqual([
      { name: 'RetryFact', named: { type: `${OWN}.RetryFactAttribute` } },
      { name: 'Fact', named: { type: 'Xunit.FactAttribute', via: `${OWN}.RetryFactAttribute` } },
    ]);
  });

  it('two levels of inheritance resolve to the framework attribute, before the next annotation', () => {
    expect(annotationsOf('TwoLevels')).toEqual([
      { name: 'SlowRetryFact', named: { type: `${OWN}.SlowRetryFactAttribute` } },
      { name: 'Fact', named: { type: 'Xunit.FactAttribute', via: `${OWN}.SlowRetryFactAttribute` } },
      { name: 'Trait', args: ['Rule', 'LEND-09'], named: { type: 'Xunit.TraitAttribute' } },
    ]);
  });

  it('the nearest known base wins: TheoryAttribute, not its own base FactAttribute', () => {
    expect(annotationsOf('FromTheory')!.map(a => a.name)).toEqual(['LoanTheory', 'Theory']);
  });

  it('NUnit and MSTest bases resolve too', () => {
    expect(annotationsOf('FromNUnitTest')!.map(a => a.name)).toEqual(['SmokeTest', 'Test']);
    expect(annotationsOf('FromMSTestTestMethod')!.map(a => a.name)).toEqual(['IntegrationTestMethod', 'TestMethod']);
  });

  it('look-alike names that derive from no test attribute get nothing', () => {
    expect(annotationsOf('LookAlikes')).toEqual([
      { name: 'Factory', named: { type: `${OWN}.FactoryAttribute` } },
      { name: 'Facts', named: { type: `${OWN}.FactsAttribute` } },
    ]);
    expect(isMarkedAsTest('LookAlikes')).toBe(false);
  });

  it('a known name already on the declaration is not repeated', () => {
    expect(annotationsOf('KnownNameAlreadyThere')!.map(a => a.name)).toEqual(['Fact', 'RetryFact']);
  });

  it('the host classifier sees every derived test method as a test, without knowing the derived names', () => {
    for (const name of ['Direct', 'TwoLevels', 'FromTheory', 'FromNUnitTest', 'FromMSTestTestMethod']) {
      expect(isMarkedAsTest(name), name).toBe(true);
    }
  });

  it('the tree-sitter tier stays name-based', async () => {
    const source = readFileSync(resolve(FIXTURE_DIR, TESTS_FILE), 'utf-8');
    const syntax = await new CSharpAdapter().extractSymbols(TESTS_FILE, source);
    const direct = syntax.find(s => s.kind === 'method' && s.name.replace(/\(\d*\)$/, '').endsWith('.Direct'));
    expect(direct?.annotations).toEqual([{ name: 'RetryFact' }]);
  });
});
