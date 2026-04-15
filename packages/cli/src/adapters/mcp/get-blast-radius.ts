import { z } from 'zod';
import type { IGitPort } from '../../ports/i-git-port.js';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { BlastRadiusCalculator } from '../../core/blast-radius/blast-radius-calculator.js';
import { wrapResponse } from '../../core/response-envelope.js';
import { buildSnapshotStaleness } from '../../core/overlay/snapshot-staleness.js';
import { filterByIntent } from '../../core/intent-filter.js';
import type { CommunitySnapshot } from '../../core/types.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { getGraphAndFiles } from './get-logic-slice.js';

interface ClusterBreakdown {
  readonly byCluster: Record<string, number>;
  readonly crossClusterCount: number;
  readonly multiClusterHint?: string;
}

function computeClusterBreakdown(
  snapshot: CommunitySnapshot,
  rootSymbolId: string,
  impactedSymbolIds: readonly string[],
): ClusterBreakdown | undefined {
  if (impactedSymbolIds.length === 0) return undefined;
  const assignment = new Map<string, { id: number; label: string }>();
  for (const entry of snapshot.communities) {
    assignment.set(entry.symbolId, { id: entry.communityId, label: entry.communityLabel });
  }
  const rootCluster = assignment.get(rootSymbolId);
  const byCluster: Record<string, number> = {};
  let crossClusterCount = 0;
  for (const symbolId of impactedSymbolIds) {
    const cluster = assignment.get(symbolId);
    if (!cluster) continue;
    const label = cluster.label || `community-${cluster.id}`;
    byCluster[label] = (byCluster[label] ?? 0) + 1;
    if (rootCluster && cluster.id !== rootCluster.id) crossClusterCount++;
  }
  const clusterCount = Object.keys(byCluster).length;
  const multiClusterHint =
    clusterCount >= 3
      ? `Change impacts ${clusterCount} clusters — multi-team review recommended.`
      : undefined;
  return { byCluster, crossClusterCount, multiClusterHint };
}

const InputSchema = z.object({
  symbolId: z.string().min(1),
  confidence: z.enum(['confirmed', 'likely', 'potential']).optional(),
  intent: z.string().optional().describe('Filter results by intent keywords (e.g., "test", "adapter", "security")'),
});

export function handleGetBlastRadius(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
  git?: IGitPort,
) {
  const calculator = new BlastRadiusCalculator();
  const getGraph = () => getGraphAndFiles(ctxoRoot, storage);

  return async (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId } = parsed.data;
      const { graph, indexedFiles } = getGraph();

      if (!graph.hasNode(symbolId)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }

      const result = calculator.calculate(graph, symbolId);

      // Apply confidence filter if requested
      let symbols = result.impactedSymbols;
      if (parsed.data.confidence) {
        symbols = symbols.filter(s => s.confidence === parsed.data.confidence);
      }

      // Apply intent filter if requested
      symbols = filterByIntent(symbols as unknown as Record<string, unknown>[], parsed.data.intent) as unknown as typeof symbols;

      const confirmedCount = symbols.filter(s => s.confidence === 'confirmed').length;
      const likelyCount = symbols.filter(s => s.confidence === 'likely').length;
      const potentialCount = symbols.filter(s => s.confidence === 'potential').length;

      const snapshot = storage.readCommunities();
      const clusterBreakdown = snapshot
        ? computeClusterBreakdown(snapshot, symbolId, symbols.map((s) => s.symbolId))
        : undefined;

      const body: Record<string, unknown> = {
        symbolId,
        impactScore: symbols.length,
        directDependentsCount: result.directDependentsCount,
        confirmedCount,
        likelyCount,
        potentialCount,
        overallRiskScore: result.overallRiskScore,
        impactedSymbols: symbols,
      };
      if (clusterBreakdown) {
        body.byCluster = clusterBreakdown.byCluster;
        body.crossClusterEdges = clusterBreakdown.crossClusterCount;
        if (clusterBreakdown.multiClusterHint) {
          body.multiClusterHint = clusterBreakdown.multiClusterHint;
        }
      }

      const stalenessMeta = git ? await buildSnapshotStaleness(storage, git) : undefined;
      const extras = stalenessMeta ? { snapshotStaleness: stalenessMeta } : undefined;
      const payload = masking.mask(JSON.stringify(wrapResponse(body, extras)));

      const content: Array<{ type: 'text'; text: string }> = [];
      if (staleness) {
        const warning = staleness.check(indexedFiles);
        if (warning) content.push({ type: 'text', text: `⚠️ ${warning.message}` });
      }
      content.push({ type: 'text', text: payload });

      return { content };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: (err as Error).message }) }],
      };
    }
  };
}
