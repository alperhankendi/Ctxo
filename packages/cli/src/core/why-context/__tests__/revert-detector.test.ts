import { describe, it, expect } from 'vitest';
import { RevertDetector } from '../revert-detector.js';
import type { CommitRecord } from '../../types.js';

function buildCommit(message: string, hash = 'abc123'): CommitRecord {
  return { hash, message, date: '2024-03-15', author: 'dev' };
}

describe('RevertDetector', () => {
  const detector = new RevertDetector();

  it('detects \'Revert "original message"\' pattern', () => {
    const commits = [buildCommit('Revert "add rate limiting"')];
    const result = detector.detect(commits);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe('Revert "add rate limiting"');
  });

  it('detects "revert: description" prefix pattern', () => {
    const commits = [buildCommit('revert: remove mutex lock')];
    const result = detector.detect(commits);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe('revert: remove mutex lock');
  });

  it('returns empty array when no revert commits found', () => {
    const commits = [
      buildCommit('feat: add login'),
      buildCommit('fix: correct typo'),
    ];
    expect(detector.detect(commits)).toEqual([]);
  });

  it('detects multiple revert commits in history', () => {
    const commits = [
      buildCommit('Revert "add caching"', 'hash1'),
      buildCommit('fix: something else', 'hash2'),
      buildCommit('revert: disable feature flag', 'hash3'),
    ];
    const result = detector.detect(commits);
    expect(result).toHaveLength(2);
  });

  it('extracts original commit reference from revert message', () => {
    const commits = [buildCommit('Revert "implement SSO"')];
    const result = detector.detect(commits);
    expect(result[0]?.hash).toBe('abc123');
  });

  it('detects "revert" keyword in sentence context', () => {
    const commits = [buildCommit('This commit does not revert anything')];
    // With extended detection (#4), keyword "revert" in body IS flagged
    expect(detector.detect(commits)).toHaveLength(1);
  });

  it('handles empty commit message', () => {
    const commits = [buildCommit('')];
    expect(detector.detect(commits)).toEqual([]);
  });

  it('handles commit message with unicode characters', () => {
    const commits = [buildCommit('revert: geri al — önceki değişiklik')];
    const result = detector.detect(commits);
    expect(result).toHaveLength(1);
  });

  it('is case-insensitive for revert: prefix', () => {
    const commits = [buildCommit('REVERT: undo migration')];
    const result = detector.detect(commits);
    expect(result).toHaveLength(1);
  });

  // Extended patterns (#4)
  it('detects "undo:" prefix pattern', () => {
    const commits = [buildCommit('undo: remove broken feature')];
    expect(detector.detect(commits)).toHaveLength(1);
  });

  it('detects "rollback:" prefix pattern', () => {
    const commits = [buildCommit('rollback: restore previous auth logic')];
    expect(detector.detect(commits)).toHaveLength(1);
  });

  it('detects "reverted" keyword in commit message', () => {
    const commits = [buildCommit('fix: reverted the caching change that caused deadlocks')];
    expect(detector.detect(commits)).toHaveLength(1);
  });

  it('detects "rolled back" keyword in commit message', () => {
    const commits = [buildCommit('chore: rolled back migration to fix prod')];
    expect(detector.detect(commits)).toHaveLength(1);
  });

  it('detects "backed out" keyword in commit message', () => {
    const commits = [buildCommit('backed out the SSO changes due to regression')];
    expect(detector.detect(commits)).toHaveLength(1);
  });

  it('detects "remove broken" keyword in commit message', () => {
    const commits = [buildCommit('fix: removing broken rate limiter implementation')];
    expect(detector.detect(commits)).toHaveLength(1);
  });

  it('does NOT flag normal commits with "remove" without broken/buggy', () => {
    const commits = [buildCommit('refactor: remove unused imports')];
    expect(detector.detect(commits)).toEqual([]);
  });

  it('does NOT flag normal fix commits', () => {
    const commits = [buildCommit('fix: correct typo in error message')];
    expect(detector.detect(commits)).toEqual([]);
  });
});
