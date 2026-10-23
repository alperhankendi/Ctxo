import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildCoChangeMatrix,
  loadCoChangeMap,
  type CoChangeBuildOptions,
} from '../co-change-analyzer.js';
import type { CanonicalCommit } from '../../history/change-log.js';

describe('loadCoChangeMap', () => {
  it('builds bidirectional lookup map', () => {
    const map = loadCoChangeMap({
      version: 1,
      timestamp: 0,
      entries: [{ file1: 'src/a.ts', file2: 'src/b.ts', sharedCommits: 2, frequency: 1 }],
    });

    expect(map.get('src/a.ts')).toHaveLength(1);
    expect(map.get('src/b.ts')).toHaveLength(1);
    expect(map.get('src/a.ts')![0]!.file2).toBe('src/b.ts');
  });

  it('returns empty map for empty matrix', () => {
    const map = loadCoChangeMap({ version: 1, timestamp: 0, entries: [] });
    expect(map.size).toBe(0);
  });
});

// ── buildCoChangeMatrix ─────────────────────────────────────────

describe('buildCoChangeMatrix', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A commit that touched `files` (sorted, as the canonical change log delivers them). */
  function commit(hash: string, files: readonly string[]): CanonicalCommit {
    return {
      hash,
      message: `commit ${hash}`,
      date: '2026-01-01T00:00:00+00:00',
      author: 'Dev',
      committedAt: 1_767_225_600,
      files: [...files].sort(),
    };
  }

  /** `count` commits that each touch exactly `files`; hashes are unique per prefix. */
  function commitsOf(prefix: string, count: number, files: readonly string[]): CanonicalCommit[] {
    return Array.from({ length: count }, (_, i) => commit(`${prefix}-${i}`, files));
  }

  const baseOptions: CoChangeBuildOptions = {
    isIncluded: () => true,
    maxCommits: 2000,
    head: 'abc1234',
    maxFilesPerCommit: 30,
    minShared: 2,
    timestamp: 1_760_000_000,
  };

  function build(commits: readonly CanonicalCommit[], overrides: Partial<CoChangeBuildOptions> = {}) {
    return buildCoChangeMatrix(commits, { ...baseOptions, ...overrides });
  }

  function triples(matrix: ReturnType<typeof build>): Array<[string, string, number, number]> {
    return matrix.entries.map((e) => [e.file1, e.file2, e.sharedCommits, e.frequency]);
  }

  it('buildCoChangeMatrix counts shared commits only among included files', () => {
    const commits = [
      commit('c2', ['README.md', 'a.ts', 'b.ts']),
      commit('c1', ['README.md', 'a.ts', 'b.ts']),
    ];

    const matrix = build(commits, { isIncluded: (path) => !path.endsWith('.md') });

    expect(matrix.entries).toEqual([{ file1: 'a.ts', file2: 'b.ts', sharedCommits: 2, frequency: 1 }]);
  });

  it('buildCoChangeMatrix skips commits above maxFilesPerCommit after filtering and counts them as massSkipped', () => {
    const docs = Array.from({ length: 10 }, (_, i) => `docs/page-${i}.md`);
    const commits = [
      commit('mass', ['a.ts', 'b.ts', 'c.ts', ...docs]), // 3 included files, 13 in total
      commit('small', ['a.ts', 'b.ts', ...docs]), // 2 included files, 12 in total
    ];

    const matrix = build(commits, {
      maxFilesPerCommit: 2,
      minShared: 1,
      isIncluded: (path) => path.endsWith('.ts'),
    });

    expect(matrix.window).toMatchObject({ commitsScanned: 2, commitsUsed: 1, massSkipped: 1 });
    // The 10 excluded files do not count toward the threshold, so `small` was used. `mass`
    // contributed neither a pair nor a file count.
    expect(matrix.entries).toEqual([{ file1: 'a.ts', file2: 'b.ts', sharedCommits: 1, frequency: 1 }]);
  });

  it('buildCoChangeMatrix ignores commits with no included file and reports commitsUsed', () => {
    const commits = [
      commit('docs-only', ['README.md']),
      commit('empty', []),
      commit('c2', ['a.ts', 'b.ts']),
      commit('c1', ['a.ts', 'b.ts']),
    ];

    const matrix = build(commits, { isIncluded: (path) => path.endsWith('.ts') });

    expect(matrix.window).toMatchObject({ commitsScanned: 4, commitsUsed: 2, massSkipped: 0 });
    expect(triples(matrix)).toEqual([['a.ts', 'b.ts', 2, 1]]);
  });

  it('buildCoChangeMatrix drops pairs below minShared and below frequency 0.1', () => {
    const commits = [
      // Shared once: below the default minShared of 2.
      commit('lone', ['p.ts', 'q.ts']),
      // Shared twice, but the smaller history is 25 commits: 2 / 25 = 0.08 is below 0.1.
      ...commitsOf('rs', 2, ['r.ts', 's.ts']),
      ...commitsOf('r', 23, ['r.ts']),
      ...commitsOf('s', 28, ['s.ts']),
      // Shared twice with a smaller history of 20 commits: 2 / 20 = 0.1 reaches the floor.
      ...commitsOf('tu', 2, ['t.ts', 'u.ts']),
      ...commitsOf('t', 18, ['t.ts']),
      ...commitsOf('u', 18, ['u.ts']),
    ];

    expect(triples(build(commits))).toEqual([['t.ts', 'u.ts', 2, 0.1]]);
  });

  it('buildCoChangeMatrix measures the 0.1 floor against the rounded frequency', () => {
    // 20 / 201 = 0.0995..., which rounds to 0.1 and therefore stays.
    const commits = [
      ...commitsOf('ab', 20, ['a.ts', 'b.ts']),
      ...commitsOf('a', 181, ['a.ts']),
      ...commitsOf('b', 181, ['b.ts']),
    ];

    expect(triples(build(commits))).toEqual([['a.ts', 'b.ts', 20, 0.1]]);
  });

  it('buildCoChangeMatrix honours the minShared option', () => {
    const commits = [...commitsOf('ab', 2, ['a.ts', 'b.ts']), commit('cd', ['c.ts', 'd.ts'])];

    expect(triples(build(commits, { minShared: 1 }))).toEqual([
      ['a.ts', 'b.ts', 2, 1],
      ['c.ts', 'd.ts', 1, 1],
    ]);
    expect(triples(build(commits, { minShared: 2 }))).toEqual([['a.ts', 'b.ts', 2, 1]]);
    expect(triples(build(commits, { minShared: 3 }))).toEqual([]);
  });

  it('buildCoChangeMatrix sorts by frequency desc, shared desc, file1, file2 with codepoint order', () => {
    // The commits come in the reverse of the expected order, so a sort that skipped a tie-break
    // would leave the pairs in the order they were first seen and fail.
    const commits = [
      ...commitsOf('f', 2, ['f1.ts', 'f2.ts']), // 2 / min(4, 4) = 0.5
      ...commitsOf('f1', 2, ['f1.ts']),
      ...commitsOf('f2', 2, ['f2.ts']),
      ...commitsOf('h', 4, ['h1.ts', 'h2.ts']), // 4 / min(8, 8) = 0.5, shared more often than f
      ...commitsOf('h1', 4, ['h1.ts']),
      ...commitsOf('h2', 4, ['h2.ts']),
      ...commitsOf('g', 3, ['g1.ts', 'g2.ts']), // 3 / min(4, 4) = 0.75
      ...commitsOf('g1', 1, ['g1.ts']),
      ...commitsOf('g2', 1, ['g2.ts']),
      // Frequency 1 and shared 2 for four pairs, so only the names order them. Code point order puts
      // upper case first ('A' < 'B' < 'C' < 'a' < 'b'); a locale order would not.
      ...commitsOf('bw', 2, ['b.ts', 'w.ts']),
      ...commitsOf('cx', 2, ['C.ts', 'x.ts']),
      ...commitsOf('aa', 2, ['A.ts', 'a.ts']),
      ...commitsOf('ab', 2, ['A.ts', 'B.ts']),
      ...commitsOf('m', 3, ['m1.ts', 'm2.ts']), // 3 / 3 = 1, shared 3
    ];

    expect(triples(build(commits))).toEqual([
      ['m1.ts', 'm2.ts', 3, 1],
      ['A.ts', 'B.ts', 2, 1],
      ['A.ts', 'a.ts', 2, 1],
      ['C.ts', 'x.ts', 2, 1],
      ['b.ts', 'w.ts', 2, 1],
      ['g1.ts', 'g2.ts', 3, 0.75],
      ['h1.ts', 'h2.ts', 4, 0.5],
      ['f1.ts', 'f2.ts', 2, 0.5],
    ]);
  });

  it('buildCoChangeMatrix is deterministic', () => {
    const commits = [
      ...commitsOf('ab', 3, ['A.ts', 'B.ts']),
      ...commitsOf('ac', 2, ['A.ts', 'C.ts']),
      ...commitsOf('bc', 2, ['B.ts', 'C.ts']),
      commit('solo', ['A.ts']),
    ];

    const first = build(commits);
    const second = build(commits);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // The order the commits arrive in does not change the counts.
    expect(build([...commits].reverse()).entries).toEqual(first.entries);
  });

  it('buildCoChangeMatrix takes the timestamp from its options and never reads the clock', () => {
    const commits = commitsOf('ab', 2, ['a.ts', 'b.ts']);
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const first = build(commits);
    vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));
    const second = build(commits);

    expect(first.timestamp).toBe(baseOptions.timestamp);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('buildCoChangeMatrix records the window it was built from', () => {
    const matrix = build(commitsOf('ab', 2, ['a.ts', 'b.ts']), {
      maxCommits: 'all',
      since: '12m',
      head: 'f00ba12',
      maxFilesPerCommit: 7,
      minShared: 2,
      timestamp: 42,
    });

    expect(matrix).toStrictEqual({
      version: 1,
      timestamp: 42,
      window: {
        maxCommits: 'all',
        since: '12m',
        head: 'f00ba12',
        commitsScanned: 2,
        commitsUsed: 2,
        massSkipped: 0,
        maxFilesPerCommit: 7,
        minShared: 2,
      },
      entries: [{ file1: 'a.ts', file2: 'b.ts', sharedCommits: 2, frequency: 1 }],
    });
  });

  it('buildCoChangeMatrix leaves since out of the window when none was configured', () => {
    const matrix = build([commit('c1', ['a.ts'])]);

    expect(matrix.window).toBeDefined();
    expect('since' in matrix.window!).toBe(false);
  });

  it('buildCoChangeMatrix returns an empty matrix for an empty window', () => {
    const matrix = build([]);

    expect(matrix.entries).toEqual([]);
    expect(matrix.window).toMatchObject({ commitsScanned: 0, commitsUsed: 0, massSkipped: 0 });
  });

  it('buildCoChangeMatrix yields no entries when every commit touches a single file', () => {
    const matrix = build([commit('c1', ['a.ts']), commit('c2', ['b.ts']), commit('c3', ['a.ts'])]);

    expect(matrix.entries).toEqual([]);
    expect(matrix.window).toMatchObject({ commitsScanned: 3, commitsUsed: 3 });
  });

  it('buildCoChangeMatrix leaves skipped mass commits out of file counts and pairs', () => {
    const commits = [
      ...commitsOf('ab', 2, ['a.ts', 'b.ts']),
      commit('mass', ['a.ts', 'b.ts', 'c.ts', 'd.ts']),
    ];

    const matrix = build(commits, { maxFilesPerCommit: 3, minShared: 1 });

    // Counted, the mass commit would raise the shared count to 3 and add the pairs with c and d.
    expect(triples(matrix)).toEqual([['a.ts', 'b.ts', 2, 1]]);
    expect(matrix.window).toMatchObject({ commitsUsed: 2, massSkipped: 1 });
  });

  it('buildCoChangeMatrix uses a commit that touches exactly maxFilesPerCommit files', () => {
    const matrix = build(commitsOf('abc', 2, ['a.ts', 'b.ts', 'c.ts']), { maxFilesPerCommit: 3 });

    expect(matrix.window).toMatchObject({ commitsUsed: 2, massSkipped: 0 });
    expect(matrix.entries).toHaveLength(3);
  });

  it('buildCoChangeMatrix counts commits where a file changed alone toward its history', () => {
    const commits = [
      ...commitsOf('ab', 2, ['a.ts', 'b.ts']),
      ...commitsOf('a', 2, ['a.ts']),
      ...commitsOf('b', 2, ['b.ts']),
    ];

    // 2 shared / min(4, 4) = 0.5
    expect(triples(build(commits))).toEqual([['a.ts', 'b.ts', 2, 0.5]]);
  });

  it('buildCoChangeMatrix rounds frequency to three decimals', () => {
    const commits = [
      commit('ab', ['a.ts', 'b.ts']), // 1 / min(3, 3)
      ...commitsOf('a', 2, ['a.ts']),
      ...commitsOf('b', 2, ['b.ts']),
      ...commitsOf('cd', 2, ['c.ts', 'd.ts']), // 2 / min(3, 3)
      commit('c', ['c.ts']),
      commit('d', ['d.ts']),
    ];

    expect(triples(build(commits, { minShared: 1 }))).toEqual([
      ['c.ts', 'd.ts', 2, 0.667],
      ['a.ts', 'b.ts', 1, 0.333],
    ]);
  });

  it('buildCoChangeMatrix normalises unsorted and repeated file names inside a commit', () => {
    const messy: CanonicalCommit[] = [1, 2].map((n) => ({
      hash: `c${n}`,
      message: 'messy',
      date: '2026-01-01T00:00:00+00:00',
      author: 'Dev',
      committedAt: 1_767_225_600,
      files: ['b.ts', 'a.ts', 'b.ts'],
    }));

    expect(build(messy).entries).toEqual([{ file1: 'a.ts', file2: 'b.ts', sharedCommits: 2, frequency: 1 }]);
  });

  it('buildCoChangeMatrix does not modify its input', () => {
    const frozen = Object.freeze(
      commitsOf('ab', 2, ['a.ts', 'b.ts']).map((c) => Object.freeze({ ...c, files: Object.freeze([...c.files]) })),
    );

    expect(() => build(frozen)).not.toThrow();
  });
});
