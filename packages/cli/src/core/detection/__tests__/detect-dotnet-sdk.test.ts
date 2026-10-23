import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDotnetSdkMajor,
  detectDotnetSdkVersion,
  resetDotnetSdkCacheForTests,
} from '../detect-dotnet-sdk.js';

describe('parseDotnetSdkMajor', () => {
  it('reads 8.0.404 as 8', () => expect(parseDotnetSdkMajor('8.0.404')).toBe(8));
  it('reads 10.0.100-rc.1.25451.107 as 10', () => expect(parseDotnetSdkMajor('10.0.100-rc.1.25451.107')).toBe(10));
  it('returns undefined for garbage', () => expect(parseDotnetSdkMajor('No .NET SDKs were found.')).toBeUndefined());
  it('returns undefined for an empty string', () => expect(parseDotnetSdkMajor('')).toBeUndefined());
});

describe('detectDotnetSdkVersion', () => {
  beforeEach(() => {
    resetDotnetSdkCacheForTests();
  });

  it('returns a trimmed version string or undefined without throwing', () => {
    // The SDK may or may not be installed on the machine running the tests; assert the contract.
    const version = detectDotnetSdkVersion();
    expect(version === undefined || (typeof version === 'string' && version === version.trim() && version.length > 0)).toBe(true);
  });

  it('returns the same value on successive calls (memoized)', () => {
    const first = detectDotnetSdkVersion();
    expect(detectDotnetSdkVersion()).toStrictEqual(first);
    resetDotnetSdkCacheForTests();
    expect(detectDotnetSdkVersion()).toStrictEqual(first);
  });
});
