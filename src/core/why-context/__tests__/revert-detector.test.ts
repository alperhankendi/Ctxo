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

  it('handles commit message with only "revert" word (not a pattern match)', () => {
    const commits = [buildCommit('This commit does not revert anything')];
    expect(detector.detect(commits)).toEqual([]);
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
});
