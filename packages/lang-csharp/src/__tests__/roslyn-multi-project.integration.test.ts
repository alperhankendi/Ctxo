import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { CodeFact } from '@ctxo/plugin-api';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/csharp-multi-project');
const SHARED = 'Shared/SharedApi.cs';
const APP = 'App/AppApi.cs';

function endpoints(facts: readonly CodeFact[]): string[] {
  return facts.filter(f => f.kind === 'endpoint').map(f => f.text).sort();
}

describe.skipIf(!HAS_DOTNET)('Roslyn route prefixes and test attributes across projects', () => {
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

  it('a controller inherits the Route of a base controller in a referenced project', async () => {
    expect(endpoints(await roslyn.extractFacts(APP, ''))).toEqual(['GET /api/Orders/{id}']);
  });

  it('a public method of a referenced project is not followed; an internal one is', async () => {
    // App calls MapPublic with "/other", outside Shared's compilation: "/s" would be a guess.
    expect(endpoints(await roslyn.extractFacts(SHARED, ''))).toEqual(['GET /pub', 'GET /s/int']);
  });

  it('a test attribute derived from one in a referenced project gets the known base', async () => {
    const symbols = await roslyn.extractSymbols(APP, '');
    const test = symbols.find(s => s.name === 'App.OrdersTests.Retries');
    expect(test?.annotations).toEqual([
      { name: 'RetryFact', named: { type: 'Shared.RetryFactAttribute' } },
      { name: 'Fact', named: { type: 'Xunit.FactAttribute', via: 'Shared.RetryFactAttribute' } },
    ]);
  });
});
