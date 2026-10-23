import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

// A lone project file with no .sln or .slnx anywhere under the fixture.
const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/csharp-csproj-only');

describe.skipIf(!HAS_DOTNET)('Roslyn lone .csproj loading', () => {
  let adapter: RoslynAdapter;

  beforeAll(async () => {
    adapter = new RoslynAdapter();
    await adapter.initialize(FIXTURE_DIR);
    if (adapter.isReady()) {
      await adapter.batchIndex();
    }
  }, 120_000);

  afterAll(async () => {
    await adapter.dispose();
  });

  it('a repository with a lone .csproj and no solution yields symbols', async () => {
    expect(adapter.isReady()).toBe(true);

    const symbols = await adapter.extractSymbols('Loans/Loan.cs', '');
    const names = symbols.map(s => `${s.name}::${s.kind}`);
    expect(names).toContain('CsprojOnly.Loans.Loan::class');
    expect(names).toContain('CsprojOnly.Loans.Loan.RenewalsLeft::method');
  });
});
