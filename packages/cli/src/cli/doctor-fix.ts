import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JsonIndexReader } from '../adapters/storage/json-index-reader.js';
import type { DoctorReport } from '../core/diagnostics/types.js';
import {
  detectLanguages,
  decideNeededLanguages,
  officialPluginFor,
  type KnownLanguage,
} from '../core/detection/detect-languages.js';
import { ensureConfig } from './ai-rules.js';
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
}

export interface FixReport {
  readonly attempts: readonly FixAttempt[];
  readonly halted: boolean;
  readonly reason?: string;
}

/**
 * Apply ordered fixes derived from a doctor report.
 *
 * Order (PRD §5.2 D4.4):
 *   1. Config (bootstraps defaults other steps may need)
 *   2. Git hooks (cheap; depends on .git existing)
 *   3. Language coverage (install missing plugins)
 *   4. Index (requires adapters — so run AFTER plugin install)
 *   5. SQLite cache (last; rebuild from index JSONs)
 *
 * Error handling (D4.6 "dependency-aware continue"):
 *   - Config failure -> skip all dependent steps
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

async function run(
  name: string,
  action: string,
  body: () => Promise<void>,
  options: FixOptions,
): Promise<FixAttempt> {
  if (options.dryRun) {
    return { name, action, status: 'planned' };
  }
  const start = Date.now();
  try {
    await body();
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

async function fixHooks(projectRoot: string): Promise<void> {
  new InitCommand(projectRoot).installHooks();
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
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
    return new Set(out.split('\n').filter(Boolean));
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

function canResolvePlugin(lang: KnownLanguage): boolean {
  try {
    const { createRequire } = require('node:module') as typeof import('node:module');
    const r = createRequire(import.meta.url);
    r.resolve(`${officialPluginFor(lang)}/package.json`);
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
  }
  if (report.halted && report.reason) {
    lines.push(`  ! halted: ${report.reason}`);
  }
  return lines.join('\n');
}
