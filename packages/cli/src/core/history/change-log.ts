import { compareCodepoint } from '../compare-codepoint.js';
import type { CommitChangeSet } from '../types.js';

/** A non-merge commit with its changed paths mapped to the newest name of each file. */
export interface CanonicalCommit {
  readonly hash: string;
  readonly message: string;
  readonly date: string;
  readonly author: string;
  readonly committedAt: number;
  /** Canonical file names the commit touched: sorted by code point, no duplicates. */
  readonly files: readonly string[];
}

/**
 * Maps every path in a change log to the newest name of its file, so a file keeps one identity
 * across renames.
 *
 * `commits` must be newest first (the order `git log` returns). The log is walked in that order
 * with an alias map: on `R old -> new` it records `canon[old] = canon[new] ?? new`, and every
 * path maps to `canon[path] ?? path`. A rename therefore reaches only commits older than itself;
 * a newer commit that reuses the old name keeps it. The entries of one commit can be handled in
 * order because git (with `-M`) reports a rename only between a deleted and an added path, so no
 * path is both the source and the destination of a rename in the same commit.
 *
 * A copy (`C`) contributes its new path and creates no alias. A deleted file keeps the last name
 * it had, and callers drop the files that no longer exist. Every input commit yields one output
 * commit in the same order, including commits that changed no files.
 */
export function canonicalizeChangeLog(commits: readonly CommitChangeSet[]): CanonicalCommit[] {
  const canon = new Map<string, string>();
  const canonical: CanonicalCommit[] = [];

  for (const commit of commits) {
    const files = new Set<string>();
    for (const change of commit.changes) {
      const newest = canon.get(change.path) ?? change.path;
      if (change.status === 'R' && change.oldPath !== undefined) {
        canon.set(change.oldPath, newest);
      }
      files.add(newest);
    }
    canonical.push({
      hash: commit.hash,
      message: commit.message,
      date: commit.date,
      author: commit.author,
      committedAt: commit.committedAt,
      files: [...files].sort(compareCodepoint),
    });
  }

  return canonical;
}
