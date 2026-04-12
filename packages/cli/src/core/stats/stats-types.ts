/**
 * StatsReport — the output model for `ctxo stats` CLI command.
 * This is also the exact shape of `--json` output.
 */
export interface StatsReport {
  timeRange: {
    from: string | null;
    to: string;
    daysFilter: number | null;
  };
  summary: {
    totalCalls: number;
    totalTokensServed: number;
  };
  topTools: Array<{
    tool: string;
    calls: number;
    avgTokens: number;
  }>;
  topSymbols: Array<{
    symbolId: string;
    name: string;
    queries: number;
  }>;
  detailLevelDistribution: Array<{
    level: string;
    count: number;
    percentage: number;
  }>;
}
