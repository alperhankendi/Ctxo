import { describe, it, expect } from 'vitest';
import { detectChannel, compareSemver, computePackageStates, selectInstallTargets } from '../update-plan.js';
import type { RegistryResult } from '../registry-client.js';

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

describe('computePackageStates', () => {
  const installed = [
    { name: '@ctxo/cli', version: '0.7.0-alpha.0' },
    { name: '@ctxo/lang-typescript', version: '0.7.0-alpha.0' },
    { name: '@ctxo/lang-csharp', version: '0.6.2' },
    { name: 'ctxo-lang-kotlin', version: '0.1.0' },
  ];

  it('marks packages with newer dist-tag as update', () => {
    const results: RegistryResult[] = [
      { name: '@ctxo/cli', distTags: { latest: '0.7.0', alpha: '0.7.0-alpha.3' } },
      { name: '@ctxo/lang-typescript', distTags: { latest: '0.7.0', alpha: '0.7.0-alpha.0' } },
      { name: '@ctxo/lang-csharp', distTags: { latest: '0.7.0' } },
      { name: 'ctxo-lang-kotlin', reason: 'registry-404', status: 404 },
    ];
    const states = computePackageStates(installed, results);
    expect(states[0]).toMatchObject({ name: '@ctxo/cli', current: '0.7.0-alpha.0', latest: '0.7.0-alpha.3', channel: 'alpha', status: 'update' });
    expect(states[1]).toMatchObject({ name: '@ctxo/lang-typescript', latest: '0.7.0-alpha.0', status: 'current' });
    expect(states[2]).toMatchObject({ name: '@ctxo/lang-csharp', latest: '0.7.0', channel: 'latest', status: 'update' });
    expect(states[3]).toMatchObject({ name: 'ctxo-lang-kotlin', latest: null, status: 'unknown', reason: 'registry-404' });
  });

  it('falls back to dist-tags.latest and reports channel=latest when the chosen channel is missing', () => {
    const states = computePackageStates(
      [{ name: '@ctxo/lang-go', version: '0.6.0-alpha.0' }],
      [{ name: '@ctxo/lang-go', distTags: { latest: '0.7.0' } }],
    );
    expect(states[0]).toMatchObject({ name: '@ctxo/lang-go', latest: '0.7.0', channel: 'latest', status: 'update' });
  });

  it('marks ahead when installed version is greater than registry target', () => {
    const states = computePackageStates(
      [{ name: '@ctxo/cli', version: '0.8.0' }],
      [{ name: '@ctxo/cli', distTags: { latest: '0.7.0' } }],
    );
    expect(states[0]).toMatchObject({ status: 'ahead' });
  });

  it('preserves input order when matching registry results by name', () => {
    const states = computePackageStates(
      [{ name: 'a', version: '1.0.0' }, { name: 'b', version: '1.0.0' }],
      [{ name: 'b', distTags: { latest: '1.0.0' } }, { name: 'a', distTags: { latest: '2.0.0' } }],
    );
    expect(states.map((s) => s.name)).toEqual(['a', 'b']);
    expect(states[0]).toMatchObject({ status: 'update', latest: '2.0.0' });
    expect(states[1]).toMatchObject({ status: 'current' });
  });

  it('treats a missing registry result the same as an unknown miss', () => {
    const states = computePackageStates(
      [{ name: 'x', version: '1.0.0' }],
      [],
    );
    expect(states[0]).toMatchObject({ status: 'unknown' });
  });
});

describe('selectInstallTargets', () => {
  it('returns only packages with status update', () => {
    const targets = selectInstallTargets([
      { name: 'a', current: '1.0.0', latest: '2.0.0', channel: 'latest', status: 'update' },
      { name: 'b', current: '1.0.0', latest: '1.0.0', channel: 'latest', status: 'current' },
      { name: 'c', current: '2.0.0', latest: '1.0.0', channel: 'latest', status: 'ahead' },
      { name: 'd', current: '1.0.0', latest: null, channel: 'latest', status: 'unknown' },
    ]);
    expect(targets).toEqual([{ name: 'a', version: '2.0.0' }]);
  });
});
