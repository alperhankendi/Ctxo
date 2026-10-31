import { resolveHttpPort } from './cli/http-port.js';
import { FAST_ROUTE_COMMANDS, runFastRoute } from './cli/module-commands.js';
import { createLogger } from './core/logger.js';

/**
 * The `ctxo` entry: a thin argv router (ADR-018). No static import of the MCP SDK, the tool handlers or
 * the CLI router, so each route loads only what it runs:
 * - no arguments, `--http` or `CTXO_HTTP_PORT`: the MCP server (`mcp-server.ts`);
 * - a fast-route command (`domain-guard-hook`, `domain-cursor-hook`): the module command, without the router or the MCP stack;
 * - anything else: the CLI router.
 */

const log = createLogger('ctxo:mcp');

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // HTTP mode — check before CLI routing since --http is a server flag, not a CLI command
  // CTXO_HTTP_PORT only counts when there are no CLI arguments (see resolveHttpPort).
  const httpPortStr = resolveHttpPort(args, process.env);

  if (!httpPortStr && args.length > 0) {
    if (FAST_ROUTE_COMMANDS.has(args[0]!)) {
      process.exitCode = await runFastRoute(args, process.cwd());
      return;
    }

    // CLI mode
    const { CliRouter } = await import('./cli/cli-router.js');
    const router = new CliRouter(process.cwd());
    await router.route(args);
    return;
  }

  const { startMcpServer } = await import('./mcp-server.js');
  await startMcpServer(httpPortStr ? { httpPort: parseInt(httpPortStr, 10) } : {});
}

main().catch((err: unknown) => {
  log.error('Fatal: %s', (err as Error).message);
  process.exit(1);
});
