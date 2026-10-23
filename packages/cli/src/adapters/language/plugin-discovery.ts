import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CtxoLanguagePlugin } from '@ctxo/plugin-api';
import { SUPPORTED_API_VERSIONS } from '@ctxo/plugin-api';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:plugin-discovery');

const OFFICIAL_PREFIX = '@ctxo/lang-';
const COMMUNITY_PREFIX = 'ctxo-lang-';

export interface DiscoverOptions {
  /** Absolute path to the package.json used for dependency scanning. */
  readonly manifestPath: string;
  /**
   * Explicit plugin list. When provided, suppresses auto-discovery and loads
   * only these packages/paths. Strings starting with '.' or '/' are treated
   * as local paths resolved against the manifest directory.
   */
  readonly explicit?: readonly string[];
  /**
   * Predicate that returns true for plugin specifiers that should be skipped
   * entirely (never imported). Used by the CLI to short-circuit loading of
   * plugins whose backing workspace was excluded via
   * `.ctxo/config.yaml#index.ignoreProjects`.
   */
  readonly shouldSkipSpecifier?: (specifier: string) => boolean;
}

export interface DiscoveredPlugin {
  readonly plugin: CtxoLanguagePlugin;
  readonly specifier: string;
}

export interface PluginLoadFailure {
  readonly specifier: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly plugins: readonly DiscoveredPlugin[];
  readonly failures: readonly PluginLoadFailure[];
}

function readManifestDeps(manifestPath: string): string[] {
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const all = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };
    return Object.keys(all).filter(
      (name) => name.startsWith(OFFICIAL_PREFIX) || name.startsWith(COMMUNITY_PREFIX),
    );
  } catch (err) {
    log.warn(`Failed to read manifest ${manifestPath}: ${(err as Error).message}`);
    return [];
  }
}

function isLocalSpecifier(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/') || isAbsolute(spec);
}

type ExportsEntry = string | { [condition: string]: ExportsEntry } | null | undefined;

function pickEsmEntry(exportsField: unknown): string | undefined {
  if (!exportsField) return undefined;
  if (typeof exportsField === 'string') return exportsField;
  if (typeof exportsField !== 'object') return undefined;
  const table = exportsField as Record<string, ExportsEntry>;
  const dot = '.' in table ? table['.'] : (exportsField as ExportsEntry);
  if (typeof dot === 'string') return dot;
  if (!dot || typeof dot !== 'object') return undefined;
  for (const key of ['import', 'node', 'default'] as const) {
    const nested = (dot as Record<string, ExportsEntry>)[key];
    if (typeof nested === 'string') return nested;
    if (nested && typeof nested === 'object') {
      for (const inner of ['default', 'import', 'node'] as const) {
        const v = (nested as Record<string, ExportsEntry>)[inner];
        if (typeof v === 'string') return v;
      }
    }
  }
  return undefined;
}

const cliFallbackRequire = createRequire(import.meta.url);

/**
 * Absolute path of `${specifier}/package.json`, found the way the plugin loader
 * finds a plugin: through `projectRequire` (the consumer project) first, then
 * from the CLI's own location. The CLI fallback matters for a global install
 * run in a repository without a package.json, and for dev/test flows (where the
 * CLI source lives inside the plugin's monorepo) that resolve without a
 * populated node_modules. Throws the project lookup's error when neither finds it.
 *
 * Anchored on `${specifier}/package.json` because `require.resolve(spec)` fails
 * for ESM-only packages whose "exports" map has no "require" condition.
 */
export function resolvePluginPackageJson(specifier: string, projectRequire: NodeJS.Require): string {
  try {
    return projectRequire.resolve(`${specifier}/package.json`);
  } catch (primary) {
    try {
      return cliFallbackRequire.resolve(`${specifier}/package.json`);
    } catch {
      throw primary;
    }
  }
}

function resolvePluginEntryUrl(
  specifier: string,
  manifestRequire: NodeJS.Require,
): string {
  // Resolve bare specifiers against the consumer project's node_modules first,
  // not the CLI bundle location. Matters when `ctxo` runs via npx, where plain
  // import() would look in ~/.npm/_npx/<hash>/node_modules.
  const pkgJsonPath = resolvePluginPackageJson(specifier, manifestRequire);
  const pkgDir = dirname(pkgJsonPath);
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
    main?: string;
    module?: string;
    exports?: unknown;
  };
  const entry = pickEsmEntry(pkgJson.exports) ?? pkgJson.module ?? pkgJson.main ?? 'index.js';
  return pathToFileURL(resolve(pkgDir, entry)).href;
}

async function tryLoad(
  specifier: string,
  baseDir: string,
  manifestRequire: NodeJS.Require,
): Promise<CtxoLanguagePlugin | PluginLoadFailure> {
  try {
    const target = isLocalSpecifier(specifier)
      ? pathToFileURL(resolve(baseDir, specifier)).href
      : resolvePluginEntryUrl(specifier, manifestRequire);

    const mod = (await import(target)) as {
      default?: unknown;
      plugin?: unknown;
    };
    const candidate = (mod.default ?? mod.plugin ?? mod) as Partial<CtxoLanguagePlugin>;

    if (!candidate || typeof candidate !== 'object') {
      return { specifier, reason: 'module export is not an object' };
    }
    if (!(SUPPORTED_API_VERSIONS as readonly unknown[]).includes(candidate.apiVersion)) {
      return {
        specifier,
        reason: `unsupported apiVersion ${String(candidate.apiVersion)} (supported: ${SUPPORTED_API_VERSIONS.join(', ')})`,
      };
    }
    if (typeof candidate.createAdapter !== 'function') {
      return { specifier, reason: 'missing createAdapter()' };
    }
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      return { specifier, reason: 'missing or empty id' };
    }
    if (!Array.isArray(candidate.extensions)) {
      return { specifier, reason: 'extensions must be an array' };
    }
    if (candidate.tier !== 'syntax' && candidate.tier !== 'full') {
      return { specifier, reason: `invalid tier ${String(candidate.tier)}` };
    }

    return candidate as CtxoLanguagePlugin;
  } catch (err) {
    return { specifier, reason: (err as Error).message };
  }
}

export async function discoverPlugins(options: DiscoverOptions): Promise<DiscoveryResult> {
  const { manifestPath } = options;
  if (!existsSync(manifestPath)) {
    log.info(`Manifest not found at ${manifestPath} — no plugins discovered`);
    return { plugins: [], failures: [] };
  }

  const baseDir = dirname(manifestPath);
  const specifiers = options.explicit ?? readManifestDeps(manifestPath);
  const manifestRequire = createRequire(pathToFileURL(manifestPath).href);

  const plugins: DiscoveredPlugin[] = [];
  const failures: PluginLoadFailure[] = [];

  for (const spec of specifiers) {
    if (options.shouldSkipSpecifier?.(spec)) {
      log.info(`Skipping plugin ${spec} (matched ignoreProjects)`);
      continue;
    }
    const result = await tryLoad(spec, baseDir, manifestRequire);
    if ('apiVersion' in result) {
      plugins.push({ plugin: result, specifier: spec });
    } else {
      failures.push(result);
      log.warn(`Skipped plugin ${spec}: ${result.reason}`);
    }
  }

  return { plugins, failures };
}
