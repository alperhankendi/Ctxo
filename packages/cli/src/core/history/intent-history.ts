import type { CommitRecord } from '../types.js';
import type { CanonicalCommit } from './change-log.js';

/**
 * Builds the per-file commit history behind `intent[]`: for each canonical file, its newest
 * `maxPerFile` commits, newest first.
 *
 * `commits` must be newest first, as `canonicalizeChangeLog` returns them. A commit is listed at
 * most once per file. Files that no longer exist are included; callers read only the files they
 * index. A `maxPerFile` below one (or `NaN`) keeps nothing, and a fractional value rounds down.
 */
export function buildIntentHistory(
  commits: readonly CanonicalCommit[],
  maxPerFile: number,
): Map<string, CommitRecord[]> {
  const history = new Map<string, CommitRecord[]>();
  const limit = Math.floor(maxPerFile);
  if (!(limit >= 1)) return history;

  for (const commit of commits) {
    // One record per commit, shared by all of its files (records are read-only).
    let record: CommitRecord | undefined;
    for (const file of commit.files) {
      let records = history.get(file);
      if (records === undefined) {
        records = [];
        history.set(file, records);
      }
      if (records.length >= limit) continue;
      if (records.at(-1)?.hash === commit.hash) continue;
      record ??= { hash: commit.hash, message: commit.message, date: commit.date, author: commit.author };
      records.push(record);
    }
  }

  return history;
}
