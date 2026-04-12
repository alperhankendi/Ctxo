import type { ILanguageAdapter } from './adapter.js';
import type { IWorkspace } from './workspace.js';

/**
 * Minimal logger shape passed to plugins. Matches the `debug`-style namespaced
 * logger used internally by ctxo, but narrowed to methods plugins may safely
 * call. Core provides a logger bound to the plugin's id.
 */
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Runtime context handed to `createAdapter`. All paths are absolute.
 */
export interface PluginContext {
  readonly logger: PluginLogger;
  readonly projectRoot: string;
  readonly workspace: IWorkspace;
  /** Per-plugin configuration block from `.ctxo/config.yaml#languages.config.<id>`. */
  readonly config: Record<string, unknown>;
}

/**
 * The top-level plugin contract. A plugin package's default export (or a named
 * `plugin` export) MUST satisfy this shape. Core loads plugins via duck-typing
 * against this interface.
 */
export interface CtxoLanguagePlugin {
  /** Protocol version. v0.7 introduces '1'. Future breaking changes bump to '2'. */
  readonly apiVersion: '1';

  /** Short identifier. Used for CLI (`ctxo install python` → id: 'python'). */
  readonly id: string;

  /** Human-readable name for diagnostics. */
  readonly name: string;

  /** Plugin package version, typically mirrored from package.json. */
  readonly version: string;

  /** File extensions this plugin handles. Must be lowercase, dot-prefixed. */
  readonly extensions: readonly string[];

  /** Analysis tier. Determines whether ctxo calls full-tier APIs. */
  readonly tier: 'syntax' | 'full';

  /** Factory. Called once per indexing session. Adapter instance is reused. */
  createAdapter(ctx: PluginContext): ILanguageAdapter;
}
