import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetBlastRadius } from '../get-blast-radius.js';
import type { FileIndex } from '../../../core/types.js';

function buildGraphIndices(): FileIndex[] {
  return [
    {
      file: 'src/a.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/a.ts::A::function', name: 'A', kind: 'function', startLine: 0, endLine: 5 }],
      edges: [{ from: 'src/a.ts::A::function', to: 'src/b.ts::B::class', kind: 'imports' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/b.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/b.ts::B::class', name: 'B', kind: 'class', startLine: 0, endLine: 20 }],
      edges: [{ from: 'src/b.ts::B::class', to: 'src/c.ts::C::interface', kind: 'implements' }],
      intent: [],
      antiPatterns: [],
    },
    {
      file: 'src/c.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/c.ts::C::interface', name: 'C', kind: 'interface', startLine: 0, endLine: 10 }],
      edges: [],
      intent: [],
      antiPatterns: [],
    },
  ];
}

describe('GetBlastRadiusHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-br-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildGraphIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('returns MCP response with ranked dependents', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);

    const result = await handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.symbolId).toBe('src/c.ts::C::interface');
    expect(payload.impactScore).toBeGreaterThanOrEqual(1);
    expect(payload.directDependentsCount).toBeGreaterThanOrEqual(1);
    expect(payload.overallRiskScore).toBeGreaterThan(0);
    expect(payload.impactedSymbols.length).toBeGreaterThanOrEqual(1);
    expect(payload.impactedSymbols[0].symbolId).toBe('src/b.ts::B::class');
    expect(payload.impactedSymbols[0].riskScore).toBeDefined();
  });

  it('returns transitive blast radius', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);

    const result = await handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);

    const depIds = payload.impactedSymbols.map((d: { symbolId: string }) => d.symbolId);
    expect(depIds).toContain('src/b.ts::B::class');
    expect(depIds).toContain('src/a.ts::A::function');
  });

  it('returns { found: false } for missing symbol', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);

    const result = await handler({ symbolId: 'src/missing.ts::X::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.found).toBe(false);
  });

  it('applies masking to response', () => {
    // Add a symbol with sensitive name
    const sensitiveIndex: FileIndex = {
      file: 'src/config.ts',
      lastModified: 1,
      symbols: [{ symbolId: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE', kind: 'variable', startLine: 0, endLine: 1 }],
      edges: [{ from: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable', to: 'src/c.ts::C::interface', kind: 'uses' }],
      intent: [],
      antiPatterns: [],
    };
    storage.writeSymbolFile(sensitiveIndex);

    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/c.ts::C::interface' });

    expect(result.content[0]!.text).toContain('[REDACTED:AWS_KEY]');
  });

  it('returns error for empty symbolId', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: '' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.error).toBe(true);
  });

  it('returns confirmedCount, likelyCount, and potentialCount in response', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(typeof payload.confirmedCount).toBe('number');
    expect(typeof payload.likelyCount).toBe('number');
    expect(typeof payload.potentialCount).toBe('number');
    expect(payload.confirmedCount + payload.likelyCount + payload.potentialCount).toBe(payload.impactScore);
  });

  it('classifies implements edge as confirmed and imports edge as potential', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);

    // B implements C → confirmed (depth 1)
    const bEntry = payload.impactedSymbols.find((e: { symbolId: string }) => e.symbolId === 'src/b.ts::B::class');
    expect(bEntry.confidence).toBe('confirmed');

    // A imports B → potential (depth 2, transitive via imports)
    const aEntry = payload.impactedSymbols.find((e: { symbolId: string }) => e.symbolId === 'src/a.ts::A::function');
    expect(aEntry.confidence).toBe('potential');
  });

  it('returns riskScore per entry with depth-weighted decay', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);

    // Depth 1 should have higher riskScore than depth 2
    const depth1 = payload.impactedSymbols.filter((e: { depth: number }) => e.depth === 1);
    const depth2 = payload.impactedSymbols.filter((e: { depth: number }) => e.depth === 2);

    if (depth1.length > 0 && depth2.length > 0) {
      expect(depth1[0].riskScore).toBeGreaterThan(depth2[0].riskScore);
    }
  });

  it('returns zero counts for leaf symbol with no dependents', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/a.ts::A::function' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.impactScore).toBe(0);
    expect(payload.confirmedCount).toBe(0);
    expect(payload.likelyCount).toBe(0);
    expect(payload.potentialCount).toBe(0);
    expect(payload.overallRiskScore).toBe(0);
  });

  it('includes edgeKinds in each impacted symbol entry', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);

    for (const entry of payload.impactedSymbols) {
      expect(entry.edgeKinds).toBeDefined();
      expect(Array.isArray(entry.edgeKinds)).toBe(true);
      expect(entry.edgeKinds.length).toBeGreaterThan(0);
    }
  });

  it('filters by confidence when confidence param is provided', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/c.ts::C::interface', confidence: 'confirmed' });
    const payload = JSON.parse(result.content[0]!.text);

    for (const entry of payload.impactedSymbols) {
      expect(entry.confidence).toBe('confirmed');
    }
    expect(payload.confirmedCount).toBe(payload.impactScore);
    expect(payload.potentialCount).toBe(0);
    expect(payload.likelyCount).toBe(0);
  });

  it('returns all entries when no confidence filter', () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const unfiltered = handler({ symbolId: 'src/c.ts::C::interface' });
    const filtered = handler({ symbolId: 'src/c.ts::C::interface', confidence: 'confirmed' });

    const unfilteredPayload = JSON.parse(unfiltered.content[0]!.text);
    const filteredPayload = JSON.parse(filtered.content[0]!.text);

    expect(unfilteredPayload.impactScore).toBeGreaterThanOrEqual(filteredPayload.impactScore);
  });

  it('omits cluster breakdown when no community snapshot is available', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.byCluster).toBeUndefined();
  });

  it('emits cluster breakdown + multiClusterHint when snapshot covers impacted symbols across clusters', () => {
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
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const result = await handler({ symbolId: 'src/c.ts::C::interface' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.byCluster).toBeDefined();
    const totals = Object.values(payload.byCluster as Record<string, number>);
    expect(totals.reduce((sum, v) => sum + v, 0)).toBeGreaterThan(0);
  });
});
