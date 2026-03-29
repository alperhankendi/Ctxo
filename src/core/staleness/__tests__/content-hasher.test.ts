import { describe, it, expect } from 'vitest';
import { ContentHasher } from '../content-hasher.js';

describe('ContentHasher', () => {
  const hasher = new ContentHasher();

  it('produces identical hash for identical content', () => {
    const content = 'export function foo() { return 1; }';
    const hash1 = hasher.hash(content);
    const hash2 = hasher.hash(content);

    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different content', () => {
    const hash1 = hasher.hash('export function foo() { return 1; }');
    const hash2 = hasher.hash('export function foo() { return 2; }');

    expect(hash1).not.toBe(hash2);
  });

  it('handles empty string input', () => {
    const hash = hasher.hash('');
    expect(hash).toBe(hasher.hash(''));
    expect(hash.length).toBe(64); // SHA-256 hex = 64 chars
  });

  it('handles very large string (100K+ chars)', () => {
    const large = 'x'.repeat(100_000);
    const hash = hasher.hash(large);

    expect(hash.length).toBe(64);
    expect(hash).toBe(hasher.hash(large));
  });

  it('returns hex string of 64 characters', () => {
    const hash = hasher.hash('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is sensitive to whitespace changes', () => {
    const hash1 = hasher.hash('foo bar');
    const hash2 = hasher.hash('foo  bar');

    expect(hash1).not.toBe(hash2);
  });

  it('is sensitive to unicode content', () => {
    const hash1 = hasher.hash('hello');
    const hash2 = hasher.hash('héllo');

    expect(hash1).not.toBe(hash2);
  });
});
