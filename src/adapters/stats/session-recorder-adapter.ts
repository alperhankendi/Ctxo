import type { Database } from 'sql.js';
import type {
  ISessionRecorderPort,
  SessionEvent,
  AggregatedStats,
  ToolStats,
  SymbolStats,
  DetailLevelStats,
} from '../../ports/i-session-recorder-port.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:stats');

export class SessionRecorderAdapter implements ISessionRecorderPort {
  private readonly db: Database;
  private readonly onWrite: (() => void) | null;
  private tableCreated = false;

  constructor(db: Database, onWrite?: () => void) {
    this.db = db;
    this.onWrite = onWrite ?? null;
  }

  private ensureTable(): void {
    if (this.tableCreated) return;
    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now')),
        tool TEXT NOT NULL,
        symbol_id TEXT,
        detail_level TEXT,
        response_tokens INTEGER,
        response_bytes INTEGER,
        latency_ms REAL,
        truncated BOOLEAN DEFAULT 0
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_session_timestamp ON session_events(timestamp)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_session_tool ON session_events(tool)');
    this.tableCreated = true;
  }

  record(event: SessionEvent): void {
    try {
      this.ensureTable();
      this.db.run(
        `INSERT INTO session_events (tool, symbol_id, detail_level, response_tokens, response_bytes, latency_ms, truncated)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          event.tool,
          event.symbolId,
          event.detailLevel,
          event.responseTokens,
          event.responseBytes,
          event.latencyMs,
          event.truncated ? 1 : 0,
        ],
      );
      this.flushToDisk();
    } catch (err) {
      log.error(`Failed to record session event: ${(err as Error).message}`);
    }
  }

  queryStats(days?: number): AggregatedStats {
    this.ensureTable();

    const whereClause = days != null && days > 0
      ? `WHERE timestamp >= datetime('now', '-${Math.floor(days)} days')`
      : '';

    // Total calls and tokens
    const summaryResult = this.db.exec(
      `SELECT COUNT(*) as total_calls, COALESCE(SUM(response_tokens), 0) as total_tokens
       FROM session_events ${whereClause}`,
    );
    const summaryRow = summaryResult[0]?.values[0];
    const totalCalls = Number(summaryRow?.[0] ?? 0);
    const totalTokensServed = Number(summaryRow?.[1] ?? 0);

    // Top tools
    const toolsResult = this.db.exec(
      `SELECT tool, COUNT(*) as calls, CAST(AVG(response_tokens) AS INTEGER) as avg_tokens
       FROM session_events ${whereClause}
       GROUP BY tool ORDER BY calls DESC LIMIT 5`,
    );
    const topTools: ToolStats[] = (toolsResult[0]?.values ?? []).map((row) => ({
      tool: String(row[0]),
      calls: Number(row[1]),
      avgTokens: Number(row[2]),
    }));

    // Top symbols (exclude nulls)
    const symbolWherePrefix = whereClause ? whereClause + ' AND' : 'WHERE';
    const symbolsResult = this.db.exec(
      `SELECT symbol_id, COUNT(*) as queries
       FROM session_events ${symbolWherePrefix} symbol_id IS NOT NULL
       GROUP BY symbol_id ORDER BY queries DESC LIMIT 5`,
    );
    const topSymbols: SymbolStats[] = (symbolsResult[0]?.values ?? []).map((row) => {
      const symbolId = String(row[0]);
      const parts = symbolId.split('::');
      const name = parts.length >= 2 ? parts[1]! : symbolId;
      return {
        symbolId,
        name,
        queries: Number(row[1]),
      };
    });

    // Detail level distribution
    const levelResult = this.db.exec(
      `SELECT detail_level, COUNT(*) as count
       FROM session_events ${symbolWherePrefix} detail_level IS NOT NULL
       GROUP BY detail_level ORDER BY detail_level`,
    );
    const levelRows = levelResult[0]?.values ?? [];
    const levelTotal = levelRows.reduce((sum, row) => sum + Number(row[1]), 0);
    const detailLevelDistribution: DetailLevelStats[] = levelRows.map((row) => ({
      level: String(row[0]),
      count: Number(row[1]),
      percentage: levelTotal > 0 ? Math.round((Number(row[1]) / levelTotal) * 100) : 0,
    }));

    return {
      totalCalls,
      totalTokensServed,
      topTools,
      topSymbols,
      detailLevelDistribution,
    };
  }

  clear(): void {
    this.ensureTable();
    this.db.run('DELETE FROM session_events');
    this.flushToDisk();
  }

  private flushToDisk(): void {
    try {
      this.onWrite?.();
    } catch (err) {
      log.error(`Failed to flush stats to disk: ${(err as Error).message}`);
    }
  }
}
