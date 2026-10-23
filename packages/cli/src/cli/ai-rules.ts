/**
 * Platform configurations and MCP tool usage rule generator.
 *
 * Each platform entry defines where the AI coding assistant reads its
 * project-level instructions; ctxo upserts one marked rules block into that file.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import {
  LEGACY_CURSOR_FRONTMATTER,
  SKILLS_TEMPLATE_VERSION,
  compareTemplateVersions,
  expectedRulesTier,
  comparableMarkdown,
  guardAndSkillsExpected,
  renderRulesBlock,
  scanRulesBlocks,
  skillTemplateVersion,
  textShape,
  upsertRulesBlock,
  type RulesBlockSpan,
  type RulesScan,
  type RulesTier,
  type TextShape,
} from '../core/agent-rules/rules-block.js';
import { loadConfig } from '../core/config/load-config.js';

/* ------------------------------------------------------------------ */
/*  Claude Code safe-edit gate hook                                    */
/* ------------------------------------------------------------------ */

const CTXO_HOOK_COMMAND = 'ctxo gate-hook';
const CLAUDE_SETTINGS_FILE = '.claude/settings.json';
const UNREADABLE_SETTINGS_WARNING =
  `${CLAUDE_SETTINGS_FILE} is not valid JSON or not a settings object; left unchanged. Fix it, then run "ctxo init --only rules,skills,guard".`;

/** Whether the safe-edit guard is registered: `unreadable` means `.claude/settings.json` cannot be read safely. */
export type ClaudeGuardState = 'present' | 'absent' | 'unreadable';

type SettingsRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'ok'; readonly json: Record<string, unknown>; readonly hasHook: boolean; readonly shape: TextShape };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a Claude Code settings file; a leading UTF-8 BOM and CRLF line endings are kept in `shape`, so
 * a rewrite restores them (D2). `unreadable` covers text that fails `JSON.parse` (JSONC comments
 * included) and JSON that is not a plain object, has a `hooks` that is not a plain object, a
 * `hooks.PreToolUse` that is not an array, or a `PreToolUse` entry that is not a plain object with a
 * `hooks` array. The guard counts wherever its own entry is well formed: a file that registers it is
 * `ok` with `hasHook` even next to a malformed entry, because ctxo never writes a file with the guard.
 */
function readSettings(path: string): SettingsRead {
  if (!existsSync(path)) return { kind: 'missing' };
  let json: unknown;
  let shape: TextShape;
  try {
    shape = textShape(readFileSync(path, 'utf-8'));
    json = JSON.parse(shape.text);
  } catch {
    return { kind: 'unreadable' };
  }
  if (!isPlainObject(json)) return { kind: 'unreadable' };
  if (json.hooks === undefined) return { kind: 'ok', json, hasHook: false, shape };
  if (!isPlainObject(json.hooks)) return { kind: 'unreadable' };
  const pre = json.hooks.PreToolUse;
  if (pre === undefined) return { kind: 'ok', json, hasHook: false, shape };
  if (!Array.isArray(pre)) return { kind: 'unreadable' };
  const wellFormed = (pre as unknown[]).filter(
    (entry): entry is { hooks: unknown[] } => isPlainObject(entry) && Array.isArray(entry.hooks),
  );
  const hasHook = wellFormed.some((entry) => entry.hooks.some((h) => isPlainObject(h) && h.command === CTXO_HOOK_COMMAND));
  if (!hasHook && wellFormed.length !== pre.length) return { kind: 'unreadable' };
  return { kind: 'ok', json, hasHook, shape };
}

/** The shared settings file and whether the guard is registered there or in the local one (read only, D11). */
function guardRegistration(projectRoot: string): { readonly shared: SettingsRead; readonly state: ClaudeGuardState } {
  const shared = readSettings(join(projectRoot, '.claude', 'settings.json'));
  const local = readSettings(join(projectRoot, '.claude', 'settings.local.json'));
  if ((shared.kind === 'ok' && shared.hasHook) || (local.kind === 'ok' && local.hasHook)) {
    return { shared, state: 'present' };
  }
  return { shared, state: shared.kind === 'unreadable' ? 'unreadable' : 'absent' };
}

/**
 * Whether the safe-edit guard hook is registered in `.claude/settings.json` or
 * `.claude/settings.local.json`. `unreadable`: the shared file exists but cannot be read safely and
 * the local file does not register the guard.
 */
export function readClaudeGuardState(projectRoot: string): ClaudeGuardState {
  return guardRegistration(projectRoot).state;
}

/** A platform's rules file and the ctxo blocks found in it. */
export interface PlatformRulesState {
  readonly platformId: string;
  /** Project-relative, forward slashes */
  readonly file: string;
  readonly scan: RulesScan;
}

function platformRulesState(projectRoot: string, platform: Platform): PlatformRulesState | undefined {
  const path = join(projectRoot, platform.file);
  if (statSync(path, { throwIfNoEntry: false })?.isFile() !== true) return undefined;
  return { platformId: platform.id, file: platform.file, scan: scanRulesBlocks(readFileSync(path, 'utf-8')) };
}

/**
 * The scan of every platform whose rules file exists, in PLATFORMS order. Platforms whose rules files
 * are one file on disk (`linkedRulesPlatforms`) give one entry, under the first of them.
 */
export function readRulesStates(projectRoot: string): PlatformRulesState[] {
  const states: PlatformRulesState[] = [];
  const covered = new Set<string>();
  for (const platform of PLATFORMS) {
    if (covered.has(platform.id)) continue;
    const state = platformRulesState(projectRoot, platform);
    if (!state) continue;
    for (const id of linkedRulesPlatforms(projectRoot, platform.id)) covered.add(id);
    states.push(state);
  }
  return states;
}

/**
 * Whether two existing paths are one file on disk: the same real path (a symlink), or the same device
 * and inode (a hard link, which has a real path of its own). Both are checked.
 */
function sameFileOnDisk(a: string, b: string): boolean {
  try {
    if (realpathSync(a) === realpathSync(b)) return true;
    const sa = statSync(a, { bigint: true });
    const sb = statSync(b, { bigint: true });
    return sa.ino !== 0n && sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/**
 * The other platforms whose rules file is the same file on disk as this platform's, in PLATFORMS
 * order: for example an AGENTS.md or GEMINI.md linked to CLAUDE.md. `[]` when the file does not exist.
 * Such a file serves several clients, so the writer and doctor both give it the full tier.
 */
export function linkedRulesPlatforms(projectRoot: string, platformId: string): string[] {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  const path = platform ? join(projectRoot, platform.file) : undefined;
  if (!path || !existsSync(path)) return [];
  return PLATFORMS.filter((other) => {
    if (other.id === platformId) return false;
    const otherPath = join(projectRoot, other.file);
    return existsSync(otherPath) && sameFileOnDisk(path, otherPath);
  }).map((other) => other.id);
}

/** The first ctxo block in a platform's rules file; undefined without the file or a block. */
function firstRulesBlock(projectRoot: string, platformId: string): RulesBlockSpan | undefined {
  const platform = PLATFORMS.find((p) => p.id === platformId);
  return platform ? platformRulesState(projectRoot, platform)?.scan.blocks[0] : undefined;
}

/**
 * Whether the safe-edit guard should be registered: CLAUDE.md's first block is pre-tier or compact
 * (a versioned full block records an opt-out, D5) and `gate.enabled` is not false.
 */
export function guardExpected(projectRoot: string): boolean {
  return guardAndSkillsExpected(firstRulesBlock(projectRoot, 'claude-code')) && gateEnabled(projectRoot);
}

/**
 * Whether the platform's skills should all be installed: one ctxo skill is already there, or its rules
 * block is pre-tier or compact. Always false for a platform without skills. Throws like `skillStates`
 * when the bundled skills cannot be found.
 */
export function skillsExpected(projectRoot: string, platformId: string): boolean {
  if (!skillTarget(platformId)) return false;
  return (
    skillStates(projectRoot, platformId).some((s) => s.state !== 'missing') ||
    guardAndSkillsExpected(firstRulesBlock(projectRoot, platformId))
  );
}

/** What a run declined, for `rulesHold`. Config opt-outs (`gate.enabled: false`) are read from disk. */
export interface RulesHoldOptions {
  /** `--no-guard`, or the guard question answered no: the guard is not waited for. */
  readonly noGuard?: boolean;
  /** `--skip skills`: the skills are not waited for. */
  readonly skipSkills?: boolean;
  /** A dry run: the guard and this platform's skills that the run would install count as on disk. */
  readonly planned?: { readonly guard?: boolean; readonly skills?: boolean };
  /** `gate.enabled` as this run already read it; read from `.ctxo/config.yaml` when absent. */
  readonly gateEnabled?: boolean;
}

/** What a held rules file waits for; see `rulesHold`. */
export interface RulesHoldReasons {
  /** The guard is expected and not registered; `unreadable`: `.claude/settings.json` cannot be read safely. */
  readonly guard?: 'absent' | 'unreadable';
  /** The expected skills that are not on disk, or not readable as a file. */
  readonly missingSkills?: readonly string[];
  /** The expected skills on disk that differ from the bundled copy; like missing ones, they do not back the compact tier. */
  readonly outdatedSkills?: readonly string[];
  /** The bundled skills cannot be read, so the installed ones cannot be checked; they count as not on disk. */
  readonly skillsError?: string;
}

/** Whether a skill backs the compact tier: its file is readable and current (or from a newer ctxo). */
function skillInPlace(state: SkillState): boolean {
  return state.state === 'current' || state.state === 'newer';
}

/**
 * Why a platform's rules block must be left unchanged, or undefined when it may be written; see
 * `rulesHold`. A rules file that cannot be read is never held: the writer then leaves it unchanged
 * with its `could not be read` warning, and the run goes on.
 */
export function rulesHoldReasons(
  projectRoot: string,
  platformId: string,
  options: RulesHoldOptions = {},
): RulesHoldReasons | undefined {
  if (!(SKILL_PLATFORMS as readonly string[]).includes(platformId)) return undefined;
  let first: RulesBlockSpan | undefined;
  try {
    first = firstRulesBlock(projectRoot, platformId);
  } catch {
    return undefined;
  }
  if (!guardAndSkillsExpected(first)) return undefined;

  let guard: RulesHoldReasons['guard'];
  if (
    platformId === 'claude-code' &&
    !options.noGuard &&
    options.planned?.guard !== true &&
    (options.gateEnabled ?? gateEnabled(projectRoot))
  ) {
    const state = readClaudeGuardState(projectRoot);
    if (state !== 'present') guard = state;
  }
  let missingSkills: string[] | undefined;
  let outdatedSkills: string[] | undefined;
  let skillsError: string | undefined;
  if (!options.skipSkills && options.planned?.skills !== true) {
    try {
      const states = skillStates(projectRoot, platformId);
      const missing = states.filter((s) => s.state === 'missing').map((s) => s.skill);
      const outdated = states.filter((s) => s.state === 'outdated').map((s) => s.skill);
      if (missing.length > 0) missingSkills = missing;
      if (outdated.length > 0) outdatedSkills = outdated;
    } catch (err) {
      skillsError = (err as Error).message;
    }
  }

  if (guard === undefined && missingSkills === undefined && outdatedSkills === undefined && skillsError === undefined) {
    return undefined;
  }
  return {
    ...(guard !== undefined ? { guard } : {}),
    ...(missingSkills !== undefined ? { missingSkills } : {}),
    ...(outdatedSkills !== undefined ? { outdatedSkills } : {}),
    ...(skillsError !== undefined ? { skillsError } : {}),
  };
}

/**
 * The one rule against a silent opt-out (D5): whether the writers must leave this platform's rules
 * block unchanged. A versioned full block records that the user declined the guard and the skills,
 * so writing one where nobody declined them would hide the missing pieces for good. True for Claude
 * Code and Cursor (the platforms with skills) when all of these hold:
 *
 * 1. the rules file has a ctxo block that expects the guard and the skills: pre-tier (unversioned or
 *    legacy) or compact;
 * 2. the user has not declined them: the guard counts unless `noGuard` or `gate.enabled: false`, the
 *    skills unless `skipSkills` (Cursor has no guard);
 * 3. what counts is still not on disk, read after the run's skills and guard steps (`planned` stands
 *    in for them in a dry run). An unreadable `.claude/settings.json` is not on disk, and neither are
 *    skills that cannot be checked. A skill counts as on disk only when it is readable and current,
 *    the same test `resolveRulesTier` applies, so a held block is never one the tier would turn full.
 *
 * A file without a ctxo block is never held. Used by init (the real run and the dry run, so also by
 * `--only rules` and `--rules`) and by `doctor --fix`.
 */
export function rulesHold(projectRoot: string, platformId: string, options: RulesHoldOptions = {}): boolean {
  return rulesHoldReasons(projectRoot, platformId, options) !== undefined;
}

/**
 * `rulesHoldReasons` for a rules file that may be several platforms' file (`linkedRulesPlatforms`):
 * the platform's own reasons, else those of the first platform linked to it that is held. A write
 * under any name of the file reaches the held block (an AGENTS.md linked to a held CLAUDE.md would
 * record the opt-out through the link), so every name waits. `optionsFor` gives each platform's
 * options, because a dry run plans the skills per platform. Init, the dry run and `doctor --fix` use it.
 */
export function rulesFileHoldReasons(
  projectRoot: string,
  platformId: string,
  optionsFor: (platformId: string) => RulesHoldOptions = () => ({}),
): RulesHoldReasons | undefined {
  for (const id of [platformId, ...linkedRulesPlatforms(projectRoot, platformId)]) {
    const reasons = rulesHoldReasons(projectRoot, id, optionsFor(id));
    if (reasons) return reasons;
  }
  return undefined;
}

/**
 * Registers the safe-edit guard under `hooks.PreToolUse` in `.claude/settings.json`. A guard already
 * registered there or in `.claude/settings.local.json` is `skipped`. An unreadable settings file is
 * never overwritten: `skipped` with a warning. Every other setting and hook is kept, the entry goes
 * last, and the file's UTF-8 BOM and line endings are written back (D2). `dryRun` computes the same
 * action and writes nothing, not even a directory.
 */
export function ensureClaudeHook(projectRoot: string, options: { readonly dryRun?: boolean } = {}): InstallResult {
  const filePath = join(projectRoot, '.claude', 'settings.json');
  const ctxoEntry = { matcher: 'Edit', hooks: [{ type: 'command', command: CTXO_HOOK_COMMAND }] };
  const { shared, state } = guardRegistration(projectRoot);

  if (state === 'present') return { file: CLAUDE_SETTINGS_FILE, action: 'skipped' };
  if (shared.kind === 'unreadable') {
    return { file: CLAUDE_SETTINGS_FILE, action: 'skipped', warning: UNREADABLE_SETTINGS_WARNING };
  }

  if (shared.kind === 'missing') {
    if (!options.dryRun) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify({ hooks: { PreToolUse: [ctxoEntry] } }, null, 2) + '\n', 'utf-8');
    }
    return { file: CLAUDE_SETTINGS_FILE, action: 'created' };
  }

  const hooks = isPlainObject(shared.json.hooks) ? shared.json.hooks : {};
  const pre = Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as unknown[]) : [];
  const updated = { ...shared.json, hooks: { ...hooks, PreToolUse: [...pre, ctxoEntry] } };
  const body = JSON.stringify(updated, null, 2) + '\n';
  if (!options.dryRun) writeFileSync(filePath, shared.shape.restore(body), 'utf-8');
  return { file: CLAUDE_SETTINGS_FILE, action: 'updated' };
}

/** `gate.enabled` from `.ctxo/config.yaml`; a missing or invalid config counts as enabled. */
export function gateEnabled(projectRoot: string): boolean {
  return loadConfig(join(projectRoot, '.ctxo')).config.gate?.enabled !== false;
}

/**
 * The rules tier for a platform from what is on disk. `planned` counts a guard or skills that a dry
 * run would install as present. A skill counts only when its file is readable and current (or from a
 * newer ctxo): a missing one, a path that is not a readable file and an outdated copy do not back the
 * compact tier. A rules file linked to another platform's (`linkedRulesPlatforms`) gets the full tier.
 * Only Claude Code can get the compact tier, so every other platform is `full` without a disk read.
 * `known.gateEnabled` is the `gate.enabled` value this run already read (read from config when absent).
 */
export function resolveRulesTier(
  projectRoot: string,
  platformId: string,
  planned: { readonly guard?: boolean; readonly skills?: boolean } = {},
  known: { readonly gateEnabled?: boolean } = {},
): RulesTier {
  if (platformId !== 'claude-code') return 'full';
  const guardPresent = planned.guard === true || readClaudeGuardState(projectRoot) === 'present';
  const skillsComplete = planned.skills === true || skillStates(projectRoot, 'claude-code').every(skillInPlace);
  const sharedFile = linkedRulesPlatforms(projectRoot, platformId).length > 0;
  const gate = known.gateEnabled ?? gateEnabled(projectRoot);
  return expectedRulesTier(platformId, { guardPresent, skillsComplete, gateEnabled: gate, sharedFile });
}

export interface Platform {
  id: string;
  name: string;
  /** The rules file, project-relative with forward slashes; ctxo upserts a marked block into it */
  file: string;
  /** Paths to check for auto-detection (relative to project root) */
  detectPaths: string[];
  /** Show a star next to this platform name */
  starred: boolean;
}

export const PLATFORMS: Platform[] = [
  { id: 'claude-code',    name: 'Claude Code',        file: 'CLAUDE.md',                       detectPaths: ['CLAUDE.md', '.claude'],                    starred: true },
  { id: 'cursor',         name: 'Cursor',             file: '.cursor/rules/ctxo.mdc',          detectPaths: ['.cursor', '.cursorrules'],                  starred: false },
  { id: 'github-copilot', name: 'GitHub Copilot',     file: '.github/copilot-instructions.md', detectPaths: ['.github', '.vscode'],                      starred: false },
  { id: 'windsurf',       name: 'Windsurf',           file: '.windsurfrules',                  detectPaths: ['.windsurfrules', '.windsurf'],              starred: false },
  { id: 'antigravity',    name: 'Google Antigravity', file: 'AGENTS.md',                       detectPaths: ['AGENTS.md', 'GEMINI.md', '.gemini'],       starred: false },
  { id: 'augment',        name: 'Augment Code',       file: 'augment-guidelines.md',           detectPaths: ['augment-guidelines.md', '.augment'],        starred: false },
  { id: 'amazonq',        name: 'Amazon Q',           file: '.amazonq/rules/ctxo.md',          detectPaths: ['.amazonq'],                                starred: false },
  { id: 'gemini-cli',     name: 'Gemini CLI',         file: 'GEMINI.md',                       detectPaths: ['.gemini/settings.json', 'GEMINI.md'],      starred: false },
  { id: 'continue',       name: 'Continue',           file: '.continue/rules/ctxo.md',         detectPaths: ['.continue'],                                starred: false },
];

export function detectPlatforms(projectRoot: string): Set<string> {
  const detected = new Set<string>();
  for (const p of PLATFORMS) {
    if (p.detectPaths.some(d => existsSync(join(projectRoot, d)))) {
      detected.add(p.id);
    }
  }
  return detected;
}

/* ------------------------------------------------------------------ */
/*  Rule content                                                       */
/* ------------------------------------------------------------------ */

/** The frontmatter of a new Cursor rules file; LEGACY_CURSOR_FRONTMATTER is the one it replaces. */
const CURSOR_FRONTMATTER = `---
description: ctxo MCP tool usage rules, always applied
globs:
alwaysApply: true
---

`;

/** The content of a new rules file: the marked block (after the frontmatter for Cursor). */
export function generateRules(platformId: string, tier: RulesTier = 'full'): string {
  const block = renderRulesBlock(tier) + '\n';
  return platformId === 'cursor' ? CURSOR_FRONTMATTER + block : block;
}

/**
 * Swaps a leading LEGACY_CURSOR_FRONTMATTER for CURSOR_FRONTMATTER. The swapped lines keep their
 * BOM and line endings; anything else is returned as it is.
 */
function replaceLegacyCursorFrontmatter(content: string): string {
  const lineBreaks = LEGACY_CURSOR_FRONTMATTER.split('\n').length - 1;
  let end = 0;
  for (let i = 0; i < lineBreaks; i++) {
    const next = content.indexOf('\n', end);
    if (next < 0) return content;
    end = next + 1;
  }
  const head = textShape(content.slice(0, end));
  if (head.text !== LEGACY_CURSOR_FRONTMATTER) return content;
  return head.restore(CURSOR_FRONTMATTER) + content.slice(end);
}

/* ------------------------------------------------------------------ */
/*  File operations                                                    */
/* ------------------------------------------------------------------ */

export interface InstallResult {
  /**
   * Project-relative, forward slashes. A git hook row from init is absolute when the hooks directory
   * is outside the project (a `core.hooksPath` elsewhere, a worktree's common git dir).
   */
  file: string;
  action: 'created' | 'updated' | 'skipped';
  /** Why a file was left unchanged although it needs attention */
  warning?: string;
}

/**
 * Upserts the ctxo rules block into a platform's rules file. A missing file gets
 * `generateRules`; an existing one keeps every byte outside the ctxo block. The action compares
 * the final content with the original: equal is `skipped`. `dryRun` computes the same action and
 * writes nothing, not even a directory. A file that is also another platform's rules file
 * (`linkedRulesPlatforms`) is written in the full tier, whatever `tier` says.
 *
 * Cursor's file also gets its frontmatter: a leading LEGACY_CURSOR_FRONTMATTER is swapped for the
 * current one (its BOM and line endings kept), and an empty or whitespace-only file is written as a
 * created one would be. Other frontmatter is left alone.
 *
 * A file that cannot be read (a directory, no permission), a damaged block (a start marker without an
 * end marker, an end marker without a start marker) and a block from a newer ctxo are `skipped` with
 * a warning and left unchanged, in a dry run too.
 */
export function installRules(
  projectRoot: string,
  platformId: string,
  options: { readonly tier?: RulesTier; readonly dryRun?: boolean } = {},
): InstallResult {
  const { result, content } = planRules(projectRoot, platformId, { tier: options.tier });
  if (!options.dryRun && result.action !== 'skipped' && content !== undefined) {
    const filePath = join(projectRoot, result.file);
    if (result.action === 'created') mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  }
  return result;
}

/** What `installRules` does to a rules file, and the file's content afterwards. */
export interface RulesPlan {
  readonly result: InstallResult;
  /** The content the file has after the write (the old content when `skipped`); absent when it is left alone with a warning. */
  readonly content?: string;
}

/**
 * `installRules` without the write: its result, and the content the file would have. `existing`
 * stands in for the file's content on disk, so a dry run that has already planned a write to the same
 * file under a linked name plans this one against what that write leaves, as a real run reads it.
 */
export function planRules(
  projectRoot: string,
  platformId: string,
  options: { readonly tier?: RulesTier; readonly existing?: string } = {},
): RulesPlan {
  const platform = PLATFORMS.find(p => p.id === platformId);
  if (!platform) throw new Error(`Unknown platform: ${platformId}`);
  const file = platform.file;

  // A file another platform also reads gets the full tier whatever the caller asked (doctor agrees).
  const tier = linkedRulesPlatforms(projectRoot, platformId).length > 0 ? 'full' : (options.tier ?? 'full');
  const filePath = join(projectRoot, file);

  let existing = options.existing;
  if (existing === undefined) {
    if (!existsSync(filePath)) return { result: { file, action: 'created' }, content: generateRules(platformId, tier) };
    try {
      existing = readFileSync(filePath, 'utf-8');
    } catch (err) {
      return { result: { file, action: 'skipped', warning: unreadableWarning(file, err) } };
    }
  }
  const changed = (content: string): RulesPlan => ({
    result: { file, action: content === existing ? 'skipped' : 'updated' },
    content,
  });

  if (platformId === 'cursor' && textShape(existing).text.trim() === '') {
    // An empty Cursor file gets what a created one gets: the frontmatter, then the block.
    return changed(textShape(existing).restore(generateRules(platformId, tier)));
  }

  const upsert = upsertRulesBlock(existing, renderRulesBlock(tier));
  if (upsert.kind === 'unterminated') {
    return { result: { file, action: 'skipped', warning: `${file}: ctxo rules start marker has no end marker; left unchanged` } };
  }
  if (upsert.kind === 'orphan-end') {
    return { result: { file, action: 'skipped', warning: `${file}: ctxo rules end marker has no start marker; left unchanged` } };
  }
  if (upsert.kind === 'newer') {
    return {
      result: { file, action: 'skipped', warning: `${file}: rules block v${upsert.version} comes from a newer ctxo; left unchanged` },
    };
  }

  return changed(platformId === 'cursor' ? replaceLegacyCursorFrontmatter(upsert.content) : upsert.content);
}

/** The warning for a rules, skill or MCP config file ctxo could not read (a directory in its place, no permission). */
function unreadableWarning(file: string, err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const reason = code ?? (err instanceof Error ? err.message : String(err));
  return `${file}: could not be read (${reason}); left unchanged`;
}

/* ------------------------------------------------------------------ */
/*  Skills                                                             */
/* ------------------------------------------------------------------ */

export const SKILLS = ['ctxo-understand', 'ctxo-safe-edit', 'ctxo-review-pr'] as const;

/** Platforms with a markdown skill/rule directory we can drop skills into. */
export const SKILL_PLATFORMS = ['claude-code', 'cursor'] as const;

type SkillPlatform = (typeof SKILL_PLATFORMS)[number];

const SKILL_TARGET_DIR: Record<SkillPlatform, (root: string, skill: string) => string> = {
  'claude-code': (root, skill) => join(root, '.claude', 'skills', skill, 'SKILL.md'),
  cursor: (root, skill) => join(root, '.cursor', 'rules', `${skill}.mdc`),
};

function skillTarget(platformId: string): ((root: string, skill: string) => string) | undefined {
  return (SKILL_PLATFORMS as readonly string[]).includes(platformId)
    ? SKILL_TARGET_DIR[platformId as SkillPlatform]
    : undefined;
}

function skillsSourceDir(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'skills');
    if (existsSync(join(candidate, 'ctxo-safe-edit', 'SKILL.md'))) return candidate;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate ctxo skills/ directory.');
}

export interface SkillState {
  readonly skill: (typeof SKILLS)[number];
  /** Project-relative, forward slashes */
  readonly file: string;
  /**
   * `current` also covers a copy that differs only in formatting: line endings, a UTF-8 BOM, trailing
   * whitespace, blank lines, table padding or line wrapping (`comparableMarkdown`). `newer`: the copy's
   * `<!-- ctxo-skill -->` marker is above SKILLS_TEMPLATE_VERSION (a newer ctxo wrote it); it is left
   * alone and is not outdated. A copy with no marker or an older one is `outdated`. `missing` also
   * covers a path that cannot be read as a file (such as a directory).
   */
  readonly state: 'current' | 'missing' | 'outdated' | 'newer';
}

interface SkillPlanEntry extends SkillState {
  /** The bundled file's content and the absolute path the skill is installed at. */
  readonly bundled: string;
  readonly to: string;
  /** The installed copy's marker version; set for `newer`. */
  readonly version?: string;
  /** Set when something other than a readable file is at `to` (a directory, no permission): the warning. */
  readonly blocked?: string;
}

function skillPlan(projectRoot: string, platformId: string): SkillPlanEntry[] {
  const target = skillTarget(platformId);
  if (!target) return [];
  const src = skillsSourceDir();
  return SKILLS.map((skill) => {
    const bundled = readFileSync(join(src, skill, 'SKILL.md'), 'utf-8');
    const to = target(projectRoot, skill);
    const file = relative(projectRoot, to).split(sep).join('/');
    if (!existsSync(to)) return { skill, file, state: 'missing', bundled, to };
    let installed: string;
    try {
      installed = readFileSync(to, 'utf-8');
    } catch (err) {
      // Not a readable skill, so it counts as missing; installSkills warns instead of writing over it.
      return { skill, file, state: 'missing', bundled, to, blocked: unreadableWarning(file, err) };
    }
    const version = skillTemplateVersion(installed);
    if (version !== undefined && compareTemplateVersions(version, SKILLS_TEMPLATE_VERSION) > 0) {
      return { skill, file, state: 'newer', bundled, to, version };
    }
    // The bundled copy carries the current marker, so a copy without one or with an older one differs.
    const same = comparableMarkdown(installed) === comparableMarkdown(bundled);
    return { skill, file, state: same ? 'current' : 'outdated', bundled, to };
  });
}

/** Where each of the platform's skills stands against the bundled copy. `[]` for a platform without skills. */
export function skillStates(projectRoot: string, platformId: string): SkillState[] {
  return skillPlan(projectRoot, platformId).map(({ skill, file, state }) => ({ skill, file, state }));
}

/**
 * Copies the bundled skills into the platform's skill folder. A skill equal to the bundled one
 * (formatting ignored, see `SkillState`) is `skipped` and not rewritten; a missing one is `created`, a
 * different one `updated`. A skill from a newer ctxo, and a skill path that cannot be read (such as a
 * directory), are `skipped` with a warning and left unchanged. `dryRun` computes the same actions and
 * writes nothing, not even a directory.
 */
export function installSkills(
  projectRoot: string,
  platformId: string,
  options: { readonly dryRun?: boolean } = {},
): InstallResult[] {
  return skillPlan(projectRoot, platformId).map(({ file, state, bundled, to, version, blocked }): InstallResult => {
    if (blocked !== undefined) return { file, action: 'skipped', warning: blocked };
    if (state === 'current') return { file, action: 'skipped' };
    if (state === 'newer') {
      return { file, action: 'skipped', warning: `${file}: skill v${version ?? ''} comes from a newer ctxo; left unchanged` };
    }
    if (!options.dryRun) {
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, bundled, 'utf-8');
    }
    return { file, action: state === 'missing' ? 'created' : 'updated' };
  });
}

/**
 * The warnings of one platform's `installSkills` run, split by what they leave on disk: a skill from
 * a newer ctxo stays in place and still backs the tier (`notices`); any other warning, such as a skill
 * path that is a directory, leaves the skill missing (`problems`). Init and `doctor --fix` read them
 * the same way, so init plans the tier only from skills that are in place.
 */
export function skillInstallWarnings(
  projectRoot: string,
  platformId: string,
  results: readonly InstallResult[],
): { readonly problems: readonly string[]; readonly notices: readonly string[] } {
  const newer = new Set(skillStates(projectRoot, platformId).filter((s) => s.state === 'newer').map((s) => s.file));
  const problems: string[] = [];
  const notices: string[] = [];
  for (const result of results) {
    if (result.warning === undefined) continue;
    if (newer.has(result.file)) notices.push(result.warning);
    else problems.push(result.warning);
  }
  return { problems, notices };
}

/* ------------------------------------------------------------------ */
/*  Project scaffolding (automatic, not prompted)                      */
/* ------------------------------------------------------------------ */

const GITIGNORE_ENTRY = '.ctxo/.cache/';

/**
 * Creates `.ctxo/index/`, where `ctxo index` writes the committed index. An existing directory is
 * `skipped`. `dryRun` computes the same action and creates nothing.
 */
export function ensureIndexDir(projectRoot: string, options: { readonly dryRun?: boolean } = {}): InstallResult {
  const dir = join(projectRoot, '.ctxo', 'index');
  if (existsSync(dir)) return { file: '.ctxo/index/', action: 'skipped' };
  if (!options.dryRun) mkdirSync(dir, { recursive: true });
  return { file: '.ctxo/index/', action: 'created' };
}

/**
 * Adds the `.ctxo/.cache/` entry to `.gitignore`, creating the file when it is missing. A file that
 * already has the entry is `skipped`. `dryRun` computes the same action and writes nothing.
 */
export function ensureGitignore(projectRoot: string, options: { readonly dryRun?: boolean } = {}): InstallResult {
  const filePath = join(projectRoot, '.gitignore');

  if (!existsSync(filePath)) {
    if (!options.dryRun) {
      writeFileSync(filePath, `# Ctxo local cache (auto-rebuilt, never committed)\n${GITIGNORE_ENTRY}\n`, 'utf-8');
    }
    return { file: '.gitignore', action: 'created' };
  }

  const existing = readFileSync(filePath, 'utf-8');
  if (existing.includes(GITIGNORE_ENTRY)) {
    return { file: '.gitignore', action: 'skipped' };
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  const updated = existing + `${separator}# Ctxo local cache (auto-rebuilt, never committed)\n${GITIGNORE_ENTRY}\n`;
  if (!options.dryRun) writeFileSync(filePath, updated, 'utf-8');
  return { file: '.gitignore', action: 'updated' };
}

const DEFAULT_CONFIG = `# ctxo project configuration
# Docs: https://github.com/alperhankendi/Ctxo
version: "1.0"

# Exclude files and workspaces from indexing.
# Uncomment and edit to activate; both fields accept picomatch globs
# (forward-slash paths relative to repo root).
index:
  # Per-file filter applied after \`git ls-files\`.
  ignore: []
  # - "packages/**/fixtures/**"
  # - "tools/legacy-*/**"

  # Workspace filter: matching workspaces are skipped entirely
  # (no plugin load, no file enumeration).
  ignoreProjects: []
  # - "packages/experimental-*"
  # - "examples/*"

gate:
  enabled: true
  sensitivity: balanced   # strict | balanced | lenient

# Co-change analysis: which files change together (.ctxo/index/co-changes.json).
# Every field is optional. Uncomment the block to edit it; the values shown are the defaults.
# cochange:
#   maxCommits: 2000        # number or "all"
#   # since: 12m            # optional age limit; d, w, m, y
#   maxFilesPerCommit: 30
#   minShared: 2
#   include: []             # extra tracked files no plugin indexes (picomatch globs)
#   exclude: []             # indexed files to leave out (picomatch globs)
`;

/**
 * Writes the default `.ctxo/config.yaml`; an existing config is `skipped` and never touched. `dryRun`
 * computes the same action and writes nothing, not even the `.ctxo/` directory.
 */
export function ensureConfig(projectRoot: string, options: { readonly dryRun?: boolean } = {}): InstallResult {
  const filePath = join(projectRoot, '.ctxo', 'config.yaml');

  if (existsSync(filePath)) {
    return { file: '.ctxo/config.yaml', action: 'skipped' };
  }

  if (!options.dryRun) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, DEFAULT_CONFIG, 'utf-8');
  }
  return { file: '.ctxo/config.yaml', action: 'created' };
}

/* ------------------------------------------------------------------ */
/*  MCP server registration                                            */
/* ------------------------------------------------------------------ */

const CTXO_MCP_ENTRY = { command: 'npx', args: ['-y', '@ctxo/cli'] };

interface McpConfigTarget {
  file: string;
  /** JSON key that holds server map */
  serverKey: 'mcpServers' | 'servers';
  /** Extra fields per server entry */
  extraFields?: Record<string, string>;
}

/**
 * Returns which MCP config files to create/update based on selected platforms.
 * Multiple platforms may map to the same config file (deduplicated).
 */
export function getMcpConfigTargets(selectedPlatformIds: string[]): McpConfigTarget[] {
  const targets = new Map<string, McpConfigTarget>();

  for (const id of selectedPlatformIds) {
    switch (id) {
      case 'claude-code':
      case 'cursor':
      case 'windsurf':
      case 'augment':
      case 'antigravity':
        // .mcp.json is the universal project-level MCP config
        targets.set('.mcp.json', { file: '.mcp.json', serverKey: 'mcpServers' });
        break;
      case 'github-copilot':
        targets.set('.vscode/mcp.json', { file: '.vscode/mcp.json', serverKey: 'servers', extraFields: { type: 'stdio' } });
        break;
      case 'amazonq':
        targets.set('.amazonq/mcp.json', { file: '.amazonq/mcp.json', serverKey: 'mcpServers' });
        break;
      case 'gemini-cli':
        // Gemini CLI reads MCP servers from .gemini/settings.json (project) or ~/.gemini/settings.json (user).
        targets.set('.gemini/settings.json', { file: '.gemini/settings.json', serverKey: 'mcpServers' });
        break;
      case 'continue':
        // Continue reads each MCP server from a standalone file under .continue/mcpServers/.
        targets.set('.continue/mcpServers/ctxo.json', { file: '.continue/mcpServers/ctxo.json', serverKey: 'mcpServers' });
        break;
    }
  }

  return [...targets.values()];
}

/**
 * Registers the ctxo server in one MCP config file: a missing file is `created`, an existing one gets
 * the entry merged in (`updated`, or `skipped` when ctxo is already there), and corrupt MCP JSON is
 * overwritten (`updated`, D12). Corrupt covers text that fails `JSON.parse`, a root that is not a plain
 * object (an array, a string, a number, `null`), and a server map that is neither absent, `null` nor a
 * plain object (such as a string `mcpServers`), so the call never throws on a file's content. A path
 * that cannot be read (a directory, no permission) is `skipped` with a warning and left alone. `dryRun`
 * computes the same action and writes nothing, not even a directory.
 */
export function ensureMcpConfig(
  projectRoot: string,
  target: McpConfigTarget,
  options: { readonly dryRun?: boolean } = {},
): InstallResult {
  const filePath = join(projectRoot, target.file);
  const write = (config: Record<string, unknown>): void => {
    if (options.dryRun) return;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  };

  const entry = target.extraFields
    ? { ...target.extraFields, ...CTXO_MCP_ENTRY }
    : { ...CTXO_MCP_ENTRY };
  const fresh = (): Record<string, unknown> => ({ [target.serverKey]: { ctxo: entry } });

  if (!existsSync(filePath)) {
    write(fresh());
    return { file: target.file, action: 'created' };
  }

  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { file: target.file, action: 'skipped', warning: unreadableWarning(target.file, err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const servers = isPlainObject(parsed) ? (parsed[target.serverKey] ?? {}) : undefined;
  if (!isPlainObject(parsed) || !isPlainObject(servers)) {
    // Corrupt MCP JSON: overwrite (D12).
    write(fresh());
    return { file: target.file, action: 'updated' };
  }

  if (servers['ctxo']) {
    return { file: target.file, action: 'skipped' };
  }

  write({ ...parsed, [target.serverKey]: { ...servers, ctxo: entry } });
  return { file: target.file, action: 'updated' };
}
