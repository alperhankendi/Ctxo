import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { JsonIndexWriter } from '../../storage/json-index-writer.js';
import { CoChangeReader } from '../../storage/co-change-reader.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetBlastRadius } from '../get-blast-radius.js';
import type { CoChangeEntry, FileIndex } from '../../../core/types.js';

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

  it('applies masking to response', async () => {
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

  it('returns all entries when no confidence filter', async () => {
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    const unfiltered = await handler({ symbolId: 'src/c.ts::C::interface' });
    const filtered = await handler({ symbolId: 'src/c.ts::C::interface', confidence: 'confirmed' });

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

  it('emits cluster breakdown + multiClusterHint when snapshot covers impacted symbols across clusters', async () => {
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

  it('a 2-part table id gives the winner\'s blast radius', async () => {
    const WINNER = 'db/migrations/V1__init.sql::dbo.loans::table';
    const DOCS_COPY = 'docs/db/schema.sql::dbo.loans::table';
    const table = (symbolId: string): FileIndex['symbols'][number] =>
      ({ symbolId, name: 'dbo.loans', kind: 'table', startLine: 0, endLine: 9 });
    storage.bulkWrite([
      { file: 'docs/db/schema.sql', lastModified: 1, symbols: [table(DOCS_COPY)], edges: [], intent: [], antiPatterns: [] },
      { file: 'db/migrations/V1__init.sql', lastModified: 1, symbols: [table(WINNER)], edges: [], intent: [], antiPatterns: [] },
      {
        file: 'src/LoanReport.cs',
        lastModified: 1,
        symbols: [{ symbolId: 'src/LoanReport.cs::Lending.LoanReport.Run::method', name: 'Lending.LoanReport.Run', kind: 'method', startLine: 0, endLine: 9 }],
        edges: [{ from: 'src/LoanReport.cs::Lending.LoanReport.Run::method', to: 'dbo.loans::table', kind: 'reads' }],
        intent: [],
        antiPatterns: [],
      },
    ]);
    storage.writeCommunities({
      version: 1,
      computedAt: '2026-04-16T10:00:00.000Z',
      commitSha: 'abc1234',
      modularity: 0.5,
      communities: [
        { symbolId: WINNER, communityId: 0, communityLabel: 'loans' },
        { symbolId: 'src/LoanReport.cs::Lending.LoanReport.Run::method', communityId: 1, communityLabel: 'reports' },
      ],
      godNodes: [],
      edgeQuality: 'full',
      crossClusterEdges: 1,
    });
    const handler = handleGetBlastRadius(storage, new MaskingPipeline(), undefined, tempDir);
    // The payload echoes the id as given, and `_meta.totalBytes` follows its length; the rest must match.
    const blast = async (symbolId: string) => {
      const payload = JSON.parse((await handler({ symbolId })).content[0]!.text);
      expect(payload.symbolId).toBe(symbolId);
      delete payload.symbolId;
      delete payload._meta;
      return payload;
    };

    const winner = await blast(WINNER);
    expect(winner.impactedSymbols.map((e: { symbolId: string }) => e.symbolId)).toEqual(['src/LoanReport.cs::Lending.LoanReport.Run::method']);
    expect(winner.crossClusterEdges).toBe(1);
    expect(await blast('dbo.loans::table')).toEqual(winner);
    // A losing copy has the same dependents; its own cluster (none here) is the root of the cluster count.
    expect((await blast(DOCS_COPY)).impactedSymbols).toEqual(winner.impactedSymbols);
  });
});

/** b.ts imports a.ts (a potential dependent of A); c.ts has no edge to either. */
function buildCoChangeIndices(): FileIndex[] {
  const fileIndex = (file: string, name: string, edges: FileIndex['edges'] = []): FileIndex => ({
    file,
    lastModified: 1,
    symbols: [{ symbolId: `${file}::${name}::function`, name, kind: 'function', startLine: 0, endLine: 5 }],
    edges,
    intent: [],
    antiPatterns: [],
  });
  return [
    fileIndex('src/a.ts', 'A'),
    fileIndex('src/b.ts', 'B', [{ from: 'src/b.ts::B::function', to: 'src/a.ts::A::function', kind: 'imports' }]),
    fileIndex('src/c.ts', 'C'),
  ];
}

function pair(file1: string, file2: string, frequency: number, sharedCommits: number): CoChangeEntry {
  return { file1, file2, sharedCommits, frequency };
}

describe('GetBlastRadiusHandler co-change', () => {
  const ROOT = 'src/a.ts::A::function';
  const B = 'src/b.ts::B::function';
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-br-cochange-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildCoChangeIndices());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    storage.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function writeMatrix(entries: CoChangeEntry[]): void {
    new JsonIndexWriter(tempDir).writeCoChanges({ version: 1, timestamp: 1, entries });
  }

  function createHandler(withReader = true) {
    return handleGetBlastRadius(
      storage, new MaskingPipeline(), undefined, tempDir, undefined, undefined,
      withReader ? new CoChangeReader(tempDir) : undefined,
    );
  }

  async function blastRadius(args: Record<string, unknown> = { symbolId: ROOT }, withReader = true) {
    const result = await createHandler(withReader)(args);
    return JSON.parse(result.content[0]!.text);
  }

  function entryOf(payload: { impactedSymbols: Array<{ symbolId: string }> }, symbolId: string) {
    return payload.impactedSymbols.find((e) => e.symbolId === symbolId) as
      { confidence: string; coChangeFrequency?: number } | undefined;
  }

  it('upgrades a co-changing potential dependent to likely and lists the co-changing files that have no graph path', async () => {
    writeMatrix([pair('src/a.ts', 'src/b.ts', 0.8, 4), pair('src/a.ts', 'src/c.ts', 0.6, 3)]);

    const payload = await blastRadius();

    expect(entryOf(payload, B)?.confidence).toBe('likely');
    expect(entryOf(payload, B)?.coChangeFrequency).toBe(0.8);
    expect(payload.likelyCount).toBe(1);
    expect(payload.potentialCount).toBe(0);
    // b.ts is impacted through its edge, so only c.ts is a co-change without a graph path.
    expect(payload.coChangedFiles).toEqual([{ file: 'src/c.ts', frequency: 0.6, sharedCommits: 3 }]);
  });

  it('keeps the dependent potential and omits coChangedFiles when no co-change reader is wired', async () => {
    writeMatrix([pair('src/a.ts', 'src/b.ts', 0.8, 4), pair('src/a.ts', 'src/c.ts', 0.6, 3)]);

    const payload = await blastRadius({ symbolId: ROOT }, false);

    expect(entryOf(payload, B)?.confidence).toBe('potential');
    expect(payload.likelyCount).toBe(0);
    expect(payload).not.toHaveProperty('coChangedFiles');
  });

  it('omits coChangedFiles when every co-changing file already has a graph path', async () => {
    writeMatrix([pair('src/a.ts', 'src/b.ts', 0.8, 4)]);

    const payload = await blastRadius();

    expect(entryOf(payload, B)?.confidence).toBe('likely');
    expect(payload).not.toHaveProperty('coChangedFiles');
  });

  it('omits coChangedFiles and keeps the graph tiers when co-changes.json is missing', async () => {
    const payload = await blastRadius();

    expect(entryOf(payload, B)?.confidence).toBe('potential');
    expect(payload).not.toHaveProperty('coChangedFiles');
  });

  it('treats an invalid co-changes.json as no matrix instead of failing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(join(tempDir, 'index'), { recursive: true });
    writeFileSync(join(tempDir, 'index', 'co-changes.json'), '{ "version": 1, "entries": "nope" }');

    const payload = await blastRadius();

    expect(payload.error).toBeUndefined();
    expect(entryOf(payload, B)?.confidence).toBe('potential');
    expect(payload).not.toHaveProperty('coChangedFiles');
  });

  it('lists the same co-changed files whatever the confidence and intent filters keep', async () => {
    writeMatrix([pair('src/a.ts', 'src/b.ts', 0.8, 4), pair('src/a.ts', 'src/c.ts', 0.6, 3)]);

    const byConfidence = await blastRadius({ symbolId: ROOT, confidence: 'confirmed' });
    const byIntent = await blastRadius({ symbolId: ROOT, intent: 'nothing-matches-this' });

    for (const payload of [byConfidence, byIntent]) {
      // The filtered-out dependent still has a graph path, so b.ts must not show up as a co-change.
      expect(payload.impactedSymbols).toEqual([]);
      expect(payload.coChangedFiles).toEqual([{ file: 'src/c.ts', frequency: 0.6, sharedCommits: 3 }]);
    }
  });

  it('caps coChangedFiles at ten files, strongest first, and adds no total field', async () => {
    const partners = Array.from({ length: 12 }, (_, i) => `src/extra${String(i).padStart(2, '0')}.ts`);
    writeMatrix(partners.map((file, i) => pair('src/a.ts', file, 0.95 - i * 0.01, 5)));

    const payload = await blastRadius();

    expect(payload.coChangedFiles.map((f: { file: string }) => f.file)).toEqual(partners.slice(0, 10));
    expect(payload).not.toHaveProperty('coChangedFilesTotal');
  });

  it('upgrades above 0.5 only, while a file without a graph path is listed from 0.5', async () => {
    writeMatrix([pair('src/a.ts', 'src/b.ts', 0.5, 4), pair('src/a.ts', 'src/c.ts', 0.5, 3)]);

    const payload = await blastRadius();

    expect(entryOf(payload, B)?.confidence).toBe('potential');
    expect(payload.coChangedFiles).toEqual([{ file: 'src/c.ts', frequency: 0.5, sharedCommits: 3 }]);
  });

  it('picks up a co-changes.json that is written while the handler is running', async () => {
    const handler = createHandler();
    const call = async () => JSON.parse((await handler({ symbolId: ROOT })).content[0]!.text);

    expect(entryOf(await call(), B)?.confidence).toBe('potential');

    writeMatrix([pair('src/a.ts', 'src/b.ts', 0.8, 4), pair('src/a.ts', 'src/c.ts', 0.6, 3)]);

    const after = await call();
    expect(entryOf(after, B)?.confidence).toBe('likely');
    expect(after.coChangedFiles).toHaveLength(1);
  });
});
