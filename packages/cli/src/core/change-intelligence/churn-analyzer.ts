export class ChurnAnalyzer {
  normalize(commitCount: number, maxCommitCount: number): number {
    if (maxCommitCount <= 0) return 0;
    if (commitCount < 0) {
      throw new Error(`Invalid commit count: ${commitCount}`);
    }
    return Math.min(commitCount / maxCommitCount, 1);
  }
}
