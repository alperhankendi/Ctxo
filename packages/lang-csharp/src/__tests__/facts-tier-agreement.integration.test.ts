import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CodeFact } from '@ctxo/plugin-api';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';
import { CSharpAdapter } from '../csharp-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/csharp-v2-sample');
const FACTS_DIR = 'CsharpV2Sample/Facts';
const FILES = readdirSync(resolve(FIXTURE_DIR, FACTS_DIR)).filter(name => name.endsWith('.cs')).sort();

/** The comparable shape: the syntax tier's `(n)` parameter count dropped from the symbol ID. */
function comparable(facts: readonly CodeFact[]): string[] {
  return facts
    .map(({ kind, line, text, detail, symbolId }) =>
      JSON.stringify({ kind, line, text, detail, symbolId: symbolId.replace(/\(\d+\)(?=::)/, '') }))
    .sort();
}

describe.skipIf(!HAS_DOTNET)('C# fact tier agreement', () => {
  let roslyn: RoslynAdapter;

  beforeAll(async () => {
    roslyn = new RoslynAdapter({ facts: DEFAULT_FACT_OPTIONS });
    await roslyn.initialize(FIXTURE_DIR);
    expect(roslyn.isReady()).toBe(true);
    expect((await roslyn.batchIndex()).ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await roslyn.dispose();
  });

  it('the samples hold every Facts file', () => {
    expect(FILES).toEqual(['Endpoints.cs', 'LoanPolicy.cs', 'LoansController.cs', 'MemberDirectory.cs', 'Program.cs', 'RenewalRules.cs', 'RetryNames.cs', 'ShelfController.cs']);
  });

  it('accepted difference: an explicit implementation of an interface from another namespace, written by its simple name', async () => {
    const path = 'CsharpV2Sample/KnownDifferences/ExternalRenewal.cs';
    const full = await roslyn.extractFacts(path, '');
    const syntax = await new CSharpAdapter({ facts: DEFAULT_FACT_OPTIONS })
      .extractFacts(path, readFileSync(resolve(FIXTURE_DIR, path), 'utf-8'));
    expect(full.map(f => `${f.text} ${f.symbolId}`)).toEqual([
      `days > 21 ${path}::Lending.Facts.Differences.ExternalRenewal.Lending.Facts.Contracts.IExtendable.Extend::method`,
    ]);
    expect(syntax.map(f => `${f.text} ${f.symbolId}`)).toEqual([
      `days > 21 ${path}::Lending.Facts.Differences.ExternalRenewal.Lending.Facts.Differences.IExtendable.Extend::method`,
    ]);
  });

  it.each(FILES)('both tiers give the same facts: %s', async (file) => {
    const path = `${FACTS_DIR}/${file}`;
    const full = await roslyn.extractFacts(path, '');
    const syntax = await new CSharpAdapter({ facts: DEFAULT_FACT_OPTIONS })
      .extractFacts(path, readFileSync(resolve(FIXTURE_DIR, path), 'utf-8'));
    expect(full.length).toBeGreaterThan(0);
    expect(comparable(syntax)).toEqual(comparable(full));
  });
});
