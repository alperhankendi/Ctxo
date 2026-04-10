import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IHealthCheck, CheckResult, CheckContext } from '../../../core/diagnostics/types.js';

export class SqliteCacheCheck implements IHealthCheck {
  readonly id = 'sqlite_cache';
  readonly title = 'SQLite cache';

  async run(ctx: CheckContext): Promise<CheckResult> {
    const dbPath = join(ctx.ctxoRoot, '.cache', 'symbols.db');
    if (!existsSync(dbPath)) {
      return { id: this.id, title: this.title, status: 'warn', message: 'SQLite cache missing', fix: 'Run "ctxo sync" to rebuild' };
    }

    try {
      const { default: initSqlJs } = await import('sql.js');
      const SQL = await initSqlJs();
      const buffer = readFileSync(dbPath);
      const db = new SQL.Database(new Uint8Array(buffer));
      const result = db.exec('PRAGMA integrity_check');
      db.close();

      const firstRow = result[0]?.values[0];
      if (firstRow && firstRow[0] === 'ok') {
        return { id: this.id, title: this.title, status: 'pass', message: 'integrity_check passed' };
      }
      return { id: this.id, title: this.title, status: 'fail', message: `SQLite corrupt: ${String(firstRow?.[0])}`, fix: 'Run "ctxo sync" to rebuild' };
    } catch (err) {
      return { id: this.id, title: this.title, status: 'fail', message: `SQLite unreadable: ${(err as Error).message}`, fix: 'Run "ctxo sync" to rebuild' };
    }
  }
}
