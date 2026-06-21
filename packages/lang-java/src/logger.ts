type LogFn = (message: string, ...args: unknown[]) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

/**
 * Minimal namespaced logger. Writes to stderr only (stdout is reserved for
 * MCP JSON-RPC). Enabled when DEBUG matches the namespace (e.g. DEBUG=ctxo:*).
 */
export function createLogger(namespace: string): Logger {
  const enabled = (): boolean => {
    const debug = process.env.DEBUG ?? '';
    if (!debug) return false;
    return debug.split(',').some((p) => {
      const pat = p.trim();
      if (pat === '*' || pat === namespace) return true;
      if (pat.endsWith('*')) return namespace.startsWith(pat.slice(0, -1));
      return false;
    });
  };
  const write = (level: string): LogFn => (message, ...args) => {
    if (!enabled()) return;
    process.stderr.write(`${namespace} ${level} ${message}\n`);
    if (args.length) process.stderr.write(`${args.map(String).join(' ')}\n`);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
