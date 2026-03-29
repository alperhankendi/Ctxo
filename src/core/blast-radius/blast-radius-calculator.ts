import type { SymbolGraph } from '../graph/symbol-graph.js';

export interface BlastRadiusEntry {
  readonly symbolId: string;
  readonly depth: number;
  readonly dependentCount: number;
  readonly riskScore: number;
}

export interface BlastRadiusResult {
  readonly impactedSymbols: BlastRadiusEntry[];
  readonly directDependentsCount: number;
  readonly overallRiskScore: number;
}

export class BlastRadiusCalculator {
  calculate(graph: SymbolGraph, symbolId: string): BlastRadiusResult {
    if (!graph.hasNode(symbolId)) {
      return { impactedSymbols: [], directDependentsCount: 0, overallRiskScore: 0 };
    }

    const visited = new Set<string>([symbolId]);
    const entries: BlastRadiusEntry[] = [];

    // BFS via reverse edges (who depends on this symbol?)
    const queue: Array<{ id: string; depth: number }> = [{ id: symbolId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      const reverseEdges = graph.getReverseEdges(current.id);
      for (const edge of reverseEdges) {
        if (visited.has(edge.from)) continue;
        visited.add(edge.from);

        if (!graph.hasNode(edge.from)) continue;

        const depth = current.depth + 1;

        // Risk score: 1/depth^0.7 — closer dependents = higher risk
        const riskScore = 1 / Math.pow(depth, 0.7);

        entries.push({
          symbolId: edge.from,
          depth,
          dependentCount: graph.getReverseEdges(edge.from).length,
          riskScore: Math.round(riskScore * 1000) / 1000,
        });

        queue.push({ id: edge.from, depth });
      }
    }

    // Sort by depth ascending
    entries.sort((a, b) => a.depth - b.depth);

    const directDependentsCount = entries.filter((e) => e.depth === 1).length;

    // Overall risk: sum of all risk scores, normalized to 0.0–1.0
    const totalRisk = entries.reduce((sum, e) => sum + e.riskScore, 0);
    const maxPossibleRisk = entries.length > 0 ? entries.length : 1;
    const overallRiskScore = Math.round(Math.min(totalRisk / maxPossibleRisk, 1) * 1000) / 1000;

    return { impactedSymbols: entries, directDependentsCount, overallRiskScore };
  }
}
