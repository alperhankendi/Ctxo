import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';

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
      return { id: this.id, title: this.title, status: 'pass', message: '.ctxo/config.yaml valid' };
    } catch (err) {
      return { id: this.id, title: this.title, status: 'fail', message: `Cannot read config.yaml: ${(err as Error).message}`, fix: 'Check file permissions for .ctxo/config.yaml' };
    }
  }
}
