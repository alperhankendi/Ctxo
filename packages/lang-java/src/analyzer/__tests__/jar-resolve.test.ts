import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveAnalyzerJar, analyzerPackageVersion, baseVersionMismatch } from '../jar-resolve.js';

const require = createRequire(import.meta.url);
const ENV = 'CTXO_JDT_ANALYZER_JAR';
afterEach(() => { delete process.env[ENV]; });

describe('resolveAnalyzerJar', () => {
  it('honors the env override when the file exists', () => {
    const real = require.resolve('@ctxo/lang-java-analyzer/package.json');
    process.env[ENV] = real;
    expect(resolveAnalyzerJar()).toBe(real);
  });
  it('never throws; returns an existing path or null', () => {
    const result = resolveAnalyzerJar();
    if (result !== null) expect(existsSync(result)).toBe(true);
    else expect(result).toBeNull();
  });
  it('ignores a missing env override and falls through', () => {
    process.env[ENV] = 'Z:/missing-' + Date.now() + '.jar';
    const result = resolveAnalyzerJar();
    if (result !== null) expect(existsSync(result)).toBe(true);
  });
  it('does not throw and returns string|null (smoke test: resolution tries process.cwd())', () => {
    const result = resolveAnalyzerJar();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

describe('analyzerPackageVersion', () => {
  it('returns the installed analyzer package version (string) or null', () => {
    const v = analyzerPackageVersion();
    expect(v === null || typeof v === 'string').toBe(true);
  });
});

describe('baseVersionMismatch', () => {
  it('returns false when both versions share the same base (identical prerelease)', () => {
    expect(baseVersionMismatch('0.8.0-alpha.0', '0.8.0-alpha.0')).toBe(false);
  });
  it('returns false when base matches despite different prerelease suffix', () => {
    expect(baseVersionMismatch('0.8.0', '0.8.0-alpha.1')).toBe(false);
  });
  it('returns false when base matches despite prerelease on first arg', () => {
    expect(baseVersionMismatch('0.8.0-alpha.1', '0.8.0')).toBe(false);
  });
  it('returns true when minor version differs', () => {
    expect(baseVersionMismatch('0.8.0', '0.9.0')).toBe(true);
  });
  it('returns true when major version differs', () => {
    expect(baseVersionMismatch('1.0.0', '2.0.0')).toBe(true);
  });
  it('returns true when patch version differs', () => {
    expect(baseVersionMismatch('0.8.0', '0.8.1')).toBe(true);
  });
  it('returns false when build metadata differs but base is same', () => {
    expect(baseVersionMismatch('1.0.0+build', '1.0.0')).toBe(false);
  });
  it('returns false for identical plain versions', () => {
    expect(baseVersionMismatch('1.2.3', '1.2.3')).toBe(false);
  });
});
