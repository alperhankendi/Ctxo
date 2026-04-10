import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLATFORMS, generateRules, installRules, detectPlatforms } from '../ai-rules.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function makeTempDir(prefix = 'ctxo-rules-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('PLATFORMS', () => {
  it('has unique IDs', () => {
    const ids = PLATFORMS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique file paths', () => {
    const files = PLATFORMS.map(p => p.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('includes claude-code as append mode', () => {
    const claude = PLATFORMS.find(p => p.id === 'claude-code');
    expect(claude).toBeDefined();
    expect(claude!.mode).toBe('append');
  });

  it('every platform has at least one detect path', () => {
    for (const p of PLATFORMS) {
      expect(p.detectPaths.length).toBeGreaterThan(0);
    }
  });
});

describe('detectPlatforms', () => {
  it('returns empty set for a bare directory', () => {
    const dir = makeTempDir();
    expect(detectPlatforms(dir).size).toBe(0);
  });

  it('detects claude-code when CLAUDE.md exists', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'CLAUDE.md'), '# test', 'utf-8');
    const detected = detectPlatforms(dir);
    expect(detected.has('claude-code')).toBe(true);
  });

  it('detects cursor when .cursor/ exists', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.cursor'));
    const detected = detectPlatforms(dir);
    expect(detected.has('cursor')).toBe(true);
  });

  it('detects multiple platforms', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'CLAUDE.md'), '# test', 'utf-8');
    mkdirSync(join(dir, '.vscode'));
    const detected = detectPlatforms(dir);
    expect(detected.has('claude-code')).toBe(true);
    expect(detected.has('github-copilot')).toBe(true);
  });
});

describe('generateRules', () => {
  it('generates markdown with mandatory rules for all platforms', () => {
    for (const p of PLATFORMS) {
      const content = generateRules(p.id);
      expect(content).toContain('get_blast_radius');
      expect(content).toContain('get_why_context');
      expect(content).toContain('get_context_for_task');
      expect(content).toContain('NEVER');
    }
  });

  it('adds YAML frontmatter for cursor', () => {
    const content = generateRules('cursor');
    expect(content).toContain('---');
    expect(content).toContain('alwaysApply: true');
  });

  it('does not add frontmatter for non-cursor platforms', () => {
    const content = generateRules('claude-code');
    expect(content).not.toContain('alwaysApply');
  });
});

describe('installRules', () => {
  it('creates a new file for create-mode platforms', () => {
    const dir = makeTempDir();
    const result = installRules(dir, 'windsurf');

    expect(result.file).toBe('.windsurfrules');
    expect(existsSync(join(dir, '.windsurfrules'))).toBe(true);

    const content = readFileSync(join(dir, '.windsurfrules'), 'utf-8');
    expect(content).toContain('get_blast_radius');
  });

  it('creates nested directories for cursor', () => {
    const dir = makeTempDir();
    const result = installRules(dir, 'cursor');

    expect(result.file).toBe('.cursor/rules/ctxo-mcp.mdc');
    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo-mcp.mdc'))).toBe(true);

    const content = readFileSync(join(dir, '.cursor', 'rules', 'ctxo-mcp.mdc'), 'utf-8');
    expect(content).toContain('alwaysApply: true');
  });

  it('creates nested directories for amazon q', () => {
    const dir = makeTempDir();
    installRules(dir, 'amazonq');
    expect(existsSync(join(dir, '.amazonq', 'rules', 'ctxo-mcp.md'))).toBe(true);
  });

  it('appends a marked section to existing CLAUDE.md', () => {
    const dir = makeTempDir();
    const claudeMd = join(dir, 'CLAUDE.md');
    writeFileSync(claudeMd, '# My Project\n\nExisting content.\n', 'utf-8');

    const result = installRules(dir, 'claude-code');
    expect(result.action).toBe('updated');

    const content = readFileSync(claudeMd, 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Existing content.');
    expect(content).toContain('<!-- ctxo-rules-start -->');
    expect(content).toContain('<!-- ctxo-rules-end -->');
    expect(content).toContain('get_blast_radius');
  });

  it('replaces existing ctxo section on re-run (idempotent)', () => {
    const dir = makeTempDir();
    const claudeMd = join(dir, 'CLAUDE.md');
    writeFileSync(claudeMd, '# My Project\n', 'utf-8');

    installRules(dir, 'claude-code');
    installRules(dir, 'claude-code');

    const content = readFileSync(claudeMd, 'utf-8');
    const startCount = (content.match(/<!-- ctxo-rules-start -->/g) ?? []).length;
    expect(startCount).toBe(1);
  });

  it('creates CLAUDE.md if it does not exist (append mode)', () => {
    const dir = makeTempDir();
    const result = installRules(dir, 'claude-code');

    expect(result.action).toBe('created');
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
  });

  it('throws on unknown platform ID', () => {
    const dir = makeTempDir();
    expect(() => installRules(dir, 'unknown-tool')).toThrow('Unknown platform');
  });

  it('installs all platforms without error', () => {
    const dir = makeTempDir();
    for (const p of PLATFORMS) {
      expect(() => installRules(dir, p.id)).not.toThrow();
    }
  });
});
