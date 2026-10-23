import { describe, it, expect } from 'vitest';
import { buildIntentHistory } from '../intent-history.js';
import { canonicalizeChangeLog } from '../change-log.js';
import type { CanonicalCommit } from '../change-log.js';
import type { CommitChangeSet } from '../../types.js';

function makeCanonical(
  hash: string,
  files: readonly string[],
  overrides: Partial<CanonicalCommit> = {},
): CanonicalCommit {
  return {
    hash,
    message: `message of ${hash}`,
    date: '2026-01-02T03:04:05+00:00',
    author: 'Test Author',
    committedAt: 1_767_323_045,
    files,
    ...overrides,
  };
}

const hashesOf = (records: readonly { readonly hash: string }[] | undefined): string[] | undefined =>
  records?.map((record) => record.hash);

describe('intent history', () => {
  it('buildIntentHistory keeps the newest maxPerFile commits per canonical file', () => {
    const commits = [
      makeCanonical('h3', ['c'], { message: 'third', date: '2026-03-01T00:00:00+00:00', author: 'Carol' }),
      makeCanonical('h2', ['c'], { message: 'second', date: '2026-02-01T00:00:00+00:00', author: 'Bob' }),
      makeCanonical('h1', ['c'], { message: 'first', date: '2026-01-01T00:00:00+00:00', author: 'Alice' }),
    ];

    const history = buildIntentHistory(commits, 2);

    expect(history.size).toBe(1);
    expect(history.get('c')).toStrictEqual([
      { hash: 'h3', message: 'third', date: '2026-03-01T00:00:00+00:00', author: 'Carol' },
      { hash: 'h2', message: 'second', date: '2026-02-01T00:00:00+00:00', author: 'Bob' },
    ]);
  });

  it('buildIntentHistory counts the limit per file, so a full file does not block the others', () => {
    const commits = [
      makeCanonical('h3', ['a']),
      makeCanonical('h2', ['a', 'b']),
      makeCanonical('h1', ['a', 'b']),
    ];

    const history = buildIntentHistory(commits, 2);

    expect(hashesOf(history.get('a'))).toEqual(['h3', 'h2']);
    expect(hashesOf(history.get('b'))).toEqual(['h2', 'h1']);
    // The record of a multi-file commit is the same for each of its files.
    expect(history.get('a')![1]).toStrictEqual(history.get('b')![0]);
  });

  it('buildIntentHistory lists a commit once per file', () => {
    const commits = [
      makeCanonical('h2', ['a', 'a']),
      makeCanonical('h2', ['a']),
      makeCanonical('h1', ['a']),
    ];

    expect(hashesOf(buildIntentHistory(commits, 10).get('a'))).toEqual(['h2', 'h1']);
  });

  it('buildIntentHistory follows renames when it is fed by canonicalizeChangeLog', () => {
    const log: CommitChangeSet[] = [
      {
        hash: 'h3',
        message: 'move b to c',
        date: '2026-03-01T00:00:00+00:00',
        author: 'Carol',
        committedAt: 300,
        changes: [
          { status: 'R', path: 'c', oldPath: 'b' },
          { status: 'M', path: 'util' },
        ],
      },
      {
        hash: 'h2',
        message: 'move a to b',
        date: '2026-02-01T00:00:00+00:00',
        author: 'Bob',
        committedAt: 200,
        changes: [{ status: 'R', path: 'b', oldPath: 'a' }],
      },
      {
        hash: 'h1',
        message: 'add a and util',
        date: '2026-01-01T00:00:00+00:00',
        author: 'Alice',
        committedAt: 100,
        changes: [
          { status: 'A', path: 'a' },
          { status: 'A', path: 'util' },
        ],
      },
    ];

    const history = buildIntentHistory(canonicalizeChangeLog(log), 10);

    expect(hashesOf(history.get('c'))).toEqual(['h3', 'h2', 'h1']);
    expect(hashesOf(history.get('util'))).toEqual(['h3', 'h1']);
    expect([...history.keys()].sort()).toEqual(['c', 'util']);
  });

  it('buildIntentHistory returns an empty map for an empty list', () => {
    expect(buildIntentHistory([], 5).size).toBe(0);
  });

  it.each([0, -3, Number.NaN])('buildIntentHistory returns no entries when maxPerFile is %s', (maxPerFile) => {
    expect(buildIntentHistory([makeCanonical('h1', ['a'])], maxPerFile).size).toBe(0);
  });

  it('buildIntentHistory rounds a fractional maxPerFile down', () => {
    const commits = [makeCanonical('h2', ['a']), makeCanonical('h1', ['a'])];

    expect(hashesOf(buildIntentHistory(commits, 1.9).get('a'))).toEqual(['h2']);
  });
});
