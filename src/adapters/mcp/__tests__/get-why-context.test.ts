import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetWhyContext } from '../get-why-context.js';
import type { FileIndex, CommitRecord, ChurnData } from '../../../core/types.js';
import type { IGitPort } from '../../../ports/i-git-port.js';

function buildTestIndex(): FileIndex {
  return {
    file: 'src/foo.ts',
    lastModified: 1711620000,
    symbols: [{ symbolId: 'src/foo.ts::processPayment::function', name: 'processPayment', kind: 'function', startLine: 0, endLine: 10 }],
    edges: [],
    intent: [],
    antiPatterns: [],
  };
}

function createMockGit(commits: CommitRecord[]): IGitPort {
  return {
    getCommitHistory: async () => commits,
    getFileChurn: async (filePath: string) => ({ filePath, commitCount: commits.length }),
    isAvailable: async () => true,
  };
}

describe('GetWhyContextHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-why-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite([buildTestIndex()]);
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns MCP response shape with commit history', async () => {
    const git = createMockGit([
      { hash: 'abc', message: 'feat: add payment', date: '2024-01-01', author: 'dev' },
    ]);
    const handler = handleGetWhyContext(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/foo.ts::processPayment::function' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.commitHistory).toHaveLength(1);
    expect(payload.commitHistory[0].message).toBe('feat: add payment');
  });

  it('includes anti-pattern badge when revert warnings exist', async () => {
    const git = createMockGit([
      { hash: 'abc', message: 'Revert "add caching"', date: '2024-01-02', author: 'dev' },
      { hash: 'def', message: 'feat: add caching', date: '2024-01-01', author: 'dev' },
    ]);
    const handler = handleGetWhyContext(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/foo.ts::processPayment::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.antiPatternWarnings).toHaveLength(1);
    expect(payload.antiPatternWarnings[0].message).toBe('Revert "add caching"');
  });

  it('applies masking to commit messages containing credentials', async () => {
    const git = createMockGit([
      { hash: 'abc', message: 'fix: update AKIAIOSFODNN7EXAMPLE key', date: '2024-01-01', author: 'dev' },
    ]);
    const handler = handleGetWhyContext(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/foo.ts::processPayment::function' });

    expect(result.content[0]!.text).toContain('[REDACTED:AWS_KEY]');
    expect(result.content[0]!.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('returns { found: false } for non-existent symbol', async () => {
    const git = createMockGit([]);
    const handler = handleGetWhyContext(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/missing.ts::nothing::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.found).toBe(false);
    expect(payload.hint).toContain('ctxo index');
  });

  it('never throws — returns error shape on internal failure', async () => {
    const git = createMockGit([]);
    const handler = handleGetWhyContext(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: '' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.error).toBe(true);
  });

  it('returns empty history when git has no commits for file', async () => {
    const git = createMockGit([]);
    const handler = handleGetWhyContext(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/foo.ts::processPayment::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.commitHistory).toEqual([]);
    expect(payload.antiPatternWarnings).toEqual([]);
  });
});
