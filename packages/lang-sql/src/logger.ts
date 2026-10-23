/**
 * Minimal namespaced logger. Mirrors the shape of cli's `createLogger` so the
 * plugin needs no runtime dependency on `@ctxo/cli`. Emits to stderr only
 * (the stdio transport requires stdout to stay clean).
 */
type LogFn = (message: string, ...args: unknown[]) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

function enabledFor(namespace: string): boolean {
  const env = process.env['DEBUG'];
  if (!env) return false;
  const patterns = env.split(',').map((p) => p.trim()).filter(Boolean);
  for (const pattern of patterns) {
    if (pattern === '*' || pattern === namespace) return true;
    if (pattern.endsWith('*') && namespace.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}

function emit(namespace: string, level: string, message: string, args: unknown[]): void {
  const line = `[${namespace}] ${message}${args.length ? ' ' + args.map(String).join(' ') : ''}`;
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else if (enabledFor(namespace)) process.stderr.write(line + '\n');
}

export function createLogger(namespace: string): Logger {
  return {
    debug: (msg, ...args) => emit(namespace, 'debug', msg, args),
    info: (msg, ...args) => emit(namespace, 'info', msg, args),
    warn: (msg, ...args) => emit(namespace, 'warn', msg, args),
    error: (msg, ...args) => emit(namespace, 'error', msg, args),
  };
}
