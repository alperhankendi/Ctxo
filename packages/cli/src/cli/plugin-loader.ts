import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter, IWorkspace } from '@ctxo/plugin-api';
import { discoverPlugins, type DiscoveredPlugin } from '../adapters/language/plugin-discovery.js';
import { detectWorkspace } from '../adapters/workspace/single-package-workspace.js';
import { createLogger } from '../core/logger.js';
import { makeGlobMatcher } from '../core/config/load-config.js';

const log = createLogger('ctxo:plugin-loader');

export interface LoadedPlugin {
  readonly plugin: CtxoLanguagePlugin;
  readonly adapter: ILanguageAdapter;
  readonly specifier: string;
}

function manifestHasPlugins(path: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const all = { ...raw.dependencies, ...raw.devDependencies, ...raw.peerDependencies };
    return Object.keys(all).some((n) => n.startsWith('@ctxo/lang-') || n.startsWith('ctxo-lang-'));
  } catch {
    return false;
  }
}

/**
 * Resolve the package.json that should be scanned for plugin deps.
 * Preference order:
 *   1. projectRoot/package.json (user's project)
 *   2. cli install location (walk up from __dirname until package.json)
 */
export function loadManifestPath(projectRoot: string): string | null {
  return resolveManifestPath(projectRoot);
}

function resolveManifestPath(projectRoot: string): string | null {
  const projectManifest = join(projectRoot, 'package.json');
  if (existsSync(projectManifest) && manifestHasPlugins(projectManifest)) {
    return projectManifest;
  }

  let dir = import.meta.dirname;
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate) && manifestHasPlugins(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Last resort: return projectManifest even if empty so discovery reports absence.
  return existsSync(projectManifest) ? projectManifest : null;
}

function buildContext(projectRoot: string, workspace: IWorkspace, pluginId: string): PluginContext {
  const pluginLog = createLogger(`ctxo:plugin:${pluginId}`);
  return {
    logger: {
      debug: (msg, ...args) => pluginLog.info(String(msg), ...args),
      info: (msg, ...args) => pluginLog.info(String(msg), ...args),
      warn: (msg, ...args) => pluginLog.warn(String(msg), ...args),
      error: (msg, ...args) => pluginLog.error(String(msg), ...args),
    },
    projectRoot,
    workspace,
    config: {},
  };
}

export interface LoadPluginsOptions {
  /**
   * Glob patterns (matched against workspace paths relative to projectRoot)
   * for workspaces whose plugin deps should be ignored during discovery.
   * Sourced from `.ctxo/config.yaml#index.ignoreProjects`.
   */
  readonly ignoreProjects?: readonly string[];
}

export async function loadPlugins(
  projectRoot: string,
  options: LoadPluginsOptions = {},
): Promise<LoadedPlugin[]> {
  const manifestPath = resolveManifestPath(projectRoot);
  if (!manifestPath) {
    log.info('No package.json found for plugin discovery');
    return [];
  }

  const workspace = detectWorkspace(projectRoot);
  const ignoreProjectPatterns = options.ignoreProjects ?? [];
  const shouldSkipSpecifier = ignoreProjectPatterns.length === 0
    ? undefined
    : makeGlobMatcher(ignoreProjectPatterns.slice());
  const result = await discoverPlugins({ manifestPath, shouldSkipSpecifier });

  const loaded: LoadedPlugin[] = [];
  for (const { plugin, specifier } of result.plugins as readonly DiscoveredPlugin[]) {
    try {
      const ctx = buildContext(projectRoot, workspace, plugin.id);
      const adapter = plugin.createAdapter(ctx);
      loaded.push({ plugin, adapter, specifier });
    } catch (err) {
      log.warn(`Plugin ${plugin.id} createAdapter failed: ${(err as Error).message}`);
    }
  }
  return loaded;
}
