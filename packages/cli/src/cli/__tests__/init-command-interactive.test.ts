import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Scripted answers for the interactive flow: every confirm is answered yes and recorded (ANSI codes
// stripped), the tool multiselect returns the test's list.
const prompts = vi.hoisted(() => ({
  messages: [] as string[],
  tools: [] as string[],
  /** Answer no to the safe-edit guard question. */
  declineGuard: false,
}));

vi.mock('@clack/prompts', () => ({
  text: vi.fn(async () => '.ctxo/index'),
  multiselect: vi.fn(async () => prompts.tools),
  confirm: vi.fn(async (options: { message: string }) => {
    const message = String(options.message).replace(/\u001b\[[0-9;]*m/g, '');
    prompts.messages.push(message);
    return !(prompts.declineGuard && /safe-edit guard/.test(message));
  }),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

import { InitCommand } from '../init-command.js';
import { LEGACY_RULE_BODY, blockTier, renderRulesBlock, scanRulesBlocks } from '../../core/agent-rules/rules-block.js';
import { isolateGitEnv, type IsolatedGitEnv } from './git-test-env.js';

/** A CLAUDE.md written by a ctxo version before the tiers: an unversioned marked block. */
const PRE_TIER_CLAUDE_MD = '# P\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n';

const tempDirs: string[] = [];
let gitEnv: IsolatedGitEnv;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  gitEnv = isolateGitEnv();
  prompts.messages.length = 0;
  prompts.tools = [];
  prompts.declineGuard = false;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  tempDirs.length = 0;
  gitEnv.restore();
});

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-init-interactive-'));
  tempDirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function asked(pattern: RegExp): string[] {
  return prompts.messages.filter((message) => pattern.test(message));
}

describe('InitCommand - interactive steps follow the selected parts', () => {
  it('does not ask about git hooks when git-hooks is skipped', async () => {
    const dir = makeTempProject();
    prompts.tools = ['cursor'];

    await new InitCommand(dir).run({ skip: ['git-hooks'], noInstall: true });

    expect(asked(/Install hooks/)).toEqual([]);
    expect(existsSync(join(dir, '.git', 'hooks', 'post-commit'))).toBe(false);
    expect(existsSync(join(dir, '.cursor', 'rules', 'ctxo.mdc'))).toBe(true);
  });

  it('asks the guard question only when Claude Code is selected', async () => {
    prompts.tools = ['cursor'];
    await new InitCommand(makeTempProject()).run({ noInstall: true });
    expect(asked(/safe-edit guard/)).toEqual([]);

    prompts.messages.length = 0;
    prompts.tools = ['claude-code'];
    const dir = makeTempProject();
    await new InitCommand(dir).run({ noInstall: true });

    expect(asked(/safe-edit guard/)).toHaveLength(1);
    expect(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8')).toContain('ctxo gate-hook');
  });

  it('does not ask the guard question with --no-guard and writes the full block', async () => {
    const dir = makeTempProject();
    prompts.tools = ['claude-code'];

    await new InitCommand(dir).run({ noGuard: true, noInstall: true });

    expect(asked(/safe-edit guard/)).toEqual([]);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
    const blocks = scanRulesBlocks(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).blocks;
    expect(blocks).toHaveLength(1);
    expect(blockTier(blocks[0]!.body)).toBe('full');
  });

  it('the step counter counts only the steps shown', async () => {
    /** The `n/total Title` of every step header printed so far, ANSI codes stripped. */
    const steps = (): string[] =>
      errorSpy.mock.calls
        .map((call) => String(call[0]).replace(/\u001b\[[0-9;]*m/g, ''))
        .flatMap((text) => [...text.matchAll(/(\d+\/\d+) (Index Directory|AI Tools|Language Plugins|Git Hooks)/g)])
        .map((match) => `${match[1]} ${match[2]}`);
    prompts.tools = ['cursor'];

    await new InitCommand(makeTempProject()).run({ noInstall: true });
    expect(steps()).toEqual(['1/3 Index Directory', '2/3 AI Tools', '3/3 Git Hooks']);

    errorSpy.mockClear();
    await new InitCommand(makeTempProject()).run({ skip: ['git-hooks'], noInstall: true });
    expect(steps()).toEqual(['1/2 Index Directory', '2/2 AI Tools']);

    errorSpy.mockClear();
    await new InitCommand(makeTempProject()).run({ only: ['rules'] });
    expect(steps()).toEqual(['1/1 AI Tools']);

    errorSpy.mockClear();
    await new InitCommand(makeTempProject()).run({ only: ['git-hooks', 'config'] });
    expect(steps()).toEqual(['1/2 Index Directory', '2/2 Git Hooks']);
  });

  it('declining the guard is an opt-out: a pre-tier CLAUDE.md gets the full block, not a hold', async () => {
    const dir = makeTempProject();
    writeFileSync(join(dir, 'CLAUDE.md'), PRE_TIER_CLAUDE_MD, 'utf-8');
    prompts.tools = ['claude-code'];
    prompts.declineGuard = true;

    await new InitCommand(dir).run({ noInstall: true });

    expect(asked(/safe-edit guard/)).toHaveLength(1);
    expect(existsSync(join(dir, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(dir, '.claude', 'skills', 'ctxo-safe-edit', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('# P\n\n' + renderRulesBlock('full') + '\n');
  });
});
