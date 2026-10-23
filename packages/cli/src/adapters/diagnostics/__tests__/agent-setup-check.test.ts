import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AiRulesCheck, SkillsCheck, ClaudeGuardHookCheck } from '../checks/agent-setup-check.js';
import { ensureClaudeHook, installSkills } from '../../../cli/ai-rules.js';
import {
  LEGACY_RULE_BODY,
  RULES_TEMPLATE_VERSION,
  renderRulesBlock,
} from '../../../core/agent-rules/rules-block.js';
import type { CheckContext } from '../../../core/diagnostics/types.js';

/** Set by a test to make the exported skill helpers throw as they do when the bundled skills are missing. */
const bundle = vi.hoisted(() => ({ missing: false }));

vi.mock('../../../cli/ai-rules.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../cli/ai-rules.js')>();
  const failWhenMissing = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
    if (bundle.missing) throw new Error('Could not locate ctxo skills/ directory.');
    return fn(...args);
  };
  return {
    ...actual,
    skillStates: failWhenMissing(actual.skillStates),
    skillsExpected: failWhenMissing(actual.skillsExpected),
    resolveRulesTier: failWhenMissing(actual.resolveRulesTier),
    installSkills: failWhenMissing(actual.installSkills),
  };
});

const RULES_FIX = 'Run "ctxo doctor --fix" or "ctxo init" to re-render the ctxo rules blocks';
// One command installs the pieces and lets the rules tier follow (final review M3).
const SKILLS_FIX = 'Run "ctxo doctor --fix" or "ctxo init --only rules,skills,guard"';
const GUARD_FIX = 'Run "ctxo doctor --fix" or "ctxo init --only rules,skills,guard"';
const UNTERMINATED_FIX =
  'Fix the file by hand (add the missing "<!-- ctxo-rules-end -->" line, or delete the start marker without one), then run "ctxo doctor"';
const ORPHAN_END_FIX =
  'Fix the file by hand (delete the "<!-- ctxo-rules-end -->" line that has no start marker, with the old ctxo rules text above it, or add the missing start marker), then run "ctxo doctor"';
const NEWER_BLOCKS_FIX = 'Delete the older ctxo rules block by hand, or run "ctxo doctor --fix" with the newer ctxo';
const CHECK_ERROR_FIX =
  'Fix the cause named in the message (a file ctxo cannot read, or a ctxo install without its bundled skills: reinstall @ctxo/cli), then run "ctxo doctor"';
const TEMPLATE = `template v${RULES_TEMPLATE_VERSION}`;

/** A CLAUDE.md written by a ctxo version before the tiers: an unversioned marked block. */
const PRE_TIER_CLAUDE_MD = '# P\n\n<!-- ctxo-rules-start -->\n' + LEGACY_RULE_BODY + '\n<!-- ctxo-rules-end -->\n';

const BOM = String.fromCharCode(0xfeff);

/** The text with every line break as CRLF and a UTF-8 BOM, as a Windows editor may save it. */
function windowsShape(text: string): string {
  return BOM + text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

/** A `.claude/settings.local.json` that registers the safe-edit guard (D11: read, never written). */
const LOCAL_GUARD = { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'ctxo gate-hook' }] }] } };

const tempDirs: string[] = [];

afterEach(() => {
  bundle.missing = false;
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  tempDirs.length = 0;
});

function makeProject(): { root: string; ctx: CheckContext } {
  const root = mkdtempSync(join(tmpdir(), 'ctxo-agent-setup-'));
  tempDirs.push(root);
  return { root, ctx: { projectRoot: root, ctxoRoot: join(root, '.ctxo') } };
}

/** Writes a project-relative file, creating its directory. */
function write(root: string, file: string, content: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function disableGate(root: string): void {
  write(root, '.ctxo/config.yaml', 'gate:\n  enabled: false\n');
}

describe('AiRulesCheck', () => {
  const check = new AiRulesCheck();

  it('has the ai_rules id and title', () => {
    expect(check.id).toBe('ai_rules');
    expect(check.title).toBe('AI rules');
  });

  it('ai_rules passes when no rules file has a ctxo block', async () => {
    const { root, ctx } = makeProject();
    expect(await check.run(ctx)).toMatchObject({ status: 'pass', message: 'no ctxo rules blocks' });

    write(root, 'CLAUDE.md', '# Project\n\nNo ctxo here.\n');
    expect(await check.run(ctx)).toMatchObject({ status: 'pass', message: 'no ctxo rules blocks' });
  });

  it('ai_rules reports rules present, guard missing and rules template outdated for a pre-tier CLAUDE.md', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER_CLAUDE_MD);

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('rules present, guard missing');
    expect(result.message).toContain('rules template outdated');
    expect(result.message).toBe(
      `CLAUDE.md: rules template outdated (unversioned block, ${TEMPLATE}); CLAUDE.md: rules present, guard missing`,
    );
    expect(result.fix).toBe(RULES_FIX);
  });

  it('ai_rules reports an older template version', async () => {
    const { root, ctx } = makeProject();
    const older = renderRulesBlock('full').replace(`v${RULES_TEMPLATE_VERSION}`, 'v0.1');
    expect(older).toContain('<!-- ctxo-rules-start v0.1 -->');
    write(root, 'CLAUDE.md', older + '\n');

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe(`CLAUDE.md: rules template outdated (v0.1 block, ${TEMPLATE})`);
  });

  it('ai_rules reports an edited block of the current version', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', renderRulesBlock('full').replace('Only then edit the source', 'Then edit') + '\n');

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe(`CLAUDE.md: rules template outdated (edited block, ${TEMPLATE})`);
  });

  it('ai_rules does not report a block from a newer ctxo', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', renderRulesBlock('full').replace(`v${RULES_TEMPLATE_VERSION}`, 'v99.0') + '\n');

    const result = await check.run(ctx);

    expect(result.status).toBe('pass');
    expect(result.message).toContain('CLAUDE.md v99.0');
  });

  it('ai_rules accepts a current full block without the guard as an opt-out', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', '# P\n\n' + renderRulesBlock('full') + '\n');

    expect(await check.run(ctx)).toMatchObject({
      status: 'pass',
      message: `CLAUDE.md v${RULES_TEMPLATE_VERSION} full`,
    });
  });

  it('ai_rules passes a current compact block backed by the guard and the skills', async () => {
    const { root, ctx } = makeProject();
    ensureClaudeHook(root);
    installSkills(root, 'claude-code');
    write(root, 'CLAUDE.md', renderRulesBlock('compact') + '\n');
    write(root, 'AGENTS.md', renderRulesBlock('full') + '\n');

    expect(await check.run(ctx)).toMatchObject({
      status: 'pass',
      message: `CLAUDE.md v${RULES_TEMPLATE_VERSION} compact; AGENTS.md v${RULES_TEMPLATE_VERSION} full`,
    });
  });

  it('ai_rules reports a compact block when the gate is disabled', async () => {
    const { root, ctx } = makeProject();
    ensureClaudeHook(root);
    installSkills(root, 'claude-code');
    disableGate(root);
    write(root, 'CLAUDE.md', renderRulesBlock('compact') + '\n');

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe('CLAUDE.md: rules tier does not match the guard and skills (expected full)');
  });

  it('ai_rules reports a compact block without the guard once, as guard missing', async () => {
    const { root, ctx } = makeProject();
    installSkills(root, 'claude-code');
    write(root, 'CLAUDE.md', renderRulesBlock('compact') + '\n');

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe('CLAUDE.md: rules present, guard missing');
  });

  it('ai_rules checks non-Claude rules files too', async () => {
    const { root, ctx } = makeProject();
    write(root, '.windsurfrules', LEGACY_RULE_BODY + '\n');

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe(`.windsurfrules: rules template outdated (unversioned block, ${TEMPLATE})`);
  });

  it('ai_rules reports duplicate and unterminated blocks', async () => {
    const { root, ctx } = makeProject();
    const block = renderRulesBlock('full');
    write(root, 'CLAUDE.md', `${block}\n\nkept text\n\n${block}\n`);
    write(root, 'AGENTS.md', '# Agents\n\n' + block.replace('\n<!-- ctxo-rules-end -->', '') + '\n');

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe('CLAUDE.md: 2 ctxo rules blocks; AGENTS.md: start marker without end marker');
    // --fix and init leave an unterminated block alone, so the first step is by hand.
    expect(result.fix).toBe(UNTERMINATED_FIX);
  });

  it('ai_rules reports an end marker without a start marker with a fix by hand', async () => {
    const { root, ctx } = makeProject();
    // The start marker line was deleted: the old body and its end marker stay, and no block is found.
    const startLine = `<!-- ctxo-rules-start v${RULES_TEMPLATE_VERSION} -->\n`;
    const block = renderRulesBlock('full');
    expect(block.startsWith(startLine)).toBe(true);
    write(root, 'AGENTS.md', '# Agents\n\n' + block.slice(startLine.length) + '\n');
    write(root, 'CLAUDE.md', `${block}\n\nkept text\n\n${block}\n<!-- ctxo-rules-end -->\n`);

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe(
      'CLAUDE.md: 2 ctxo rules blocks; CLAUDE.md: end marker without start marker; AGENTS.md: end marker without start marker',
    );
    // init and --fix leave such a file unchanged, so the first step is by hand.
    expect(result.fix).toBe(ORPHAN_END_FIX);
  });

  it('ai_rules gives a duplicate block a fix that ctxo doctor --fix can carry out', async () => {
    const { root, ctx } = makeProject();
    const block = renderRulesBlock('full');
    write(root, 'CLAUDE.md', `${block}\n\nkept text\n\n${block}\n`);

    expect(await check.run(ctx)).toMatchObject({ status: 'warn', fix: RULES_FIX });
  });

  it('ai_rules gives a newer block next to other blocks a warning this ctxo can clear', async () => {
    const { root, ctx } = makeProject();
    const newer = renderRulesBlock('full').replace(`v${RULES_TEMPLATE_VERSION}`, 'v99.0');
    write(root, 'CLAUDE.md', `${PRE_TIER_CLAUDE_MD}\n${newer}\n`);
    write(root, 'AGENTS.md', `${newer}\n\n${renderRulesBlock('full')}\n`);

    const result = await check.run(ctx);

    // This ctxo leaves both files unchanged (D2), so "re-render" would never clear the warning.
    expect(result.status).toBe('warn');
    expect(result.message).toBe(
      'CLAUDE.md: 2 ctxo rules blocks, one from a newer ctxo (v99.0); this ctxo leaves the file unchanged; ' +
        'CLAUDE.md: rules present, guard missing; ' +
        'AGENTS.md: 2 ctxo rules blocks, one from a newer ctxo (v99.0); this ctxo leaves the file unchanged',
    );
    expect(result.fix).toBe(NEWER_BLOCKS_FIX);
  });

  it('ai_rules warns instead of crashing when the bundled skills are missing', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', renderRulesBlock('full') + '\n');
    bundle.missing = true;

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('Could not locate ctxo skills/ directory.');
    expect(result.fix).toBe(CHECK_ERROR_FIX);
  });

  it('ai_rules keeps the findings of the other files when the bundled skills are missing', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', renderRulesBlock('full') + '\n');
    write(root, '.windsurfrules', LEGACY_RULE_BODY + '\n');
    bundle.missing = true;

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe(
      'CLAUDE.md: rules tier could not be checked (Could not locate ctxo skills/ directory.); ' +
        `.windsurfrules: rules template outdated (unversioned block, ${TEMPLATE})`,
    );
    expect(result.fix).toBe(CHECK_ERROR_FIX);
  });

  it('ai_rules reads a CLAUDE.md with a UTF-8 BOM and CRLF line endings like any other', async () => {
    const preTier = makeProject();
    write(preTier.root, 'CLAUDE.md', windowsShape(PRE_TIER_CLAUDE_MD));
    expect(await check.run(preTier.ctx)).toMatchObject({
      status: 'warn',
      message: `CLAUDE.md: rules template outdated (unversioned block, ${TEMPLATE}); CLAUDE.md: rules present, guard missing`,
    });

    const compact = makeProject();
    ensureClaudeHook(compact.root);
    installSkills(compact.root, 'claude-code');
    write(compact.root, 'CLAUDE.md', windowsShape('# P\n\n' + renderRulesBlock('compact') + '\n'));
    expect(await check.run(compact.ctx)).toMatchObject({
      status: 'pass',
      message: `CLAUDE.md v${RULES_TEMPLATE_VERSION} compact`,
    });
  });

  it('ai_rules counts a guard registered only in settings.local.json', async () => {
    const { root, ctx } = makeProject();
    installSkills(root, 'claude-code');
    write(root, 'CLAUDE.md', renderRulesBlock('compact') + '\n');
    write(root, '.claude/settings.local.json', JSON.stringify(LOCAL_GUARD, null, 2) + '\n');

    expect(await check.run(ctx)).toMatchObject({ status: 'pass', message: `CLAUDE.md v${RULES_TEMPLATE_VERSION} compact` });
  });
});

describe('SkillsCheck', () => {
  const check = new SkillsCheck();

  it('has the skills id and title', () => {
    expect(check.id).toBe('skills');
    expect(check.title).toBe('Agent skills');
  });

  it('skills reports missing skills for a pre-tier Claude Code setup', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER_CLAUDE_MD);

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe('Claude Code: missing ctxo-understand, ctxo-safe-edit, ctxo-review-pr');
    expect(result.fix).toBe(SKILLS_FIX);
  });

  it('skills reports missing skills for a pre-tier block even with the gate disabled', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER_CLAUDE_MD);
    disableGate(root);

    expect((await check.run(ctx)).message).toBe('Claude Code: missing ctxo-understand, ctxo-safe-edit, ctxo-review-pr');
  });

  it('skills reports an edited skill as outdated', async () => {
    const { root, ctx } = makeProject();
    installSkills(root, 'claude-code');
    installSkills(root, 'cursor');
    write(root, '.claude/skills/ctxo-understand/SKILL.md', 'edited\n');
    rmSync(join(root, '.cursor', 'rules', 'ctxo-review-pr.mdc'));

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toBe('Claude Code: outdated ctxo-understand; Cursor: missing ctxo-review-pr');
  });

  it('skills does not report CRLF copies as outdated', async () => {
    const { root, ctx } = makeProject();
    installSkills(root, 'claude-code');
    for (const skill of ['ctxo-understand', 'ctxo-safe-edit', 'ctxo-review-pr']) {
      const file = join(root, '.claude', 'skills', skill, 'SKILL.md');
      // installSkills copied the bundled bytes, which are CRLF on a core.autocrlf checkout. Give the
      // copy the other line ending, so the test compares two endings on every checkout.
      const bundled = readFileSync(file, 'utf-8');
      const lf = bundled.replace(/\r\n/g, '\n');
      const flipped = bundled.includes('\r\n') ? lf : lf.replace(/\n/g, '\r\n');
      expect(flipped).not.toBe(bundled);
      writeFileSync(file, flipped, 'utf-8');
    }

    expect(await check.run(ctx)).toMatchObject({ status: 'pass' });
  });

  it('skills stays quiet for a current full block without skills', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', renderRulesBlock('full') + '\n');
    write(root, '.cursor/rules/ctxo.mdc', renderRulesBlock('full') + '\n');

    expect(await check.run(ctx)).toMatchObject({ status: 'pass' });
  });

  it('skills warns instead of crashing when the bundled skills are missing', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER_CLAUDE_MD);
    bundle.missing = true;

    const result = await check.run(ctx);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('Could not locate ctxo skills/ directory.');
    expect(result.fix).toBe(CHECK_ERROR_FIX);
  });
});

describe('ClaudeGuardHookCheck', () => {
  const check = new ClaudeGuardHookCheck();

  it('has the claude_guard_hook id and title', () => {
    expect(check.id).toBe('claude_guard_hook');
    expect(check.title).toBe('Claude guard hook');
  });

  it('claude_guard_hook warns on unreadable settings', async () => {
    const { root, ctx } = makeProject();
    write(root, '.claude/settings.json', 'null');

    expect(await check.run(ctx)).toEqual({
      id: 'claude_guard_hook',
      title: 'Claude guard hook',
      status: 'warn',
      message: '.claude/settings.json is not valid JSON or not a settings object; the guard cannot be verified',
      fix: 'Repair .claude/settings.json by hand; ctxo never overwrites it',
    });
  });

  it('claude_guard_hook warns when the guard is missing for a pre-tier block and passes when it is present, disabled or opted out', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', PRE_TIER_CLAUDE_MD);

    expect(await check.run(ctx)).toMatchObject({
      status: 'warn',
      message: 'safe-edit guard hook missing from .claude/settings.json',
      fix: GUARD_FIX,
    });

    ensureClaudeHook(root);
    expect(await check.run(ctx)).toMatchObject({ status: 'pass', message: 'installed' });

    disableGate(root);
    expect(await check.run(ctx)).toMatchObject({ status: 'pass', message: 'installed, disabled by gate.enabled: false' });

    rmSync(join(root, '.claude', 'settings.json'));
    expect(await check.run(ctx)).toMatchObject({ status: 'pass', message: 'not installed' });

    const optedOut = makeProject();
    write(optedOut.root, 'CLAUDE.md', renderRulesBlock('full') + '\n');
    expect(await check.run(optedOut.ctx)).toMatchObject({ status: 'pass', message: 'not installed' });
  });

  it('claude_guard_hook passes for a pre-tier block when the guard is only in settings.local.json', async () => {
    const { root, ctx } = makeProject();
    write(root, 'CLAUDE.md', windowsShape(PRE_TIER_CLAUDE_MD));
    write(root, '.claude/settings.local.json', JSON.stringify(LOCAL_GUARD, null, 2) + '\n');

    expect(await check.run(ctx)).toMatchObject({ status: 'pass', message: 'installed' });
  });

  it('claude_guard_hook passes without a ctxo block', async () => {
    const { ctx } = makeProject();
    expect(await check.run(ctx)).toMatchObject({ status: 'pass', message: 'not installed' });
  });
});
