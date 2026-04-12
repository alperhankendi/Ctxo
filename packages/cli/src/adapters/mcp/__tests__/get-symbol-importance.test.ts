import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetSymbolImportance } from '../get-symbol-importance.js';
import type { FileIndex } from '../../../core/types.js';

function buildIndices(): FileIndex[] {
  return [
    {
      file: 'src/a.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 1, endLine: 10 }],
      edges: [{ from: 'src/a.ts::A::function', to: 'src/c.ts::C::class', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/b.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/b.ts::B::function', name: 'B', kind: 'function', startLine: 1, endLine: 10 }],
      edges: [
        { from: 'src/b.ts::B::function', to: 'src/c.ts::C::class', kind: 'imports' },
        { from: 'src/b.ts::B::function', to: 'src/d.ts::D::interface', kind: 'implements' },
      ],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/c.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/c.ts::C::class', name: 'C', kind: 'class', startLine: 1, endLine: 50 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/d.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/d.ts::D::interface', name: 'D', kind: 'interface', startLine: 1, endLine: 10 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
  ];
}

describe('GetSymbolImportanceHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-importance-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns PageRank rankings with most-depended symbol first', () => {
    const handler = handleGetSymbolImportance(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.totalSymbols).toBe(4);
    expect(payload.converged).toBe(true);
    expect(payload.rankings.length).toBeGreaterThan(0);

    // C is depended on by A and B — should rank highest
    expect(payload.rankings[0].symbolId).toBe('src/c.ts::C::class');
  });

  it('each entry has score, inDegree, outDegree fields', () => {
    const handler = handleGetSymbolImportance(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});
    const payload = JSON.parse(result.content[0]!.text);

    for (const entry of payload.rankings) {
      expect(typeof entry.score).toBe('number');
      expect(typeof entry.inDegree).toBe('number');
      expect(typeof entry.outDegree).toBe('number');
      expect(entry.symbolId).toBeDefined();
      expect(entry.name).toBeDefined();
      expect(entry.kind).toBeDefined();
      expect(entry.file).toBeDefined();
    }
  });

  it('respects limit parameter', () => {
    const handler = handleGetSymbolImportance(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ limit: 2 });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.rankings).toHaveLength(2);
  });

  it('filters by kind', () => {
    const handler = handleGetSymbolImportance(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ kind: 'interface' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.rankings.every((r: { kind: string }) => r.kind === 'interface')).toBe(true);
  });

  it('filters by filePattern', () => {
    const handler = handleGetSymbolImportance(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ filePattern: 'src/c' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.rankings.every((r: { file: string }) => r.file.includes('src/c'))).toBe(true);
  });

  it('reports damping factor in response', () => {
    const handler = handleGetSymbolImportance(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ damping: 0.7 });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.damping).toBe(0.7);
  });

  it('applies masking to response', () => {
    const sensitiveIndex: FileIndex = {
      file: 'src/secret.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/secret.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE', kind: 'variable', startLine: 0, endLine: 1 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(sensitiveIndex);

    const handler = handleGetSymbolImportance(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({});

    expect(result.content[0]!.text).toContain('[REDACTED:AWS_KEY]');
  });

  it('prepends staleness warning when stale', () => {
    const mockStaleness = { check: () => ({ message: 'Index stale' }) };
    const handler = handleGetSymbolImportance(storage, new MaskingPipeline(), mockStaleness as never, tempDir);
    const result = handler({});

    expect(result.content.length).toBeGreaterThanOrEqual(2);
    expect(result.content[0]!.text).toContain('stale');
  });
});
