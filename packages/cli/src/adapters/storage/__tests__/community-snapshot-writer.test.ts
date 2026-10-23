import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** A timestamp `minute` minutes into the day, so a larger number is always a later snapshot. */
function at(minute: number): string {
  return `2026-04-16T10:${String(minute).padStart(2, '0')}:00.000Z`;
}

function historyDir(): string {
  return join(ctxoRoot, 'index', 'communities.history');
}

/** The file names in communities.history/, sorted; empty when the folder does not exist. */
function historyFiles(): string[] {
  return existsSync(historyDir()) ? readdirSync(historyDir()).sort() : [];
}

/**
 * Drops a snapshot straight into communities.history/ under the name the writer would give it, the way
 * an older ctxo left them (one archive per `ctxo index --file` run, so several files share a commit).
 * Returns the file name.
 */
function seedArchive(commitSha: string, computedAt: string, overrides: Partial<CommunitySnapshot> = {}): string {
  const name = `${computedAt.replace(/[:.]/g, '-')}-${commitSha}.json`;
  mkdirSync(historyDir(), { recursive: true });
  writeFileSync(
    join(historyDir(), name),
    JSON.stringify(makeSnapshot({ computedAt, commitSha, ...overrides }), null, 2),
  );
  return name;
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

  it('does NOT archive a nocommit snapshot into history (drift anchor invariant)', () => {
    // With no git, the CLI records commitSha='nocommit'. Such snapshots have
    // no stable comparison anchor — they must not pollute the history chain
    // that drift/boundary-violation detectors read.
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot({ commitSha: 'nocommit' }));
    writer.writeSnapshot(
      makeSnapshot({ computedAt: '2026-04-16T11:00:00.000Z', commitSha: 'real1' }),
    );
    const historyFiles = readdirSync(join(ctxoRoot, 'index', 'communities.history'));
    expect(historyFiles).toHaveLength(0);
    expect(writer.listHistory()).toHaveLength(0);
  });

  it('archives successor snapshots normally even after a nocommit predecessor', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    writer.writeSnapshot(makeSnapshot({ commitSha: 'nocommit' }));
    writer.writeSnapshot(
      makeSnapshot({ computedAt: '2026-04-16T11:00:00.000Z', commitSha: 'real1' }),
    );
    writer.writeSnapshot(
      makeSnapshot({ computedAt: '2026-04-16T12:00:00.000Z', commitSha: 'real2' }),
    );
    const history = writer.listHistory();
    // Only real1 lands in history (nocommit was skipped, real2 is current).
    expect(history).toHaveLength(1);
    expect(history[0]!.commitSha).toBe('real1');
  });

  it('refuses to write outside a tmpdir path unless opted into a production root', () => {
    // Simulates the exact test-isolation scenario that polluted the repo's .ctxo/
    // during v0.8 runtime analysis: some test instantiates the writer with a path
    // that sits outside os.tmpdir() and without the production opt-in.
    const unsafe = '/opt/some/project/.ctxo';
    expect(() => new CommunitySnapshotWriter(unsafe)).toThrow(/refusing to write/);
    // Opting in explicitly unblocks the writer for the CLI's real production usage.
    expect(
      () => new CommunitySnapshotWriter(unsafe, { allowProductionPath: true }),
    ).not.toThrow();
  });

  it('filters legacy nocommit entries out of listHistory (defense in depth)', () => {
    const writer = new CommunitySnapshotWriter(ctxoRoot);
    // Seed a real snapshot first so history dir exists.
    writer.writeSnapshot(makeSnapshot({ commitSha: 'real0' }));
    writer.writeSnapshot(
      makeSnapshot({ computedAt: '2026-04-16T11:00:00.000Z', commitSha: 'real1' }),
    );
    // Drop a legacy nocommit snapshot directly into history (simulates data
    // written before the archival guard landed).
    const histDir = join(ctxoRoot, 'index', 'communities.history');
    writeFileSync(
      join(histDir, '2026-04-16T10-30-00-000Z-nocommit.json'),
      JSON.stringify(makeSnapshot({ commitSha: 'nocommit' })),
    );

    const history = writer.listHistory();
    expect(history.every((s) => s.commitSha !== 'nocommit' && s.commitSha !== '')).toBe(true);
    expect(history.some((s) => s.commitSha === 'real0')).toBe(true);
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

  // One snapshot per commit (#157): the post-commit hook runs `ctxo index --file` once per changed file and
  // every run writes a snapshot with the same HEAD sha. History must hold that commit once, not once per file.
  describe('one snapshot per commit', () => {
    it('writing twice for the same commit replaces current and archives nothing', () => {
      const writer = new CommunitySnapshotWriter(ctxoRoot);
      writer.writeSnapshot(makeSnapshot({ computedAt: at(0), commitSha: 'sha1', modularity: 0.1 }));
      writer.writeSnapshot(makeSnapshot({ computedAt: at(1), commitSha: 'sha1', modularity: 0.2 }));

      expect(historyFiles()).toEqual([]);
      expect(writer.listHistory()).toEqual([]);
      expect(writer.readCurrent()).toMatchObject({ commitSha: 'sha1', computedAt: at(1), modularity: 0.2 });
    });

    it('a new commit after same-commit rewrites archives exactly one entry for the old commit', () => {
      const writer = new CommunitySnapshotWriter(ctxoRoot);
      writer.writeSnapshot(makeSnapshot({ computedAt: at(0), commitSha: 'sha1', modularity: 0.1 }));
      writer.writeSnapshot(makeSnapshot({ computedAt: at(1), commitSha: 'sha1', modularity: 0.2 }));
      writer.writeSnapshot(makeSnapshot({ computedAt: at(2), commitSha: 'sha1', modularity: 0.3 }));
      writer.writeSnapshot(makeSnapshot({ computedAt: at(3), commitSha: 'sha2', modularity: 0.9 }));

      expect(historyFiles()).toHaveLength(1);
      // The entry is what current held for sha1 when sha2 replaced it: the last rewrite.
      expect(writer.listHistory()).toMatchObject([{ commitSha: 'sha1', computedAt: at(2), modularity: 0.3 }]);
      expect(writer.readCurrent()?.commitSha).toBe('sha2');
    });

    it('listHistory collapses legacy duplicates to one entry per commitSha', () => {
      seedArchive('sha1', at(0), { modularity: 0.1 });
      seedArchive('sha1', at(1), { modularity: 0.2 });
      seedArchive('sha1', at(2), { modularity: 0.3 });
      seedArchive('sha2', at(3), { modularity: 0.9 });
      const writer = new CommunitySnapshotWriter(ctxoRoot);

      const history = writer.listHistory();

      expect(history.map((s) => s.commitSha)).toEqual(['sha2', 'sha1']);
      expect(history[1]!.modularity).toBe(0.3); // the newest sha1 file wins
      expect(historyFiles()).toHaveLength(4); // reading never touches the folder
    });

    it('listHistory applies its limit to distinct commits, not to files', () => {
      seedArchive('sha1', at(0));
      seedArchive('sha2', at(1));
      seedArchive('sha3', at(2));
      seedArchive('sha3', at(3));
      seedArchive('sha3', at(4));
      const writer = new CommunitySnapshotWriter(ctxoRoot);

      expect(writer.listHistory(2).map((s) => s.commitSha)).toEqual(['sha3', 'sha2']);
    });

    it('rotation deletes the older copies of a commit and keeps its newest file', () => {
      seedArchive('sha1', at(0));
      seedArchive('sha1', at(1));
      const newestSha1 = seedArchive('sha1', at(2));
      const sha2 = seedArchive('sha2', at(3));
      const writer = new CommunitySnapshotWriter(ctxoRoot); // the limit (10) is nowhere near reached

      writer.writeSnapshot(makeSnapshot({ computedAt: at(9), commitSha: 'current' }));

      expect(historyFiles()).toEqual([newestSha1, sha2]);
      expect(writer.listHistory().map((s) => s.commitSha)).toEqual(['sha2', 'sha1']);
    });

    it('copies of a commit do not use up history slots', () => {
      // Five files, three commits, limit 3. Rotating by raw file count would evict sha0, the only file of
      // the oldest commit, and leave two commits in history.
      seedArchive('sha0', at(0));
      seedArchive('sha1', at(1));
      seedArchive('sha1', at(2));
      seedArchive('sha1', at(3));
      seedArchive('sha2', at(4));
      const writer = new CommunitySnapshotWriter(ctxoRoot, 3);

      writer.writeSnapshot(makeSnapshot({ computedAt: at(9), commitSha: 'current' }));

      expect(writer.listHistory().map((s) => s.commitSha)).toEqual(['sha2', 'sha1', 'sha0']);
      expect(historyFiles()).toHaveLength(3);
    });

    it('still evicts the oldest commits when more distinct commits than the limit remain', () => {
      seedArchive('sha1', at(0));
      seedArchive('sha1', at(1));
      const sha2 = seedArchive('sha2', at(2));
      seedArchive('sha3', at(3));
      const newestSha3 = seedArchive('sha3', at(4));
      const writer = new CommunitySnapshotWriter(ctxoRoot, 2);

      writer.writeSnapshot(makeSnapshot({ computedAt: at(9), commitSha: 'current' }));

      // sha1 is the oldest of three commits, so it goes. Of sha3's two copies the newer one stays.
      expect(historyFiles()).toEqual([sha2, newestSha3]);
    });

    it('keeps the later archive when two share a timestamp and a commit', () => {
      // Archiving the same computedAt and sha twice makes historyFilename append ".1" to the second name,
      // and "x.1.json" sorts before "x.json": file name order alone would call the earlier archive newest.
      const writer = new CommunitySnapshotWriter(ctxoRoot);
      writer.writeSnapshot(makeSnapshot({ computedAt: at(0), commitSha: 'sha1', modularity: 0.1 }));
      writer.writeSnapshot(makeSnapshot({ computedAt: at(1), commitSha: 'sha2' })); // archives sha1
      writer.writeSnapshot(makeSnapshot({ computedAt: at(0), commitSha: 'sha1', modularity: 0.2 })); // archives sha2
      writer.writeSnapshot(makeSnapshot({ computedAt: at(2), commitSha: 'sha3' })); // archives sha1 again, as "-sha1.1.json"

      const sha1 = writer.listHistory().filter((s) => s.commitSha === 'sha1');
      expect(sha1).toHaveLength(1);
      expect(sha1[0]!.modularity).toBe(0.2);
      expect(historyFiles().filter((name) => name.includes('sha1'))).toHaveLength(1);
    });

    it('keeps the readable copy of a commit when a newer file for it is corrupt', () => {
      const readable = seedArchive('sha1', at(0), { modularity: 0.1 });
      writeFileSync(join(historyDir(), `${at(1).replace(/[:.]/g, '-')}-sha1.json`), '{ not-valid-json');
      const writer = new CommunitySnapshotWriter(ctxoRoot);

      writer.writeSnapshot(makeSnapshot({ computedAt: at(9), commitSha: 'current' }));

      expect(writer.listHistory().map((s) => s.modularity)).toEqual([0.1]);
      expect(historyFiles()).toContain(readable);
    });
  });
});
