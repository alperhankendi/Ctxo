import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LEGACY_CURSOR_FRONTMATTER,
  LEGACY_RULE_BODY,
  renderRulesBlock,
} from '../../core/agent-rules/rules-block.js';
import { ensureClaudeHook, installSkills, resolveRulesTier, rulesHold, rulesHoldReasons } from '../ai-rules.js';

/** Set by a test to hide the bundled skills, as in a ctxo install that lost its skills/ folder. */
const bundle = vi.hoisted(() => ({ hidden: false, projectRoot: '' }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  // The file the bundled-skills lookup probes for; the project's own copies stay visible.
  const probe = /[\\/]skills[\\/]ctxo-safe-edit[\\/]SKILL\.md$/;
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) => {
      const text = String(path);
      if (bundle.hidden && probe.test(text) && !text.startsWith(bundle.projectRoot)) return false;
      return actual.existsSync(path);
    },
  };
});

/** A CLAUDE.md written by a ctxo version before the tiers: an unversioned marked block. */
const PRE_TIER = '# P\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n';
/** A Cursor rules file written before the tiers: the legacy frontmatter and the unmarked body. */
const PRE_TIER_CURSOR = LEGACY_CURSOR_FRONTMATTER + LEGACY_RULE_BODY + '\n';
const CURSOR_FILE = '.cursor/rules/ctxo.mdc';
const ALL_SKILLS = ['ctxo-understand', 'ctxo-safe-edit', 'ctxo-review-pr'];

const tempDirs: string[] = [];

afterEach(() => {
  bundle.hidden = false;
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  tempDirs.length = 0;
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-rules-hold-'));
  tempDirs.push(root);
  return root;
}

/** Writes a project-relative file, creating its directory. */
function write(root: string, file: string, content: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

describe('rulesHold', () => {
  it('rulesHold is false for a file without a ctxo block, and for a versioned full block', () => {
    const root = makeProject();
    expect(rulesHold(root, 'claude-code')).toBe(false);

    write(root, 'CLAUDE.md', '# Project\n\nNo ctxo here.\n');
    expect(rulesHold(root, 'claude-code')).toBe(false);

    // A versioned full block records an opt-out (D5): nothing is waited for.
    write(root, 'CLAUDE.md', '# P\n\n' + renderRulesBlock('full') + '\n');
    expect(rulesHold(root, 'claude-code')).toBe(false);
  });

  it('rulesHold waits for the guard and the skills that a pre-tier or compact block expects', () => {
    for (const content of [PRE_TIER, LEGACY_RULE_BODY + '\n', renderRulesBlock('compact') + '\n']) {
      const root = makeProject();
      write(root, 'CLAUDE.md', content);
      expect(rulesHoldReasons(root, 'claude-code')).toEqual({ guard: 'absent', missingSkills: ALL_SKILLS });

      ensureClaudeHook(root);
      expect(rulesHoldReasons(root, 'claude-code')).toEqual({ missingSkills: ALL_SKILLS });

      installSkills(root, 'claude-code');
      expect(rulesHold(root, 'claude-code')).toBe(false);
    }
  });

  it('rulesHold does not wait for what the run or the config declined', () => {
    const root = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER);

    expect(rulesHoldReasons(root, 'claude-code', { noGuard: true })).toEqual({ missingSkills: ALL_SKILLS });
    expect(rulesHoldReasons(root, 'claude-code', { skipSkills: true })).toEqual({ guard: 'absent' });
    expect(rulesHold(root, 'claude-code', { noGuard: true, skipSkills: true })).toBe(false);

    write(root, '.ctxo/config.yaml', 'gate:\n  enabled: false\n');
    expect(rulesHoldReasons(root, 'claude-code')).toEqual({ missingSkills: ALL_SKILLS });
    expect(rulesHold(root, 'claude-code', { skipSkills: true })).toBe(false);
  });

  it('an outdated skill holds the block and gives the full tier, the same test for both', () => {
    const root = makeProject();
    write(root, 'CLAUDE.md', renderRulesBlock('compact') + '\n');
    ensureClaudeHook(root);
    installSkills(root, 'claude-code');
    expect(resolveRulesTier(root, 'claude-code')).toBe('compact');

    // An edited copy does not back the compact tier, so a write now would turn the block full.
    write(root, '.claude/skills/ctxo-review-pr/SKILL.md', '---\nname: ctxo-review-pr\n---\n\nEdited.\n');
    expect(resolveRulesTier(root, 'claude-code')).toBe('full');
    expect(rulesHoldReasons(root, 'claude-code')).toEqual({ outdatedSkills: ['ctxo-review-pr'] });

    installSkills(root, 'claude-code');
    expect(rulesHold(root, 'claude-code')).toBe(false);
    expect(resolveRulesTier(root, 'claude-code')).toBe('compact');
  });

  it('rulesHold counts what a dry run would install as on disk', () => {
    const root = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER);

    expect(rulesHold(root, 'claude-code', { planned: { guard: true, skills: true } })).toBe(false);
    expect(rulesHoldReasons(root, 'claude-code', { planned: { skills: true } })).toEqual({ guard: 'absent' });
    expect(rulesHoldReasons(root, 'claude-code', { planned: { guard: true } })).toEqual({ missingSkills: ALL_SKILLS });
  });

  it('rulesHold names an unreadable settings.json as a guard that is not on disk', () => {
    const root = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER);
    installSkills(root, 'claude-code');
    write(root, '.claude/settings.json', 'not json{{{');

    expect(rulesHoldReasons(root, 'claude-code')).toEqual({ guard: 'unreadable' });
    // An opted-out user expects nothing, so an unreadable settings.json holds nothing (final review M4).
    write(root, 'CLAUDE.md', '# P\n\n' + renderRulesBlock('full') + '\n');
    expect(rulesHold(root, 'claude-code')).toBe(false);
  });

  it('rulesHold covers Cursor, which waits for its skills only, and no other platform', () => {
    const root = makeProject();
    write(root, CURSOR_FILE, PRE_TIER_CURSOR);
    write(root, 'AGENTS.md', PRE_TIER);
    write(root, '.windsurfrules', LEGACY_RULE_BODY + '\n');

    expect(rulesHoldReasons(root, 'cursor')).toEqual({ missingSkills: ALL_SKILLS });
    expect(rulesHold(root, 'cursor', { skipSkills: true })).toBe(false);
    expect(rulesHold(root, 'antigravity')).toBe(false);
    expect(rulesHold(root, 'windsurf')).toBe(false);

    installSkills(root, 'cursor');
    expect(rulesHold(root, 'cursor')).toBe(false);
  });

  it('rulesHold holds while the bundled skills cannot be read', () => {
    const root = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER);
    ensureClaudeHook(root);
    bundle.projectRoot = root;
    bundle.hidden = true;

    expect(rulesHoldReasons(root, 'claude-code')).toEqual({ skillsError: 'Could not locate ctxo skills/ directory.' });
    expect(rulesHold(root, 'claude-code', { skipSkills: true })).toBe(false);
    // Without a block nothing is read, so nothing can fail.
    expect(rulesHold(makeProject(), 'claude-code')).toBe(false);
  });
});
