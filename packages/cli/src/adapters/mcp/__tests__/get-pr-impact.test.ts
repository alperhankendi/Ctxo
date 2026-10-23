import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { JsonIndexWriter } from '../../storage/json-index-writer.js';
import { CoChangeReader } from '../../storage/co-change-reader.js';
import { handleGetPrImpact } from '../get-pr-impact.js';
import type { ICoChangePort } from '../../../ports/i-co-change-port.js';
import type { IGitPort } from '../../../ports/i-git-port.js';
import type { CommunitySnapshot, FileIndex } from '../../../core/types.js';

function buildIndices(): FileIndex[] {
  return [
    {
      file: 'src/a.ts',
      lastModified: 1,
      symbols: [
        { symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 10 },
      ],
      edges: [
        { from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'calls' },
      ],
      intent: [{ hash: 'c1', message: 'init', date: '2026-01-01', kind: 'commit' as const }],
      antiPatterns: [],
    },
    {
      file: 'src/b.ts',
      lastModified: 1,
      symbols: [
        { symbolId: 'src/b.ts::B::class', name: 'B', kind: 'class', startLine: 1, endLine: 30 },
      ],
      edges: [
        { from: 'src/b.ts::B::class', to: 'src/c.ts::C::interface', kind: 'implements' },
      ],
      intent: [{ hash: 'c1', message: 'init', date: '2026-01-01', kind: 'commit' as const }],
      antiPatterns: [],
    },
    {
      file: 'src/c.ts',
      lastModified: 1,
      symbols: [
        { symbolId: 'src/c.ts::C::interface', name: 'C', kind: 'interface', startLine: 1, endLine: 5 },
      ],
      edges: [],
      intent: [{ hash: 'c2', message: 'add interface', date: '2026-01-02', kind: 'commit' as const }],
      antiPatterns: [],
    },
  ];
}

function createMockGit(changedFiles: string[]): IGitPort {
  return {
    getCommitHistory: async () => [],
    getFileChurn: async () => ({ filePath: '', commitCount: 0 }),
    getChangedFiles: async () => changedFiles,
    isAvailable: async () => true,
  };
}

describe('handleGetPrImpact', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-pr-impact-'));
    const writer = new JsonIndexWriter(tempDir);
    for (const idx of buildIndices()) {
      writer.write(idx);
    }
    // Write co-changes
    writer.writeCoChanges({
      version: 1,
      timestamp: 1000,
      entries: [{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 5, frequency: 0.8 }],
    });

    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('returns impact analysis for changed files', async () => {
    const git = createMockGit(['src/c.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.changedFiles).toBe(1);
    expect(payload.changedSymbols).toBeGreaterThan(0);
    expect(payload.riskLevel).toBeDefined();
    expect(['low', 'medium', 'high']).toContain(payload.riskLevel);
  });

  it('returns blast radius per changed symbol', async () => {
    const git = createMockGit(['src/c.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    const file = payload.files.find((f: { file: string }) => f.file === 'src/c.ts');
    expect(file).toBeDefined();
    expect(file.symbols.length).toBeGreaterThan(0);

    const sym = file.symbols[0];
    expect(sym.blast).toBeDefined();
    expect(sym.blast.impactScore).toBeGreaterThanOrEqual(0);
    expect(typeof sym.blast.riskScore).toBe('number');
  });

  it('a new migration copy of a procedure reports the impact of the procedure', async () => {
    const PROC_V1 = 'db/migrations/V1__init.sql::dbo.usp_close::procedure';
    const PROC_V7 = 'db/migrations/V7__close_fix.sql::dbo.usp_close::procedure';
    const procedureFile = (file: string, symbolId: string): FileIndex => ({
      file,
      lastModified: 1,
      symbols: [{ symbolId, name: 'dbo.usp_close', kind: 'procedure', startLine: 1, endLine: 9 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    });
    const writer = new JsonIndexWriter(tempDir);
    writer.write(procedureFile('db/migrations/V1__init.sql', PROC_V1));
    writer.write(procedureFile('db/migrations/V7__close_fix.sql', PROC_V7));
    // Two executors; every executes edge resolves to the winning copy, V1.
    for (const name of ['Close', 'Renew']) {
      const symbolId = `src/LoanService${name}.cs::Lending.LoanService.${name}::method`;
      writer.write({
        file: `src/LoanService${name}.cs`,
        lastModified: 1,
        symbols: [{ symbolId, name: `Lending.LoanService.${name}`, kind: 'method', startLine: 1, endLine: 9 }],
        edges: [{ from: symbolId, to: 'dbo.usp_close::procedure', kind: 'executes' }],
        intent: [],
        antiPatterns: [],
      });
    }

    const handler = handleGetPrImpact(storage, createMockGit(['db/migrations/V7__close_fix.sql']), new MaskingPipeline(), undefined, tempDir);
    const payload = JSON.parse((await handler({ since: 'HEAD~1' })).content[0]!.text);

    const [symbol] = payload.files.find((f: { file: string }) => f.file === 'db/migrations/V7__close_fix.sql').symbols;
    expect(symbol.symbolId).toBe(PROC_V7);
    expect(symbol.blast.confirmedCount).toBe(2);
    expect(symbol.blast.topImpacted.map((s: { symbolId: string }) => s.symbolId).sort()).toEqual([
      'src/LoanServiceClose.cs::Lending.LoanService.Close::method',
      'src/LoanServiceRenew.cs::Lending.LoanService.Renew::method',
    ]);
    expect(payload.summary.confirmedTotal).toBe(2);
  });

  it('returns summary with confirmed/likely/potential totals', async () => {
    const git = createMockGit(['src/c.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(typeof payload.summary.confirmedTotal).toBe('number');
    expect(typeof payload.summary.likelyTotal).toBe('number');
    expect(typeof payload.summary.potentialTotal).toBe('number');
    expect(payload.summary.confirmedTotal + payload.summary.likelyTotal + payload.summary.potentialTotal).toBe(payload.totalImpact);
  });

  it('returns empty result for no changed files', async () => {
    const git = createMockGit([]);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.changedFiles).toBe(0);
    expect(payload.totalImpact).toBe(0);
    expect(payload.riskLevel).toBe('low');
  });

  it('includes coChangedWith when co-change data exists', async () => {
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir, undefined, new CoChangeReader(tempDir));
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    const file = payload.files.find((f: { file: string }) => f.file === 'src/a.ts');
    expect(file).toBeDefined();
    expect(file.coChangedWith).toBeDefined();
    expect(file.coChangedWith).toContain('src/b.ts');
  });

  it('lists coChangedWith strongest first from the real reader, whose lists are frozen', async () => {
    new JsonIndexWriter(tempDir).writeCoChanges({
      version: 1,
      timestamp: 1000,
      entries: [
        { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 2, frequency: 0.3 },
        { file1: 'src/a.ts', file2: 'src/c.ts', sharedCommits: 6, frequency: 0.9 },
      ],
    });
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir, undefined, new CoChangeReader(tempDir));
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    // Sorting the list in place would throw on the frozen list and turn this into an error payload.
    expect(payload.error).toBeUndefined();
    const file = payload.files.find((f: { file: string }) => f.file === 'src/a.ts');
    expect(file.coChangedWith).toEqual(['src/c.ts', 'src/b.ts']);
  });

  it('reads co-change through the injected port, not from co-changes.json itself', async () => {
    // The file on disk pairs a.ts with b.ts; the port says a.ts goes with c.ts.
    const port: ICoChangePort = {
      readCoChangeMap: () => new Map([
        ['src/a.ts', [{ file1: 'src/a.ts', file2: 'src/c.ts', sharedCommits: 3, frequency: 0.6 }]],
      ]),
    };
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir, undefined, port);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    const file = payload.files.find((f: { file: string }) => f.file === 'src/a.ts');
    expect(file.coChangedWith).toEqual(['src/c.ts']);
  });

  it('reports no coChangedWith when no co-change port is wired', async () => {
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    const file = payload.files.find((f: { file: string }) => f.file === 'src/a.ts');
    expect(file).toBeDefined();
    expect(file).not.toHaveProperty('coChangedWith');
  });

  it('does not reorder the shared co-change map when it lists the partners of a file', async () => {
    // The reader hands every caller the same cached map: get_pr_impact must not sort its lists in place.
    const strong = { file1: 'src/a.ts', file2: 'src/c.ts', sharedCommits: 6, frequency: 0.9 };
    const weak = { file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 2, frequency: 0.3 };
    const shared = [weak, strong];
    const port: ICoChangePort = { readCoChangeMap: () => new Map([['src/a.ts', shared]]) };
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir, undefined, port);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    const file = payload.files.find((f: { file: string }) => f.file === 'src/a.ts');
    expect(file.coChangedWith).toEqual(['src/c.ts', 'src/b.ts']);
    expect(shared).toEqual([weak, strong]);
  });

  it('applies confidence filter', async () => {
    const git = createMockGit(['src/c.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1', confidence: 'confirmed' });
    const payload = JSON.parse(result.content[0]!.text);

    // All impacted should be confirmed only
    for (const file of payload.files) {
      for (const sym of file.symbols) {
        for (const imp of sym.blast.topImpacted) {
          expect((imp as { confidence: string }).confidence).toBe('confirmed');
        }
      }
    }
  });

  it('changedFiles counts only indexed source files, not raw git paths', async () => {
    const git = createMockGit(['src/a.ts', 'tests/a.test.ts', '.eslintrc.js', 'README.md']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    // Only src/a.ts is in the index — others should not inflate changedFiles
    expect(payload.changedFiles).toBe(1);
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].file).toBe('src/a.ts');
  });

  it('respects maxFiles limit', async () => {
    const git = createMockGit(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1', maxFiles: 1 });
    const payload = JSON.parse(result.content[0]!.text);

    // Only the first file should be processed despite 3 changed files
    expect(payload.files.length).toBeLessThanOrEqual(1);
    expect(payload.changedFiles).toBeLessThanOrEqual(1);
  });

  it('returns error for invalid input', async () => {
    const git = createMockGit([]);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ maxFiles: -1 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBe(true);
  });

  it('surfaces boundaryViolations + clustersAffected when a snapshot is available', async () => {
    storage.writeCommunities({
      version: 1,
      computedAt: '2026-04-16T10:00:00.000Z',
      commitSha: 'abc1234',
      modularity: 0.5,
      communities: [
        { symbolId: 'src/a.ts::A::function', communityId: 0, communityLabel: 'alpha' },
        { symbolId: 'src/b.ts::B::class', communityId: 1, communityLabel: 'beta' },
        { symbolId: 'src/c.ts::C::interface', communityId: 2, communityLabel: 'gamma' },
      ],
      godNodes: [],
      edgeQuality: 'full',
      crossClusterEdges: 2,
    });
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.boundaryViolations).toBeDefined();
    expect(payload.clustersAffected).toBeDefined();
    expect(Array.isArray(payload.clustersAffected)).toBe(true);
  });

  it('get_pr_impact boundaryViolations carries distinctCommits', async () => {
    const snapshotAt = (commitSha: string): CommunitySnapshot => ({
      version: 1,
      computedAt: '2026-04-16T10:00:00.000Z',
      commitSha,
      modularity: 0.5,
      communities: [
        { symbolId: 'src/a.ts::A::function', communityId: 0, communityLabel: 'alpha' },
        { symbolId: 'src/b.ts::B::class', communityId: 1, communityLabel: 'beta' },
        { symbolId: 'src/c.ts::C::interface', communityId: 2, communityLabel: 'gamma' },
      ],
      godNodes: [],
      edgeQuality: 'full',
      crossClusterEdges: 2,
    });
    storage.writeCommunities(snapshotAt('abc1234'));
    // Three history snapshots over two commits: two files for sha1, one for sha2.
    vi.spyOn(storage, 'listCommunityHistory').mockReturnValue([
      snapshotAt('sha1'),
      snapshotAt('sha1'),
      snapshotAt('sha2'),
    ]);
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);

    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.boundaryViolations).toBeDefined();
    expect(payload.boundaryViolations.distinctCommits).toBe(2);
    expect(payload.boundaryViolations.snapshotsAvailable).toBe(3);
    expect(payload.boundaryViolations.confidence).toBe('low');
  });
});
