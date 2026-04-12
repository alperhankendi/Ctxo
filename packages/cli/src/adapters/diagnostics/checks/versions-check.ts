import type { IHealthCheck, CheckContext, CheckResult } from '../../../core/diagnostics/types.js';
import {
  gatherVersionInfo,
  formatVerbose,
  type VersionInfo,
} from '../../../cli/version-command.js';
import { discoverPlugins } from '../../language/plugin-discovery.js';
import { loadManifestPath } from '../../../cli/plugin-loader.js';

/**
 * Surfaces ctxo + plugin + runtime versions in `ctxo doctor` output. Warns when
 * a plugin declares an apiVersion the core does not support. Purely informational
 * in the pass-case; the doctor report summary already treats warn as non-zero.
 */
export class VersionsCheck implements IHealthCheck {
  readonly id = 'versions';
  readonly title = 'Versions';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const info = await collectInfo(ctx);

    const incompatible = info.plugins.filter((p) => !p.compatible);
    const message = buildSummary(info);

    if (incompatible.length > 0) {
      return {
        id: this.id,
        title: this.title,
        status: 'warn',
        message,
        fix: `Upgrade or replace plugins with apiVersion != ${info.pluginApiVersion}: ${incompatible.map((p) => p.name).join(', ')}`,
        value: formatVerbose(info),
      };
    }

    return {
      id: this.id,
      title: this.title,
      status: 'pass',
      message,
      value: formatVerbose(info),
    };
  }
}

async function collectInfo(ctx: CheckContext): Promise<VersionInfo> {
  const manifestPath = loadManifestPath(ctx.projectRoot);
  if (!manifestPath) return gatherVersionInfo([]);
  const { plugins } = await discoverPlugins({ manifestPath });
  return gatherVersionInfo(plugins);
}

function buildSummary(info: VersionInfo): string {
  const pluginCount = info.plugins.length;
  const pluginLabel = pluginCount === 0 ? 'no plugins' : `${pluginCount} plugin${pluginCount === 1 ? '' : 's'}`;
  return `ctxo ${info.ctxo} (API ${info.pluginApiVersion}) — ${pluginLabel}, Node ${info.runtime.node}`;
}
