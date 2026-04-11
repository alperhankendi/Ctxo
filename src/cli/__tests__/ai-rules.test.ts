import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLATFORMS, generateRules, installRules, detectPlatforms, ensureGitignore, ensureConfig, getMcpConfigTargets, ensureMcpConfig } from '../ai-rules.js';

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

describe('ensureGitignore', () => {
  it('creates .gitignore with cache entry if missing', () => {
    const dir = makeTempDir();
    const result = ensureGitignore(dir);
    expect(result.action).toBe('created');
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('.ctxo/.cache/');
  });

  it('appends cache entry to existing .gitignore', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');
    const result = ensureGitignore(dir);
    expect(result.action).toBe('updated');
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.ctxo/.cache/');
  });

  it('skips if entry already exists', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.gitignore'), '.ctxo/.cache/\n', 'utf-8');
    const result = ensureGitignore(dir);
    expect(result.action).toBe('skipped');
  });

  it('is idempotent — does not duplicate entry', () => {
    const dir = makeTempDir();
    ensureGitignore(dir);
    ensureGitignore(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    const count = (content.match(/\.ctxo\/\.cache\//g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('ensureConfig', () => {
  it('creates config.yaml with defaults', () => {
    const dir = makeTempDir();
    const result = ensureConfig(dir);
    expect(result.action).toBe('created');
    expect(existsSync(join(dir, '.ctxo', 'config.yaml'))).toBe(true);
    const content = readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8');
    expect(content).toContain('version');
  });

  it('skips if config.yaml already exists', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, '.ctxo'), { recursive: true });
    writeFileSync(join(dir, '.ctxo', 'config.yaml'), 'custom: true\n', 'utf-8');
    const result = ensureConfig(dir);
    expect(result.action).toBe('skipped');
    const content = readFileSync(join(dir, '.ctxo', 'config.yaml'), 'utf-8');
    expect(content).toBe('custom: true\n');
  });

  it('creates .ctxo/ directory if missing', () => {
    const dir = makeTempDir();
    ensureConfig(dir);
    expect(existsSync(join(dir, '.ctxo'))).toBe(true);
  });
});

describe('getMcpConfigTargets', () => {
  it('returns .mcp.json for claude-code', () => {
    const targets = getMcpConfigTargets(['claude-code']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.mcp.json');
    expect(targets[0].serverKey).toBe('mcpServers');
  });

  it('returns .vscode/mcp.json for github-copilot', () => {
    const targets = getMcpConfigTargets(['github-copilot']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.vscode/mcp.json');
    expect(targets[0].serverKey).toBe('servers');
  });

  it('returns .amazonq/mcp.json for amazonq', () => {
    const targets = getMcpConfigTargets(['amazonq']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.amazonq/mcp.json');
  });

  it('deduplicates .mcp.json for multiple tools', () => {
    const targets = getMcpConfigTargets(['claude-code', 'cursor', 'windsurf']);
    expect(targets).toHaveLength(1);
    expect(targets[0].file).toBe('.mcp.json');
  });

  it('returns both .mcp.json and .vscode/mcp.json when mixed', () => {
    const targets = getMcpConfigTargets(['claude-code', 'github-copilot']);
    expect(targets).toHaveLength(2);
    const files = targets.map(t => t.file).sort();
    expect(files).toEqual(['.mcp.json', '.vscode/mcp.json']);
  });

  it('returns empty for no tools', () => {
    expect(getMcpConfigTargets([])).toHaveLength(0);
  });
});

describe('ensureMcpConfig', () => {
  it('creates .mcp.json with ctxo entry', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['claude-code'])[0];
    const result = ensureMcpConfig(dir, target);

    expect(result.action).toBe('created');
    const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(config.mcpServers.ctxo).toBeDefined();
    expect(config.mcpServers.ctxo.command).toBe('npx');
    expect(config.mcpServers.ctxo.args).toContain('ctxo-mcp');
  });

  it('creates .vscode/mcp.json with type: stdio for copilot', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['github-copilot'])[0];
    ensureMcpConfig(dir, target);

    const config = JSON.parse(readFileSync(join(dir, '.vscode', 'mcp.json'), 'utf-8'));
    expect(config.servers.ctxo.type).toBe('stdio');
    expect(config.servers.ctxo.command).toBe('npx');
  });

  it('merges into existing config without overwriting other servers', () => {
    const dir = makeTempDir();
    const existing = { mcpServers: { other: { command: 'node', args: ['other.js'] } } };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify(existing), 'utf-8');

    const target = getMcpConfigTargets(['claude-code'])[0];
    const result = ensureMcpConfig(dir, target);

    expect(result.action).toBe('updated');
    const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(config.mcpServers.other).toBeDefined();
    expect(config.mcpServers.ctxo).toBeDefined();
  });

  it('skips if ctxo already registered', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['claude-code'])[0];
    ensureMcpConfig(dir, target);
    const result = ensureMcpConfig(dir, target);
    expect(result.action).toBe('skipped');
  });

  it('creates parent directory if missing', () => {
    const dir = makeTempDir();
    const target = getMcpConfigTargets(['amazonq'])[0];
    ensureMcpConfig(dir, target);
    expect(existsSync(join(dir, '.amazonq', 'mcp.json'))).toBe(true);
  });

  it('handles corrupt JSON by overwriting', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.mcp.json'), 'not json{{{', 'utf-8');
    const target = getMcpConfigTargets(['claude-code'])[0];
    const result = ensureMcpConfig(dir, target);
    expect(result.action).toBe('updated');
    const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(config.mcpServers.ctxo).toBeDefined();
  });
});
