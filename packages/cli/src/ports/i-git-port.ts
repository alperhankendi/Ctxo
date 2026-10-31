import type { CommitRecord, ChurnData, ChangeLog, FileChange, GitRange, GitRefs, RangeCommit } from '../core/types.js';

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
  /**
   * The methods below return undefined when git fails, and refuse any ref that starts with `-`.
   */
  /** Full SHA of `<ref>^{commit}`. */
  resolveCommit?(ref: string): Promise<string | undefined>;
  /** Full SHA of the merge base of two refs. */
  mergeBase?(a: string, b: string): Promise<string | undefined>;
  /**
   * The commits after `base` on the first-parent line of `head` that descend from `base`, nearest first
   * (`rev-list --reverse --first-parent --ancestry-path base..head`), at most `limit`.
   */
  firstParentSuccessors?(base: string, head: string, limit: number): Promise<string[] | undefined>;
  /** Whether `ancestor` is reachable from `descendant`. */
  isAncestor?(ancestor: string, descendant: string): Promise<boolean | undefined>;
  /**
   * Commits reachable from `range.head` and from none of `range.exclude`, newest first. Merge commits
   * carry no changes. `trailerKey` collects that trailer's values per commit.
   */
  getRangeLog?(range: GitRange, options?: { readonly trailerKey?: string }): Promise<RangeCommit[] | undefined>;
  /**
   * 'all': staged, unstaged and untracked (not ignored) changes against HEAD; 'staged': only the index.
   */
  getWorkingTreeChanges?(scope: 'all' | 'staged'): Promise<FileChange[] | undefined>;
  /** Current branch, upstream, origin/HEAD and the branch list. */
  getRefs?(): Promise<GitRefs | undefined>;
  /** Tracked paths (git ls-files -z), repo-relative, forward slashes. */
  listTrackedFiles?(): Promise<string[] | undefined>;
}
