import type { SymbolGraph } from '../graph/symbol-graph.js';

export type ImpactConfidence = 'confirmed' | 'likely' | 'potential';

export interface BlastRadiusEntry {
  readonly symbolId: string;
  readonly depth: number;
  readonly dependentCount: number;
  readonly riskScore: number;
  readonly confidence: ImpactConfidence;
  readonly edgeKinds: string[];
}

export interface BlastRadiusResult {
  readonly impactedSymbols: BlastRadiusEntry[];
  readonly directDependentsCount: number;
  readonly confirmedCount: number;
  readonly likelyCount: number;
  readonly potentialCount: number;
  readonly overallRiskScore: number;
}

const CONFIRMED_KINDS = new Set(['calls', 'extends', 'implements']);
const LIKELY_KINDS = new Set(['uses']);

const CONFIDENCE_RANK: Record<ImpactConfidence, number> = {
  confirmed: 2,
  likely: 1,
  potential: 0,
};

function edgeKindToConfidence(kind: string): ImpactConfidence {
  if (CONFIRMED_KINDS.has(kind)) return 'confirmed';
  if (LIKELY_KINDS.has(kind)) return 'likely';
  return 'potential';
}

export class BlastRadiusCalculator {
  calculate(graph: SymbolGraph, symbolId: string): BlastRadiusResult {
    if (!graph.hasNode(symbolId)) {
      return { impactedSymbols: [], directDependentsCount: 0, confirmedCount: 0, potentialCount: 0, overallRiskScore: 0 };
    }

    const visited = new Set<string>([symbolId]);
    const rawEntries: Array<{ symbolId: string; depth: number; riskScore: number; confidence: ImpactConfidence; edgeKinds: string[] }> = [];

    // BFS via reverse edges (who depends on this symbol?)
    const queue: Array<{ id: string; depth: number }> = [{ id: symbolId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      const reverseEdges = graph.getReverseEdges(current.id);

      // Group edges by source node, pick strongest confidence per node
      // confirmed > likely > potential — collect all edge kinds
      const bestByNode = new Map<string, { confidence: ImpactConfidence; kinds: Set<string> }>();
      for (const edge of reverseEdges) {
        if (visited.has(edge.from)) continue;
        const conf = edgeKindToConfidence(edge.kind);
        const existing = bestByNode.get(edge.from);
        if (!existing) {
          bestByNode.set(edge.from, { confidence: conf, kinds: new Set([edge.kind]) });
        } else {
          existing.kinds.add(edge.kind);
          if (CONFIDENCE_RANK[conf] > CONFIDENCE_RANK[existing.confidence]) {
            existing.confidence = conf;
          }
        }
      }

      for (const [nodeId, info] of bestByNode) {
        visited.add(nodeId);
        if (!graph.hasNode(nodeId)) continue;

        const depth = current.depth + 1;
        const riskScore = 1 / Math.pow(depth, 0.7);

        rawEntries.push({
          symbolId: nodeId,
          depth,
          riskScore: Math.round(riskScore * 1000) / 1000,
          confidence: info.confidence,
          edgeKinds: [...info.kinds],
        });

        queue.push({ id: nodeId, depth });
      }
    }

    // GAP-30 FIX: compute dependentCount as blast-scope in-degree (not global)
    const blastSet = new Set(rawEntries.map((e) => e.symbolId));
    blastSet.add(symbolId);

    const entries: BlastRadiusEntry[] = rawEntries.map((e) => ({
      ...e,
      dependentCount: graph.getReverseEdges(e.symbolId).filter((re) => blastSet.has(re.from)).length,
    }));

    // Sort by depth ascending
    entries.sort((a, b) => a.depth - b.depth);

    const directDependentsCount = entries.filter((e) => e.depth === 1).length;

    // GAP-29 FIX: depth-weighted risk — direct dependents dominate
    const totalRisk = entries.reduce((sum, e) => sum + e.riskScore, 0);
    const overallRiskScore = Math.round(Math.min(totalRisk / Math.max(directDependentsCount, 1), 1) * 1000) / 1000;

    const confirmedCount = entries.filter((e) => e.confidence === 'confirmed').length;
    const likelyCount = entries.filter((e) => e.confidence === 'likely').length;
    const potentialCount = entries.filter((e) => e.confidence === 'potential').length;

    return { impactedSymbols: entries, directDependentsCount, confirmedCount, likelyCount, potentialCount, overallRiskScore };
  }
}
