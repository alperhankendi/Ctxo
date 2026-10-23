import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../storage/sqlite-storage-adapter.js';
import { MaskingPipeline } from '../../../core/masking/masking-pipeline.js';
import { handleGetArchitecturalOverlay, buildCommunityOverlay } from '../get-architectural-overlay.js';
import type { CommunitySnapshot, FileIndex } from '../../../core/types.js';
import { ClusterLabelMasker } from '../../../core/overlay/cluster-label-masker.js';
import { resolveContextsViewConfig } from '../../../core/config/load-config.js';
import type { ContextCandidate, ContextHub, ContextsView } from '../../../core/contexts-view/contexts-view-builder.js';
import type { TermCollision } from '../../../core/contexts-view/context-terms.js';
import type {
  CandidateSharedTable,
  DataAccessMode,
  DataResourceUsage,
} from '../../../core/contexts-view/data-coupling.js';
import { wrapResponse } from '../../../core/response-envelope.js';
import { compareCodepoint } from '../../../core/compare-codepoint.js';
import type { IContextsViewPort } from '../../../ports/i-contexts-view-port.js';

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

  it('masks sensitive cluster labels when a ClusterLabelMasker is wired', async () => {
    storage.writeCommunities({
      version: 1,
      computedAt: '2026-04-16T10:00:00.000Z',
      commitSha: 'abc1234',
      modularity: 0.5,
      communities: [
        { symbolId: 'src/core/types.ts::T::type', communityId: 0, communityLabel: 'internal-vault' },
        { symbolId: 'src/ports/i-storage.ts::I::interface', communityId: 1, communityLabel: 'src/core' },
      ],
      godNodes: [],
      edgeQuality: 'full',
      crossClusterEdges: 0,
    });
    const { ClusterLabelMasker } = await import('../../../core/overlay/cluster-label-masker.js');
    const masker = new ClusterLabelMasker(['internal-*']);
    const handler = handleGetArchitecturalOverlay(
      storage,
      new MaskingPipeline(),
      undefined,
      undefined,
      masker,
    );
    const payload = JSON.parse((await handler({})).content[0]!.text);
    const labels = payload.communities.clusters.map(
      (c: { label: string }) => c.label,
    ) as string[];
    expect(labels.some((l) => /^\[masked-cluster-\d+\]$/.test(l))).toBe(true);
    expect(labels).toContain('src/core');
    expect(labels).not.toContain('internal-vault');
  });
});

/** Freezes a view and everything in it, as `ContextsViewReader` hands it out: an in-place edit throws. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const MODULES = [
  'Billing',
  'Shipping',
  'Loans',
  'Members',
  'Catalog',
  'Orders',
  'Payments',
  'Reports',
  'Identity',
  'Notifications',
  'Inventory',
  'Pricing',
];

const SUMMARY_HINT = 'Pass candidate: <id> for one candidate in full; run ctxo contexts --json for the whole view.';

function candidate(id: number, label: string, fileCount: number): ContextCandidate {
  const files = Array.from({ length: fileCount }, (_, i) => `src/c${id}/file-${String(i).padStart(3, '0')}.ts`);
  const other = (id % 12) + 1;
  return {
    id,
    label,
    fingerprint: createHash('sha256').update(String(id)).digest('hex').slice(0, 16),
    fileCount,
    files,
    cohesion: 0.5,
    topTerms: Array.from({ length: 10 }, (_, i) => ({ term: `term${id}t${i}`, files: 10 - i })),
    crossEdges: [{ candidate: other, total: 7, byKind: { calls: 4, imports: 3 } }],
    coChangePairs: Array.from({ length: Math.min(10, fileCount) }, (_, i) => ({
      file: files[i]!,
      otherFile: `src/c${other}/file-${String(i).padStart(3, '0')}.ts`,
      otherCandidate: other,
      frequency: 0.5,
      sharedCommits: 3,
    })),
    sharedTables: [],
  };
}

/** `count` occurrences of `name` in candidates `first`, `first + 1`, ... (wrapping after 12), each with `members` members. */
function collision(name: string, count: number, members: number, first = 1): TermCollision {
  return {
    name,
    minJaccard: 0.1,
    occurrences: Array.from({ length: count }, (_, i) => {
      const file = `src/Modules/M${String(i).padStart(3, '0')}/Domain/${name}.cs`;
      return {
        candidate: ((first - 1 + i) % 12) + 1,
        file,
        symbolId: `${file}::${name}::class`,
        members: Array.from({ length: members }, (_, m) => `Member${String(m).padStart(2, '0')}`),
      };
    }),
  };
}

function buildView(candidates: ContextCandidate[], extra: Partial<ContextsView> = {}): ContextsView {
  return {
    version: 1,
    commitSha: 'abc1234',
    settings: resolveContextsViewConfig({} as never),
    coverage: { files: 100, covered: 90, ratio: 0.9 },
    candidates,
    hubs: [],
    unclustered: { count: 20, files: Array.from({ length: 20 }, (_, i) => `src/u/f-${i}.ts`) },
    collisions: [],
    dataResources: [],
    ...extra,
  };
}

/** A data resource accessed by `[candidate, modes]` pairs (sorted by candidate). */
function resource(
  name: string,
  accessors: Array<[candidate: number, modes: DataAccessMode[]]>,
  kind: 'table' | 'view' | 'external' = 'table',
): DataResourceUsage {
  const accesses = [...accessors].sort(([x], [y]) => x - y).map(([candidate, modes]) => ({ candidate, modes }));
  const writers = accesses.filter((access) => access.modes.includes('writes')).map((access) => access.candidate);
  return {
    name,
    ...(kind !== 'external' ? { kind } : {}),
    external: kind === 'external',
    accesses,
    writers,
    ...(writers.length === 1 ? { owner: writers[0]! } : {}),
  };
}

/** The view with these resources and, per candidate, the resources of two or more candidates, as the builder lists them. */
function withData(view: ContextsView, resources: DataResourceUsage[]): ContextsView {
  const sorted = [...resources].sort((x, y) => compareCodepoint(x.name, y.name));
  const shared = new Map<number, CandidateSharedTable[]>();
  for (const { name, kind, external, accesses, owner } of sorted) {
    if (accesses.length < 2) continue;
    const entry: CandidateSharedTable = {
      name,
      ...(kind !== undefined ? { kind } : {}),
      external,
      accesses,
      ...(owner !== undefined ? { owner } : {}),
    };
    for (const access of accesses) shared.set(access.candidate, [...(shared.get(access.candidate) ?? []), entry]);
  }
  return {
    ...view,
    candidates: view.candidates.map((c) => ({ ...c, sharedTables: shared.get(c.id) ?? [] })),
    dataResources: sorted,
  };
}

/**
 * Shaped like the fixture: 12 candidates of 40 files, 17 hubs (the last one unassigned) and 5 collisions, one of
 * them with 120 occurrences of 20 members. Candidate 2 takes part in `entity0` and `entity4` only.
 */
function fixtureView(): ContextsView {
  const hubs: ContextHub[] = Array.from({ length: 17 }, (_, i) => ({
    file: `src/Shared/Infrastructure/Persistence/Hub${String(i).padStart(2, '0')}DbContext.cs`,
    reasons: ['fan-in', 'god-node'],
    dependents: 40 + i,
    damping: 0.18,
    ...(i < 16 ? { candidate: (i % 12) + 1 } : {}),
  }));
  return buildView(
    MODULES.map((name, i) => candidate(i + 1, `src/Modules/${name}`, 40)),
    {
      hubs,
      collisions: [
        collision('entity0', 120, 20),
        collision('entity1', 4, 3, 4),
        collision('entity2', 4, 3, 7),
        collision('entity3', 4, 3, 10),
        collision('entity4', 4, 3, 1),
      ],
    },
  );
}

describe('GetArchitecturalOverlayHandler mode contexts', () => {
  let tempDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-overlay-ctx-'));
    storage = new SqliteStorageAdapter(tempDir);
    await storage.initEmpty();
    storage.bulkWrite(buildHexagonalIndices());
  });

  afterEach(() => {
    delete process.env['CTXO_RESPONSE_LIMIT'];
    storage.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** The view as production serves it: deep-frozen and shared by every call. */
  function port(view: ContextsView | undefined): IContextsViewPort {
    const frozen = view === undefined ? undefined : deepFreeze(view);
    return { readContextsView: () => frozen };
  }

  async function call(
    view: ContextsView | undefined,
    args: Record<string, unknown>,
    masker?: ClusterLabelMasker,
  ): Promise<Record<string, any>> {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline(), undefined, undefined, masker, port(view));
    return JSON.parse((await handler(args)).content[0]!.text);
  }

  it('the summary of a fixture-shaped view returns all 12 candidates at the default limit', async () => {
    const view = fixtureView();
    const payload = await call(view, { mode: 'contexts' });

    expect(payload._meta.truncated).toBe(false);
    expect(payload._meta.totalBytes).toBeLessThanOrEqual(8192);
    expect(Object.keys(payload).sort()).toEqual([
      '_meta',
      'candidates',
      'collisions',
      'collisionsTotal',
      'commitSha',
      'coverage',
      'dataResourcesTotal',
      'externalResourcesTotal',
      'hint',
      'hubs',
      'hubsTotal',
      'sharedResourcesTotal',
      'unclustered',
    ]);
    expect(payload.commitSha).toBe('abc1234');
    expect(payload.coverage).toEqual({ files: 100, covered: 90, ratio: 0.9 });
    expect(payload.candidates).toHaveLength(12);
    const first = view.candidates[0]!;
    expect(payload.candidates[0]).toEqual({
      id: 1,
      label: 'src/Modules/Billing',
      fingerprint: first.fingerprint,
      fileCount: 40,
      cohesion: 0.5,
      topTerms: first.topTerms.slice(0, 5),
    });
    expect(payload.hubs).toHaveLength(17);
    expect(payload.hubsTotal).toBe(17);
    expect(payload.hubs[0]).toEqual({ file: view.hubs[0]!.file, reasons: ['fan-in', 'god-node'], candidate: 1 });
    expect(payload.hubs[16]).toEqual({ file: view.hubs[16]!.file, reasons: ['fan-in', 'god-node'] });
    expect(payload.collisions).toEqual([
      { name: 'entity0', minJaccard: 0.1, candidates: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], occurrenceCount: 120 },
      { name: 'entity1', minJaccard: 0.1, candidates: [4, 5, 6, 7], occurrenceCount: 4 },
      { name: 'entity2', minJaccard: 0.1, candidates: [7, 8, 9, 10], occurrenceCount: 4 },
      { name: 'entity3', minJaccard: 0.1, candidates: [1, 10, 11, 12], occurrenceCount: 4 },
      { name: 'entity4', minJaccard: 0.1, candidates: [1, 2, 3, 4], occurrenceCount: 4 },
    ]);
    expect(payload.collisionsTotal).toBe(5);
    expect(payload.unclustered).toEqual({ count: 20 });
    expect(payload.hint).toBe(SUMMARY_HINT);
  });

  it('the summary caps hubs and collisions at 50 with totals', async () => {
    const hubs: ContextHub[] = Array.from({ length: 60 }, (_, i) => ({
      file: `src/h${i}.ts`,
      reasons: ['configured'],
      dependents: 3,
      damping: 0,
    }));
    const collisions = Array.from({ length: 55 }, (_, i) => collision(`name${String(i).padStart(2, '0')}`, 2, 1));
    const view = buildView([candidate(1, 'orders', 3)], { hubs, collisions });
    const payload = await call(view, { mode: 'contexts' });

    expect(payload.hubs).toHaveLength(50);
    expect(payload.hubsTotal).toBe(60);
    expect(payload.collisions).toHaveLength(50);
    expect(payload.collisionsTotal).toBe(55);
    expect(view.hubs).toHaveLength(60);
  });

  it('the summary truncates candidates through the envelope and points at candidate and the CLI', async () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '2048';
    const view = buildView(Array.from({ length: 40 }, (_, i) => candidate(i + 1, `context-${i}`, 15)));
    const payload = await call(view, { mode: 'contexts' });

    expect(payload._meta.truncated).toBe(true);
    expect(payload._meta.hint).toContain('candidate');
    expect(payload._meta.hint).toContain('ctxo contexts --json');
    expect(payload.candidates.length).toBeLessThan(40);
  });

  it('candidate returns that candidate in full with its hubs and the collisions it takes part in', async () => {
    const view = fixtureView();
    const payload = await call(view, { mode: 'contexts', candidate: 2 });
    const second = view.candidates[1]!;

    expect(Object.keys(payload).sort()).toEqual([
      '_meta',
      'candidate',
      'collisions',
      'collisionsTotal',
      'commitSha',
      'dataResources',
      'dataResourcesTotal',
      'hint',
      'hubs',
      'hubsTotal',
    ]);
    expect(payload.commitSha).toBe('abc1234');
    expect(payload.hint).toBe('Run ctxo contexts --json for full member sets.');
    expect(payload.candidate).toEqual({ ...second, files: second.files.slice(0, 15), sharedTableCount: 0 });
    expect(payload.dataResources).toEqual([]);
    expect(payload.dataResourcesTotal).toBe(0);
    expect(payload.candidate.fileCount).toBe(40);
    expect(payload.candidate.topTerms).toHaveLength(10);
    expect(payload.candidate.crossEdges).toEqual(second.crossEdges);
    expect(payload.candidate.coChangePairs).toHaveLength(10);
    expect(payload.hubs).toEqual(
      [view.hubs[1]!, view.hubs[13]!].map(({ file, reasons, dependents, damping }) => ({ file, reasons, dependents, damping })),
    );
    expect(payload.hubsTotal).toBe(2);
    expect(payload.collisions.map((c: { name: string }) => c.name)).toEqual(['entity0', 'entity4']);
    expect(payload.collisionsTotal).toBe(2);
    // Only candidate 2's own occurrences, without file and candidate; the other candidates are named in `candidates`.
    const own = view.collisions[4]!.occurrences[1]!;
    expect(payload.collisions[1]).toEqual({
      name: 'entity4',
      minJaccard: 0.1,
      candidates: [1, 2, 3, 4],
      occurrenceCount: 4,
      occurrences: [{ symbolId: own.symbolId, members: own.members, memberCount: 3 }],
    });
  });

  it('candidate caps its own occurrences and their members at 5 with counts', async () => {
    // 20 occurrences of candidate 1 and 10 of candidate 2, 20 members each.
    const mixed = collision('entity', 30, 20);
    const view = buildView([candidate(1, 'orders', 3), candidate(2, 'billing', 3)], {
      collisions: [
        {
          ...mixed,
          occurrences: mixed.occurrences.map((occurrence, i) => ({ ...occurrence, candidate: i < 20 ? 1 : 2 })),
        },
      ],
    });

    const payload = await call(view, { mode: 'contexts', candidate: 1 });
    const [entity] = payload.collisions;

    expect(entity.candidates).toEqual([1, 2]);
    expect(entity.occurrenceCount).toBe(30);
    expect(entity.occurrences).toEqual(
      view.collisions[0]!.occurrences.slice(0, 5).map((o) => ({
        symbolId: o.symbolId,
        members: o.members.slice(0, 5),
        memberCount: 20,
      })),
    );
    expect(view.collisions[0]!.occurrences).toHaveLength(30);
    expect(view.collisions[0]!.occurrences[0]!.members).toHaveLength(20);
  });

  it('candidate detail stays within the response limit when the candidate takes part in many large collisions', async () => {
    // Candidate 2 takes part in 20 collisions. Each has 20 occurrences across the other candidates plus one of
    // candidate 2, and every occurrence has 20 members.
    const others = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const collisions: TermCollision[] = Array.from({ length: 20 }, (_, n) => {
      const name = `entity${String(n).padStart(2, '0')}`;
      const occurrence = (candidateId: number, i: number) => {
        const file = `src/Modules/M${String(i).padStart(3, '0')}/Domain/${name}.cs`;
        return {
          candidate: candidateId,
          file,
          symbolId: `${file}::${name}::class`,
          members: Array.from({ length: 20 }, (_, m) => `Member${String(m).padStart(2, '0')}`),
        };
      };
      return {
        name,
        minJaccard: 0.1,
        occurrences: [occurrence(2, 0), ...Array.from({ length: 20 }, (_, i) => occurrence(others[i % 11]!, i + 1))],
      };
    });
    const view = buildView(
      MODULES.map((name, i) => candidate(i + 1, `src/Modules/${name}`, 40)),
      { hubs: fixtureView().hubs, collisions },
    );

    const payload = await call(view, { mode: 'contexts', candidate: 2 });

    expect(payload._meta.totalBytes).toBeLessThanOrEqual(8192);
    expect(payload._meta.truncated).toBe(false);
    expect(payload.collisionsTotal).toBe(20);
    expect(payload.collisions).toHaveLength(10);
    expect(payload.hubsTotal).toBe(2);
    const ownSymbolIds = new Set(
      view.collisions.flatMap((c) => c.occurrences.filter((o) => o.candidate === 2).map((o) => o.symbolId)),
    );
    for (const entry of payload.collisions) {
      expect(Object.keys(entry).sort()).toEqual(['candidates', 'minJaccard', 'name', 'occurrenceCount', 'occurrences']);
      expect(entry.candidates).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(entry.occurrenceCount).toBe(21);
      expect(entry.occurrences).toHaveLength(1);
      expect(entry.occurrences.every((o: { symbolId: string }) => ownSymbolIds.has(o.symbolId))).toBe(true);
      expect(entry.occurrences[0].members).toHaveLength(5);
      expect(entry.occurrences[0].memberCount).toBe(20);
    }
  });

  it('candidate detail caps its hubs at 50 and its collisions at 10, with totals', async () => {
    const hubs: ContextHub[] = Array.from({ length: 60 }, (_, i) => ({
      file: `src/h${i}.ts`,
      reasons: ['fan-in'],
      dependents: 30,
      damping: 0.2,
      candidate: 1,
    }));
    const collisions = Array.from({ length: 55 }, (_, i) => collision(`name${String(i).padStart(2, '0')}`, 2, 1));
    const view = buildView([candidate(1, 'orders', 3), candidate(2, 'billing', 3)], { hubs, collisions });

    const payload = await call(view, { mode: 'contexts', candidate: 1 });

    expect(payload.hubs).toHaveLength(50);
    expect(payload.hubsTotal).toBe(60);
    expect(payload.collisions.map((c: { name: string }) => c.name)).toEqual(
      collisions.slice(0, 10).map((c) => c.name),
    );
    expect(payload.collisionsTotal).toBe(55);
  });

  it('an unknown candidate id is a graceful miss', async () => {
    const payload = await call(fixtureView(), { mode: 'contexts', candidate: 99 });

    expect(payload).toMatchObject({
      found: false,
      hint: 'No candidate 99 in the contexts view. Call without candidate for the list.',
    });
    expect(payload.candidate).toBeUndefined();
  });

  it('a candidate id that is not a positive integer is rejected', async () => {
    for (const bad of [0, -1, 1.5, 'one']) {
      const payload = await call(fixtureView(), { mode: 'contexts', candidate: bad });
      expect(payload.error).toBe(true);
    }
  });

  it('without a view both requests return found false with the run ctxo index hint', async () => {
    for (const args of [{ mode: 'contexts' }, { mode: 'contexts', candidate: 1 }]) {
      const payload = await call(undefined, args);
      expect(payload).toMatchObject({
        found: false,
        hint: 'No contexts view available. Run ctxo index to generate one.',
      });
      expect(payload.candidates).toBeUndefined();
    }
  });

  it('labels that match masking.clusterLabels are masked in the summary and in the detail', async () => {
    const view = buildView([candidate(1, 'src/payment-core', 3), candidate(2, 'orders', 3)]);
    const masker = new ClusterLabelMasker(['src/payment*']);

    const summary = await call(view, { mode: 'contexts' }, masker);
    const labels = summary.candidates.map((c: { label: string }) => c.label) as string[];
    expect(labels).toEqual(['[masked-cluster-1]', 'orders']);

    const detail = await call(view, { mode: 'contexts', candidate: 1 }, masker);
    expect(detail.candidate.label).toBe('[masked-cluster-1]');
    expect(JSON.stringify(detail)).not.toContain('src/payment-core');
    expect((await call(view, { mode: 'contexts', candidate: 2 }, masker)).candidate.label).toBe('orders');
  });

  it('mode both is unchanged and carries no candidates', async () => {
    const payload = await call(buildView([candidate(1, 'orders', 3)]), { mode: 'both' });

    expect(payload.layers).toBeDefined();
    expect(payload.candidates).toBeUndefined();
  });

  it('the contexts summary gives sharedTableCount per candidate and the three resource totals', async () => {
    const view = withData(fixtureView(), [
      resource('dbo.loans', [[1, ['writes']], [2, ['reads']]]),
      resource('dbo.members', [[1, ['reads']], [3, ['reads']], [4, ['reads', 'writes']]]),
      resource('dbo.audit_log', [[2, ['writes']]], 'external'),
      resource('dbo.fees', [[5, ['reads']], [6, ['reads']]], 'external'),
      resource('dbo.open_loans', [[7, ['reads']]], 'view'),
    ]);

    const payload = await call(view, { mode: 'contexts' });

    expect(payload.dataResourcesTotal).toBe(5);
    expect(payload.sharedResourcesTotal).toBe(3);
    expect(payload.externalResourcesTotal).toBe(2);
    expect(payload.dataResources).toBeUndefined();
    const counts = payload.candidates.map((c: Record<string, unknown>) => c['sharedTableCount']);
    expect(counts).toEqual([2, 1, 1, 1, 1, 1, undefined, undefined, undefined, undefined, undefined, undefined]);
    // Present only when above 0, and the rows carry no data arrays.
    expect('sharedTableCount' in payload.candidates[6]).toBe(false);
    expect(Object.keys(payload.candidates[0]).sort()).toEqual([
      'cohesion',
      'fileCount',
      'fingerprint',
      'id',
      'label',
      'sharedTableCount',
      'topTerms',
    ]);

    // A view without data still gives the three totals, at 0.
    const plain = await call(fixtureView(), { mode: 'contexts' });
    expect([plain.dataResourcesTotal, plain.sharedResourcesTotal, plain.externalResourcesTotal]).toEqual([0, 0, 0]);
  });

  it('the candidate detail caps sharedTables at 15 with sharedTableCount and each accesses list at 10', async () => {
    // The caps alone: a limit large enough that the fit to the response limit drops nothing.
    process.env['CTXO_RESPONSE_LIMIT'] = '65536';
    // 30 candidates; each of 20 tables is written by candidate 1 and read by the 29 others.
    const resources = Array.from({ length: 20 }, (_, t) =>
      resource(
        `dbo.table_${String(t).padStart(2, '0')}`,
        Array.from({ length: 30 }, (_, i): [number, DataAccessMode[]] => [i + 1, i === 0 ? ['writes'] : ['reads']]),
      ),
    );
    const view = withData(
      buildView(Array.from({ length: 30 }, (_, i) => candidate(i + 1, `context-${i + 1}`, 3))),
      resources,
    );

    const payload = await call(view, { mode: 'contexts', candidate: 1 });

    expect(payload.candidate.sharedTableCount).toBe(20);
    expect(payload.candidate.sharedTables).toHaveLength(15);
    expect(payload.candidate.sharedTables.map((t: { name: string }) => t.name)).toEqual(
      resources.slice(0, 15).map((r) => r.name),
    );
    expect(payload.candidate.sharedTables[0]).toEqual({
      name: 'dbo.table_00',
      kind: 'table',
      external: false,
      accesses: resources[0]!.accesses.slice(0, 10),
      owner: 1,
      accessCount: 30,
    });
    for (const table of payload.candidate.sharedTables) {
      expect(table.accesses).toHaveLength(10);
      expect(table.accessCount).toBe(30);
    }

    // The requesting candidate's own access is always among the 10.
    const late = await call(view, { mode: 'contexts', candidate: 25 });
    expect(late.candidate.sharedTables[0].accesses.map((a: { candidate: number }) => a.candidate)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 25,
    ]);
    expect(view.candidates[0]!.sharedTables).toHaveLength(20);
    expect(view.candidates[0]!.sharedTables[0]!.accesses).toHaveLength(30);
  });

  it('the candidate detail lists its own dataResources capped at 15 with a total', async () => {
    const resources = [
      ...Array.from({ length: 20 }, (_, i) => {
        const name = `dbo.r${String(i).padStart(2, '0')}`;
        if (i === 0) return resource(name, [[1, ['reads', 'writes']], [2, ['reads']]]);
        if (i === 1) return resource(name, [[1, ['reads']], [2, ['writes']], [3, ['writes']]], 'external');
        return resource(name, [[1, ['reads']]], i % 2 === 0 ? 'table' : 'view');
      }),
      resource('dbo.zz_other', [[2, ['writes']]]),
    ];
    const view = withData(buildView([1, 2, 3, 4].map((id) => candidate(id, `context-${id}`, 3))), resources);

    const payload = await call(view, { mode: 'contexts', candidate: 1 });

    expect(payload.dataResourcesTotal).toBe(20);
    expect(payload.dataResources).toHaveLength(15);
    expect(payload.dataResources.map((r: { name: string }) => r.name)).toEqual(resources.slice(0, 15).map((r) => r.name));
    expect(payload.dataResources.slice(0, 3)).toEqual([
      { name: 'dbo.r00', kind: 'table', external: false, modes: ['reads', 'writes'], owner: 1, writerCount: 1 },
      { name: 'dbo.r01', external: true, modes: ['reads'], writerCount: 2 },
      { name: 'dbo.r02', kind: 'table', external: false, modes: ['reads'], writerCount: 0 },
    ]);

    const second = await call(view, { mode: 'contexts', candidate: 2 });
    expect(second.dataResources.map((r: { name: string }) => r.name)).toEqual(['dbo.r00', 'dbo.r01', 'dbo.zz_other']);
    expect(second.dataResourcesTotal).toBe(3);

    const none = await call(view, { mode: 'contexts', candidate: 4 });
    expect(none.dataResources).toEqual([]);
    expect(none.dataResourcesTotal).toBe(0);
  });

  it('summary and detail stay within 8192 bytes on a large view with data', async () => {
    const raw = async (view: ContextsView, args: Record<string, unknown>) => {
      const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline(), undefined, undefined, undefined, port(view));
      const text = (await handler(args)).content[0]!.text;
      return { bytes: Buffer.byteLength(text, 'utf-8'), payload: JSON.parse(text) as Record<string, any> };
    };
    // 200 resources, three in four shared: resource i is read by up to four candidates and written by the first.
    const resources = (candidates: number) =>
      Array.from({ length: 200 }, (_, i) => {
        const accessors = new Map<number, DataAccessMode[]>();
        const spread = i % 4 === 3 ? 1 : 4;
        for (let k = 0; k < spread; k++) accessors.set(((i * 7 + k * 5) % candidates) + 1, k === 0 ? ['reads', 'writes'] : ['reads']);
        return resource(`dbo.resource_${String(i).padStart(3, '0')}`, [...accessors], i % 10 === 9 ? 'external' : 'table');
      });

    // Fixture-shaped summary: 12 candidates with PR 1A's hubs and collisions, plus 200 resources. The data adds
    // counts only, so every candidate still fits untruncated.
    const fixture = withData(fixtureView(), resources(12));
    const summary = await raw(fixture, { mode: 'contexts' });
    expect(summary.payload['candidates']).toHaveLength(12);
    expect(summary.payload['_meta'].truncated).toBe(false);
    expect(summary.payload['dataResourcesTotal']).toBe(200);
    expect(summary.payload['sharedResourcesTotal']).toBe(150);
    expect(summary.payload['externalResourcesTotal']).toBe(20);
    expect(summary.bytes).toBeLessThanOrEqual(8192);

    // 120 candidates of 40 files: the summary truncates candidates through the envelope and still fits, and
    // the details of the first, a middle and the last candidate fit untruncated.
    const large = withData(
      buildView(Array.from({ length: 120 }, (_, i) => candidate(i + 1, `src/Modules/Context${String(i + 1).padStart(3, '0')}`, 40))),
      resources(120),
    );
    const largeSummary = await raw(large, { mode: 'contexts' });
    expect(largeSummary.payload['_meta'].truncated).toBe(true);
    expect(largeSummary.payload['_meta'].totalItems).toBe(120);
    expect(largeSummary.payload['dataResourcesTotal']).toBe(200);
    expect(largeSummary.bytes).toBeLessThanOrEqual(8192);
    for (const id of [1, 60, 120]) {
      const detail = await raw(large, { mode: 'contexts', candidate: id });
      expect(detail.payload['candidate'].sharedTableCount, `candidate ${id}`).toBeGreaterThan(0);
      expect(detail.payload['dataResourcesTotal'], `candidate ${id}`).toBeGreaterThan(0);
      expect(detail.payload['_meta'].truncated, `candidate ${id}`).toBe(false);
      expect(detail.bytes, `candidate ${id}`).toBeLessThanOrEqual(8192);
    }
  });

  /**
   * PR 1A's worst-case detail view (candidate 2 takes part in 20 collisions of 21 occurrences with 20 members) plus
   * 200 resources with 60-character names, three in four of them accessed by all 12 candidates. With the caps
   * alone the detail of candidate 2 measured 14823 bytes.
   */
  function crowdedDetailView(): ContextsView {
    const others = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const collisions: TermCollision[] = Array.from({ length: 20 }, (_, n) => {
      const name = `entity${String(n).padStart(2, '0')}`;
      const occurrence = (candidateId: number, i: number) => {
        const file = `src/Modules/M${String(i).padStart(3, '0')}/Domain/${name}.cs`;
        return {
          candidate: candidateId,
          file,
          symbolId: `${file}::${name}::class`,
          members: Array.from({ length: 20 }, (_, m) => `Member${String(m).padStart(2, '0')}`),
        };
      };
      return {
        name,
        minJaccard: 0.1,
        occurrences: [occurrence(2, 0), ...Array.from({ length: 20 }, (_, i) => occurrence(others[i % 11]!, i + 1))],
      };
    });
    const resources = Array.from({ length: 200 }, (_, i) => {
      const accessors = new Map<number, DataAccessMode[]>();
      const spread = i % 4 === 3 ? 1 : 12;
      for (let k = 0; k < spread; k++) accessors.set(((i * 7 + k * 5) % 12) + 1, k === 0 ? ['reads', 'writes'] : ['reads']);
      const name = `dbo.resource_${String(i).padStart(3, '0')}`;
      return resource(name.padEnd(60, 'x'), [...accessors], i % 10 === 9 ? 'external' : 'table');
    });
    return withData(
      buildView(
        MODULES.map((name, i) => candidate(i + 1, `src/Modules/${name}`, 40)),
        { hubs: fixtureView().hubs, collisions },
      ),
      resources,
    );
  }

  async function rawDetail(view: ContextsView, id: number) {
    const handler = handleGetArchitecturalOverlay(storage, new MaskingPipeline(), undefined, undefined, undefined, port(view));
    const text = (await handler({ mode: 'contexts', candidate: id })).content[0]!.text;
    return { text, bytes: Buffer.byteLength(text, 'utf-8'), payload: JSON.parse(text) as Record<string, any> };
  }

  it('the candidate detail fits the response limit with many shared tables by dropping trailing entries', async () => {
    const view = crowdedDetailView();
    const own = view.candidates[1]!;
    const ownResources = view.dataResources.filter((r) => r.accesses.some((a) => a.candidate === 2)).map((r) => r.name);

    const detail = await rawDetail(view, 2);
    const tables = detail.payload['candidate'].sharedTables as Array<{ name: string; accesses: Array<{ candidate: number }> }>;
    const resources = detail.payload['dataResources'] as Array<{ name: string }>;

    expect(detail.bytes).toBeLessThanOrEqual(8192);
    expect(detail.payload['_meta'].truncated).toBe(false);
    // Fewer shown than exist; the totals still count them all.
    expect(detail.payload['candidate'].sharedTableCount).toBe(own.sharedTables.length);
    expect(detail.payload['dataResourcesTotal']).toBe(ownResources.length);
    expect(tables.length).toBeLessThan(own.sharedTables.length);
    expect(resources.length).toBeLessThan(ownResources.length);
    expect(tables.length).toBeGreaterThan(0);
    expect(resources.length).toBeGreaterThan(0);
    // The shown entries are a prefix by name of the full sorted lists.
    expect(tables.map((t) => t.name)).toEqual(own.sharedTables.slice(0, tables.length).map((t) => t.name));
    expect(resources.map((r) => r.name)).toEqual(ownResources.slice(0, resources.length));
    // The longer list gave way first, dataResources on a tie: they end at most one apart.
    expect(Math.abs(tables.length - resources.length)).toBeLessThanOrEqual(1);
    expect(resources.length).toBeLessThanOrEqual(tables.length);
    // Each kept table keeps its access cap and this candidate's own access; the other fields stay whole.
    for (const table of tables) {
      expect(table.accesses).toHaveLength(10);
      expect(table.accesses.some((a) => a.candidate === 2)).toBe(true);
    }
    expect(detail.payload['candidate'].files).toHaveLength(15);
    expect(detail.payload['collisions']).toHaveLength(10);
    // Deterministic: the same input gives the same bytes.
    expect((await rawDetail(view, 2)).text).toBe(detail.text);
  });

  it('a larger CTXO_RESPONSE_LIMIT shows more detail entries', async () => {
    const view = crowdedDetailView();
    const atDefault = await rawDetail(view, 2);

    process.env['CTXO_RESPONSE_LIMIT'] = '16384';
    const larger = await rawDetail(view, 2);

    expect(larger.bytes).toBeLessThanOrEqual(16384);
    expect(larger.bytes).toBeGreaterThan(8192);
    expect(larger.payload['candidate'].sharedTables.length).toBeGreaterThan(
      atDefault.payload['candidate'].sharedTables.length,
    );
    expect(larger.payload['dataResources'].length).toBeGreaterThan(atDefault.payload['dataResources'].length);
    // 16 KB holds both lists at their caps.
    expect(larger.payload['candidate'].sharedTables).toHaveLength(15);
    expect(larger.payload['dataResources']).toHaveLength(15);
  });

  it('when even empty data lists do not fit, the detail empties them, keeps the totals and the rest whole', async () => {
    const view = crowdedDetailView();
    const own = view.candidates[1]!;
    const atDefault = await rawDetail(view, 2);

    // Far below what the other fields of the detail take on their own.
    process.env['CTXO_RESPONSE_LIMIT'] = '512';
    const tiny = await rawDetail(view, 2);

    expect(tiny.bytes).toBeGreaterThan(512);
    expect(tiny.payload['candidate'].sharedTables).toEqual([]);
    expect(tiny.payload['dataResources']).toEqual([]);
    expect(tiny.payload['candidate'].sharedTableCount).toBe(own.sharedTables.length);
    expect(tiny.payload['dataResourcesTotal']).toBe(atDefault.payload['dataResourcesTotal']);
    // Only the two data lists give way: every other field is as at the default limit.
    expect(tiny.payload['candidate'].files).toEqual(atDefault.payload['candidate'].files);
    expect(tiny.payload['collisions']).toEqual(atDefault.payload['collisions']);
    expect(tiny.payload['hubs']).toEqual(atDefault.payload['hubs']);
  });

  it('TRUNCATABLE_FIELDS is unchanged', () => {
    process.env['CTXO_RESPONSE_LIMIT'] = '256';
    const big = Array.from({ length: 40 }, (_, i) => ({ name: `dbo.resource_${i}`, external: false }));

    // None of the data arrays is truncatable: the envelope leaves them whole and reports no truncation.
    for (const key of ['dataResources', 'sharedTables', 'accesses']) {
      const wrapped = wrapResponse({ [key]: big }) as Record<string, any>;
      expect(wrapped[key], key).toHaveLength(40);
      expect(wrapped['_meta'].truncated, key).toBe(false);
      expect(wrapped['_meta'].totalItems, key).toBe(0);
    }
    // candidates stays the truncatable array of the contexts summary, with its hint.
    const wrapped = wrapResponse({ candidates: big, dataResources: big }) as Record<string, any>;
    expect(wrapped['_meta'].truncated).toBe(true);
    expect(wrapped['_meta'].totalItems).toBe(40);
    expect(wrapped['_meta'].hint).toContain('candidate: <id>');
    expect(wrapped['dataResources']).toHaveLength(40);
  });

  it('layer keeps precedence over mode contexts and candidate', async () => {
    const payload = await call(buildView([candidate(1, 'orders', 3)]), { mode: 'contexts', layer: 'Domain', candidate: 1 });

    expect(payload.layer).toBe('Domain');
    expect(payload.candidates).toBeUndefined();
    expect(payload.candidate).toBeUndefined();
  });
});

