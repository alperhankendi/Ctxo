import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { RoslynAdapter } from '../roslyn/roslyn-adapter.js';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]!, 10) >= 8;
  } catch { return false; }
})();

const FIXTURE_DIR = join(import.meta.dirname, '../../../../tests/e2e/fixtures/csharp-sample');

describe.skipIf(!HAS_DOTNET)('RoslynAdapter integration', () => {
  const adapter = new RoslynAdapter();

  afterAll(async () => {
    await adapter.dispose();
  });

  it('initializes with fixture project', async () => {
    await adapter.initialize(FIXTURE_DIR);
    expect(adapter.isReady()).toBe(true);
  });

  it('batch indexes all .cs files', async () => {
    const result = await adapter.batchIndex();
    expect(result).not.toBeNull();
    expect(result!.totalFiles).toBeGreaterThanOrEqual(5);
    expect(result!.files.length).toBeGreaterThanOrEqual(5);
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
    expect(getUserDisplay!.cyclomatic).toBeGreaterThanOrEqual(2); // has if branch
  });

  it('distinguishes extends from implements semantically (no I-prefix heuristic)', async () => {
    const jobEdges = await adapter.extractEdges('CsharpSample/Jobs/UserSyncJob.cs', '');
    const svcEdges = await adapter.extractEdges('CsharpSample/Services/UserService.cs', '');

    // UserSyncJob -> BaseSyncJob = extends (not implements, even though BaseSyncJob is not I-prefixed)
    const extendsEdge = jobEdges.find(e => e.kind === 'extends');
    expect(extendsEdge).toBeDefined();
    expect(extendsEdge!.to).toContain('BaseSyncJob');

    // UserService -> IUserRepository = implements (correctly identified as interface)
    const implEdge = svcEdges.find(e => e.kind === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge!.to).toContain('IUserRepository');
  });
});
