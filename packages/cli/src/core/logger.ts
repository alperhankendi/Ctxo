/**
 * Structured logger for Ctxo — all output goes to stderr (stdout reserved for MCP JSON-RPC).
 *
 * Supports debug mode via DEBUG environment variable:
 *   DEBUG=ctxo:*          — all debug output
 *   DEBUG=ctxo:git        — only git adapter debug
 *   DEBUG=ctxo:index      — only indexing debug
 *   DEBUG=ctxo:mcp        — only MCP handler debug
 *   DEBUG=ctxo:storage    — only storage adapter debug
 *   DEBUG=ctxo:masking    — only masking pipeline debug
 *
 * Always outputs: info, warn, error (regardless of DEBUG).
 * Only outputs debug when matching namespace is enabled.
 */

function isDebugEnabled(namespace: string): boolean {
  const debugEnv = process.env['DEBUG'] ?? '';
  if (!debugEnv) return false;
  const patterns = debugEnv.split(',').map(p => p.trim());
  return patterns.some(p => {
    if (p === '*' || p === 'ctxo:*') return true;
    if (p === namespace) return true;
    if (p.endsWith(':*') && namespace.startsWith(p.slice(0, -1))) return true;
    return false;
  });
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;

  return {
    debug(message: string, ...args: unknown[]) {
      if (isDebugEnabled(namespace)) {
        console.error(`${prefix} DEBUG ${message}`, ...args);
      }
    },
    info(message: string, ...args: unknown[]) {
      console.error(`${prefix} ${message}`, ...args);
    },
    warn(message: string, ...args: unknown[]) {
      console.error(`${prefix} WARN ${message}`, ...args);
    },
    error(message: string, ...args: unknown[]) {
      console.error(`${prefix} ERROR ${message}`, ...args);
    },
  };
}
