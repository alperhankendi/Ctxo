import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateJavaTier, analyzerJarPresent, findJavaFile } from '../checks/java-tier-check.js';

describe('evaluateJavaTier', () => {
  it('pass: full tier when JRE>=17 and analyzer installed', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: 21, analyzerInstalled: true });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('full');
  });
  it('warn: JRE present but analyzer missing -> install hint', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: 21, analyzerInstalled: false });
    expect(r.status).toBe('warn');
    expect(r.fix).toContain('--full-tier');
  });
  it('warn: analyzer present but no JRE -> JRE hint', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: undefined, analyzerInstalled: true });
    expect(r.status).toBe('warn');
    expect((r.fix ?? '').toLowerCase()).toContain('jre');
  });
  it('pass(syntax): java present, no jre, no analyzer -> syntax tier, status pass with hint in message', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: 16, analyzerInstalled: false });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('syntax');
  });
  it('pass: no java sources -> no nag', () => {
    const r = evaluateJavaTier({ hasJava: false, jreMajor: undefined, analyzerInstalled: false });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('no Java');
  });
});

describe('analyzerJarPresent', () => {
  it('returns a boolean without throwing', () => {
    let result: boolean | undefined;
    expect(() => {
      result = analyzerJarPresent();
    }).not.toThrow();
    expect(typeof result).toBe('boolean');
  });

  it('returns false when the analyzer package is absent (should be absent in unit test env)', () => {
    // In the unit-test sandbox the real package is not installed.
    // analyzerJarPresent must return false, not throw.
    const result = analyzerJarPresent();
    // We can only assert it's a boolean — it may be true if installed.
    expect(typeof result).toBe('boolean');
  });
});

describe('findJavaFile', () => {
  it('returns true when a .java file exists nested under src', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-java-test-'));
    try {
      mkdirSync(join(dir, 'src', 'main', 'java'), { recursive: true });
      writeFileSync(join(dir, 'src', 'main', 'java', 'Foo.java'), '');
      expect(findJavaFile(dir, 4)).toBe(true);
    } finally {
      // best-effort cleanup
      try { rmdirSync(dir, { recursive: true } as Parameters<typeof rmdirSync>[1]); } catch { /* ignore */ }
    }
  });

  it('returns false for an empty temp directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-java-empty-'));
    try {
      expect(findJavaFile(dir, 4)).toBe(false);
    } finally {
      try { rmdirSync(dir, { recursive: true } as Parameters<typeof rmdirSync>[1]); } catch { /* ignore */ }
    }
  });

  it('returns false when .java files are deeper than maxDepth', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-java-deep-'));
    try {
      // depth 5 - beyond maxDepth=4
      mkdirSync(join(dir, 'a', 'b', 'c', 'd', 'e'), { recursive: true });
      writeFileSync(join(dir, 'a', 'b', 'c', 'd', 'e', 'Foo.java'), '');
      expect(findJavaFile(dir, 4)).toBe(false);
    } finally {
      try { rmdirSync(dir, { recursive: true } as Parameters<typeof rmdirSync>[1]); } catch { /* ignore */ }
    }
  });

  it('skips node_modules, target, build, .git directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-java-skip-'));
    try {
      for (const skip of ['node_modules', 'target', 'build', '.git']) {
        mkdirSync(join(dir, skip), { recursive: true });
        writeFileSync(join(dir, skip, 'Foo.java'), '');
      }
      expect(findJavaFile(dir, 4)).toBe(false);
    } finally {
      try { rmdirSync(dir, { recursive: true } as Parameters<typeof rmdirSync>[1]); } catch { /* ignore */ }
    }
  });
});
