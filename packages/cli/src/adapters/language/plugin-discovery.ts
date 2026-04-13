import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CtxoLanguagePlugin } from '@ctxo/plugin-api';
import { SUPPORTED_API_VERSION } from '@ctxo/plugin-api';
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

async function tryLoad(
  specifier: string,
  baseDir: string,
): Promise<CtxoLanguagePlugin | PluginLoadFailure> {
  try {
    const target = isLocalSpecifier(specifier)
      ? pathToFileURL(resolve(baseDir, specifier)).href
      : specifier;

    const mod = (await import(target)) as {
      default?: unknown;
      plugin?: unknown;
    };
    const candidate = (mod.default ?? mod.plugin ?? mod) as Partial<CtxoLanguagePlugin>;

    if (!candidate || typeof candidate !== 'object') {
      return { specifier, reason: 'module export is not an object' };
    }
    if (candidate.apiVersion !== SUPPORTED_API_VERSION) {
      return {
        specifier,
        reason: `unsupported apiVersion ${String(candidate.apiVersion)} (want '${SUPPORTED_API_VERSION}')`,
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

  const plugins: DiscoveredPlugin[] = [];
  const failures: PluginLoadFailure[] = [];

  for (const spec of specifiers) {
    if (options.shouldSkipSpecifier?.(spec)) {
      log.info(`Skipping plugin ${spec} (matched ignoreProjects)`);
      continue;
    }
    const result = await tryLoad(spec, baseDir);
    if ('apiVersion' in result) {
      plugins.push({ plugin: result, specifier: spec });
    } else {
      failures.push(result);
      log.warn(`Skipped plugin ${spec}: ${result.reason}`);
    }
  }

  return { plugins, failures };
}
