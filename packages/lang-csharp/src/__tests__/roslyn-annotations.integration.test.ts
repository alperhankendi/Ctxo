import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SymbolAnnotation, SymbolNode } from '@ctxo/plugin-api';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';
import { CSharpAdapter } from '../csharp-adapter.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/csharp-v2-sample');
const TESTS_FILE = 'CsharpV2Sample/Tests/LoanPolicyTests.cs';
const TEST_CLASS = 'CsharpV2Sample.Tests.LoanPolicyTests';

describe.skipIf(!HAS_DOTNET)('Roslyn attribute annotations', () => {
  let adapter: RoslynAdapter;
  let symbols: SymbolNode[] = [];

  beforeAll(async () => {
    adapter = new RoslynAdapter();
    await adapter.initialize(FIXTURE_DIR);
    if (adapter.isReady()) {
      await adapter.batchIndex();
    }
    symbols = await adapter.extractSymbols(TESTS_FILE, '');
  }, 120_000);

  afterAll(async () => {
    await adapter.dispose();
  });

  function method(name: string): SymbolNode {
    const symbol = symbols.find(s => s.name === `${TEST_CLASS}.${name}` && s.kind === 'method');
    expect(symbol, `method ${name}`).toBeDefined();
    return symbol!;
  }

  it('MemberHoldsAtMostFiveLoans carries Fact and Trait with resolved types', () => {
    expect(method('MemberHoldsAtMostFiveLoans').annotations).toEqual([
      { name: 'Fact', named: { type: 'Xunit.FactAttribute' } },
      { name: 'Trait', args: ['Rule', 'LEND-03'], named: { type: 'Xunit.TraitAttribute' } },
    ]);
  });

  it('CharacterizesOverdueFees carries Theory then Trait from one attribute list', () => {
    expect(method('CharacterizesOverdueFees').annotations).toEqual([
      { name: 'Theory', named: { type: 'Xunit.TheoryAttribute' } },
      { name: 'Trait', args: ['Kind', 'Characterization'], named: { type: 'Xunit.TraitAttribute' } },
    ]);
  });

  it('UsesAnUnresolvedAttribute falls back to syntax and has no type', () => {
    expect(method('UsesAnUnresolvedAttribute').annotations).toEqual([
      { name: 'Unresolved', args: ['x'], named: { Level: '2' } },
    ]);
  });

  it('HasTwelveArgs flattens the params array and keeps the first 10 values', () => {
    const annotations = method('HasTwelveArgs').annotations;
    expect(annotations).toHaveLength(1);
    expect(annotations![0]!.name).toBe('Args');
    expect(annotations![0]!.args).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(annotations![0]!.named).toEqual({ type: 'CsharpV2Sample.Tests.ArgsAttribute' });
  });

  it('HasALongArg truncates the constant argument to 200 characters', () => {
    const annotations = method('HasALongArg').annotations;
    expect(annotations).toHaveLength(1);
    expect(annotations![0]!.name).toBe('Note');
    expect(annotations![0]!.args).toHaveLength(1);
    expect(annotations![0]!.args![0]).toHaveLength(200);
  });

  it('HasTwentyFiveAttributes keeps the first 20 attributes', () => {
    const annotations = method('HasTwentyFiveAttributes').annotations;
    expect(annotations).toHaveLength(20);
    expect(annotations!.map(a => a.name)).toEqual(Array.from({ length: 20 }, (_, i) => `A${i}`));
  });

  it('the test class itself carries no annotations field', () => {
    const cls = symbols.find(s => s.name === TEST_CLASS && s.kind === 'class');
    expect(cls).toBeDefined();
    expect(cls).not.toHaveProperty('annotations');
  });

  it('HasElevenNamedArgs keeps 10 named entries plus the reserved type', () => {
    const named: Record<string, string> = {};
    for (let i = 1; i <= 10; i++) named[`K${i}`] = String(i);
    expect(method('HasElevenNamedArgs').annotations).toEqual([
      { name: 'Keys', named: { ...named, type: 'CsharpV2Sample.Tests.KeysAttribute' } },
    ]);
  });

  it('qualified, global:: and generic attribute names keep only the last identifier', () => {
    expect(method('HasQualifiedAndGenericNames').annotations).toEqual([
      { name: 'Obsolete', named: { type: 'System.ObsoleteAttribute' } },
      { name: 'Y', named: { type: 'X.YAttribute' } },
      { name: 'Foo', named: { type: 'CsharpV2Sample.Tests.FooAttribute<int>' } },
    ]);
  });

  it('HasASourceTypeKey drops a source argument named type, which is reserved for the resolved class', () => {
    expect(method('HasASourceTypeKey').annotations).toEqual([
      { name: 'Shelf', named: { Level: '2', type: 'CsharpV2Sample.Tests.ShelfAttribute' } },
      { name: 'Unshelved', named: { Level: '3' } },
    ]);
  });

  it('the tree-sitter tier gives the same literal-only annotations without named.type', async () => {
    // Rows whose arguments are all literals must match across tiers once the
    // Roslyn-only named.type is removed. HasALongArg is left out: it passes a
    // const, which only Roslyn resolves. Two documented differences are kept
    // out of the fixture: `name:` arguments (positional constructor arguments
    // in Roslyn, named entries in tree-sitter) and real numbers in exponent
    // form (.NET and JavaScript format them differently).
    const source = readFileSync(resolve(FIXTURE_DIR, TESTS_FILE), 'utf-8');
    const syntaxSymbols = await new CSharpAdapter().extractSymbols(TESTS_FILE, source);
    const methodName = (s: SymbolNode) => s.name.replace(/\(\d+\)$/, '').split('.').pop()!;
    const withoutType = (annotations: readonly SymbolAnnotation[] | undefined) =>
      annotations?.map(({ named, ...rest }) => {
        const { type: _type, ...others } = named ?? {};
        return Object.keys(others).length > 0 ? { ...rest, named: others } : rest;
      });

    const rows = [
      'MemberHoldsAtMostFiveLoans',
      'CharacterizesOverdueFees',
      'UsesAnUnresolvedAttribute',
      'HasTwelveArgs',
      'HasTwentyFiveAttributes',
      'HasElevenNamedArgs',
      'HasQualifiedAndGenericNames',
      'HasASourceTypeKey',
    ];
    for (const row of rows) {
      const syntax = syntaxSymbols.find(s => s.kind === 'method' && methodName(s) === row);
      expect(syntax, `tree-sitter ${row}`).toBeDefined();
      expect(syntax!.annotations, row).toEqual(withoutType(method(row).annotations));
    }
  });
});
