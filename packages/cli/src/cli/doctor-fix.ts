import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import type { DoctorReport } from '../core/diagnostics/types.js';
import {
  detectLanguages,
  decideNeededLanguages,
  officialPluginFor,
  type KnownLanguage,
} from '../core/detection/detect-languages.js';
import { classifyRulesBlock } from '../core/agent-rules/rules-block.js';
import {
  SKILL_PLATFORMS,
  ensureClaudeHook,
  ensureConfig,
  guardExpected,
  installRules,
  installSkills,
  readClaudeGuardState,
  readRulesStates,
  resolveRulesTier,
  rulesFileHoldReasons,
  skillInstallWarnings,
  skillsExpected,
  type RulesHoldReasons,
} from './ai-rules.js';
import { InstallCommand } from './install-command.js';
import { InitCommand } from './init-command.js';
import { IndexCommand } from './index-command.js';
import { SyncCommand } from './sync-command.js';

export interface FixOptions {
  readonly projectRoot: string;
  readonly ctxoRoot: string;
  readonly yes?: boolean;
  readonly dryRun?: boolean;
}

export interface FixAttempt {
  readonly name: string;
  readonly action: string;
  readonly status: 'success' | 'skipped' | 'failed' | 'planned';
  readonly durationMs?: number;
  readonly error?: string;
  /** What a successful attempt left undone, such as a rules file it held back; one warning line each. */
  readonly warnings?: readonly string[];
}

export interface FixReport {
  readonly attempts: readonly FixAttempt[];
  readonly halted: boolean;
  readonly reason?: string;
}

/**
 * Apply ordered fixes derived from a doctor report.
 *
 * Order (PRD §5.2 D4.4, with the agent-setup steps of PR 2A D13):
 *   1. Config (bootstraps defaults other steps may need)
 *   2. Git hooks (cheap; depends on .git existing)
 *   3. Skills (install missing or outdated ctxo skills where the setup expects them)
 *   4. Claude guard hook (register ctxo gate-hook in .claude/settings.json)
 *   5. AI rules (re-render the rules blocks; runs whenever any of the three agent checks
 *      failed, after 3 and 4, so the tier follows the skills and guard fixed in this run)
 *   6. Language coverage (install missing plugins)
 *   7. Index (requires adapters, so it runs AFTER plugin install)
 *   8. SQLite cache (last; rebuild from index JSONs)
 *
 * Steps 3 to 5 never install what the user declined (D5): a versioned full block in CLAUDE.md is
 * an opt-out of the guard and the skills, and `gate.enabled: false` an opt-out of the guard only.
 * An unreadable `.claude/settings.json` is never written; when the guard is expected, its step fails
 * with the warning, otherwise it is skipped like any opt-out. Step 5
 * holds a rules file (CLAUDE.md, or Cursor's) while, after steps 3 and 4, its block still expects a
 * guard or skills that are not in place (whatever stopped them), by the same `rulesHold` rule as
 * `ctxo init`, and reports the hold as a warning.
 *
 * Error handling (D4.6 "dependency-aware continue"):
 *   - Config failure -> skip all dependent steps
 *   - Skills, Claude guard hook or AI rules failure -> reported; the next steps still run
 *   - Plugin install failure -> skip index (can't rebuild adapters) but DO rebuild cache
 *
 * Never fixable here: runtime, git repo, disk. Those remain as CheckResult
 * output for the user to address manually.
 *
 * All attempts are appended to `.ctxo/doctor-fix.log` for forensics.
 */
export async function applyFixes(report: DoctorReport, options: FixOptions): Promise<FixReport> {
  if (isCI(process.env) && !options.yes && !options.dryRun) {
    return {
      attempts: [],
      halted: true,
      reason: 'CI environment detected; refuse to mutate without --yes',
    };
  }

  const attempts: FixAttempt[] = [];
  const fixableIds = new Set(report.checks.filter((c) => c.status !== 'pass').map((c) => c.id));

  let configOk = true;
  if (fixableIds.has('config_file')) {
    const attempt = await run(
      'Config',
      'create from template',
      () => fixConfig(options.projectRoot),
      options,
    );
    attempts.push(attempt);
    configOk = attempt.status === 'success' || attempt.status === 'skipped' || attempt.status === 'planned';
  }

  if (!configOk) {
    return finish(attempts, options, true, 'Config fix failed; halting before hooks/plugins/index');
  }

  if (fixableIds.has('git_hooks') || fixableIds.has('hooks')) {
    attempts.push(
      await run(
        'Git hooks',
        're-install ctxo git hooks',
        () => fixHooks(options.projectRoot),
        options,
      ),
    );
  }

  if (fixableIds.has('skills')) {
    attempts.push(
      await run(
        'Skills',
        'install missing or outdated ctxo skills',
        () => fixSkills(options.projectRoot),
        options,
      ),
    );
  }

  if (fixableIds.has('claude_guard_hook')) {
    attempts.push(
      await run(
        'Claude guard hook',
        'register ctxo gate-hook in .claude/settings.json',
        () => fixClaudeGuardHook(options.projectRoot),
        options,
      ),
    );
  }

  if (fixableIds.has('ai_rules') || fixableIds.has('skills') || fixableIds.has('claude_guard_hook')) {
    attempts.push(
      await run(
        'AI rules',
        're-render ctxo rules blocks',
        () => fixAiRules(options.projectRoot),
        options,
      ),
    );
  }

  let pluginsOk = true;
  if (fixableIds.has('language_coverage') || hasMissingPlugins(options.projectRoot)) {
    const attempt = await run(
      'Language plugins',
      'install missing @ctxo/lang-* packages',
      () => fixLanguageCoverage(options.projectRoot, options.dryRun ?? false),
      options,
    );
    attempts.push(attempt);
    pluginsOk = attempt.status === 'success' || attempt.status === 'skipped' || attempt.status === 'planned';
  }

  if (pluginsOk) {
    if (
      fixableIds.has('index_directory') ||
      fixableIds.has('index_freshness') ||
      fixableIds.has('symbol_count')
    ) {
      attempts.push(
        await run(
          'Index',
          'rebuild JSON index',
          () => fixIndex(options.projectRoot, options.dryRun ?? false),
          options,
        ),
      );
    }
    if (fixableIds.has('orphaned_files')) {
      attempts.push(
        await run(
          'Orphaned index files',
          'delete index entries without a matching source file',
          () => pruneOrphans(options.projectRoot, options.ctxoRoot, options.dryRun ?? false),
          options,
        ),
      );
    }
  } else {
    attempts.push({ name: 'Index', action: 'rebuild JSON index', status: 'skipped', error: 'plugin install failed' });
  }

  if (
    fixableIds.has('sqlite_cache') ||
    fixableIds.has('schema_version') ||
    fixableIds.has('co_changes_cache')
  ) {
    attempts.push(
      await run(
        'SQLite cache',
        'delete .ctxo/.cache and resync',
        () => fixSqliteCache(options.projectRoot, options.ctxoRoot, options.dryRun ?? false),
        options,
      ),
    );
  }

  return finish(attempts, options, false);
}

function finish(
  attempts: FixAttempt[],
  options: FixOptions,
  halted: boolean,
  reason?: string,
): FixReport {
  writeLog(options.ctxoRoot, attempts, halted, reason);
  return reason ? { attempts, halted, reason } : { attempts, halted };
}

/** A fix body returns this when it deliberately did nothing (not a failure): the attempt is reported as skipped. */
interface FixSkipped {
  readonly skipped: string;
}

/** A fix body returns this when it did its work but left part of it undone: success with warning lines. */
interface FixWarned {
  readonly warnings: readonly string[];
}

async function run(
  name: string,
  action: string,
  body: () => Promise<void | FixSkipped | FixWarned>,
  options: FixOptions,
): Promise<FixAttempt> {
  if (options.dryRun) {
    return { name, action, status: 'planned' };
  }
  const start = Date.now();
  try {
    const outcome = await body();
    if (outcome && 'skipped' in outcome) {
      return { name, action, status: 'skipped', durationMs: Date.now() - start, error: outcome.skipped };
    }
    if (outcome) {
      return { name, action, status: 'success', durationMs: Date.now() - start, warnings: outcome.warnings };
    }
    return { name, action, status: 'success', durationMs: Date.now() - start };
  } catch (err) {
    return {
      name,
      action,
      status: 'failed',
      durationMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

async function fixConfig(projectRoot: string): Promise<void> {
  const result = ensureConfig(projectRoot);
  if (result.action === 'skipped') {
    // Already present — nothing to do
    return;
  }
}

async function fixHooks(projectRoot: string): Promise<void | FixSkipped> {
  const result = new InitCommand(projectRoot).installHooks();
  if (!result.installed) {
    // installHooks already printed the warning with the blocks to add by hand.
    return { skipped: `shared hooks directory (${result.sharedScope} core.hooksPath); ctxo does not write there, add the blocks by hand` };
  }
}

/**
 * Installs the bundled skills on every skill platform that expects them: one ctxo skill is already
 * there, or the platform's rules block is pre-tier or compact. A deliberate opt-out expects none. A
 * platform that fails does not stop the next one.
 *
 * The `installSkills` warnings are reported, not dropped. A skill left in place because a newer ctxo
 * wrote it is fine, so its warning is a warning line under the success line. Any other warning (a skill
 * path that cannot be read, such as a directory) leaves the skill missing, so it fails the attempt, as
 * does an error, `<platform>: <error>`; the failure lists the warning lines too.
 */
async function fixSkills(projectRoot: string): Promise<void | FixSkipped | FixWarned> {
  const platforms = SKILL_PLATFORMS.filter((id) => skillsExpected(projectRoot, id));
  if (platforms.length === 0) return { skipped: 'no platform expects the ctxo skills' };
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const id of platforms) {
    try {
      const { problems, notices } = skillInstallWarnings(projectRoot, id, installSkills(projectRoot, id));
      errors.push(...problems);
      warnings.push(...notices);
    } catch (err) {
      errors.push(`${id}: ${(err as Error).message}`);
    }
  }
  if (errors.length > 0) throw new Error([...errors, ...warnings].join('; '));
  if (warnings.length > 0) return { warnings };
}

/**
 * The failure for an unreadable `.claude/settings.json`. Unlike the `ensureClaudeHook` warning (shared
 * with init), it names one next step: the same `--fix` run that installs the guard renders the tier.
 */
const UNREADABLE_SETTINGS_FAILURE =
  '.claude/settings.json is not valid JSON or not a settings object; left unchanged. Fix it, then run "ctxo doctor --fix".';

/**
 * Registers the safe-edit guard when CLAUDE.md expects it and the gate is enabled. An unreadable
 * `.claude/settings.json` is never written; it fails the attempt only when the guard is expected, since
 * a user who opted out expects nothing there (final review M4).
 */
async function fixClaudeGuardHook(projectRoot: string): Promise<void | FixSkipped> {
  const state = readClaudeGuardState(projectRoot);
  if (state === 'present') return { skipped: 'already registered' };
  if (!guardExpected(projectRoot)) {
    return { skipped: 'not expected: CLAUDE.md records an opt-out or has no ctxo block, or gate.enabled is false' };
  }
  if (state === 'unreadable') throw new Error(UNREADABLE_SETTINGS_FAILURE);
  const result = ensureClaudeHook(projectRoot);
  if (result.warning) throw new Error(result.warning);
}

/**
 * Re-renders each rules file's ctxo block in the tier the disk supports now, so it follows the skills
 * and guard installed earlier in the run. A block from a newer ctxo is left alone (D2). A damaged file
 * (a start marker without an end marker, or an end marker without a start marker) is passed on too,
 * so the writer's warning fails the attempt instead of being lost; the writer leaves it unchanged (D8).
 *
 * A file is held while `rulesFileHoldReasons` (the rule `ctxo init` uses too, under every linked name
 * of the file) finds a reason, and the hold is reported: as the skip reason when nothing else
 * rendered, otherwise as a warning line under the success line. A held file still reports a damaged
 * block (from a dry run, which writes nothing).
 */
async function fixAiRules(projectRoot: string): Promise<void | FixSkipped | FixWarned> {
  const warnings: string[] = [];
  const holds: string[] = [];
  let rendered = 0;
  for (const state of readRulesStates(projectRoot)) {
    const first = state.scan.blocks[0];
    const damaged = state.scan.unterminated || state.scan.orphanEnd;
    const renderable = first ? classifyRulesBlock(first).state !== 'newer' : damaged;
    if (!renderable) continue;
    const reasons = rulesFileHoldReasons(projectRoot, state.platformId);
    if (reasons) {
      holds.push(holdMessage(state.file, reasons));
      const probe = installRules(projectRoot, state.platformId, { dryRun: true });
      if (probe.warning) warnings.push(probe.warning);
      continue;
    }
    rendered += 1;
    const result = installRules(projectRoot, state.platformId, { tier: resolveRulesTier(projectRoot, state.platformId) });
    if (result.warning) warnings.push(result.warning);
  }
  if (warnings.length > 0) throw new Error([...warnings, ...holds].join('; '));
  if (rendered === 0) return { skipped: holds.length > 0 ? holds.join('; ') : 'no ctxo rules block to re-render' };
  if (holds.length > 0) return { warnings: holds };
}

/**
 * The hold line for a rules file `rulesHoldReasons` keeps back, read from disk after the Skills and
 * Claude guard hook steps, whatever stopped them (a failed write, a partial install, an error).
 */
function holdMessage(file: string, reasons: RulesHoldReasons): string {
  const why: string[] = [];
  if (reasons.guard === 'unreadable') why.push('.claude/settings.json is unreadable');
  if (reasons.guard === 'absent') why.push('the safe-edit guard is not registered');
  if (reasons.missingSkills) why.push(`ctxo skills are missing (${reasons.missingSkills.join(', ')})`);
  if (reasons.outdatedSkills) why.push(`ctxo skills are outdated (${reasons.outdatedSkills.join(', ')})`);
  if (reasons.skillsError !== undefined) why.push(`the ctxo skills cannot be checked (${reasons.skillsError})`);
  return `${file} left unchanged while ${why.join(' and ')}`;
}

function hasMissingPlugins(projectRoot: string): boolean {
  const detection = detectLanguages(projectRoot);
  const needed = decideNeededLanguages(detection);
  for (const lang of needed) {
    if (!canResolvePlugin(lang)) return true;
  }
  return false;
}

async function fixLanguageCoverage(projectRoot: string, dryRun: boolean): Promise<void> {
  const detection = detectLanguages(projectRoot);
  const needed = decideNeededLanguages(detection);
  const missing = needed.filter((lang) => !canResolvePlugin(lang));
  if (missing.length === 0) return;
  if (dryRun) return;
  await new InstallCommand(projectRoot).run({ languages: missing, yes: true });
}

async function fixIndex(projectRoot: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await new IndexCommand(projectRoot).run({});
}

async function pruneOrphans(projectRoot: string, ctxoRoot: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  const indexDir = join(ctxoRoot, 'index');
  if (!existsSync(indexDir)) return;

  const sourceFiles = listGitFiles(projectRoot);
  if (sourceFiles.size === 0) return; // no signal; refuse to mass-delete

  const reader = new JsonIndexReader(ctxoRoot);
  const indices = reader.readAll();
  let removed = 0;
  for (const idx of indices) {
    if (sourceFiles.has(idx.file)) continue;
    const jsonPath = join(indexDir, `${idx.file}.json`);
    try {
      if (existsSync(jsonPath)) {
        unlinkSync(jsonPath);
        removed += 1;
        pruneEmptyParents(jsonPath, indexDir);
      }
    } catch {
      // best-effort; leave stragglers for next run
    }
  }
  if (removed === 0) return;
}

function pruneEmptyParents(filePath: string, stopAt: string): void {
  let dir = dirname(filePath);
  while (dir !== stopAt && dir.startsWith(stopAt)) {
    try {
      rmSync(dir, { recursive: false });
    } catch {
      return; // not empty or permission issue — stop climbing
    }
    dir = dirname(dir);
  }
}

function listGitFiles(projectRoot: string): Set<string> {
  try {
    const out = execFileSync(
      'git',
      // -z: NUL-separated, unquoted names. Quoted ones would never match an index entry, and the
      // prune would delete the entries of every file with a non-ASCII name.
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

async function fixSqliteCache(projectRoot: string, ctxoRoot: string, dryRun: boolean): Promise<void> {
  const cacheDir = join(ctxoRoot, '.cache');
  if (dryRun) return;
  if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
  // Trigger a sync to rebuild from .ctxo/index/*.json (in-process; no npx round-trip)
  await new SyncCommand(projectRoot).run();
}

const doctorRequire = createRequire(import.meta.url);

function canResolvePlugin(lang: KnownLanguage): boolean {
  try {
    doctorRequire.resolve(`${officialPluginFor(lang)}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function isCI(env: NodeJS.ProcessEnv): boolean {
  return env['CI'] === 'true' || env['CI'] === '1';
}

function writeLog(
  ctxoRoot: string,
  attempts: readonly FixAttempt[],
  halted: boolean,
  reason?: string,
): void {
  try {
    if (!existsSync(ctxoRoot)) mkdirSync(ctxoRoot, { recursive: true });
    const path = join(ctxoRoot, 'doctor-fix.log');
    const ts = new Date().toISOString();
    const lines: string[] = [`# ${ts} doctor --fix${halted ? ' (halted: ' + reason + ')' : ''}`];
    for (const a of attempts) {
      const dur = a.durationMs != null ? ` (${a.durationMs}ms)` : '';
      const err = a.error ? ` — ${a.error}` : '';
      lines.push(`- [${a.status}] ${a.name}: ${a.action}${dur}${err}`);
      for (const warning of a.warnings ?? []) lines.push(`  - warning: ${warning}`);
    }
    lines.push('');
    appendFileSync(path, lines.join('\n'));
  } catch {
    // best-effort logging; never fail the fix because of logging
  }
}

/** Consumer-friendly formatter for CLI output. */
export function formatFixReport(report: FixReport): string {
  const lines: string[] = [];
  for (const a of report.attempts) {
    const icon = a.status === 'success' ? '✓' : a.status === 'planned' ? '·' : a.status === 'skipped' ? '-' : '✗';
    const dur = a.durationMs != null ? ` (${a.durationMs}ms)` : '';
    const err = a.error ? ` — ${a.error}` : '';
    lines.push(`  ${icon} ${a.name}: ${a.action}${dur}${err}`);
    for (const warning of a.warnings ?? []) lines.push(`      ⚠ ${warning}`);
  }
  if (report.halted && report.reason) {
    lines.push(`  ! halted: ${report.reason}`);
  }
  return lines.join('\n');
}
