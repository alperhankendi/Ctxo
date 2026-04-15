import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CommunitySnapshot } from '../../../core/types.js';
import { CommunitySnapshotWriter } from '../community-snapshot-writer.js';

let ctxoRoot: string;

function makeSnapshot(overrides: Partial<CommunitySnapshot> = {}): CommunitySnapshot {
  return {
    version: 1,
    computedAt: '2026-04-16T10:00:00.000Z',
    commitSha: 'abc1234',
    modularity: 0.42,
    communities: [
      { symbolId: 'a.ts::A::function', communityId: 0, communityLabel: 'cluster-a' },
    ],
    godNodes: [],
    edgeQuality: 'full',
    crossClusterEdges: 0,
    ...overrides,
  };
}

beforeEach(() => {
  ctxoRoot = mkdtempSync(join(tmpdir(), 'ctxo-snap-')) + '/.ctxo';
});

afterEach(() => {
  try {
    rmSync(ctxoRoot.replace(/\.ctxo$/, ''), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('CommunitySnapshotWriter', () => {
  it('writes current snapshot on first run; history starts empty', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot());

    expect(existsSync(join(ctxoRoot, 'index', 'communities.json'))).toBe(true);
    const historyFiles = readdirSync(join(ctxoRoot, 'index', 'communities.history'));
    // v0.8 fix: on first run history is empty — the current snapshot is not
    // its own predecessor. It only moves into history on the NEXT write.
    expect(historyFiles).toHaveLength(0);
  });

  it('archives the previous current snapshot into history on second write', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T10:00:00.000Z', commitSha: 'first' }));
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T11:00:00.000Z', commitSha: 'second' }));

    const history = readdirSync(join(ctxoRoot, 'index', 'communities.history'));
    expect(history).toHaveLength(1);
    expect(history[0]).toContain('first');
    expect(writer.readCurrent()?.commitSha).toBe('second');
  });

  it('never puts the current snapshot into history (drift baseline invariant)', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T10:00:00.000Z', commitSha: 'only' }));
    const history = writer.listHistory();
    const current = writer.readCurrent();
    // If this invariant breaks, DriftDetector will compare current vs current
    // and always report zero drift.
    expect(history.some((s) => s.computedAt === current!.computedAt)).toBe(false);
  });

  it('round-trips a snapshot via readCurrent', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    const snapshot = makeSnapshot({ modularity: 0.77 });
    writer.writeSnapshot(snapshot);
    const loaded = writer.readCurrent();
    expect(loaded).toEqual(snapshot);
  });

  it('returns undefined when no snapshot exists', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    expect(writer.readCurrent()).toBeUndefined();
  });

  it('returns empty history when history directory is missing', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    expect(writer.listHistory()).toEqual([]);
  });

  it('lists history newest-first (older writes only, current excluded)', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T10:00:00.000Z', commitSha: 'aaa' }));
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T11:00:00.000Z', commitSha: 'bbb' }));
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T12:00:00.000Z', commitSha: 'ccc' }));
    const history = writer.listHistory();
    // current (ccc) is in communities.json, not history. History holds aaa + bbb newest-first.
    expect(history.map((s) => s.commitSha)).toEqual(['bbb', 'aaa']);
  });

  it('applies limit when listing history', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    for (let i = 0; i < 4; i++) {
      writer.writeSnapshot(
        makeSnapshot({
          computedAt: `2026-04-16T0${i}:00:00.000Z`,
          commitSha: `sha${i}`,
        }),
      );
    }
    expect(writer.listHistory(2)).toHaveLength(2);
  });

  it('rotates history files past the configured limit (FIFO oldest-first)', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot, 3);
    // 6 writes → 5 go to history (current holds the newest). Limit=3 keeps
    // the 3 most recent history entries; oldest two evicted.
    for (let i = 0; i < 6; i++) {
      writer.writeSnapshot(
        makeSnapshot({
          computedAt: `2026-04-16T0${i}:00:00.000Z`,
          commitSha: `sha${i}`,
        }),
      );
    }
    const files = readdirSync(join(ctxoRoot, 'index', 'communities.history')).sort();
    expect(files).toHaveLength(3);
    expect(files.some((f) => f.includes('sha0'))).toBe(false);
    expect(files.some((f) => f.includes('sha1'))).toBe(false);
    expect(files.some((f) => f.includes('sha5'))).toBe(false); // sha5 is current, not history
    expect(files.some((f) => f.includes('sha4'))).toBe(true);
  });

  it('skips corrupt history entries gracefully', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T10:00:00.000Z', commitSha: 'ok' }));
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T12:00:00.000Z', commitSha: 'later' }));
    const dir = join(ctxoRoot, 'index', 'communities.history');
    writeFileSync(join(dir, '2026-04-16T11-00-00.000Z-bad.json'), '{ not-valid-json');
    const history = writer.listHistory();
    // Corrupt entry skipped, one valid snapshot ('ok') remains in history.
    expect(history).toHaveLength(1);
    expect(history[0]!.commitSha).toBe('ok');
  });

  it('falls back when snapshot commit sha is empty', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot({ commitSha: '' }));
    // Second write pushes the empty-sha snapshot into history.
    writer.writeSnapshot(makeSnapshot({ computedAt: '2026-04-16T11:00:00.000Z', commitSha: 'next' }));
    const history = readdirSync(join(ctxoRoot, 'index', 'communities.history'));
    expect(history[0]).toContain('nocommit');
  });

  it('persists JSON with indentation', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot());
    const raw = readFileSync(join(ctxoRoot, 'index', 'communities.json'), 'utf-8');
    expect(raw).toContain('\n  "version"');
  });

  it('returns undefined when current snapshot is corrupt', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot());
    writeFileSync(join(ctxoRoot, 'index', 'communities.json'), '{ not-json');
    expect(writer.readCurrent()).toBeUndefined();
  });
});
