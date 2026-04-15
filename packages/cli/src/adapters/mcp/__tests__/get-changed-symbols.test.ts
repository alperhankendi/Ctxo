import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { JsonIndexWriter } from '../../storage/json-index-writer.js';
import { handleGetChangedSymbols } from '../get-changed-symbols.js';
import type { IGitPort } from '../../../ports/i-git-port.js';
import type { FileIndex } from '../../../core/types.js';

function buildIndices(): FileIndex[] {
  return [
    {
      file: 'src/a.ts',
      lastModified: 1,
      symbols: [
        { symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 10 },
        { symbolId: 'src/a.ts::B::function', name: 'B', kind: 'function', startLine: 12, endLine: 20 },
      ],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/b.ts',
      lastModified: 1,
      symbols: [
        { symbolId: 'src/b.ts::C::class', name: 'C', kind: 'class', startLine: 1, endLine: 50 },
      ],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/c.ts',
      lastModified: 1,
      symbols: [
        { symbolId: 'src/c.ts::D::interface', name: 'D', kind: 'interface', startLine: 1, endLine: 5 },
      ],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
  ];
}

function createMockGit(changedFiles: string[]): IGitPort {
  return {
    getCommitHistory: async () => [],
    getFileChurn: async (fp: string) => ({ filePath: fp, commitCount: 0 }),
    getChangedFiles: async () => changedFiles,
    isAvailable: async () => true,
  };
}

describe('GetChangedSymbolsHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-changed-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    const indices = buildIndices();
    storage.bulkWrite(indices);
    // Write JSON index for graph building
    const writer = new JsonIndexWriter(tempDir);
    for (const idx of indices) writer.write(idx);
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('returns symbols from changed files', async () => {
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.changedFiles).toBe(1);
    expect(payload.changedSymbols).toBe(2); // A + B
    expect(payload.files[0].file).toBe('src/a.ts');
    expect(payload.files[0].symbols).toHaveLength(2);
  });

  it('returns multiple changed files', async () => {
    const git = createMockGit(['src/a.ts', 'src/b.ts']);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.changedFiles).toBe(2);
    expect(payload.changedSymbols).toBe(3); // A + B + C
  });

  it('omits changed files not in index', async () => {
    const git = createMockGit(['src/unknown.ts', 'src/b.ts']);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.changedFiles).toBe(1); // Only src/b.ts matched
    expect(payload.files[0].file).toBe('src/b.ts');
  });

  it('respects maxFiles limit', async () => {
    const git = createMockGit(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ maxFiles: 1 });
    const payload = JSON.parse(result.content[0]!.text);

    // Only first file from git processed
    expect(payload.changedFiles).toBeLessThanOrEqual(1);
  });

  it('returns empty when no files changed', async () => {
    const git = createMockGit([]);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.changedFiles).toBe(0);
    expect(payload.changedSymbols).toBe(0);
    expect(payload.files).toEqual([]);
  });

  it('passes since parameter through', async () => {
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ since: 'HEAD~5' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.since).toBe('HEAD~5');
  });

  it('returns validation error for invalid maxFiles', async () => {
    const git = createMockGit([]);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ maxFiles: -1 });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.error).toBe(true);
  });

  it('prepends staleness warning when stale', async () => {
    const mockStaleness = { check: () => ({ message: 'Index stale' }) };
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = await handler({});

    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0]!.text).toContain('stale');
  });

  it('no staleness warning when index is fresh', async () => {
    const mockStaleness = { check: () => undefined };
    const git = createMockGit(['src/a.ts']);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = await handler({});

    expect(result.content).toHaveLength(1);
  });

  it('handles git error gracefully', async () => {
    const failingGit: IGitPort = {
      getCommitHistory: async () => [],
      getFileChurn: async (fp: string) => ({ filePath: fp, commitCount: 0 }),
      getChangedFiles: async () => { throw new Error('git not found'); },
      isAvailable: async () => false,
    };
    const handler = handleGetChangedSymbols(storage, failingGit, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.error).toBe(true);
    expect(payload.message).toContain('git not found');
  });

  it('applies masking to response', async () => {
    const sensitiveIndex: FileIndex = {
      file: 'src/secret.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/secret.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE', kind: 'variable', startLine: 0, endLine: 1 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(sensitiveIndex);
    const writer = new JsonIndexWriter(tempDir);
    writer.write(sensitiveIndex);

    const git = createMockGit(['src/secret.ts']);
    const handler = handleGetChangedSymbols(storage, git, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({});

    expect(result.content[0]!.text).toContain('[REDACTED:AWS_KEY]');
  });
});
