import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

// BUG 2 FIX: Use absolute path to prevent CWD-dependent resolution
const FIXTURE_DIR = resolve(import.meta.dirname, '../../../../tests/e2e/fixtures/csharp-sample');

describe.skipIf(!HAS_DOTNET)('RoslynAdapter integration', () => {
  let adapter: RoslynAdapter;

  // BUG 2 FIX: Initialize + batchIndex in beforeAll, not in first it() block.
  // This ensures consistent state regardless of test execution order.
  beforeAll(async () => {
    adapter = new RoslynAdapter();
    await adapter.initialize(FIXTURE_DIR);
    if (adapter.isReady()) {
      await adapter.batchIndex();
    }
  }, 60_000); // 60s timeout for solution load

  afterAll(async () => {
    await adapter.dispose();
  });

  it('initializes with fixture project', () => {
    expect(adapter.isReady()).toBe(true);
  });

  it('batch indexes all .cs files', async () => {
    // batchIndex already called in beforeAll, verify cache is populated
    const symbols = await adapter.extractSymbols('CsharpSample/Services/UserService.cs', '');
    expect(symbols.length).toBeGreaterThan(0);
  });

  it('extracts symbols from UserService.cs', async () => {
    const symbols = await adapter.extractSymbols('CsharpSample/Services/UserService.cs', '');
    expect(symbols.length).toBeGreaterThan(0);

    const cls = symbols.find(s => s.name.includes('UserService') && s.kind === 'class');
    expect(cls).toBeDefined();
    expect(cls!.symbolId).toContain('::class');
  });

  it('extracts implements edge (UserService -> IUserRepository)', async () => {
    const edges = await adapter.extractEdges('CsharpSample/Services/UserService.cs', '');

    const implEdge = edges.find(e => e.kind === 'implements' && e.to.includes('IUserRepository'));
    expect(implEdge).toBeDefined();
  });

  it('extracts extends edge (UserSyncJob -> BaseSyncJob)', async () => {
    const edges = await adapter.extractEdges('CsharpSample/Jobs/UserSyncJob.cs', '');

    const extendsEdge = edges.find(e => e.kind === 'extends' && e.to.includes('BaseSyncJob'));
    expect(extendsEdge).toBeDefined();
  });

  it('extracts calls edge (UserSyncJob.ExecuteAsync -> UserService.GetAll)', async () => {
    const edges = await adapter.extractEdges('CsharpSample/Jobs/UserSyncJob.cs', '');

    const callEdge = edges.find(e => e.kind === 'calls' && e.to.includes('GetAll'));
    expect(callEdge).toBeDefined();
  });

  it('extracts calls edge (UserService.GetUserDisplay -> User.GetDisplayName)', async () => {
    const edges = await adapter.extractEdges('CsharpSample/Services/UserService.cs', '');

    const callEdge = edges.find(e => e.kind === 'calls' && e.to.includes('GetDisplayName'));
    expect(callEdge).toBeDefined();
  });

  it('calculates complexity', async () => {
    const complexity = await adapter.extractComplexity('CsharpSample/Services/UserService.cs', '');
    expect(complexity.length).toBeGreaterThan(0);

    const getUserDisplay = complexity.find(c => c.symbolId.includes('GetUserDisplay'));
    expect(getUserDisplay).toBeDefined();
    expect(getUserDisplay!.cyclomatic).toBeGreaterThanOrEqual(2);
  });

  it('distinguishes extends from implements semantically (no I-prefix heuristic)', async () => {
    const jobEdges = await adapter.extractEdges('CsharpSample/Jobs/UserSyncJob.cs', '');
    const svcEdges = await adapter.extractEdges('CsharpSample/Services/UserService.cs', '');

    const extendsEdge = jobEdges.find(e => e.kind === 'extends');
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge!.to).toContain('BaseSyncJob');

    const implEdge = svcEdges.find(e => e.kind === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge!.to).toContain('IUserRepository');
  });

  it('symbols have byte offsets (startOffset/endOffset)', async () => {
    const symbols = await adapter.extractSymbols('CsharpSample/Models/User.cs', '');
    expect(symbols.length).toBeGreaterThan(0);

    for (const sym of symbols) {
      expect(sym.startOffset).toBeDefined();
      expect(sym.endOffset).toBeDefined();
      expect(sym.endOffset!).toBeGreaterThanOrEqual(sym.startOffset!);
    }
  });
});
