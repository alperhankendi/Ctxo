import type { CommitRecord, AntiPattern } from '../types.js';

// Explicit revert patterns
const REVERT_QUOTED_PATTERN = /^Revert "(.+)"$/;
const REVERT_PREFIX_PATTERN = /^revert:\s*(.+)$/i;

// Undo/rollback patterns
const UNDO_PATTERN = /^undo[:\s]/i;
const ROLLBACK_PATTERN = /^rollback[:\s]/i;

// Indirect revert indicators (keywords in commit message body)
const INDIRECT_KEYWORDS = [
  /\brevert(?:s|ed|ing)?\b/i,
  /\broll(?:s|ed|ing)?\s*back\b/i,
  /\bundo(?:es|ne|ing)?\b/i,
  /\bbacked?\s*out\b/i,
  /\bremov(?:e|es|ed|ing)\s+(?:broken|buggy|faulty)\b/i,
];

export class RevertDetector {
  detect(commits: readonly CommitRecord[]): AntiPattern[] {
    const antiPatterns: AntiPattern[] = [];

    for (const commit of commits) {
      if (!commit.message) continue;

      if (this.isRevert(commit.message)) {
        antiPatterns.push({
          hash: commit.hash,
          message: commit.message,
          date: commit.date,
        });
      }
    }

    return antiPatterns;
  }

  private isRevert(message: string): boolean {
    // Explicit patterns (high confidence)
    if (REVERT_QUOTED_PATTERN.test(message)) return true;
    if (REVERT_PREFIX_PATTERN.test(message)) return true;
    if (UNDO_PATTERN.test(message)) return true;
    if (ROLLBACK_PATTERN.test(message)) return true;

    // Indirect indicators (keyword search in full message)
    for (const pattern of INDIRECT_KEYWORDS) {
      if (pattern.test(message)) return true;
    }

    return false;
  }
}
