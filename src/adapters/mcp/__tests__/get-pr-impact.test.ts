import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { JsonIndexWriter } from '../../storage/json-index-writer.js';
import { handleGetPrImpact } from '../get-pr-impact.js';
import type { IGitPort } from '../../../ports/i-git-port.js';
import type { FileIndex } from '../../../core/types.js';

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
    rmSync(tempDir, { recursive: true, force: true });
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
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~1' });
    const payload = JSON.parse(result.content[0]!.text);

    const file = payload.files.find((f: { file: string }) => f.file === 'src/a.ts');
    expect(file).toBeDefined();
    expect(file.coChangedWith).toBeDefined();
    expect(file.coChangedWith).toContain('src/b.ts');
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

  it('returns error for invalid input', async () => {
    const git = createMockGit([]);
    const handler = handleGetPrImpact(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ maxFiles: -1 });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBe(true);
  });
});
