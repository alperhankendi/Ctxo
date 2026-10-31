import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';
import { loadConfig, negatedIndexTestPatterns } from '../../../core/config/load-config.js';

export class ConfigFileCheck implements IHealthCheck {
  readonly id = 'config_file';
  readonly title = 'Config file';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const configPath = join(ctx.ctxoRoot, 'config.yaml');
    if (!existsSync(configPath)) {
      return { id: this.id, title: this.title, status: 'warn', message: 'No config.yaml (using defaults)' };
    }

    try {
      const content = readFileSync(configPath, 'utf-8');
      if (content.trim().length === 0) {
        return { id: this.id, title: this.title, status: 'warn', message: 'config.yaml is empty (using defaults)' };
      }
      // Basic YAML structure check — tabs are invalid in YAML
      if (content.includes('\t')) {
        return { id: this.id, title: this.title, status: 'fail', message: 'Invalid config.yaml: tabs are not allowed in YAML', fix: 'Replace tabs with spaces in .ctxo/config.yaml' };
      }

      const loaded = loadConfig(ctx.ctxoRoot);
      if (loaded.errors.length > 0) {
        return {
          id: this.id,
          title: this.title,
          status: 'fail',
          message: `Invalid config.yaml: ${loaded.errors[0]}${loaded.errors.length > 1 ? ` (+${loaded.errors.length - 1} more)` : ''}`,
          fix: 'Fix schema violations in .ctxo/config.yaml (see docs for the full schema)',
        };
      }
      const negated = negatedIndexTestPatterns(loaded.config);
      const negatedMessage = `index.tests does not support negation; skipped ${negated.length} negated glob(s): ${negated.join('; ')}`;
      const negatedFix = 'Remove the negated (!) entries from index.tests; to leave files out of the index, use index.ignore';
      if (loaded.invalidGlobs.length > 0) {
        const invalidMessage = `config.yaml has ${loaded.invalidGlobs.length} invalid glob pattern(s): ${loaded.invalidGlobs.join('; ')}`;
        const invalidFix = 'Fix the listed glob patterns under index.ignore / index.ignoreProjects / index.tests / cochange.include / cochange.exclude / contextsView.exclude / contextsView.hubs.paths';
        return {
          id: this.id,
          title: this.title,
          status: 'warn',
          message: negated.length > 0 ? `${invalidMessage}; ${negatedMessage}` : invalidMessage,
          fix: negated.length > 0 ? `${invalidFix}. ${negatedFix}` : invalidFix,
        };
      }
      if (negated.length > 0) {
        return { id: this.id, title: this.title, status: 'warn', message: negatedMessage, fix: negatedFix };
      }
      return { id: this.id, title: this.title, status: 'pass', message: '.ctxo/config.yaml valid' };
    } catch (err) {
      return { id: this.id, title: this.title, status: 'fail', message: `Cannot read config.yaml: ${(err as Error).message}`, fix: 'Check file permissions for .ctxo/config.yaml' };
    }
  }
}
