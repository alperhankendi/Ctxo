import { isAbsolute, join, relative } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  PLATFORMS,
  detectPlatforms,
  installRules,
  ensureGitignore,
  ensureConfig,
  ensureIndexDir,
  getMcpConfigTargets,
  ensureMcpConfig,
  installSkills,
  installSkillContent,
  ensureClaudeHook,
  ensureClaudeHookEntry,
  gateEnabled,
  linkedRulesPlatforms,
  planRules,
  resolveRulesTier,
  rulesDomainLine,
  rulesFileHoldReasons,
  skillInstallWarnings,
  type InstallResult,
  type RulesHoldOptions,
} from './ai-rules.js';
import type { RulesTier } from '../core/agent-rules/rules-block.js';
import {
  detectLanguages,
  decideNeededLanguages,
  officialPluginFor,
  type KnownLanguage,
} from '../core/detection/detect-languages.js';
import { InstallCommand } from './install-command.js';
import { cliInstallKind } from '../core/install/install-kind.js';
import { getCliPackageRoot, getVersion as getCliVersion } from './cli-paths.js';
import { loadConfig } from '../core/config/load-config.js';
import type { InitContribution, InitPartContext, InitPrompter } from '../ports/i-ctxo-module.js';
import {
  POST_COMMIT_CONTENT,
  POST_MERGE_CONTENT,
  resolveHooksDir,
  sharedHooksScope,
  sharedHooksWarning,
  upsertCtxoBlock,
  forwardSlashes,
  type SharedHooksScope,
} from './git-hooks.js';
import { pluginStepEnabled, resolveInitParts, type InitPart } from './init-parts.js';

const requireCjs = createRequire(import.meta.url);

/** True when the project's package.json lists @ctxo/cli in any dependency field. Unreadable or absent: false. */
function projectDeclaresCtxoCli(root: string): boolean {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    if (typeof pkg !== 'object' || pkg === null) return false;
    return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((field) => {
      const deps = (pkg as Record<string, unknown>)[field];
      return typeof deps === 'object' && deps !== null && '@ctxo/cli' in deps;
    });
  } catch {
    return false;
  }
}

function resolveInstalledPlugins(needed: readonly KnownLanguage[]): {
  installed: KnownLanguage[];
  missing: KnownLanguage[];
} {
  const installed: KnownLanguage[] = [];
  const missing: KnownLanguage[] = [];
  for (const lang of needed) {
    try {
      requireCjs.resolve(`${officialPluginFor(lang)}/package.json`);
      installed.push(lang);
    } catch {
      missing.push(lang);
    }
  }
  return { installed, missing };
}

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

/** Outcome of `InitCommand.installHooks`. Not installing into a shared hooks directory is a normal outcome, not an error. */
export interface HooksInstallResult {
  readonly installed: boolean;
  readonly hooksDir: string;
  /** Set when `core.hooksPath` comes from the global or system git config, so ctxo left it alone. */
  readonly sharedScope?: SharedHooksScope;
  /**
   * One row per hook (`post-commit`, then `post-merge`); empty for a shared hooks directory. Unlike
   * other rows, a hook row's `file` is absolute when the hooks directory is outside the project.
   */
  readonly results: InstallResult[];
}

export interface InitOptions {
  /**
   * `--tools`: the AI tools to set up; a repeated id counts once. Without it, the interactive run asks,
   * and a `--yes` run and a dry run take every tool (D16; final review M2).
   */
  tools?: string[];
  yes?: boolean;
  /** `--rules`: deprecated alias for `skip: ['git-hooks', 'guard']`; it also skips the plugin step. */
  rulesOnly?: boolean;
  dryRun?: boolean;
  /** Skip language detection prompt + any install invocation. */
  noInstall?: boolean;
  /** `--only`: install exactly these parts. The router rejects it together with `skip` or `rulesOnly`. */
  only?: InitPart[];
  /** `--skip`: install everything except these parts. */
  skip?: InitPart[];
  /** `--no-guard`: does not install the safe-edit guard. */
  noGuard?: boolean;
  /** `--domain`: also set up the domain layer (the opt-in `domain` part, D14). */
  domain?: boolean;
  /** `--boundaries`: the boundary mode for the domain part, so it is not asked. */
  boundaries?: BoundaryMode;
}

/** The boundary modes of `domain.boundaries.enforce`. */
export type BoundaryMode = 'by-rung' | 'new-only' | 'report';

/** Construction options of InitCommand. */
export interface InitCommandOptions {
  /** A directory standing in for the CLI's location when @ctxo/domain is looked up (tests); defaults to the running CLI. */
  readonly cliAnchor?: string;
}

/* ------------------------------------------------------------------ */
/*  Terminal UI helpers (zero dependency — picocolors only)            */
/* ------------------------------------------------------------------ */

import type picocolorsType from 'picocolors';
type PC = typeof picocolorsType;

const STRIP_ANSI = /\u001b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(STRIP_ANSI, '');

function box(lines: string[], opts: { title?: string; border?: (s: string) => string; width?: number }, pc: PC): string {
  const border = opts.border ?? pc.dim;
  const w = opts.width ?? Math.max(...lines.map(l => strip(l).length), strip(opts.title ?? '').length + 4, 48);
  const pad = (s: string) => s + ' '.repeat(Math.max(0, w - strip(s).length));

  const hr = '\u2500'.repeat(w + 2);
  let top: string;
  if (opts.title) {
    const tLen = strip(opts.title).length;
    top = border('\u256d\u2500 ') + opts.title + border(` ${ '\u2500'.repeat(Math.max(0, w - tLen - 2))}\u256e`);
  } else {
    top = border(`\u256d${hr}\u256e`);
  }
  const bot = border(`\u2570${hr}\u256f`);
  const body = lines.map(l => `${border('\u2502')} ${pad(l)} ${border('\u2502')}`).join('\n');
  return `${top}\n${body}\n${bot}`;
}

function stepHeader(step: number, total: number, title: string, desc: string, pc: PC): string {
  const stepLabel = pc.bold(pc.cyan(`${step}/${total}`));
  const titleStr = pc.bold(title);
  return box(
    [`${pc.dim(desc)}`],
    { title: `${stepLabel} ${titleStr}`, border: pc.cyan },
    pc,
  );
}

/* ------------------------------------------------------------------ */
/*  ASCII banner with faux gradient                                    */
/* ------------------------------------------------------------------ */

function renderBanner(_version: string | undefined, pc: PC): string {
  const art = [
    '  \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 ',
    '  \u2588\u2588\u2554\u2550\u2550\u2550\u255d\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d\u255a\u2588\u2588\u2557\u2588\u2588\u2554\u255d\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557',
    '  \u2588\u2588\u2551       \u2588\u2588\u2551    \u255a\u2588\u2588\u2588\u2554\u255d \u2588\u2588\u2551   \u2588\u2588\u2551',
    '  \u2588\u2588\u2551       \u2588\u2588\u2551    \u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551   \u2588\u2588\u2551',
    '  \u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551   \u2588\u2588\u2554\u255d\u255a\u2588\u2588\u2557\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d',
    '   \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u255d   \u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d ',
  ];

  // Faux vertical gradient: cyan → blueBright → magentaBright
  const colors = [pc.cyan, pc.cyan, pc.blueBright, pc.blueBright, pc.magentaBright, pc.magentaBright] as const;
  const coloredArt = art.map((line, i) => colors[i]!(line));

  const tagline1 = pc.bold(pc.white('  Code intelligence for AI agents.'));
  const tagline2 = pc.dim('  One call instead of hundreds.');

  const inner = [
    '',
    ...coloredArt,
    '',
    tagline1,
    tagline2,
    '',
  ];

  return box(inner, { border: pc.dim }, pc);
}

/* ------------------------------------------------------------------ */
/*  Init output                                                        */
/* ------------------------------------------------------------------ */

const RULES_DEPRECATION_NOTICE =
  '[ctxo] --rules is deprecated and now means --skip git-hooks,guard. Use --only or --skip instead.';
const NOTHING_TO_INSTALL_NOTICE = '[ctxo] Nothing to install: every part is excluded.';
const SHARED_HOOKS_SKIPPED = 'git hooks skipped - shared hooks directory (see warning above)';

/** The row a dry run gives the @ctxo/domain package when it is not installed. */
const DOMAIN_PACKAGE_ROW = '@ctxo/domain (package)';
const DOMAIN_MISSING_WARNING = '@ctxo/domain is not installed; run "ctxo install domain", then "ctxo init --only domain"';

/**
 * The boundary-mode question. `@ctxo/domain` asks the same one when it runs without an answer; init asks
 * it in the question phase, before the spinner (PF11), and passes the answer as `boundaries`.
 */
const BOUNDARY_QUESTION = 'Boundary violations between named contexts';
const BOUNDARY_CHOICES: readonly { readonly value: BoundaryMode; readonly label: string }[] = [
  { value: 'by-rung', label: 'by-rung: fail verify-domain for bounded and boring contexts, warn for the others' },
  { value: 'new-only', label: 'new-only: as by-rung, but fail only on violations the branch adds (verify-domain --since)' },
  { value: 'report', label: 'report: warnings only' },
];

/** How the domain part runs in one init run. */
interface DomainRun {
  /** The interactive flow: the install question was asked before the spinner (`installApproved`). */
  readonly interactive: boolean;
  /** `--yes`: install @ctxo/domain without asking. */
  readonly yes: boolean;
  /** `--no-install`: never install @ctxo/domain. */
  readonly noInstall: boolean;
  readonly boundaries?: BoundaryMode;
  /** Interactive only: the answer to the install question; absent when it was not asked. */
  readonly installApproved?: boolean;
  /** The module's questions: clack when interactive, else each question's initial answer. */
  readonly prompter: InitPrompter;
  /** The platforms the domain part sets up: `--tools`, the selected tools, or the detected platforms. */
  readonly toolIds: readonly string[];
  /** Interactive only: stop and restart the spinner around the domain step. */
  readonly pause?: () => void;
  readonly resume?: () => void;
}

/** A prompter that answers every question with its initial value (not interactive, or `--yes`). */
const INITIAL_ANSWERS: InitPrompter = {
  confirm: async (_message, initial) => initial,
  select: async (_message, _options, initial) => initial,
};

/** The domain run of `--yes`, `--tools` and the dry run: every selected tool, no questions (PF11). */
function nonInteractiveDomainRun(options: InitOptions, toolIds: readonly string[]): DomainRun {
  return {
    interactive: false,
    yes: options.yes === true,
    noInstall: options.noInstall === true,
    ...(options.boundaries !== undefined ? { boundaries: options.boundaries } : {}),
    prompter: INITIAL_ANSWERS,
    toolIds,
  };
}

type Clack = typeof import('@clack/prompts');

/** The module's questions through clack; cancelling ends init like every other init question. */
function clackPrompter(clack: Clack, pc: PC): InitPrompter {
  const answered = <T>(value: T | symbol): T => {
    if (clack.isCancel(value)) {
      clack.cancel('Setup cancelled.');
      process.exit(0);
    }
    return value as unknown as T;
  };
  return {
    async confirm(message, initial) {
      return answered(await clack.confirm({ message: pc.cyan(message), initialValue: initial })) === true;
    },
    async select<T extends string>(
      message: string,
      options: readonly { readonly value: T; readonly label: string }[],
      initial: T,
    ): Promise<T> {
      const choices = options.map((option) => ({ value: option.value, label: option.label }));
      const picked: unknown = await clack.select({ message: pc.cyan(message), options: choices as never, initialValue: initial as never });
      return answered(picked as T | symbol);
    },
  };
}

/** `domain.boundaries.enforce` from `.ctxo/config.yaml` when it holds a valid mode. */
function configuredBoundaryMode(projectRoot: string): BoundaryMode | undefined {
  const domain = (loadConfig(join(projectRoot, '.ctxo')).config as Record<string, unknown>)['domain'];
  if (typeof domain !== 'object' || domain === null) return undefined;
  const boundaries = (domain as Record<string, unknown>)['boundaries'];
  if (typeof boundaries !== 'object' || boundaries === null) return undefined;
  const enforce = (boundaries as Record<string, unknown>)['enforce'];
  return enforce === 'by-rung' || enforce === 'new-only' || enforce === 'report' ? enforce : undefined;
}

/** The parts the AI Tools step serves: without any of them, no tool list is asked for. */
const TOOL_PARTS: readonly InitPart[] = ['rules', 'skills', 'guard', 'mcp'];

/** One row of init output: a file and what happened to it. */
interface InitResult extends InstallResult {
  /** A rules file that `rulesHold` kept back: `skipped`, with `heldWarning` as its warning. */
  readonly held?: boolean;
  /** A git hook row from `installHooks`; the dry run prints its file as `<path> (git hook)`. */
  readonly gitHook?: boolean;
}

/**
 * The tool ids a run sets up: `--tools` with each id once, or every platform without it. The dry run
 * and a `--yes` run take the same default, so the dry run previews what `--yes` writes (final review M2).
 */
function selectedTools(options: InitOptions): string[] {
  return options.tools ? [...new Set(options.tools)] : PLATFORMS.map((p) => p.id);
}

/** Why a held rules file was left unchanged, and the commands that let it be written. */
function heldWarning(file: string): string {
  return `${file}: left unchanged until the guard and skills are installed; run "ctxo init --only rules,skills,guard" or "ctxo doctor --fix"`;
}

/** What these options decline in this run, for `rulesHold`: `--no-guard` and `--skip skills` (Review Focus 3). */
function declinedBy(options: InitOptions): { noGuard: boolean; skipSkills: boolean } {
  return { noGuard: options.noGuard === true, skipSkills: options.skip?.includes('skills') === true };
}

/** `skipped` reads `unchanged` in init output (D16). */
function actionLabel(action: InstallResult['action']): string {
  return action === 'skipped' ? 'unchanged' : action;
}

/** `[ctxo] ✓ <file> (<created|updated|unchanged>)`; a result with a warning prints only `[ctxo] ⚠ <warning>` (D16). */
function formatResultLine(result: InstallResult): string {
  return result.warning !== undefined
    ? `[ctxo] \u26a0 ${result.warning}`
    : `[ctxo] \u2713 ${result.file} (${actionLabel(result.action)})`;
}

/** The same result as a row of the interactive summary box. */
function summaryRow(result: InstallResult, pc: PC): string {
  return result.warning !== undefined
    ? `${pc.yellow('\u26a0')} ${result.warning}`
    : `${pc.green('\u2713')} ${pc.bold(result.file)}  ${pc.dim(actionLabel(result.action))}`;
}

const DRY_RUN_HEADER = '[ctxo] Dry run: nothing is written. Files init would touch:';

/** A dry-run row's action word; `skipped` reads `unchanged` (D16). */
const PLAN_ACTION: Readonly<Record<InstallResult['action'], string>> = {
  created: 'would create',
  updated: 'would update',
  skipped: 'unchanged',
};

/**
 * One dry-run line: `  <file> <would create|would update|unchanged>`, the file padded to 44 columns,
 * or the warning sign and the text for a result with a warning. A git hook's file reads `<path> (git hook)`,
 * and a held rules file `unchanged (held)`.
 */
function formatPlanLine(result: InitResult): string {
  if (result.held) return `  ${result.file.padEnd(44)} unchanged (held)`;
  if (result.warning !== undefined) return `  \u26a0 ${result.warning}`;
  const file = result.gitHook ? `${result.file} (git hook)` : result.file;
  return `  ${file.padEnd(44)} ${PLAN_ACTION[result.action]}`;
}

/** Exits 1 on the first tool id that is not a platform, naming the valid ones. */
function exitOnUnknownTools(toolIds: readonly string[]): void {
  for (const id of toolIds) {
    if (!PLATFORMS.find(p => p.id === id)) {
      console.error(`[ctxo] Unknown tool: "${id}". Valid: ${PLATFORMS.map(p => p.id).join(', ')}`);
      process.exit(1);
    }
  }
}

/** The git hooks init installs, in install order. */
const GIT_HOOKS = [
  { name: 'post-commit', content: POST_COMMIT_CONTENT },
  { name: 'post-merge', content: POST_MERGE_CONTENT },
] as const;

/** A path for human output: project-relative with forward slashes inside the project, absolute otherwise. */
function displayPath(projectRoot: string, path: string): string {
  const rel = forwardSlashes(relative(projectRoot, path));
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? forwardSlashes(path) : rel;
}

/* ------------------------------------------------------------------ */
/*  InitCommand                                                        */
/* ------------------------------------------------------------------ */

export class InitCommand {
  private readonly projectRoot: string;
  private readonly cliAnchor: string | undefined;
  /** Set when the domain part could not run (missing package, failed init); `run` then ends with exit code 1. */
  private domainFailed = false;

  constructor(projectRoot: string, options: InitCommandOptions = {}) {
    // Router now resolves this; kept as a defensive copy for direct construction.
    this.projectRoot = projectRoot;
    this.cliAnchor = options.cliAnchor;
  }

  /**
   * Installs (or upgrades in place) the post-commit and post-merge blocks in the hooks directory
   * git uses, one result row per hook. A `core.hooksPath` from the global or system git config points
   * at a directory shared by every repository on the machine: nothing is written there, a warning
   * with the blocks to add by hand goes to stderr, and the result has `installed: false` and no rows.
   * A local `core.hooksPath` is honoured. `dryRun` gives the same result and warning but writes
   * nothing: no directory, no hook file, no exec bit.
   */
  installHooks(options: { readonly dryRun?: boolean } = {}): HooksInstallResult {
    const dryRun = options.dryRun === true;
    const hooksDir = resolveHooksDir(this.projectRoot);
    const sharedScope = sharedHooksScope(this.projectRoot);
    if (sharedScope) {
      console.error(sharedHooksWarning(hooksDir, sharedScope));
      return { installed: false, hooksDir, sharedScope, results: [] };
    }

    if (!dryRun) mkdirSync(hooksDir, { recursive: true });
    const results = GIT_HOOKS.map(({ name, content }) => this.installHook(hooksDir, name, content, dryRun));
    return { installed: true, hooksDir, results };
  }

  /**
   * What init would do with these options, one row per file, writing nothing: the same pipeline as a
   * real run over the parts the flags select. Without `tools` it previews every platform (D16), the
   * domain part included (PF11). Without @ctxo/domain the domain part is the row `@ctxo/domain (package)`.
   */
  async plan(options: InitOptions = {}): Promise<InitResult[]> {
    const toolIds = selectedTools(options);
    return this.applyParts(resolveInitParts(options), toolIds, true, declinedBy(options), nonInteractiveDomainRun(options, toolIds));
  }

  async run(options: InitOptions = {}): Promise<void> {
    if (!existsSync(join(this.projectRoot, '.git'))) {
      console.error('[ctxo] Not a git repository. Run "git init" first.');
      process.exit(1);
    }

    if (options.rulesOnly) console.error(RULES_DEPRECATION_NOTICE);

    // The plugin step is not a part (D9), so `--skip` of every part can still leave it; a dry run never installs plugins.
    const parts = resolveInitParts(options);
    if (parts.size === 0 && (options.dryRun || !pluginStepEnabled(options))) {
      console.error(NOTHING_TO_INSTALL_NOTICE);
      return;
    }

    if (options.dryRun) await this.dryRun(options);
    else if (options.yes || options.tools) await this.runNonInteractive(options, parts);
    else await this.runInteractive(options, parts);
    // The domain part ran after the others; a missing package (or a failed init) fails the run (D14).
    if (this.domainFailed) process.exitCode = 1;
  }

  /* ---------------------------------------------------------------- */
  /*  The parts pipeline                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Installs the selected parts in one fixed order: config, skills, guard, rules, MCP, git hooks, domain.
   * Skills and the guard go first so each platform's rules tier is resolved from what is on disk after
   * them, and so `rulesHold` can see whether a block that expects them must wait (for a file under
   * any of its linked names, `rulesFileHoldReasons`). A part not in the
   * set adds no row. Bundled skills that cannot be read become a warning row, and the other parts
   * still run. `dryRun` gives the same rows and writes nothing; the rules tier and the hold then count
   * the skills and guard it would install as present. `declined` is what the user declined in this run.
   * `domain` says how the domain part (step 7, `applyDomain`) installs @ctxo/domain and asks its questions.
   */
  private async applyParts(
    parts: ReadonlySet<InitPart>,
    toolIds: readonly string[],
    dryRun: boolean,
    declined: Pick<RulesHoldOptions, 'noGuard' | 'skipSkills'>,
    domain: DomainRun,
  ): Promise<InitResult[]> {
    const root = this.projectRoot;
    const write = { dryRun };
    const results: InitResult[] = [];

    if (parts.has('config')) {
      results.push(ensureIndexDir(root, write), ensureConfig(root, write), ensureGitignore(root, write));
    }

    /**
     * The platforms whose skills step leaves every skill in place: no error, and no warning other than
     * a skill from a newer ctxo (a skill path that is a directory stays missing, so it does not count).
     */
    const skillsDone = new Set<string>();
    if (parts.has('skills')) {
      for (const id of toolIds) {
        try {
          const skillResults = installSkills(root, id, write);
          results.push(...skillResults);
          if (skillInstallWarnings(root, id, skillResults).problems.length === 0) skillsDone.add(id);
        } catch (err) {
          // Only the warning is printed; the platform id stands in for the skill files it names.
          results.push({ file: id, action: 'skipped', warning: `skills for ${id} not installed: ${(err as Error).message}` });
        }
      }
    }

    let guard = false;
    if (parts.has('guard') && toolIds.includes('claude-code')) {
      const result = ensureClaudeHook(root, write);
      results.push(result);
      guard = result.warning === undefined;
    }

    /** The rows of the rules step, so a domain install later in the run can re-render them (#191). */
    let rulesRows: { readonly at: number; readonly count: number; readonly domain: boolean } | undefined;
    const applyRules = (domainLine: boolean): InitResult[] => {
      const rows: InitResult[] = [];
      // Read once per run, so an invalid config warns once, not once per platform.
      const gate = gateEnabled(root);
      // A real run reads the tier from disk after the skills and guard steps; a dry run counts what it would install.
      const planned = dryRun ? { guard, skills: skillsDone.has('claude-code') } : {};
      const holdOptions = (platformId: string): RulesHoldOptions => ({
        ...declined,
        gateEnabled: gate,
        ...(dryRun ? { planned: { guard, skills: skillsDone.has(platformId) } } : {}),
      });
      /** Dry run only: the content each planned rules file would have, so a linked name is planned against it. */
      const plannedContent = new Map<string, string>();
      for (const id of toolIds) {
        // A file linked to a held one (an AGENTS.md that is CLAUDE.md) is held too: a write would go through the link.
        if (rulesFileHoldReasons(root, id, holdOptions) !== undefined) {
          rows.push(...this.heldRows(id));
          continue;
        }
        const tier = this.rulesTier(id, planned, gate);
        if (!dryRun) {
          rows.push(installRules(root, id, { tier, domain: domainLine }));
          continue;
        }
        // The real run reads a linked name after the earlier name's write landed; plan it against that content.
        const sibling = linkedRulesPlatforms(root, id).find((other) => plannedContent.has(other));
        const existing = sibling !== undefined ? plannedContent.get(sibling) : undefined;
        const plan = planRules(root, id, { tier, domain: domainLine, ...(existing !== undefined ? { existing } : {}) });
        if (plan.content !== undefined) plannedContent.set(id, plan.content);
        rows.push(plan.result);
      }
      return rows;
    };

    if (parts.has('rules')) {
      // The domain line when the committed state sets up the domain layer or @ctxo/domain loads (#191), or (a
      // dry run) when the domain part would set it up.
      const domainLine = rulesDomainLine(root, await this.domainModuleLoaded()) || (dryRun && parts.has('domain'));
      const rows = applyRules(domainLine);
      rulesRows = { at: results.length, count: rows.length, domain: domainLine };
      results.push(...rows);
    }

    if (parts.has('mcp')) {
      // A project that declares @ctxo/cli is a project install even when init runs from a global copy: the
      // committed npx entry stays, so teammates without a global install keep a working MCP server (K15).
      const detected = cliInstallKind(getCliPackageRoot(), root);
      const installKind = detected === 'global' && projectDeclaresCtxoCli(root) ? 'project' : detected;
      for (const target of getMcpConfigTargets([...toolIds])) results.push(ensureMcpConfig(root, target, { ...write, installKind }));
    }

    if (parts.has('git-hooks')) {
      const hooks = this.installHooks(write);
      results.push(...hooks.results.map((result): InitResult => ({ ...result, gitHook: true })));
      if (!hooks.installed) {
        // installHooks printed the full warning; this row keeps the skip in the summary.
        results.push({ file: displayPath(root, hooks.hooksDir), action: 'skipped', warning: SHARED_HOOKS_SKIPPED });
      }
    }

    if (parts.has('domain')) {
      domain.pause?.();
      try {
        results.push(...(await this.applyDomain(dryRun, domain)));
      } finally {
        domain.resume?.();
      }
      // The domain part set up the domain layer (its config, registry or package) after the rules step: render
      // the rules again, with the domain line. A file the first pass created keeps its `created` row.
      const before = rulesRows;
      if (!dryRun && before !== undefined && !before.domain && rulesDomainLine(root, await this.domainModuleLoaded())) {
        const first = results.slice(before.at, before.at + before.count);
        const again = applyRules(true).map((row) =>
          row.action === 'updated' && first.some((old) => old.file === row.file && old.action === 'created') ? { ...row, action: 'created' as const } : row,
        );
        results.splice(before.at, before.count, ...again);
      }
    }

    return results;
  }

  /**
   * Step 7, the domain part. Without @ctxo/domain's init contribution: a dry run gives the row
   * `@ctxo/domain (package)`; `--no-install`, a non-interactive run without `--yes` or a declined install
   * question give the missing-package warning (all but the declined question fail the run); otherwise
   * @ctxo/domain is installed (`ctxo install domain`) and loaded again. Then the contribution's `apply` runs
   * with the domain tools, the run's prompter, `ensureConfig` and the two writers of `ai-rules.ts`.
   */
  private async applyDomain(dryRun: boolean, run: DomainRun): Promise<InitResult[]> {
    const missing: InitResult = { file: '@ctxo/domain', action: 'skipped', warning: DOMAIN_MISSING_WARNING };
    let init = await this.loadDomainInit(false);
    if (init === undefined) {
      if (dryRun) return [{ file: DOMAIN_PACKAGE_ROW, action: 'created' }];
      const declined = run.interactive && run.installApproved === false;
      const allowed = !run.noInstall && (run.interactive ? run.installApproved === true : run.yes);
      if (!allowed) {
        if (!declined) this.domainFailed = true;
        return [missing];
      }
      await new InstallCommand(this.projectRoot).run({ languages: ['domain'], yes: true });
      init = await this.loadDomainInit(true);
      if (init === undefined) {
        this.domainFailed = true;
        return [missing];
      }
    }

    const root = this.projectRoot;
    const write = { dryRun };
    const ctx: InitPartContext = {
      projectRoot: root,
      toolIds: run.toolIds,
      dryRun,
      yes: run.yes,
      ...(run.boundaries !== undefined ? { boundaries: run.boundaries } : {}),
      prompt: run.prompter,
      ensureConfigFile: () => ensureConfig(root, write),
      ensureClaudeHookEntry: (entry) => ensureClaudeHookEntry(root, entry, { ...write, rerun: 'domain' }),
      installSkill: (platformId, name, content) => installSkillContent(root, platformId, name, content, write),
    };
    try {
      return [...(await init.apply(ctx))];
    } catch (err) {
      this.domainFailed = true;
      return [{ file: '@ctxo/domain', action: 'skipped', warning: `@ctxo/domain init failed: ${(err as Error).message}` }];
    }
  }

  /**
   * Whether @ctxo/domain is installed and loads (the module loader's answer, memoized; a `loadDomainInit(true)`
   * after an install refreshes it). The rules block carries the domain line only then (#191).
   */
  private async domainModuleLoaded(): Promise<boolean> {
    try {
      const [{ DOMAIN_MODULE_PACKAGE, loadCtxoModules }, { resolvePackageCandidates }, { createModuleHost }] = await Promise.all([
        import('../adapters/modules/module-loader.js'),
        import('../adapters/language/plugin-discovery.js'),
        import('./module-host.js'),
      ]);
      if (resolvePackageCandidates(DOMAIN_MODULE_PACKAGE, this.projectRoot, this.cliAnchor).length === 0) return false;
      const host = createModuleHost({ projectRoot: this.projectRoot, mode: 'cli' });
      const { modules } = await loadCtxoModules(host, { cliAnchor: this.cliAnchor });
      return modules.some((module) => module.registration.id === 'domain');
    } catch {
      return false;
    }
  }

  /**
   * @ctxo/domain's init contribution, or undefined when the package is not installed, does not load
   * (version mismatch, load failure: the loader warns) or has no `init`. `refresh` looks again after an install.
   */
  private async loadDomainInit(refresh: boolean): Promise<InitContribution | undefined> {
    try {
      const [{ DOMAIN_MODULE_PACKAGE, loadCtxoModules }, { resolvePackageCandidates }, { createModuleHost }] = await Promise.all([
        import('../adapters/modules/module-loader.js'),
        import('../adapters/language/plugin-discovery.js'),
        import('./module-host.js'),
      ]);
      if (resolvePackageCandidates(DOMAIN_MODULE_PACKAGE, this.projectRoot, this.cliAnchor).length === 0) return undefined;
      const host = createModuleHost({ projectRoot: this.projectRoot, mode: 'cli' });
      const { modules } = await loadCtxoModules(host, { refresh, cliAnchor: this.cliAnchor });
      const init = modules[0]?.registration.init;
      return init !== undefined && typeof init.apply === 'function' ? init : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The rows for a rules file that `rulesHold` keeps back: the held row, then the warning a write
   * would have given (a damaged block or one from a newer ctxo, read by a dry run that writes nothing).
   */
  private heldRows(platformId: string): InitResult[] {
    const file = PLATFORMS.find((p) => p.id === platformId)?.file ?? platformId;
    const probe = installRules(this.projectRoot, platformId, { dryRun: true });
    const held: InitResult = { file, action: 'skipped', warning: heldWarning(file), held: true };
    return probe.warning !== undefined ? [held, probe] : [held];
  }

  /** The platform's rules tier; `full` when it cannot be resolved (the bundled skills cannot be read). */
  private rulesTier(
    platformId: string,
    planned: { readonly guard?: boolean; readonly skills?: boolean },
    gate: boolean,
  ): RulesTier {
    try {
      return resolveRulesTier(this.projectRoot, platformId, planned, { gateEnabled: gate });
    } catch {
      return 'full';
    }
  }

  /** Detected languages whose official plugin is not installed. */
  private missingPlugins(): KnownLanguage[] {
    return resolveInstalledPlugins(decideNeededLanguages(detectLanguages(this.projectRoot))).missing;
  }

  /* ---------------------------------------------------------------- */
  /*  Interactive flow                                                 */
  /* ---------------------------------------------------------------- */

  private async runInteractive(options: InitOptions, selected: ReadonlySet<InitPart>): Promise<void> {
    const clack = await import('@clack/prompts');
    const pc = (await import('picocolors')).default;

    const version = await this.getVersion();
    const parts = new Set(selected);

    // A step is shown only for a selected part, and the counter counts only the steps shown. The
    // plugin lookup runs up front so its step can be counted.
    const missingPlugins = pluginStepEnabled(options) ? this.missingPlugins() : [];
    const showIndex = parts.has('config');
    const showTools = TOOL_PARTS.some((part) => parts.has(part));
    const showPlugins = missingPlugins.length > 0;
    const showHooks = parts.has('git-hooks');
    const showDomain = parts.has('domain');
    const totalSteps = [showIndex, showTools, showPlugins, showHooks, showDomain].filter(Boolean).length;
    let stepNum = 0;

    // ── Banner ──
    console.error('');
    console.error(renderBanner(version, pc));
    console.error('');

    // ── Index directory (config) ──
    if (showIndex) {
      stepNum++;
      console.error(stepHeader(stepNum, totalSteps, 'Index Directory', 'Where ctxo stores the symbol graph and metadata.', pc));
      console.error('');
      console.error(`  ${pc.bold('.ctxo/index/')}  ${pc.dim('fixed location')}`);
      console.error('');
    }

    // ── AI tool selection (rules, skills, guard, mcp) ──
    let toolIds: string[] = [];
    if (showTools) {
      stepNum++;
      const detected = detectPlatforms(this.projectRoot);
      const detectedCount = detected.size;
      const detectedHint = detectedCount > 0 ? pc.green(` ${detectedCount} detected`) : '';

      console.error(stepHeader(stepNum, totalSteps, `AI Tools${detectedHint}`, 'Select your tools. Generates MCP usage rules for each.', pc));
      console.error('');

      const toolChoices = PLATFORMS.map(p => {
        const isDetected = detected.has(p.id);
        const star = p.starred ? pc.yellow(' \u2605') : '';
        const detect = isDetected ? pc.green(' (detected)') : '';
        return {
          value: p.id,
          label: `${p.name}${star}${detect}`,
          hint: isDetected ? undefined : pc.dim(p.file),
        };
      });

      const selectedTools = await clack.multiselect({
        message: pc.cyan('Select tools'),
        options: toolChoices,
        initialValues: [...detected],
        required: false,
      });

      if (clack.isCancel(selectedTools)) { clack.cancel('Setup cancelled.'); process.exit(0); }
      toolIds = selectedTools as string[];
      console.error('');
    }

    // ── Language plugins (not a part; skipped by --only, --rules and --no-install) ──
    let pluginsToInstall: KnownLanguage[] = [];
    if (showPlugins) {
      stepNum++;
      console.error(stepHeader(
        stepNum,
        totalSteps,
        `Language Plugins ${pc.yellow('missing')}`,
        `Detected: ${missingPlugins.join(', ')}; ctxo needs a plugin per language to index it.`,
        pc,
      ));
      console.error('');
      const confirm = await clack.confirm({
        message: pc.cyan(`Install ${[...new Set(missingPlugins.map(officialPluginFor))].join(' ')}?`),
        initialValue: true,
      });
      if (clack.isCancel(confirm)) { clack.cancel('Setup cancelled.'); process.exit(0); }
      if (confirm) pluginsToInstall = missingPlugins;
      console.error('');
    }

    // ── Git hooks ──
    if (showHooks) {
      stepNum++;
      console.error(stepHeader(
        stepNum,
        totalSteps,
        `Git Hooks ${pc.yellow('recommended')}`,
        'Auto-updates index and community snapshots on every commit and pull.\n  Without hooks, architectural drift & boundary violation signals stay empty\n  until you re-run `ctxo index` manually (or start `ctxo watch`).',
        pc,
      ));
      console.error('');

      const hooks = await clack.confirm({
        message: pc.cyan('Install hooks?'),
        initialValue: true,
      });

      if (clack.isCancel(hooks)) { clack.cancel('Setup cancelled.'); process.exit(0); }

      if (!hooks) {
        parts.delete('git-hooks');
        console.error('');
        console.error(pc.yellow('  ⚠ Drift & boundary-violation signals depend on repeated snapshots.'));
        console.error(pc.dim('    Options without hooks:'));
        console.error(pc.dim('      • run `ctxo watch` during development'));
        console.error(pc.dim('      • run `ctxo index --commit HEAD` after each commit (`ctxo index --check` only verifies staleness and records no snapshot)'));
        console.error(pc.dim('      • run `ctxo init` again to install hooks later'));
      }
      console.error('');
    }

    // ── Domain knowledge (opt-in part); its questions come before the spinner (PF11) ──
    const prompter = clackPrompter(clack, pc);
    let installApproved: boolean | undefined;
    let boundaries = options.boundaries;
    if (showDomain) {
      stepNum++;
      console.error(stepHeader(
        stepNum,
        totalSteps,
        'Domain Knowledge',
        'Registry, fold guard (Cursor: fold reminder) and the ctxo-domain-fold skill (@ctxo/domain).',
        pc,
      ));
      console.error('');
      const installed = (await this.loadDomainInit(false)) !== undefined;
      if (!installed && !options.noInstall) {
        installApproved = await prompter.confirm(
          `Install @ctxo/domain@${getCliVersion()}? It adds the registry, contexts-touched and the fold guard.`,
          true,
        );
      }
      if ((installed || installApproved === true) && boundaries === undefined && configuredBoundaryMode(this.projectRoot) === undefined) {
        boundaries = await prompter.select(BOUNDARY_QUESTION, BOUNDARY_CHOICES, 'by-rung');
      }
      console.error('');
    }

    // ── Guard question (Claude Code only); answering no declines the guard, as --no-guard does ──
    const declined = declinedBy(options);
    if (parts.has('guard') && toolIds.includes('claude-code') && !options.noGuard) {
      const guard = await clack.confirm({
        message: pc.cyan('Install the safe-edit guard? Blocks edits to high-impact symbols until blast radius is checked.'),
        initialValue: true,
      });
      if (clack.isCancel(guard)) { clack.cancel('Setup cancelled.'); process.exit(0); }
      if (!guard) {
        parts.delete('guard');
        declined.noGuard = true;
      }
    }

    // ── Execute with spinner ──
    const s = clack.spinner();
    s.start(pc.dim('Configuring...'));

    const domainRun: DomainRun = {
      interactive: true,
      yes: false,
      noInstall: options.noInstall === true,
      ...(boundaries !== undefined ? { boundaries } : {}),
      ...(installApproved !== undefined ? { installApproved } : {}),
      prompter,
      toolIds: showTools ? toolIds : [...detectPlatforms(this.projectRoot)],
      // The domain step may install a package and ask the module's own questions: never under a live spinner.
      pause: () => s.stop(pc.dim('Setting up the domain layer...')),
      resume: () => s.start(pc.dim('Finalizing...')),
    };
    const rows = (await this.applyParts(parts, toolIds, false, declined, domainRun)).map((result) => summaryRow(result, pc));

    if (pluginsToInstall.length > 0) {
      s.stop(pc.dim('Installing language plugins...'));
      const installer = new InstallCommand(this.projectRoot);
      await installer.run({ languages: pluginsToInstall, yes: true });
      rows.push(`${pc.green('\u2713')} ${pc.bold([...new Set(pluginsToInstall.map(officialPluginFor))].join(', '))}  ${pc.dim('language plugins installed')}`);
      s.start(pc.dim('Finalizing...'));
    }

    s.stop(pc.green('Done!'));

    // ── Summary box ──
    if (rows.length > 0) {
      console.error('');
      console.error(box(rows, { title: pc.green('\u2713 Summary'), border: pc.green }, pc));
    }

    // ── Next steps box ──
    const hasWork = toolIds.length > 0 || parts.has('git-hooks') || parts.has('domain');
    if (hasWork) {
      const steps = [
        `${pc.cyan('\u25b6')} ctxo index     ${pc.dim('\u2500 build codebase index')}`,
        `${pc.cyan('\u25b6')} ctxo doctor    ${pc.dim('\u2500 verify everything works')}`,
      ];
      console.error('');
      console.error(box(steps, { title: pc.cyan('\u2192 Next steps'), border: pc.cyan }, pc));
    }

    console.error('');
    console.error(`  ${pc.dim('Happy coding!')} ${pc.magentaBright('\u2764')}`);
    console.error('');
  }

  /* ---------------------------------------------------------------- */
  /*  Non-interactive flow                                             */
  /* ---------------------------------------------------------------- */

  private async runNonInteractive(options: InitOptions, parts: ReadonlySet<InitPart>): Promise<void> {
    const toolIds = selectedTools(options);
    exitOnUnknownTools(toolIds);

    const rows = await this.applyParts(parts, toolIds, false, declinedBy(options), nonInteractiveDomainRun(options, toolIds));
    for (const result of rows) console.error(formatResultLine(result));

    // Language detection + plugin install (not a part: skipped by --only, --rules and --no-install)
    if (pluginStepEnabled(options)) {
      const missing = this.missingPlugins();
      if (missing.length > 0) {
        if (options.yes) {
          console.error(`[ctxo] Installing missing plugins: ${missing.join(', ')}`);
          await new InstallCommand(this.projectRoot).run({ languages: missing, yes: true });
        } else {
          console.error(
            `[ctxo] Detected missing plugins: ${missing.join(', ')}. Run "ctxo install ${missing.join(' ')}" to install.`,
          );
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Dry run                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Prints `plan(options)`: the header, then one row per file and one line per warning. A shared
   * hooks directory prints installHooks' warning and no hook rows, as a real run does. The hook rows
   * come marked from the pipeline, so the hooks directory is looked up only when git-hooks is selected.
   */
  private async dryRun(options: InitOptions): Promise<void> {
    exitOnUnknownTools(selectedTools(options));

    console.error(DRY_RUN_HEADER);
    const rows = await this.plan(options);
    for (const result of rows) console.error(formatPlanLine(result));
  }

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                          */
  /* ---------------------------------------------------------------- */

  private async getVersion(): Promise<string | undefined> {
    try {
      const pkgPath = join(this.projectRoot, 'node_modules', '@ctxo', 'cli', 'package.json');
      if (existsSync(pkgPath)) {
        return JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
      }
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      return require('../../package.json').version;
    } catch {
      return undefined;
    }
  }

  /**
   * Upserts one hook's ctxo block. The action compares the old and the new text: a missing file is
   * `created`, a changed one `updated`, an equal one `skipped` and not rewritten. `dryRun` computes
   * the same action and touches nothing, not even the exec bit.
   *
   * The hook is read once, with no existence check before it (a check followed by a read is a race
   * on the same path): `ENOENT` means there is no hook yet, and any other read error (a directory,
   * no permission) is thrown to the caller.
   */
  private installHook(hooksDir: string, hookName: string, hookContent: string, dryRun: boolean): InstallResult {
    const hookPath = join(hooksDir, hookName);
    const file = displayPath(this.projectRoot, hookPath);

    let existing = '#!/bin/sh\n';
    let hookExists = true;
    try {
      existing = readFileSync(hookPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      hookExists = false;
    }
    const updated = upsertCtxoBlock(existing, hookContent);

    if (!hookExists || updated !== existing) {
      if (!dryRun) {
        writeFileSync(hookPath, updated, 'utf-8');
        chmodSync(hookPath, 0o755);
      }
      return { file, action: hookExists ? 'updated' : 'created' };
    }

    // Content is already current. A hook that lost its exec bit (copied, restored from a backup)
    // would silently stop firing, so restore it; failing init over a file we cannot chmod would not help.
    if (!dryRun) {
      try {
        chmodSync(hookPath, 0o755);
      } catch {
        // best effort
      }
    }
    return { file, action: 'skipped' };
  }
}
