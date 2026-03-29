import { IndexCommand } from './index-command.js';

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
      case 'index':
        await new IndexCommand(this.projectRoot).run();
        break;

      case 'sync':
      case 'watch':
      case 'verify-index':
      case 'status':
      case 'init':
        console.error(`[ctxo] Command "${command}" is not yet implemented`);
        process.exit(1);
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
