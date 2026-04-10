import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { SessionRecorderAdapter } from '../adapters/stats/session-recorder-adapter.js';
import type { AggregatedStats } from '../ports/i-session-recorder-port.js';
import type { StatsReport } from '../core/stats/stats-types.js';

export class StatsCommand {
  private readonly projectRoot: string;
  private readonly ctxoRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  async run(options: { days?: number; json?: boolean; clear?: boolean }): Promise<void> {
    // Check if stats are enabled
    if (!this.isStatsEnabled()) {
      console.error('[ctxo] Stats collection is disabled in .ctxo/config.yaml');
      return;
    }

    const dbPath = join(this.ctxoRoot, '.cache', 'symbols.db');
    if (!existsSync(dbPath)) {
      if (options.json) {
        process.stdout.write(JSON.stringify(this.emptyReport(options.days)) + '\n');
      } else {
        console.error('[ctxo] No usage data yet. Start using Ctxo MCP tools to collect stats.');
      }
      return;
    }

    // Open DB
    const SQL = await initSqlJs();
    const buffer = readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    const recorder = new SessionRecorderAdapter(db);

    try {
      if (options.clear) {
        recorder.clear();
        // Persist cleared DB
        const data = db.export();
        const { writeFileSync } = await import('node:fs');
        writeFileSync(dbPath, Buffer.from(data));
        console.error('[ctxo] Session data cleared.');
        return;
      }

      // Validate --days
      if (options.days != null) {
        if (!Number.isInteger(options.days) || options.days <= 0) {
          console.error('[ctxo] --days must be a positive integer');
          process.exit(1);
          return;
        }
      }

      const stats = recorder.queryStats(options.days);

      if (stats.totalCalls === 0) {
        if (options.json) {
          process.stdout.write(JSON.stringify(this.emptyReport(options.days)) + '\n');
        } else {
          console.error('[ctxo] No usage data yet. Start using Ctxo MCP tools to collect stats.');
        }
        return;
      }

      if (options.json) {
        process.stdout.write(JSON.stringify(this.buildReport(stats, options.days), null, 2) + '\n');
      } else {
        this.printHumanReadable(stats, options.days);
      }
    } finally {
      db.close();
    }
  }

  private isStatsEnabled(): boolean {
    const configPath = join(this.ctxoRoot, 'config.yaml');
    if (!existsSync(configPath)) return true;

    try {
      const raw = readFileSync(configPath, 'utf-8');
      const match = raw.match(/stats:\s*\n\s*enabled:\s*(true|false)/);
      if (match) return match[1] !== 'false';
      return true;
    } catch {
      return true;
    }
  }

  private buildReport(stats: AggregatedStats, days?: number): StatsReport {
    const now = new Date().toISOString();
    const from = days != null
      ? new Date(Date.now() - days * 86400000).toISOString()
      : null;

    return {
      timeRange: { from, to: now, daysFilter: days ?? null },
      summary: {
        totalCalls: stats.totalCalls,
        totalTokensServed: stats.totalTokensServed,
      },
      topTools: stats.topTools,
      topSymbols: stats.topSymbols,
      detailLevelDistribution: stats.detailLevelDistribution.map((d) => ({
        level: d.level,
        count: d.count,
        percentage: d.percentage,
      })),
    };
  }

  private emptyReport(days?: number): StatsReport {
    return this.buildReport({
      totalCalls: 0,
      totalTokensServed: 0,
      topTools: [],
      topSymbols: [],
      detailLevelDistribution: [],
    }, days);
  }

  private printHumanReadable(stats: AggregatedStats, days?: number): void {
    const header = days != null ? `last ${days} days` : 'all time';

    console.error('');
    console.error(`  Usage Summary (${header})`);
    console.error('  ────────────────────────────────────────');
    console.error(`  Total tool calls:      ${this.formatNumber(stats.totalCalls)}`);
    console.error(`  Total tokens served:   ${this.formatTokens(stats.totalTokensServed)}`);

    if (stats.topTools.length > 0) {
      console.error('');
      console.error('  Top Tools');
      console.error('  ────────────────────────────────────────');
      for (const t of stats.topTools) {
        const name = t.tool.padEnd(24);
        const calls = `${this.formatNumber(t.calls)} calls`.padEnd(14);
        console.error(`  ${name}${calls}avg ${this.formatNumber(t.avgTokens)} tokens`);
      }
    }

    if (stats.topSymbols.length > 0) {
      console.error('');
      console.error('  Top Queried Symbols');
      console.error('  ────────────────────────────────────────');
      for (const s of stats.topSymbols) {
        const name = s.name.padEnd(32);
        console.error(`  ${name}${this.formatNumber(s.queries)} queries`);
      }
    }

    if (stats.detailLevelDistribution.length > 0) {
      console.error('');
      console.error('  Detail Level Distribution');
      console.error('  ────────────────────────────────────────');
      for (const d of stats.detailLevelDistribution) {
        const bar = this.renderBar(d.percentage);
        const pct = `${d.percentage}%`.padStart(4);
        console.error(`  ${d.level}: ${bar}  ${pct}`);
      }
    }

    console.error('');
  }

  private renderBar(percentage: number): string {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  private formatNumber(n: number): string {
    return n.toLocaleString('en-US');
  }

  private formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
}
