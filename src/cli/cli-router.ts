import { IndexCommand } from './index-command.js';
import { SyncCommand } from './sync-command.js';
import { StatusCommand } from './status-command.js';
import { VerifyCommand } from './verify-command.js';
import { InitCommand } from './init-command.js';
import { WatchCommand } from './watch-command.js';

export class CliRouter {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async route(args: string[]): Promise<void> {
    const command = args[0];

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
        }
        const checkArg = args.includes('--check');
        const skipHistory = args.includes('--skip-history');
        await new IndexCommand(this.projectRoot).run({ file: fileArg, check: checkArg, skipHistory });
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

      case 'init':
        new InitCommand(this.projectRoot).run();
        break;

      default:
        console.error(`[ctxo] Unknown command: "${command}". Run "ctxo --help" for usage.`);
        process.exit(1);
    }
  }

  private printHelp(): void {
    console.error(`
ctxo — MCP server for dependency-aware codebase context

Usage:
  ctxo                      Start MCP server (stdio transport)
  ctxo index                Build full codebase index
  ctxo sync                 Rebuild SQLite cache from committed JSON index
  ctxo watch                Start file watcher for incremental re-indexing
  ctxo verify-index         CI gate: fail if index is stale
  ctxo status               Show index manifest
  ctxo init                 Install git hooks
  ctxo --help               Show this help message
`.trim());
  }
}
