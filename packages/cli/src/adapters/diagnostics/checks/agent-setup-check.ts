import type { IHealthCheck, CheckContext, CheckResult } from '../../../core/diagnostics/types.js';
import { RULES_TEMPLATE_VERSION, classifyRulesBlock, type BlockStatus } from '../../../core/agent-rules/rules-block.js';
import {
  PLATFORMS,
  SKILL_PLATFORMS,
  gateEnabled,
  guardExpected,
  readClaudeGuardState,
  readRulesStates,
  resolveRulesTier,
  skillStates,
  skillsExpected,
  type PlatformRulesState,
} from '../../../cli/ai-rules.js';

/*
 * Agent-setup checks: the ctxo rules blocks, the bundled skills and the Claude Code safe-edit guard.
 * Each reports drift as a warn and never fails or throws: an internal error (such as the bundled
 * skills not being found) becomes a warn that carries its message and CHECK_ERROR_FIX.
 */

const RULES_FIX = 'Run "ctxo doctor --fix" or "ctxo init" to re-render the ctxo rules blocks';
// The rules part is named too, so the tier follows the pieces in one command (final review M3).
const SKILLS_FIX = 'Run "ctxo doctor --fix" or "ctxo init --only rules,skills,guard"';
const GUARD_FIX = 'Run "ctxo doctor --fix" or "ctxo init --only rules,skills,guard"';
const UNREADABLE_SETTINGS_FIX = 'Repair .claude/settings.json by hand; ctxo never overwrites it';
/** Init and --fix leave a file with an unterminated block unchanged (D8), so the first step is by hand. */
const UNTERMINATED_FIX =
  'Fix the file by hand (add the missing "<!-- ctxo-rules-end -->" line, or delete the start marker without one), then run "ctxo doctor"';
/** The same for an end marker that closes no block (its start line was deleted): init and --fix leave it unchanged. */
const ORPHAN_END_FIX =
  'Fix the file by hand (delete the "<!-- ctxo-rules-end -->" line that has no start marker, with the old ctxo rules text above it, or add the missing start marker), then run "ctxo doctor"';
/** This ctxo leaves a file with a block from a newer ctxo unchanged (D2), so it cannot collapse the blocks. */
const NEWER_BLOCKS_FIX = 'Delete the older ctxo rules block by hand, or run "ctxo doctor --fix" with the newer ctxo';
const CHECK_ERROR_FIX =
  'Fix the cause named in the message (a file ctxo cannot read, or a ctxo install without its bundled skills: reinstall @ctxo/cli), then run "ctxo doctor"';

/** The ai_rules fixes, first step first: when several apply, the check names the one to take first. */
const RULES_FIX_ORDER = [CHECK_ERROR_FIX, UNTERMINATED_FIX, ORPHAN_END_FIX, NEWER_BLOCKS_FIX, RULES_FIX] as const;

type RulesFix = (typeof RULES_FIX_ORDER)[number];

interface RulesProblem {
  readonly text: string;
  readonly fix: RulesFix;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The warn an agent-setup check gives when it cannot run to the end. */
function checkError(id: string, title: string, what: string, err: unknown): CheckResult {
  return { id, title, status: 'warn', message: `${what} could not be checked: ${errorMessage(err)}`, fix: CHECK_ERROR_FIX };
}

function platformName(platformId: string): string {
  return PLATFORMS.find((p) => p.id === platformId)?.name ?? platformId;
}

/**
 * Reports, per rules file, a block whose template is outdated (D2: a newer one is fine), a Claude
 * Code block that expects the guard while it is missing, a current block in the wrong tier, several
 * blocks in one file, a start marker without an end marker, and an end marker without a start
 * marker. The fix names the first step to take: by hand for a damaged block or for blocks next to a
 * newer one, which ctxo leaves alone.
 */
export class AiRulesCheck implements IHealthCheck {
  readonly id = 'ai_rules';
  readonly title = 'AI rules';

  async run(ctx: CheckContext): Promise<CheckResult> {
    try {
      return this.check(ctx.projectRoot);
    } catch (err) {
      return checkError(this.id, this.title, 'ctxo rules blocks', err);
    }
  }

  private check(projectRoot: string): CheckResult {
    const problems: RulesProblem[] = [];
    const summary: string[] = [];
    for (const state of readRulesStates(projectRoot)) {
      const first = state.scan.blocks[0];
      const status = first ? classifyRulesBlock(first) : undefined;
      problems.push(...fileProblems(projectRoot, state, status).map((p) => ({ ...p, text: `${state.file}: ${p.text}` })));
      if (status?.state === 'current') summary.push(`${state.file} v${RULES_TEMPLATE_VERSION} ${status.tier}`);
      if (status?.state === 'newer') summary.push(`${state.file} v${status.version} from a newer ctxo`);
    }

    if (problems.length > 0) {
      const fix = RULES_FIX_ORDER.find((candidate) => problems.some((p) => p.fix === candidate)) ?? RULES_FIX;
      return { id: this.id, title: this.title, status: 'warn', message: problems.map((p) => p.text).join('; '), fix };
    }
    return {
      id: this.id,
      title: this.title,
      status: 'pass',
      message: summary.length > 0 ? summary.join('; ') : 'no ctxo rules blocks',
    };
  }
}

/**
 * The problems in one rules file; `status` classifies its first block. A tier that cannot be resolved
 * (the bundled skills cannot be read) is a problem of this file only, so the other files keep theirs.
 */
function fileProblems(projectRoot: string, state: PlatformRulesState, status: BlockStatus | undefined): RulesProblem[] {
  const problems: RulesProblem[] = [];
  const blocks = state.scan.blocks;
  const newer = blocks.length > 1 ? blocks.map(classifyRulesBlock).find((s) => s.state === 'newer') : undefined;

  if (newer?.state === 'newer') {
    // This ctxo leaves the whole file alone, so it reports the blocks once, with a step that clears them.
    problems.push({
      text: `${blocks.length} ctxo rules blocks, one from a newer ctxo (v${newer.version}); this ctxo leaves the file unchanged`,
      fix: NEWER_BLOCKS_FIX,
    });
  } else if (status?.state === 'outdated') {
    const found = status.reason === 'older' ? `v${blocks[0]?.version ?? ''}` : status.reason;
    problems.push({ text: `rules template outdated (${found} block, template v${RULES_TEMPLATE_VERSION})`, fix: RULES_FIX });
  }

  const guardMissing =
    state.platformId === 'claude-code' &&
    readClaudeGuardState(projectRoot) === 'absent' &&
    guardExpected(projectRoot);
  if (guardMissing) problems.push({ text: 'rules present, guard missing', fix: RULES_FIX });

  if (status?.state === 'current' && !guardMissing) {
    try {
      const expected = resolveRulesTier(projectRoot, state.platformId);
      if (status.tier !== expected) {
        problems.push({ text: `rules tier does not match the guard and skills (expected ${expected})`, fix: RULES_FIX });
      }
    } catch (err) {
      problems.push({ text: `rules tier could not be checked (${errorMessage(err)})`, fix: CHECK_ERROR_FIX });
    }
  }

  if (blocks.length > 1 && !newer) problems.push({ text: `${blocks.length} ctxo rules blocks`, fix: RULES_FIX });
  if (state.scan.unterminated) problems.push({ text: 'start marker without end marker', fix: UNTERMINATED_FIX });
  if (state.scan.orphanEnd) problems.push({ text: 'end marker without start marker', fix: ORPHAN_END_FIX });
  return problems;
}

/**
 * Reports missing and outdated skills for each skill platform that expects them: one ctxo skill is
 * installed, or its rules block is pre-tier or compact. A deliberate opt-out (a versioned full block
 * and no skills) passes.
 */
export class SkillsCheck implements IHealthCheck {
  readonly id = 'skills';
  readonly title = 'Agent skills';

  async run(ctx: CheckContext): Promise<CheckResult> {
    try {
      return this.check(ctx.projectRoot);
    } catch (err) {
      return checkError(this.id, this.title, 'ctxo skills', err);
    }
  }

  private check(projectRoot: string): CheckResult {
    const problems: string[] = [];
    const summary: string[] = [];
    for (const platformId of SKILL_PLATFORMS) {
      const name = platformName(platformId);
      if (!skillsExpected(projectRoot, platformId)) {
        summary.push(`${name}: not installed`);
        continue;
      }
      const states = skillStates(projectRoot, platformId);
      const missing = states.filter((s) => s.state === 'missing').map((s) => s.skill);
      const outdated = states.filter((s) => s.state === 'outdated').map((s) => s.skill);
      if (missing.length > 0) problems.push(`${name}: missing ${missing.join(', ')}`);
      if (outdated.length > 0) problems.push(`${name}: outdated ${outdated.join(', ')}`);
      if (missing.length === 0 && outdated.length === 0) summary.push(`${name}: current`);
    }

    if (problems.length > 0) {
      return { id: this.id, title: this.title, status: 'warn', message: problems.join('; '), fix: SKILLS_FIX };
    }
    return { id: this.id, title: this.title, status: 'pass', message: summary.join('; ') };
  }
}

/**
 * Reports an unreadable `.claude/settings.json`, and a missing guard when CLAUDE.md's block expects it
 * (pre-tier or compact) and the gate is enabled. A versioned full block or `gate.enabled: false`
 * records an opt-out and passes.
 */
export class ClaudeGuardHookCheck implements IHealthCheck {
  readonly id = 'claude_guard_hook';
  readonly title = 'Claude guard hook';

  async run(ctx: CheckContext): Promise<CheckResult> {
    try {
      return this.check(ctx.projectRoot);
    } catch (err) {
      return checkError(this.id, this.title, 'safe-edit guard', err);
    }
  }

  private check(projectRoot: string): CheckResult {
    const state = readClaudeGuardState(projectRoot);
    if (state === 'unreadable') {
      return {
        id: this.id,
        title: this.title,
        status: 'warn',
        message: '.claude/settings.json is not valid JSON or not a settings object; the guard cannot be verified',
        fix: UNREADABLE_SETTINGS_FIX,
      };
    }
    if (state === 'absent' && guardExpected(projectRoot)) {
      return {
        id: this.id,
        title: this.title,
        status: 'warn',
        message: 'safe-edit guard hook missing from .claude/settings.json',
        fix: GUARD_FIX,
      };
    }
    const message =
      state === 'absent'
        ? 'not installed'
        : gateEnabled(projectRoot)
          ? 'installed'
          : 'installed, disabled by gate.enabled: false';
    return { id: this.id, title: this.title, status: 'pass', message };
  }
}
