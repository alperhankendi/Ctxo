const DEFAULT_HTTP_PORT = '3001';

/**
 * The HTTP port the MCP server should listen on, or null for stdio / CLI mode.
 *
 * `CTXO_HTTP_PORT` is honoured only when `ctxo` runs without arguments. With arguments the CLI router
 * runs: an exported variable must not turn `ctxo index --commit HEAD` (the git post-commit hook, which
 * would then never return) or `ctxo <command> --help` into a server. `--http [--port <n>]` selects
 * HTTP mode explicitly; `CTXO_HTTP_PORT` still wins over `--port` when both are given.
 */
export function resolveHttpPort(args: readonly string[], env: NodeJS.ProcessEnv): string | null {
  const fromEnv = env['CTXO_HTTP_PORT'] || null;
  if (args.length === 0) return fromEnv;
  if (!args.includes('--http')) return null;

  const portFlag = args.indexOf('--port');
  return fromEnv || (portFlag === -1 ? undefined : args[portFlag + 1]) || DEFAULT_HTTP_PORT;
}
