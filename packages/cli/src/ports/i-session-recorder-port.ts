/**
 * Port interface for session recording — tracks MCP tool usage statistics.
 *
 * Implementations must ensure that record() never throws and never blocks
 * the MCP tool response. All recording is fire-and-forget.
 */

export interface SessionEvent {
  /** MCP tool name (e.g., 'get_logic_slice', 'get_blast_radius') */
  tool: string;
  /** Symbol ID queried, if applicable (null for tools like find_dead_code) */
  symbolId: string | null;
  /** Detail level used, if applicable (null for tools without levels) */
  detailLevel: 'L1' | 'L2' | 'L3' | 'L4' | null;
  /** Estimated token count of the response */
  responseTokens: number;
  /** Response size in bytes (after masking, before transport) */
  responseBytes: number;
  /** Total query latency in milliseconds */
  latencyMs: number;
  /** Whether the response was truncated by response-envelope */
  truncated: boolean;
}

export interface ToolStats {
  tool: string;
  calls: number;
  avgTokens: number;
}

export interface SymbolStats {
  symbolId: string;
  name: string;
  queries: number;
}

export interface DetailLevelStats {
  level: string;
  count: number;
  percentage: number;
}

export interface AggregatedStats {
  totalCalls: number;
  totalTokensServed: number;
  topTools: ToolStats[];
  topSymbols: SymbolStats[];
  detailLevelDistribution: DetailLevelStats[];
}

export interface ISessionRecorderPort {
  /**
   * Record a tool call event. Fire-and-forget — must never throw.
   * Implementations should swallow all errors.
   */
  record(event: SessionEvent): void;

  /**
   * Query aggregated stats, optionally filtered by time range.
   * @param days - If provided, only include events from the last N days.
   *               If null/undefined, include all events.
   */
  queryStats(days?: number): AggregatedStats;

  /**
   * Delete all session event data.
   */
  clear(): void;
}
