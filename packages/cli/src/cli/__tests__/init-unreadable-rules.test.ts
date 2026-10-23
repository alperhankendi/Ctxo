import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { InitCommand } from '../init-command.js';
import { LEGACY_RULE_BODY } from '../../core/agent-rules/rules-block.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

/**
 * Set by a test: reads of this file fail with EPERM, as for a CLAUDE.md the user may not read. An
 * EPERM cannot be produced the same way on every platform (chmod does not deny reads on Windows),
 * so the read is denied here.
 */
const denied = vi.hoisted(() => ({ file: '' }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((path: Parameters<typeof actual.readFileSync>[0], ...rest: unknown[]) => {
    if (denied.file !== '' && typeof path === 'string' && normalize(path) === denied.file) {
      throw Object.assign(new Error(`EPERM: operation not permitted, open '${path}'`), { code: 'EPERM' });
    }
    return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

/** A CLAUDE.md written by a ctxo version before the tiers: its block expects the guard and the skills. */
const PRE_TIER_CLAUDE_MD = '# P\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n';
const WARNING = 'CLAUDE.md: could not be read (EPERM); left unchanged';

const tempDirs: string[] = [];
let gitEnv: IsolatedGitEnv;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  gitEnv = isolateGitEnv();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  denied.file = '';
  errorSpy.mockRestore();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  tempDirs.length = 0;
  gitEnv.restore();
});

function lines(): string[] {
  return errorSpy.mock.calls.map((call) => String(call[0]));
}

describe('InitCommand - an unreadable rules file', () => {
  it('init warns and continues when CLAUDE.md cannot be read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-init-unreadable-'));
    tempDirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');
    denied.file = normalize(join(dir, 'CLAUDE.md'));

    // The dry run: one warning line for CLAUDE.md, and every other part still listed.
    await new InitCommand(dir).run({ dryRun: true, tools: ['claude-code'] });
    expect(lines().filter((line) => line.includes('CLAUDE.md'))).toEqual([`  \u26a0 ${WARNING}`]);
    const plan = lines().join('\n');
    expect(plan).toMatch(/^ {2}\.claude\/skills\/ctxo-safe-edit\/SKILL\.md +would create$/m);
    expect(plan).toMatch(/^ {2}\.claude\/settings\.json +would create$/m);
    expect(plan).toMatch(/^ {2}\.mcp\.json +would create$/m);
    expect(plan).toMatch(/^ {2}\.git\/hooks\/post-commit \(git hook\) +would create$/m);

    // The real run: the same one warning line, and the other parts are installed.
    errorSpy.mockClear();
    await new InitCommand(dir).run({ tools: ['claude-code'], yes: true, noInstall: true });
    expect(lines().filter((line) => line.includes('CLAUDE.md'))).toEqual([`[ctxo] \u26a0 ${WARNING}`]);
    for (const file of ['.claude/skills/ctxo-safe-edit/SKILL.md', '.claude/settings.json', '.mcp.json', '.git/hooks/post-commit']) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }

    denied.file = '';
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe(PRE_TIER_CLAUDE_MD);
  });
});
