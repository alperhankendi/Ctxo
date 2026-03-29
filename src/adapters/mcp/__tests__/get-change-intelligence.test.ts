import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetChangeIntelligence } from '../get-change-intelligence.js';
import type { FileIndex, ChurnData } from '../../../core/types.js';
import type { IGitPort } from '../../../ports/i-git-port.js';

function buildTestIndices(): FileIndex[] {
  return [
    {
      file: 'src/foo.ts',
      lastModified: 1711620000,
      symbols: [{ symbolId: 'src/foo.ts::processPayment::function', name: 'processPayment', kind: 'function', startLine: 0, endLine: 50 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/bar.ts',
      lastModified: 1711620000,
      symbols: [{ symbolId: 'src/bar.ts::validate::function', name: 'validate', kind: 'function', startLine: 0, endLine: 10 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
  ];
}

function createMockGit(churnMap: Record<string, number>): IGitPort {
  return {
    getCommitHistory: async () => [],
    getFileChurn: async (filePath: string): Promise<ChurnData> => ({
      filePath,
      commitCount: churnMap[filePath] ?? 0,
    }),
    isAvailable: async () => true,
  };
}

describe('GetChangeIntelligenceHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-ci-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildTestIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns MCP response with complexity, churn, composite score, band', async () => {
    const git = createMockGit({ 'src/foo.ts': 10, 'src/bar.ts': 2 });
    const handler = handleGetChangeIntelligence(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/foo.ts::processPayment::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.symbolId).toBe('src/foo.ts::processPayment::function');
    expect(typeof payload.complexity).toBe('number');
    expect(typeof payload.churn).toBe('number');
    expect(typeof payload.composite).toBe('number');
    expect(['low', 'medium', 'high']).toContain(payload.band);
  });

  it('returns correct band for high churn file', async () => {
    const git = createMockGit({ 'src/foo.ts': 100, 'src/bar.ts': 1 });
    const handler = handleGetChangeIntelligence(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/foo.ts::processPayment::function' });
    const payload = JSON.parse(result.content[0]!.text);

    // foo.ts: 51 lines → complexity ~0.51, churn 100/100=1.0, composite ~0.51 → medium
    expect(payload.churn).toBe(1);
    expect(['medium', 'high']).toContain(payload.band);
  });

  it('returns { found: false } for non-existent symbol', async () => {
    const git = createMockGit({});
    const handler = handleGetChangeIntelligence(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/missing.ts::x::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.found).toBe(false);
  });

  it('returns error for empty symbolId', async () => {
    const git = createMockGit({});
    const handler = handleGetChangeIntelligence(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: '' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.error).toBe(true);
  });

  it('handles zero churn gracefully (new file)', async () => {
    const git = createMockGit({ 'src/foo.ts': 0, 'src/bar.ts': 0 });
    const handler = handleGetChangeIntelligence(storage, git, new MaskingPipeline());

    const result = await handler({ symbolId: 'src/foo.ts::processPayment::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.churn).toBe(0);
    expect(payload.band).toBe('low');
  });
});
