import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifySha256, resolveAnalyzerJar } from '../jar-download.js';

describe('verifySha256', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctxo-jar-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  it('returns true when the file hash matches', () => {
    const f = join(dir, 'a.jar'); writeFileSync(f, 'hello');
    const sha = createHash('sha256').update('hello').digest('hex');
    expect(verifySha256(f, sha)).toBe(true);
  });
  it('returns false on mismatch', () => {
    const f = join(dir, 'a.jar'); writeFileSync(f, 'hello');
    expect(verifySha256(f, 'deadbeef')).toBe(false);
  });
  it('returns false when file is missing', () => {
    expect(verifySha256(join(dir, 'nope.jar'), 'x')).toBe(false);
  });
});

describe('resolveAnalyzerJar', () => {
  let dir: string;
  const ENV = 'CTXO_JDT_ANALYZER_JAR';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ctxo-jar-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env[ENV]; });
  it('uses the env override when set and the file exists', () => {
    const f = join(dir, 'override.jar'); writeFileSync(f, 'x');
    process.env[ENV] = f;
    expect(resolveAnalyzerJar('0.8.0')).toBe(f);
  });
  it('ignores the env override when the file does not exist', () => {
    process.env[ENV] = join(dir, 'missing.jar');
    expect(resolveAnalyzerJar('0.8.0', { cacheRoot: dir })).toBeNull();
  });
  it('uses a cached jar when present (no SHA pinned -> accept)', () => {
    const cacheDir = join(dir, '0.8.0'); mkdirSync(cacheDir, { recursive: true });
    const jar = join(cacheDir, 'ctxo-jdt-analyzer.jar'); writeFileSync(jar, 'x');
    expect(resolveAnalyzerJar('0.8.0', { cacheRoot: dir, expectedSha: null })).toBe(jar);
  });
  it('rejects a cached jar when SHA does not match', () => {
    const cacheDir = join(dir, '0.8.0'); mkdirSync(cacheDir, { recursive: true });
    const jar = join(cacheDir, 'ctxo-jdt-analyzer.jar'); writeFileSync(jar, 'x');
    expect(resolveAnalyzerJar('0.8.0', { cacheRoot: dir, expectedSha: 'deadbeef' })).toBeNull();
  });
});
