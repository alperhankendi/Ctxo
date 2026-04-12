import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';

export interface DiskThresholds {
  readonly warnMb: number;
  readonly failMb: number;
}

const DEFAULT_THRESHOLDS: DiskThresholds = { warnMb: 100, failMb: 500 };

export class DiskUsageCheck implements IHealthCheck {
  readonly id = 'disk_usage';
  readonly title = 'Disk usage';
  private readonly thresholds: DiskThresholds;

  constructor(thresholds: DiskThresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  async run(ctx: CheckContext): Promise<CheckResult> {
    if (!existsSync(ctx.ctxoRoot)) {
      return { id: this.id, title: this.title, status: 'pass', message: 'no .ctxo/ directory', value: '0' };
    }

    const bytes = this.getDirSize(ctx.ctxoRoot);
    const mb = bytes / (1024 * 1024);
    const formatted = mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;

    if (mb < this.thresholds.warnMb) {
      return { id: this.id, title: this.title, status: 'pass', message: formatted, value: formatted };
    }
    if (mb < this.thresholds.failMb) {
      return { id: this.id, title: this.title, status: 'warn', message: `${formatted} — consider pruning orphaned index files`, value: formatted };
    }
    return { id: this.id, title: this.title, status: 'fail', message: `${formatted} — unusually large`, fix: 'Check for stale data in .ctxo/', value: formatted };
  }

  private getDirSize(dirPath: string): number {
    let total = 0;
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          try {
            // parentPath available in Node 20.12+, path in earlier Node 20.x
            const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath
              ?? (entry as unknown as { path?: string }).path
              ?? dirPath;
            total += statSync(join(parent, entry.name)).size;
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // skip unreadable directories
    }
    return total;
  }
}
