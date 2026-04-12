import { SUPPORTED_API_VERSION } from '@ctxo/plugin-api';
import type { CtxoLanguagePlugin } from '@ctxo/plugin-api';
import { getVersion } from './cli-router.js';
import { discoverPlugins, type DiscoveredPlugin } from '../adapters/language/plugin-discovery.js';
import { loadManifestPath } from './plugin-loader.js';

export interface PluginVersionInfo {
  /** npm package name, e.g. "@ctxo/lang-typescript" or community "ctxo-lang-kotlin" */
  name: string;
  /** Plugin id from the runtime declaration, e.g. "typescript" */
  id: string;
  /** Runtime-declared plugin version */
  version: string;
  /** Plugin protocol version declared by the plugin */
  apiVersion: string;
  /** True when apiVersion matches the core's SUPPORTED_API_VERSION */
  compatible: boolean;
}

export interface RuntimeInfo {
  node: string;
  platform: NodeJS.Platform;
  arch: string;
}

export interface VersionInfo {
  ctxo: string;
  pluginApiVersion: string;
  plugins: PluginVersionInfo[];
  runtime: RuntimeInfo;
}

/**
 * Produce VersionInfo from already-discovered plugins. Pure function; safe to
 * call without I/O once plugins are in hand. Used by both CLI printers and tests.
 */
export function gatherVersionInfo(discovered: readonly DiscoveredPlugin[]): VersionInfo {
  const plugins: PluginVersionInfo[] = discovered.map(({ plugin, specifier }) => ({
    name: specifier,
    id: plugin.id,
    version: plugin.version,
    apiVersion: plugin.apiVersion,
    compatible: plugin.apiVersion === SUPPORTED_API_VERSION,
  }));

  return {
    ctxo: getVersion(),
    pluginApiVersion: SUPPORTED_API_VERSION,
    plugins,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

export function formatShort(info: VersionInfo): string {
  return `ctxo ${info.ctxo}`;
}

export function formatVerbose(info: VersionInfo): string {
  const lines: string[] = [];
  lines.push(`ctxo ${info.ctxo}`);
  lines.push(`Plugin API: ${info.pluginApiVersion}`);
  lines.push(`Runtime:    Node ${info.runtime.node} on ${info.runtime.platform}/${info.runtime.arch}`);
  lines.push('');
  if (info.plugins.length === 0) {
    lines.push('Plugins:    (none installed)');
    lines.push('');
    lines.push('Install a language plugin, e.g. "npm i -D @ctxo/lang-typescript"');
    return lines.join('\n');
  }

  const nameCol = Math.max(7, ...info.plugins.map((p) => p.name.length));
  const verCol = Math.max(7, ...info.plugins.map((p) => p.version.length));
  const apiCol = Math.max(3, ...info.plugins.map((p) => p.apiVersion.length));

  lines.push(`Plugins:    ${info.plugins.length} installed`);
  lines.push(
    `  ${'NAME'.padEnd(nameCol)}  ${'VERSION'.padEnd(verCol)}  ${'API'.padEnd(apiCol)}  STATUS`,
  );
  for (const p of info.plugins) {
    const status = p.compatible ? 'OK' : `incompatible (core wants ${info.pluginApiVersion})`;
    lines.push(
      `  ${p.name.padEnd(nameCol)}  ${p.version.padEnd(verCol)}  ${p.apiVersion.padEnd(apiCol)}  ${status}`,
    );
  }

  return lines.join('\n');
}

export function formatJson(info: VersionInfo): string {
  return JSON.stringify(info, null, 2);
}

export interface VersionOptions {
  verbose?: boolean;
  json?: boolean;
}

/**
 * CLI entry. Keeps I/O scoped to plugin-discovery metadata reads; no adapter
 * instantiation, no network. Verbose and JSON modes target sub-200ms even with
 * several plugins installed because discovery only reads package.json plus a
 * single dynamic import() per plugin module (no createAdapter call).
 */
export class VersionCommand {
  constructor(private readonly projectRoot: string) {}

  async run(options: VersionOptions = {}): Promise<void> {
    const info = await this.collect();
    if (options.json) {
      process.stdout.write(formatJson(info) + '\n');
      return;
    }
    if (options.verbose) {
      process.stdout.write(formatVerbose(info) + '\n');
      return;
    }
    process.stdout.write(formatShort(info) + '\n');
  }

  private async collect(): Promise<VersionInfo> {
    const manifestPath = loadManifestPath(this.projectRoot);
    if (!manifestPath) {
      return gatherVersionInfo([]);
    }
    const { plugins } = await discoverPlugins({ manifestPath });
    return gatherVersionInfo(plugins);
  }
}

/**
 * Treat a CtxoLanguagePlugin-shaped object directly (escape hatch for callers
 * that have plugins in memory, e.g. indexCommand after wiring the registry).
 */
export function gatherFromLivePlugins(
  live: ReadonlyArray<{ plugin: CtxoLanguagePlugin; specifier: string }>,
): VersionInfo {
  return gatherVersionInfo(live);
}
