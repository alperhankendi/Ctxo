import { describe, it, expect } from 'vitest';
import { canonicalizeChangeLog } from '../change-log.js';
import type { CommitChangeSet, FileChange } from '../../types.js';

function makeCommit(
  hash: string,
  changes: readonly FileChange[],
  overrides: Partial<CommitChangeSet> = {},
): CommitChangeSet {
  return {
    hash,
    message: `message of ${hash}`,
    date: '2026-01-02T03:04:05+00:00',
    author: 'Test Author',
    committedAt: 1_767_323_045,
    changes,
    ...overrides,
  };
}

const added = (path: string): FileChange => ({ status: 'A', path });
const modified = (path: string): FileChange => ({ status: 'M', path });
const deleted = (path: string): FileChange => ({ status: 'D', path });
const renamed = (oldPath: string, path: string): FileChange => ({ status: 'R', path, oldPath });
const copied = (oldPath: string, path: string): FileChange => ({ status: 'C', path, oldPath });

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('canonical change log', () => {
  it('canonicalizeChangeLog maps an old path to its newest name across a chain of renames', () => {
    // Newest first: "b" was renamed to "c" last, "a" was renamed to "b" before that.
    const result = canonicalizeChangeLog([
      makeCommit('h3', [renamed('b', 'c')]),
      makeCommit('h2', [renamed('a', 'b')]),
      makeCommit('h1', [modified('a')]),
    ]);

    expect(result.map((commit) => commit.files)).toEqual([['c'], ['c'], ['c']]);
  });

  it('canonicalizeChangeLog keeps a deleted file under its own name', () => {
    const result = canonicalizeChangeLog([
      makeCommit('h3', [deleted('src/gone.ts')]),
      makeCommit('h2', [modified('src/gone.ts'), modified('src/kept.ts')]),
      makeCommit('h1', [added('src/gone.ts')]),
    ]);

    expect(result.map((commit) => commit.files)).toEqual([
      ['src/gone.ts'],
      ['src/gone.ts', 'src/kept.ts'],
      ['src/gone.ts'],
    ]);
  });

  it('canonicalizeChangeLog sorts and de-duplicates files within a commit', () => {
    // "src/a.ts" was renamed to "src/b.ts" later, so in the older commit both names are one file.
    const result = canonicalizeChangeLog([
      makeCommit('h2', [renamed('src/a.ts', 'src/b.ts')]),
      makeCommit('h1', [
        modified('src/z.ts'),
        modified('src/b.ts'),
        modified('src/a.ts'),
        modified('src/z.ts'),
      ]),
    ]);

    expect(result[1]!.files).toEqual(['src/b.ts', 'src/z.ts']);
  });

  it('canonicalizeChangeLog attributes a renamed and then deleted file to its last name', () => {
    const result = canonicalizeChangeLog([
      makeCommit('h3', [deleted('src/b.ts')]),
      makeCommit('h2', [renamed('src/a.ts', 'src/b.ts')]),
      makeCommit('h1', [added('src/a.ts')]),
    ]);

    expect(result.map((commit) => commit.files)).toEqual([['src/b.ts'], ['src/b.ts'], ['src/b.ts']]);
  });

  it('canonicalizeChangeLog only renames older commits and lets a newer commit reuse the old name', () => {
    // Newest first: after "a" was renamed to "b", a new, unrelated file took the name "a".
    const result = canonicalizeChangeLog([
      makeCommit('h4', [added('a')]),
      makeCommit('h3', [modified('b')]),
      makeCommit('h2', [renamed('a', 'b')]),
      makeCommit('h1', [modified('a')]),
    ]);

    expect(result.map((commit) => commit.files)).toEqual([['a'], ['b'], ['b'], ['b']]);
  });

  it('canonicalizeChangeLog counts a copy as its new path and creates no alias for the source', () => {
    // Newest first: "a" is copied to "b", and the copy "b" is renamed to "c" afterwards.
    const result = canonicalizeChangeLog([
      makeCommit('h4', [modified('a')]),
      makeCommit('h3', [renamed('b', 'c')]),
      makeCommit('h2', [copied('a', 'b')]),
      makeCommit('h1', [added('a')]),
    ]);

    expect(result.map((commit) => commit.files)).toEqual([['a'], ['c'], ['c'], ['a']]);
  });

  it('canonicalizeChangeLog treats a rename without an old path as a plain change', () => {
    const malformed: FileChange = { status: 'R', path: 'src/b.ts' };
    const result = canonicalizeChangeLog([
      makeCommit('h2', [malformed]),
      makeCommit('h1', [modified('src/b.ts'), modified('src/a.ts')]),
    ]);

    expect(result.map((commit) => commit.files)).toEqual([['src/b.ts'], ['src/a.ts', 'src/b.ts']]);
  });

  it('canonicalizeChangeLog orders files by code point, not by locale', () => {
    const result = canonicalizeChangeLog([
      makeCommit('h1', [modified('b.ts'), modified('a.ts'), modified('B.ts'), modified('A.ts')]),
    ]);

    expect(result[0]!.files).toEqual(['A.ts', 'B.ts', 'a.ts', 'b.ts']);
  });

  it('canonicalizeChangeLog carries the commit metadata over and keeps one entry per commit, in order', () => {
    const result = canonicalizeChangeLog([
      makeCommit('h3', [], {
        message: 'empty commit',
        date: '2026-03-01T00:00:00+02:00',
        author: 'Carol',
        committedAt: 300,
      }),
      makeCommit('h2', [modified('a')], {
        message: 'touch a',
        date: '2026-02-01T00:00:00+00:00',
        author: 'Bob',
        committedAt: 200,
      }),
    ]);

    expect(result).toStrictEqual([
      {
        hash: 'h3',
        message: 'empty commit',
        date: '2026-03-01T00:00:00+02:00',
        author: 'Carol',
        committedAt: 300,
        files: [],
      },
      {
        hash: 'h2',
        message: 'touch a',
        date: '2026-02-01T00:00:00+00:00',
        author: 'Bob',
        committedAt: 200,
        files: ['a'],
      },
    ]);
  });

  it('canonicalizeChangeLog returns an empty list for an empty log', () => {
    expect(canonicalizeChangeLog([])).toEqual([]);
  });

  it('canonicalizeChangeLog does not modify its input', () => {
    const log = deepFreeze([
      makeCommit('h2', [renamed('a', 'b'), modified('z')]),
      makeCommit('h1', [modified('a')]),
    ]);

    expect(() => canonicalizeChangeLog(log)).not.toThrow();
  });
});
