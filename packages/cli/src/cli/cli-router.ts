import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { IndexCommand } from './index-command.js';
import { SyncCommand } from './sync-command.js';
import { StatusCommand } from './status-command.js';
import { VerifyCommand } from './verify-command.js';
import { InitCommand } from './init-command.js';
import { WatchCommand } from './watch-command.js';
import { StatsCommand } from './stats-command.js';
import { DoctorCommand } from './doctor-command.js';
import { VisualizeCommand } from './visualize-command.js';
import { VersionCommand } from './version-command.js';
import { InstallCommand } from './install-command.js';

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

export class CliRouter {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async route(args: string[]): Promise<void> {
    const command = args[0];

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

    if (!command || command === '--help' || command === '-h') {
      this.printHelp();
      return;
    }

    switch (command) {
      case 'index': {
        const fileIdx = args.indexOf('--file');
        const fileArg = fileIdx !== -1 ? args[fileIdx + 1] : undefined;
        if (fileIdx !== -1 && (!fileArg || fileArg.startsWith('--'))) {
          console.error('[ctxo] --file requires a path argument');
          process.exit(1);
          return;
        }
        const checkArg = args.includes('--check');
        const skipHistory = args.includes('--skip-history');
        const maxHistoryIdx = args.indexOf('--max-history');
        const maxHistoryArg = maxHistoryIdx !== -1 ? Number(args[maxHistoryIdx + 1]) : undefined;
        if (maxHistoryIdx !== -1 && (!maxHistoryArg || isNaN(maxHistoryArg) || maxHistoryArg < 1)) {
          console.error('[ctxo] --max-history requires a positive integer');
          process.exit(1);
          return;
        }
        await new IndexCommand(this.projectRoot).run({ file: fileArg, check: checkArg, skipHistory, maxHistory: maxHistoryArg });
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
        const tools = toolsArg ? toolsArg.split(',').map(t => t.trim()) : undefined;
        await new InitCommand(this.projectRoot).run({ tools, yes: yesArg, rulesOnly, dryRun });
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
        await new DoctorCommand(this.projectRoot).run({ json: jsonArg, quiet: quietArg });
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
          pm: typeof flagValues['pm'] === 'string' ? flagValues['pm'] : undefined,
          version: typeof flagValues['version'] === 'string' ? flagValues['version'] : undefined,
        });
        break;
      }

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
  ctxo index                Build full codebase index (--max-history N, default 20)
  ctxo sync                 Rebuild SQLite cache from committed JSON index
  ctxo watch                Start file watcher for incremental re-indexing
  ctxo verify-index         CI gate: fail if index is stale
  ctxo status               Show index manifest
  ctxo init                 Interactive setup (tools, rules, hooks)
  ctxo init --rules         Regenerate AI tool rules only
  ctxo init --tools a,b -y  Non-interactive (claude-code,cursor,...)
  ctxo init --dry-run       Preview what would be created
  ctxo stats                Show usage statistics (--json, --days N, --clear)
  ctxo doctor               Health check all subsystems (--json, --quiet)
  ctxo visualize            Generate interactive dependency graph HTML
  ctxo visualize --max-nodes N   Limit to top N symbols by PageRank
  ctxo visualize --output PATH   Write HTML to custom path
  ctxo visualize --no-browser    Skip auto-opening browser
  ctxo install [<lang>...]  Install language plugins (detects if omitted)
  ctxo install python -y    Batch install, no prompt
  ctxo install ts --global  Install globally
  ctxo install py --dry-run Show command without running
  ctxo --version                 Print core version
  ctxo --version --verbose       Print core + plugins + runtime
  ctxo --version --json          Machine-readable version payload
  ctxo version                   Subcommand — verbose by default
  ctxo --help               Show this help message
`.trim());
  }
}
