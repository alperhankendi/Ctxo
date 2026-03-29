import type { CommitRecord, AntiPattern } from '../types.js';

const REVERT_QUOTED_PATTERN = /^Revert "(.+)"$/;
const REVERT_PREFIX_PATTERN = /^revert:\s*(.+)$/i;

export class RevertDetector {
  detect(commits: readonly CommitRecord[]): AntiPattern[] {
    const antiPatterns: AntiPattern[] = [];

    for (const commit of commits) {
      if (!commit.message) continue;

      const quotedMatch = REVERT_QUOTED_PATTERN.exec(commit.message);
      if (quotedMatch) {
        antiPatterns.push({
          hash: commit.hash,
          message: commit.message,
          date: commit.date,
        });
        continue;
      }

      const prefixMatch = REVERT_PREFIX_PATTERN.exec(commit.message);
      if (prefixMatch) {
        antiPatterns.push({
          hash: commit.hash,
          message: commit.message,
          date: commit.date,
        });
      }
    }

    return antiPatterns;
  }
}
