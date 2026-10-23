import type { CommitRecord, ChurnData, ChangeLog, FileChange } from '../core/types.js';

export interface IGitPort {
  getCommitHistory(filePath: string, maxCount?: number): Promise<CommitRecord[]>;
  getFileChurn(filePath: string): Promise<ChurnData>;
  getChangedFiles(since: string): Promise<string[]>;
  isAvailable(): Promise<boolean>;
  /** Short (8-char) SHA of current HEAD, or undefined if git is unavailable. */
  getHeadSha?(): Promise<string | undefined>;
  /**
   * Number of commits in `base..HEAD` (reachable from HEAD but not from base).
   * Returns undefined when either ref cannot be resolved. Zero means HEAD has
   * not advanced past `base`.
   */
  countCommitsBetween?(base: string): Promise<number | undefined>;
  /**
   * Non-merge commits reachable from HEAD, newest first, each with the files it
   * changed (renames carry `oldPath`). `maxCommits` caps the number of non-merge
   * commits; 'all' reads the whole history. `head` and `headCommittedAt` describe
   * HEAD itself, even when HEAD is a merge commit. Returns undefined when git
   * fails or the repository has no commits.
   */
  getChangeLog?(maxCommits: number | 'all'): Promise<ChangeLog | undefined>;
  /**
   * Files changed by a single commit, root commits included. A merge commit
   * yields an empty list. Returns undefined when `rev` cannot be resolved or git
   * fails.
   */
  getCommitFileChanges?(rev: string): Promise<FileChange[] | undefined>;
  /**
   * Tracked paths that git marks skip-worktree (a sparse checkout, or
   * `git update-index --skip-worktree`): git still tracks them, but they are
   * deliberately absent from the working tree. Repo-relative, forward slashes.
   * Returns undefined when git fails, so a caller can fail safe.
   */
  getSkipWorktreePaths?(): Promise<ReadonlySet<string> | undefined>;
  /**
   * Of the given repo-relative paths, those that git ignores (.gitignore, .git/info/exclude, the global
   * excludes). A tracked file is never ignored in this sense, however a pattern matches it. Returns
   * undefined when git fails.
   */
  getIgnoredPaths?(paths: readonly string[]): Promise<ReadonlySet<string> | undefined>;
}
