import { describe, it, expect } from 'vitest';
import { detectChannel, compareSemver } from '../update-plan.js';

describe('detectChannel', () => {
  it('returns "latest" for stable versions', () => {
    expect(detectChannel('0.7.0')).toBe('latest');
    expect(detectChannel('10.20.30')).toBe('latest');
  });

  it('returns the prerelease channel for tagged versions', () => {
    expect(detectChannel('0.7.0-alpha.0')).toBe('alpha');
    expect(detectChannel('1.0.0-beta.3')).toBe('beta');
    expect(detectChannel('2.0.0-rc.1')).toBe('rc');
    expect(detectChannel('3.0.0-next.4')).toBe('next');
  });

  it('falls back to "latest" when prerelease label is missing or numeric-only', () => {
    expect(detectChannel('1.0.0-')).toBe('latest');
    expect(detectChannel('1.0.0-0')).toBe('latest');
  });
});

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('0.7.0-alpha.0', '0.7.0-alpha.0')).toBe(0);
  });

  it('orders by major, then minor, then patch', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.2.0', '1.3.0')).toBe(-1);
    expect(compareSemver('1.2.10', '1.2.9')).toBe(1);
  });

  it('treats prerelease as lower precedence than the equivalent release', () => {
    expect(compareSemver('1.0.0-alpha.0', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-alpha.0')).toBe(1);
  });

  it('orders prerelease identifiers per semver section 11', () => {
    expect(compareSemver('1.0.0-alpha.0', '1.0.0-alpha.1')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1); // numeric, not lexical
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1); // numeric < non-numeric
  });

  it('ignores build metadata', () => {
    expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
  });
});
