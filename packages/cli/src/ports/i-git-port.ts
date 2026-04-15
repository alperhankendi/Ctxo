import type { CommitRecord, ChurnData } from '../core/types.js';

export interface IGitPort {
  getCommitHistory(filePath: string, maxCount?: number): Promise<CommitRecord[]>;
  getBatchHistory?(maxCount?: number): Promise<Map<string, CommitRecord[]>>;
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
}
