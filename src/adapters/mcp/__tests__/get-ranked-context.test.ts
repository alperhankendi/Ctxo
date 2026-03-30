import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { JsonIndexWriter } from '../../storage/json-index-writer.js';
import { handleGetRankedContext } from '../get-ranked-context.js';
import type { FileIndex } from '../../../core/types.js';

function buildTestIndices(): FileIndex[] {
  return [
    {
      file: 'src/masking.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/masking.ts::MaskingPipeline::class', name: 'MaskingPipeline', kind: 'class', startLine: 0, endLine: 40 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/graph.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/graph.ts::SymbolGraph::class', name: 'SymbolGraph', kind: 'class', startLine: 0, endLine: 60 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/types.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/types.ts::SymbolNode::type', name: 'SymbolNode', kind: 'type', startLine: 0, endLine: 8 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/adapter.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/adapter.ts::TsMorphAdapter::class', name: 'TsMorphAdapter', kind: 'class', startLine: 0, endLine: 100 }],
      edges: [
        { from: 'src/adapter.ts::TsMorphAdapter::class', to: 'src/types.ts::SymbolNode::type', kind: 'imports' },
        { from: 'src/adapter.ts::TsMorphAdapter::class', to: 'src/graph.ts::SymbolGraph::class', kind: 'imports' },
      ],
      intent: [],
      antiPatterns: [],
    },
  ];
}

describe('GetRankedContextHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-ranked-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();

    const writer = new JsonIndexWriter(tempDir);
    for (const idx of buildTestIndices()) {
      writer.write(idx);
      storage.writeSymbolFile(idx);
    }
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns results ranked by combinedScore for text query', () => {
    const handler = handleGetRankedContext(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ query: 'Masking' });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.results.length).toBeGreaterThan(0);
    // "Masking" is contained in "MaskingPipeline" → relevance 0.7 (contains match)
    const masking = payload.results.find((r: { name: string }) => r.name === 'MaskingPipeline');
    expect(masking).toBeDefined();
    expect(masking.relevanceScore).toBe(0.7);

    // Sorted by combinedScore descending
    for (let i = 1; i < payload.results.length; i++) {
      expect(payload.results[i - 1].combinedScore).toBeGreaterThanOrEqual(payload.results[i].combinedScore);
    }
  });

  it('exact name match scores relevance 1.0', () => {
    const handler = handleGetRankedContext(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ query: 'SymbolGraph' });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    const sg = payload.results.find((r: { name: string }) => r.name === 'SymbolGraph');
    expect(sg.relevanceScore).toBe(1.0);
  });

  it('partial match scores relevance 0.7', () => {
    const handler = handleGetRankedContext(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ query: 'Symbol' });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    const sg = payload.results.find((r: { name: string }) => r.name === 'SymbolGraph');
    expect(sg.relevanceScore).toBe(0.7);
  });

  it('respects tokenBudget parameter', () => {
    const handler = handleGetRankedContext(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ query: 'Symbol', tokenBudget: 200 });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.totalTokens).toBeLessThanOrEqual(200);
    expect(payload.tokenBudget).toBe(200);
  });

  it('importance strategy ranks by reverse edge count', () => {
    const handler = handleGetRankedContext(storage, new MaskingPipeline(), undefined, tempDir);
    // Use a query that matches something so results aren't filtered
    const result = handler({ query: 'Symbol', strategy: 'importance', tokenBudget: 10000 });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.strategy).toBe('importance');

    // Results should have importanceScore field
    for (const r of payload.results) {
      expect(typeof r.importanceScore).toBe('number');
    }
  });

  it('returns zero relevance for no-match query', () => {
    const handler = handleGetRankedContext(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ query: 'zzzznonexistent' });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    for (const r of payload.results) {
      expect(r.relevanceScore).toBe(0);
    }
  });

  it('returns { error: true } for empty query string', () => {
    const handler = handleGetRankedContext(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ query: '' });
    const payload = JSON.parse(result.content[result.content.length - 1]!.text);

    expect(payload.error).toBe(true);
  });

  it('applies masking to response', () => {
    const writer = new JsonIndexWriter(tempDir);
    writer.write({
      file: 'src/secret.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/secret.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE', kind: 'variable', startLine: 0, endLine: 1 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    });

    const handler = handleGetRankedContext(storage, new MaskingPipeline(), undefined, tempDir);
    const result = handler({ query: 'AKIA' });

    expect(result.content[result.content.length - 1]!.text).toContain('[REDACTED:AWS_KEY]');
  });
});
