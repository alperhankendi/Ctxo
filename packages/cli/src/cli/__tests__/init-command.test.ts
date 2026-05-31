import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InitCommand } from '../init-command.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function makeTempProject(prefix = 'ctxo-init-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  return dir;
}

describe('InitCommand — hook installation', () => {
  it('installs post-commit and post-merge git hooks', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();

    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(true);
    expect(existsSync(join(dir, '.git', 'hooks', 'post-merge'))).toBe(true);
  });

  it('preserves existing hook content (appends ctxo block)', () => {
    const dir = makeTempProject();
    const hookPath = join(dir, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "existing hook"\n', 'utf-8');

    new InitCommand(dir).installHooks();

    const result = readFileSync(hookPath, 'utf-8');
    expect(result).toContain('existing hook');
    expect(result).toContain('# ctxo-start');
    expect(result).toContain('# ctxo-end');
  });

  it('is idempotent — running twice does not duplicate ctxo block', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();
    new InitCommand(dir).installHooks();

    const content = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf-8');
    const startCount = (content.match(/# ctxo-start/g) ?? []).length;
    expect(startCount).toBe(1);
  });

  it('uses # ctxo-start / # ctxo-end markers', () => {
    const dir = makeTempProject();
    new InitCommand(dir).installHooks();

    const content = readFileSync(join(dir, '.git', 'hooks', 'post-commit'), 'utf-8');
    expect(content).toContain('# ctxo-start');
    expect(content).toContain('# ctxo-end');
  });
});

describe('InitCommand — non-interactive mode', () => {
  it('creates index directory and installs hooks with --yes', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ yes: true });

    expect(existsSync(join(dir, '.ctxo', 'index'))).toBe(true);
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(true);
  });

  it('generates rules for specified tools', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['windsurf', 'cursor'], yes: true });

    expect(existsSync(join(dir, '.windsurfrules'))).toBe(true);
    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'))).toBe(true);
  });

  it('rejects unknown tool IDs', async () => {
    const dir = makeTempProject();
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    await expect(new InitCommand(dir).run({ tools: ['unknown'], yes: true })).rejects.toThrow('exit');

    mockExit.mockRestore();
  });

  it('--rules only regenerates rules without hooks', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['windsurf'], rulesOnly: true });

    expect(existsSync(join(dir, '.windsurfrules'))).toBe(true);
    // No hooks installed
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(false);
  });

  it('--dry-run does not create any files', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['windsurf'], dryRun: true });

    expect(existsSync(join(dir, '.windsurfrules'))).toBe(false);
  });

  it('installs safe-edit guard for claude-code in non-interactive mode', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, rulesOnly: false, noInstall: true });

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'));
    const pre = cfg.hooks?.PreToolUse ?? [];
    expect(pre.some((e: { hooks?: Array<{ command?: string }> }) =>
      e.hooks?.some(h => h.command?.includes('gate-hook'))
    )).toBe(true);
  });

  it('does NOT install guard for claude-code when --rules-only', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['claude-code'], rulesOnly: true });

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
  });
});

describe('InitCommand — cursor: skills + rules, no guard', () => {
  it('writes cursor rules file', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['cursor'], yes: true, noInstall: true });

    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'))).toBe(true);
  });

  it('writes cursor skill .mdc files', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['cursor'], yes: true, noInstall: true });

    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo-safe-edit.mdc'))).toBe(true);
  });

  it('does NOT create .claude/settings.json guard for cursor-only init', async () => {
    const dir = makeTempProject();
    await new InitCommand(dir).run({ tools: ['cursor'], yes: true, noInstall: true });

    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
  });
});

// Import vi for mocking
import { vi } from 'vitest';
