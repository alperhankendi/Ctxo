import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolveAnalyzerJar, analyzerPackageVersion } from '../jar-resolve.js';

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
});

describe('analyzerPackageVersion', () => {
  it('returns the installed analyzer package version (string) or null', () => {
    const v = analyzerPackageVersion();
    expect(v === null || typeof v === 'string').toBe(true);
  });
});
