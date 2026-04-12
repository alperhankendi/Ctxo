import { createRequire } from 'node:module';
import type { IHealthCheck, CheckContext, CheckResult } from '../../../core/diagnostics/types.js';
import {
  decideNeededLanguages,
  detectLanguages,
  officialPluginFor,
  type KnownLanguage,
} from '../../../core/detection/detect-languages.js';

const require = createRequire(import.meta.url);

/**
 * Reports which detected languages lack an installed plugin. Warns (never fails)
 * so mixed-language projects can still run ctxo for the subset with plugins.
 */
export class LanguageCoverageCheck implements IHealthCheck {
  readonly id = 'language_coverage';
  readonly title = 'Language coverage';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const detection = detectLanguages(ctx.projectRoot);
    const needed = decideNeededLanguages(detection);

    if (needed.length === 0) {
      return {
        id: this.id,
        title: this.title,
        status: 'pass',
        message: 'no source languages detected',
      };
    }

    const missing: KnownLanguage[] = [];
    for (const lang of needed) {
      if (!pluginResolves(officialPluginFor(lang))) {
        missing.push(lang);
      }
    }

    if (missing.length === 0) {
      const summary = needed.map((l) => `${l}`).join(', ');
      return {
        id: this.id,
        title: this.title,
        status: 'pass',
        message: `plugins installed for: ${summary}`,
      };
    }

    const packages = missing.map(officialPluginFor).join(' ');
    const shortList = missing.join(', ');
    return {
      id: this.id,
      title: this.title,
      status: 'warn',
      message: `missing plugins for: ${shortList}`,
      fix: `Run "ctxo install ${missing.join(' ')}" or "npm install -D ${packages}"`,
    };
  }
}

function pluginResolves(packageName: string): boolean {
  try {
    // Resolve package.json instead of the entry point so we don't trip over
    // ESM `exports` fields that refuse CJS require (our own plugins do this).
    require.resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return false;
  }
}
