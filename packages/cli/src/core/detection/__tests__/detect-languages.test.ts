import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  detectLanguages,
  decideNeededLanguages,
  officialPluginFor,
} from '../detect-languages.js';

function initRepo(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
}

function commitAll(dir: string): void {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init', '--quiet'],
    { cwd: dir },
  );
}

function touch(root: string, relPath: string, content = ''): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('detectLanguages', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctxo-detect-'));
    initRepo(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty result on an empty git repo', () => {
    const result = detectLanguages(tempDir);
    expect(result.byManifest).toEqual({});
    expect(result.byExtension).toEqual({});
    expect(result.totalFiles).toBe(0);
    expect(result.unknownExtensions).toEqual({});
  });

  it('flags Python via pyproject.toml manifest', () => {
    touch(tempDir, 'pyproject.toml', '[project]\nname="x"');
    commitAll(tempDir);
    const result = detectLanguages(tempDir);
    expect(result.byManifest).toEqual({ python: 'pyproject.toml' });
  });

  it('flags Java via pom.xml manifest', () => {
    touch(tempDir, 'pom.xml', '<project/>');
    commitAll(tempDir);
    const result = detectLanguages(tempDir);
    expect(result.byManifest.java).toBe('pom.xml');
  });

  it('flags Go via go.mod manifest', () => {
    touch(tempDir, 'go.mod', 'module example.com/x');
    commitAll(tempDir);
    const result = detectLanguages(tempDir);
    expect(result.byManifest.go).toBe('go.mod');
  });

  it('flags C# via .csproj manifest', () => {
    touch(tempDir, 'App.csproj', '<Project/>');
    commitAll(tempDir);
    const result = detectLanguages(tempDir);
    expect(result.byManifest.csharp).toBe('App.csproj');
  });

  it('flags Rust via Cargo.toml', () => {
    touch(tempDir, 'Cargo.toml', '[package]');
    commitAll(tempDir);
    const result = detectLanguages(tempDir);
    expect(result.byManifest.rust).toBe('Cargo.toml');
  });

  it('counts files per language via git ls-files', () => {
    touch(tempDir, 'src/a.ts', '');
    touch(tempDir, 'src/b.ts', '');
    touch(tempDir, 'src/c.go', '');
    touch(tempDir, 'doc.md', '');
    commitAll(tempDir);
    const result = detectLanguages(tempDir);
    expect(result.byExtension.typescript).toBe(2);
    expect(result.byExtension.go).toBe(1);
    expect(result.totalFiles).toBe(4);
    expect(result.unknownExtensions['.md']).toBe(1);
  });

  it('merges .ts and .tsx into a single typescript count', () => {
    touch(tempDir, 'a.ts', '');
    touch(tempDir, 'b.tsx', '');
    commitAll(tempDir);
    const result = detectLanguages(tempDir);
    expect(result.byExtension.typescript).toBe(2);
  });

  it('reports both manifest and extension signals when both exist', () => {
    touch(tempDir, 'go.mod', 'module x');
    touch(tempDir, 'a.go', '');
    touch(tempDir, 'b.go', '');
    commitAll(tempDir);
    const result = detectLanguages(tempDir);
    expect(result.byManifest.go).toBe('go.mod');
    expect(result.byExtension.go).toBe(2);
  });
});

describe('decideNeededLanguages', () => {
  it('always includes manifest-backed languages', () => {
    const needed = decideNeededLanguages({
      byManifest: { python: 'pyproject.toml' },
      byExtension: {},
      totalFiles: 0,
      unknownExtensions: {},
    });
    expect(needed).toContain('python');
  });

  it('includes extension-only language when count and ratio clear thresholds', () => {
    const needed = decideNeededLanguages({
      byManifest: {},
      byExtension: { typescript: 20 },
      totalFiles: 100,
      unknownExtensions: {},
    });
    expect(needed).toContain('typescript');
  });

  it('skips extension-only language below file count threshold', () => {
    const needed = decideNeededLanguages({
      byManifest: {},
      byExtension: { typescript: 3 },
      totalFiles: 10,
      unknownExtensions: {},
    });
    expect(needed).not.toContain('typescript');
  });

  it('skips extension-only language below ratio threshold', () => {
    const needed = decideNeededLanguages({
      byManifest: {},
      byExtension: { typescript: 10 },
      totalFiles: 10_000,
      unknownExtensions: {},
    });
    expect(needed).not.toContain('typescript');
  });

  it('respects custom thresholds', () => {
    const needed = decideNeededLanguages(
      {
        byManifest: {},
        byExtension: { typescript: 2 },
        totalFiles: 100,
        unknownExtensions: {},
      },
      { minFiles: 1, minRatio: 0.01 },
    );
    expect(needed).toContain('typescript');
  });
});

describe('officialPluginFor', () => {
  it('builds the official npm package name', () => {
    expect(officialPluginFor('python')).toBe('@ctxo/lang-python');
    expect(officialPluginFor('typescript')).toBe('@ctxo/lang-typescript');
  });
});
