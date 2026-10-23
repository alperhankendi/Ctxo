import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IndexCommand } from './index-command.js';
import { SyncCommand } from './sync-command.js';
import { StatusCommand } from './status-command.js';
import { VerifyCommand } from './verify-command.js';
import { InitCommand } from './init-command.js';
import { INIT_PARTS, parseInitParts, type InitPart } from './init-parts.js';
import { WatchCommand } from './watch-command.js';
import { StatsCommand } from './stats-command.js';
import { DoctorCommand } from './doctor-command.js';
import { VisualizeCommand } from './visualize-command.js';
import { VersionCommand } from './version-command.js';
import { InstallCommand } from './install-command.js';
import { UpdateCommand } from './update-command.js';
import { BlastRadiusCommand } from './blast-radius-command.js';
import { ContextsCommand } from './contexts-command.js';
import { GateHookCommand } from './gate-hook-command.js';
import { GateCommand } from './gate-command.js';
import { parseCoChangeSince } from '../core/co-change/co-change-window.js';

/** `value` as a positive integer, or undefined when it is anything else (no sign, decimals, exponent or unit). */
function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

interface InitPartsFlag {
  /** The flag appears on the line, with or without a usable value. */
  readonly present: boolean;
  readonly parts: InitPart[];
  /** The message to print before exiting 1, when the value is missing or names a part that does not exist. */
  readonly error?: string;
}

/**
 * Read `--only` or `--skip` from `ctxo init` arguments: `--only a,b`, `--only=a,b`, repeated as often as
 * the user likes (the parts are merged). The value must be present. In the two-token spelling a next
 * token that starts with `-` is a flag (`--dry-run`, `-y`), which ends the list before it began; in the
 * `=` spelling the value is taken as written, so `--only=-y` names an unknown part.
 */
function readInitPartsFlag(args: readonly string[], flag: '--only' | '--skip'): InitPartsFlag {
  const validParts = INIT_PARTS.join(', ');
  const missing = `[ctxo] ${flag} requires a comma-separated list of parts: ${validParts}`;
  const values: string[] = [];
  let present = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    let value: string | undefined;
    let flagToken = false;
    if (arg === flag) {
      present = true;
      value = args[i + 1];
      flagToken = value?.startsWith('-') === true;
      i += 1;
    } else if (arg.startsWith(`${flag}=`)) {
      present = true;
      value = arg.slice(flag.length + 1);
    } else {
      continue;
    }
    if (!value || flagToken) return { present, parts: [], error: missing };
    values.push(value);
  }
  const { parts, unknown } = parseInitParts(values.join(','));
  if (unknown.length > 0) {
    return { present, parts, error: `[ctxo] Unknown init part: ${unknown[0]}. Valid parts: ${validParts}` };
  }
  return { present, parts };
}

export function getVersion(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 10; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf-8'));
        return json.version ?? 'unknown';
      } catch { break; }
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return 'unknown';
}

/**
 * Walk up from `startDir` (capped at 12 levels) looking for a directory that
 * contains `.git`. First hit wins. Matches how git itself resolves the working
 * tree and keeps every subcommand consistent when the user runs ctxo from a
 * subdirectory or when pnpm --filter sets cwd to a monorepo package.
 */
export function locateGitRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export class CliRouter {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    // If cwd is a subdirectory of a git repo (common in monorepos and when
    // users run ctxo from anywhere below the repo root), use the repo root so
    // every subcommand consistently operates on the same project.
    this.projectRoot = locateGitRoot(projectRoot) ?? projectRoot;
  }

  async route(args: string[]): Promise<void> {
    const command = args[0];

    // --help and -h win over everything else on the line, before any flag is parsed or any command is built:
    // `ctxo index --help` must print the help and never start an index run, and `ctxo init --help` never an init.
    // There is one help text for the whole CLI (each command has its own lines in it).
    if (!command || args.some((arg) => arg === '--help' || arg === '-h')) {
      this.printHelp();
      return;
    }

    if (command === '--version' || command === '-v' || command === '-V') {
      const verbose = args.includes('--verbose');
      const json = args.includes('--json');
      await new VersionCommand(this.projectRoot).run({ verbose, json });
      return;
    }

    if (command === 'version') {
      const json = args.includes('--json');
      const short = args.includes('--short');
      await new VersionCommand(this.projectRoot).run({
        verbose: !json && !short,
        json,
      });
      return;
    }

    switch (command) {
      case 'index': {
        // --files takes every value up to the next flag, --commit takes one revision, and --file is the
        // older spelling of --files with a single path. All of them can be repeated or combined.
        const filesArg: string[] = [];
        let commitArg: string | undefined;
        for (let i = 1; i < args.length; i++) {
          const arg = args[i];
          if (arg === '--file') {
            const value = args[i + 1];
            if (!value || value.startsWith('--')) {
              console.error('[ctxo] --file requires a path argument');
              process.exit(1);
              return;
            }
            filesArg.push(value);
            i += 1;
          } else if (arg === '--files') {
            const before = filesArg.length;
            while (i + 1 < args.length && !args[i + 1]!.startsWith('--')) {
              filesArg.push(args[i + 1]!);
              i += 1;
            }
            if (filesArg.length === before) {
              console.error('[ctxo] --files requires at least one path');
              process.exit(1);
              return;
            }
          } else if (arg === '--commit') {
            const value = args[i + 1];
            if (!value || value.startsWith('--')) {
              console.error('[ctxo] --commit requires a revision (for example HEAD)');
              process.exit(1);
              return;
            }
            commitArg = value;
            i += 1;
          }
        }
        const checkArg = args.includes('--check');
        const skipHistory = args.includes('--skip-history');
        const skipCommunity = args.includes('--skip-community');
        const installMissing = args.includes('--install-missing');
        const maxHistoryIdx = args.indexOf('--max-history');
        const maxHistoryArg = maxHistoryIdx !== -1 ? Number(args[maxHistoryIdx + 1]) : undefined;
        if (maxHistoryIdx !== -1 && (!maxHistoryArg || isNaN(maxHistoryArg) || maxHistoryArg < 1)) {
          console.error('[ctxo] --max-history requires a positive integer');
          process.exit(1);
          return;
        }
        // The co-change window flags are checked here because the config resolver skips an invalid
        // override silently, which would run a different window from the one the user asked for.
        const cochangeCommitsIdx = args.indexOf('--cochange-commits');
        const cochangeCommitsRaw = cochangeCommitsIdx !== -1 ? args[cochangeCommitsIdx + 1] : undefined;
        const cochangeCommitsArg = cochangeCommitsRaw === 'all' ? 'all' : parsePositiveInteger(cochangeCommitsRaw);
        if (cochangeCommitsIdx !== -1 && cochangeCommitsArg === undefined) {
          console.error('[ctxo] --cochange-commits requires a positive integer or "all"');
          process.exit(1);
          return;
        }
        const cochangeSinceIdx = args.indexOf('--cochange-since');
        const cochangeSinceArg = cochangeSinceIdx !== -1 ? args[cochangeSinceIdx + 1] : undefined;
        if (cochangeSinceIdx !== -1 && (cochangeSinceArg === undefined || parseCoChangeSince(cochangeSinceArg) === undefined)) {
          console.error('[ctxo] --cochange-since requires a duration such as 30d, 2w, 12m or 1y');
          process.exit(1);
          return;
        }
        await new IndexCommand(this.projectRoot).run({
          files: filesArg.length > 0 ? filesArg : undefined,
          commit: commitArg,
          check: checkArg,
          skipHistory,
          skipCommunity,
          maxHistory: maxHistoryArg,
          cochangeCommits: cochangeCommitsArg,
          cochangeSince: cochangeSinceArg,
          installMissing,
        });
        break;
      }

      case 'sync':
        await new SyncCommand(this.projectRoot).run();
        break;

      case 'watch':
        await new WatchCommand(this.projectRoot).run();
        break;

      case 'verify-index':
        await new VerifyCommand(this.projectRoot).run();
        break;

      case 'status':
        new StatusCommand(this.projectRoot).run();
        break;

      case 'init': {
        const toolsIdx = args.indexOf('--tools');
        const toolsArg = toolsIdx !== -1 ? args[toolsIdx + 1] : undefined;
        const yesArg = args.includes('--yes') || args.includes('-y');
        const rulesOnly = args.includes('--rules');
        const dryRun = args.includes('--dry-run');
        const noInstall = args.includes('--no-install');
        const noGuard = args.includes('--no-guard');
        const tools = toolsArg ? toolsArg.split(',').map(t => t.trim()) : undefined;
        // Everything is checked before InitCommand exists, so a bad flag never starts an init. --only is
        // exact, so it cannot be mixed with the narrowing flags (--skip, --rules); --no-guard combines with all.
        const only = readInitPartsFlag(args, '--only');
        const skip = readInitPartsFlag(args, '--skip');
        const partsError = only.error ?? skip.error
          ?? (only.present && (skip.present || rulesOnly) ? '[ctxo] --only cannot be combined with --skip or --rules' : undefined);
        if (partsError) {
          console.error(partsError);
          process.exit(1);
          return;
        }
        await new InitCommand(this.projectRoot).run({
          tools,
          yes: yesArg,
          rulesOnly,
          dryRun,
          noInstall,
          only: only.present ? only.parts : undefined,
          skip: skip.present ? skip.parts : undefined,
          noGuard,
        });
        break;
      }

      case 'stats': {
        const daysIdx = args.indexOf('--days');
        const daysArg = daysIdx !== -1 ? Number(args[daysIdx + 1]) : undefined;
        const jsonArg = args.includes('--json');
        const clearArg = args.includes('--clear');
        await new StatsCommand(this.projectRoot).run({ days: daysArg, json: jsonArg, clear: clearArg });
        break;
      }

      case 'doctor': {
        const jsonArg = args.includes('--json');
        const quietArg = args.includes('--quiet');
        const fixArg = args.includes('--fix');
        const dryRunArg = args.includes('--dry-run');
        const yesArg = args.includes('--yes') || args.includes('-y');
        await new DoctorCommand(this.projectRoot).run({
          json: jsonArg,
          quiet: quietArg,
          fix: fixArg,
          dryRun: dryRunArg,
          yes: yesArg,
        });
        break;
      }

      case 'install': {
        const languages: string[] = [];
        const flagValues: Record<string, string | boolean> = {};
        for (let i = 1; i < args.length; i++) {
          const a = args[i]!;
          if (a === '--yes' || a === '-y') flagValues['yes'] = true;
          else if (a === '--global' || a === '-g') flagValues['global'] = true;
          else if (a === '--dry-run') flagValues['dryRun'] = true;
          else if (a === '--force') flagValues['force'] = true;
          else if (a === '--full-tier') flagValues['fullTier'] = true;
          else if (a === '--syntax-only') flagValues['syntaxOnly'] = true;
          else if (a === '--pm') {
            const next = args[++i];
            if (!next) { console.error('[ctxo] --pm requires a value'); process.exit(1); return; }
            flagValues['pm'] = next;
          } else if (a === '--version') {
            const next = args[++i];
            if (!next) { console.error('[ctxo] --version requires a value'); process.exit(1); return; }
            flagValues['version'] = next;
          } else if (a.startsWith('--')) {
            console.error(`[ctxo] Unknown install flag: ${a}`);
            process.exit(1);
            return;
          } else {
            languages.push(a);
          }
        }
        await new InstallCommand(this.projectRoot).run({
          languages,
          yes: flagValues['yes'] === true,
          global: flagValues['global'] === true,
          dryRun: flagValues['dryRun'] === true,
          force: flagValues['force'] === true,
          fullTier: flagValues['fullTier'] === true,
          syntaxOnly: flagValues['syntaxOnly'] === true,
          pm: typeof flagValues['pm'] === 'string' ? flagValues['pm'] : undefined,
          version: typeof flagValues['version'] === 'string' ? flagValues['version'] : undefined,
        });
        break;
      }

      case 'update': {
        const flagValues: Record<string, string | boolean> = {};
        for (let i = 1; i < args.length; i++) {
          const a = args[i]!;
          if (a === '--check') flagValues['check'] = true;
          else if (a === '--print') flagValues['print'] = true;
          else if (a === '--global' || a === '-g') flagValues['global'] = true;
          else if (a === '--json') flagValues['json'] = true;
          else if (a === '--force') flagValues['force'] = true;
          else if (a === '--pm') {
            const next = args[++i];
            if (!next) { console.error('[ctxo] --pm requires a value'); process.exit(1); return; }
            flagValues['pm'] = next;
          } else {
            console.error(`[ctxo] Unknown update flag: ${a}`);
            process.exit(1);
            return;
          }
        }
        await new UpdateCommand(this.projectRoot, {
          setExitCode: (code: number) => { process.exitCode = code; },
        }).run({
          check: flagValues['check'] === true,
          print: flagValues['print'] === true,
          global: flagValues['global'] === true,
          json: flagValues['json'] === true,
          force: flagValues['force'] === true,
          pm: typeof flagValues['pm'] === 'string' ? flagValues['pm'] : undefined,
        });
        break;
      }

      case 'gate': {
        if (args.includes('--preview')) {
          new GateCommand(this.projectRoot).preview({ json: args.includes('--json') });
        } else {
          console.error('[ctxo] usage: ctxo gate --preview [--json]');
          process.exit(1);
        }
        break;
      }

      case 'gate-hook':
        await new GateHookCommand(this.projectRoot).run();
        break;

      case 'blast-radius': {
        const symbolId = args[1];
        if (!symbolId || symbolId.startsWith('--')) {
          console.error('[ctxo] usage: ctxo blast-radius <symbolId> [--json]');
          process.exit(1);
          return;
        }
        new BlastRadiusCommand(this.projectRoot).run({ symbolId, json: args.includes('--json') });
        break;
      }

      case 'contexts':
        new ContextsCommand(this.projectRoot).run({ json: args.includes('--json') });
        break;

      case 'visualize': {
        const outputIdx = args.indexOf('--output');
        const outputArg = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
        const maxNodesIdx = args.indexOf('--max-nodes');
        const maxNodesArg = maxNodesIdx !== -1 ? Number(args[maxNodesIdx + 1]) : undefined;
        const noBrowser = args.includes('--no-browser');
        if (maxNodesIdx !== -1 && (!maxNodesArg || isNaN(maxNodesArg) || maxNodesArg < 1)) {
          console.error('[ctxo] --max-nodes requires a positive integer');
          process.exit(1);
          return;
        }
        await new VisualizeCommand(this.projectRoot).run({ output: outputArg, maxNodes: maxNodesArg, noBrowser });
        break;
      }

      default:
        console.error(`[ctxo] Unknown command: "${command}". Run "ctxo --help" for usage.`);
        process.exit(1);
        return;
    }
  }

  private printHelp(): void {
    const v = getVersion();
    console.error(`
ctxo v${v} — MCP server for dependency-aware codebase context

Usage:
  ctxo                      Start MCP server (stdio transport)
  ctxo index                Build full codebase index (--max-history N controls intent depth only, default 20)
  ctxo index --skip-community    Skip community detection and the contexts view for faster indexing
  ctxo index --skip-history      Skip git history (no intent or anti-patterns; co-changes.json is not refreshed)
  ctxo index --check             Fail if the index is stale; writes nothing and records no snapshot
  ctxo index --cochange-commits <n|all>   Co-change window in commits (default 2000, or "all")
  ctxo index --cochange-since <duration>  Co-change window by age from HEAD (30d, 2w, 12m, 1y)
  ctxo index --files <path...>   Re-index only these files (repo-relative); the rest of the index is kept
  ctxo index --file <path>       Same as --files with one path
  ctxo index --commit <rev>      Re-index the files changed by the commit just made (for example HEAD), drop the ones it deleted or renamed
  ctxo sync                 Rebuild SQLite cache from committed JSON index
  ctxo watch                Start file watcher for incremental re-indexing
  ctxo verify-index         CI gate: fail if index is stale
  ctxo status               Show index manifest
  ctxo init                 Interactive setup (rules, skills, guard, MCP, git hooks, config); the post-commit hook runs ctxo index --commit HEAD
  ctxo init --tools a,b -y  Non-interactive (claude-code,cursor,...); -y without --tools selects every tool
  ctxo init --only <parts>  Install only these parts: rules,skills,guard,mcp,git-hooks,config
  ctxo init --skip <parts>  Install everything except these parts
  ctxo init --no-guard      Does not install the Claude Code safe-edit guard
  ctxo init --rules         Deprecated: same as --skip git-hooks,guard
  ctxo init --dry-run       List every file init would create or change
  ctxo stats                Show usage statistics (--json, --days N, --clear)
  ctxo doctor               Health check all subsystems (--json, --quiet)
  ctxo doctor --fix         Apply fixes in dependency order: config, git hooks, skills, the safe-edit guard, rules blocks, plugins, index (--dry-run, --yes)
  ctxo visualize            Generate interactive dependency graph HTML
  ctxo visualize --max-nodes N   Limit to top N symbols by PageRank
  ctxo visualize --output PATH   Write HTML to custom path
  ctxo visualize --no-browser    Skip auto-opening browser
  ctxo install [<lang>...]  Install language plugins (detects if omitted)
  ctxo install python -y    Batch install, no prompt
  ctxo install ts --global  Install globally
  ctxo install py --dry-run Show command without running
  ctxo install sql          SQL plugin: .sql definitions, data edges from C# call sites
  ctxo update              Check + apply updates for ctxo + plugins
  ctxo update --check      Check only, no install
  ctxo update --print      Print install command, never execute
  ctxo update --global     Force a global install
  ctxo update --json       Machine-readable output
  ctxo update --pm <pm>    Override package manager (npm|pnpm|yarn|bun)
  ctxo update --force      Bypass CI lockfile guard
  ctxo blast-radius <symbolId>   Blast radius for one symbol (--json for machine output; name::kind for a SQL object)
  ctxo contexts             Candidate contexts from dependency and co-change clusters (table)
  ctxo contexts --json      Same, full contexts-view.json to stdout
  ctxo gate --preview            Preview which symbols the safe-edit guard would block
  ctxo gate --preview --json     Same, machine-readable output
  ctxo --version                 Print core version
  ctxo --version --verbose       Print core + plugins + runtime
  ctxo --version --json          Machine-readable version payload
  ctxo version                   Subcommand — verbose by default
  ctxo --help               Show this help message (also ctxo <command> --help; nothing is run)
`.trim());
  }
}
