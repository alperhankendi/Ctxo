import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetArchitecturalOverlay, buildCommunityOverlay } from '../get-architectural-overlay.js';
import type { CommunitySnapshot, FileIndex } from '../../../core/types.js';

function buildSnapshot(): CommunitySnapshot {
  return {
    version: 1,
    computedAt: '2026-04-16T10:00:00.000Z',
    commitSha: 'abc1234',
    modularity: 0.4,
    communities: [
      { symbolId: 'src/core/types.ts::T::type', communityId: 0, communityLabel: 'core' },
      { symbolId: 'src/ports/i-storage.ts::I::interface', communityId: 0, communityLabel: 'core' },
      { symbolId: 'src/adapters/mcp/handler.ts::H::class', communityId: 1, communityLabel: 'adapters' },
    ],
    godNodes: [
      { symbolId: 'src/core/types.ts::T::type', bridgedCommunities: [0, 1], centralityScore: 1 },
    ],
    edgeQuality: 'full',
    crossClusterEdges: 2,
  };
}

function buildHexagonalIndices(): FileIndex[] {
  return [
    { file: 'src/core/types.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/adapters/mcp/handler.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/ports/i-storage.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/cli/index-cmd.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
    { file: 'src/utils/format.ts', lastModified: 1, symbols: [], edges: [], intent: [], antiPatterns: [] },
  ];
}

describe('GetArchitecturalOverlayHandler', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-overlay-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildHexagonalIndices());
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('returns MCP response with layer map', async () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.layers).toBeDefined();
    expect(payload.layers['Domain']).toContain('src/core/types.ts');
    expect(payload.layers['Domain']).toContain('src/ports/i-storage.ts');
    expect(payload.layers['Adapter']).toContain('src/adapters/mcp/handler.ts');
    expect(payload.layers['Adapter']).toContain('src/cli/index-cmd.ts');
    expect(payload.layers['Unknown']).toContain('src/utils/format.ts');
  });

  it('filters by specific layer when parameter provided', async () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = await handler({ layer: 'Domain' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.layer).toBe('Domain');
    expect(payload.files).toContain('src/core/types.ts');
    expect(payload.files).not.toContain('src/utils/format.ts');
  });

  it('returns empty files array for non-existent layer', async () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = await handler({ layer: 'NonExistent' });
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.files).toEqual([]);
  });

  it('returns all layers when no filter specified', async () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(Object.keys(payload.layers)).toContain('Domain');
    expect(Object.keys(payload.layers)).toContain('Adapter');
    expect(Object.keys(payload.layers)).toContain('Unknown');
  });

  it('handles empty index gracefully', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'ctxo-empty-'));
    const emptyStorage = new SqliteStorageAdapter(emptyDir);
    await emptyStorage.initEmpty();

    const handler = handleGetArchitecturalOverlay(emptyStorage, new MaskingPipeline());
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.layers).toEqual({});

    emptyStorage.close();
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('includes community overlay in both mode when a snapshot is available', async () => {
    storage.writeCommunities(buildSnapshot());
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = await handler({});
    const payload = JSON.parse(result.content[0]!.text);

    expect(payload.layers).toBeDefined();
    expect(payload.communities).toBeDefined();
    expect(payload.communities.modularity).toBe(0.4);
    expect(payload.communities.commitSha).toBe('abc1234');
    expect(payload.communities.clusters).toHaveLength(2);
  });

  it('drops the layers map when mode=communities', async () => {
    storage.writeCommunities(buildSnapshot());
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = await handler({ mode: 'communities' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.layers).toBeUndefined();
    expect(payload.communities).toBeDefined();
  });

  it('drops the communities map when mode=regex', async () => {
    storage.writeCommunities(buildSnapshot());
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = await handler({ mode: 'regex' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.layers).toBeDefined();
    expect(payload.communities).toBeUndefined();
  });

  it('returns a hint when mode=communities but no snapshot exists', async () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const result = await handler({ mode: 'communities' });
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.hint).toMatch(/ctxo index/);
  });

  it('buildCommunityOverlay sorts clusters by member count descending', () => {
    const overlay = buildCommunityOverlay(buildSnapshot());
    expect(overlay.clusters[0]!.id).toBe(0);
    expect(overlay.clusters[0]!.memberCount).toBe(2);
    expect(overlay.clusters[0]!.godNodes).toContain('src/core/types.ts::T::type');
  });

  it('wraps all responses with a _meta envelope', async () => {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const full = JSON.parse((await handler({})).content[0]!.text);
    expect(full._meta).toBeDefined();
    expect(full._meta).toMatchObject({ truncated: expect.any(Boolean), totalBytes: expect.any(Number) });

    const filtered = JSON.parse((await handler({ layer: 'Domain' })).content[0]!.text);
    expect(filtered._meta).toBeDefined();
  });

  it('surfaces snapshotStaleness in _meta when git reports HEAD ahead of snapshot', async () => {
    storage.writeCommunities(buildSnapshot()); // commitSha: 'abc1234'
    const git = {
      getHeadSha: () => Promise.resolve('def5678'),
      countCommitsBetween: () => Promise.resolve(3),
    } as unknown as Parameters<typeof handleGetArchitecturalOverlay>[3];

    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline(), undefined, git);
    const payload = JSON.parse((await handler({})).content[0]!.text);
    expect(payload._meta.snapshotStaleness).toMatchObject({
      snapshotCommit: 'abc1234',
      currentHeadCommit: 'def5678',
      commitsBehind: 3,
    });
    expect(payload._meta.snapshotStaleness.hint).toMatch(/behind HEAD/);
  });

  it('omits snapshotStaleness when git port is not provided', async () => {
    storage.writeCommunities(buildSnapshot());
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline());
    const payload = JSON.parse((await handler({})).content[0]!.text);
    expect(payload._meta.snapshotStaleness).toBeUndefined();
  });
});
