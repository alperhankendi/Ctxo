import type { ILanguageAdapter } from './adapter.js';
import type { IWorkspace } from './workspace.js';
import type { ApiVersion } from './version.js';

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
 * Host capabilities computed by core before any `createAdapter` call
 * (protocol v2). Absent fields mean false.
 */
export interface PluginCapabilities {
  /** True when facts were requested (`index.facts: true`); `extractFacts` is then called. */
  readonly facts?: boolean;
  /** True when a loaded plugin handles `.sql` files, so host-language plugins may emit SQL call-site edges (reads/writes/executes). */
  readonly sqlCallSites?: boolean;
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
  /** Protocol v2 host capabilities. Absent on v1 cores. */
  readonly capabilities?: PluginCapabilities;
}

/**
 * The top-level plugin contract. A plugin package's default export (or a named
 * `plugin` export) MUST satisfy this shape. Core loads plugins via duck-typing
 * against this interface.
 */
export interface CtxoLanguagePlugin {
  /**
   * Protocol version: the lowest version this plugin works on. Versions gate
   * loading only; core handles output identically for '1' and '2'.
   */
  readonly apiVersion: ApiVersion;

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
