import type { SymbolGraph } from '../graph/symbol-graph.js';
import { EDGE_KINDS, type CoChangeEntry, type EdgeKind } from '../types.js';

export type ImpactConfidence = 'confirmed' | 'likely' | 'potential';

export interface BlastRadiusEntry {
  readonly symbolId: string;
  readonly depth: number;
  readonly dependentCount: number;
  readonly riskScore: number;
  readonly confidence: ImpactConfidence;
  readonly edgeKinds: string[];
  readonly coChangeFrequency?: number;
}

export interface BlastRadiusResult {
  readonly impactedSymbols: BlastRadiusEntry[];
  readonly directDependentsCount: number;
  readonly confirmedCount: number;
  readonly likelyCount: number;
  readonly potentialCount: number;
  readonly overallRiskScore: number;
}

/** Confidence of a dependent by edge kind. The data edges are exact references, so they are confirmed. */
export const EDGE_KIND_CONFIDENCE: Readonly<Record<EdgeKind, ImpactConfidence>> = {
  calls: 'confirmed',
  extends: 'confirmed',
  implements: 'confirmed',
  reads: 'confirmed',
  writes: 'confirmed',
  executes: 'confirmed',
  uses: 'likely',
  imports: 'potential',
};

// Depth-weighted risk mass at which overallRiskScore reaches 0.5.
// With 5: 1 direct dependent → 0.167, 3 → 0.375, 12 → 0.706. The hyperbolic
// curve keeps heavily-depended-on symbols distinguishable instead of pinning
// them at 1.0, and 3 direct dependents (the balanced gate floor) land in medium.
const RISK_HALF_POINT = 5;

const CONFIDENCE_RANK: Record<ImpactConfidence, number> = {
  confirmed: 2,
  likely: 1,
  potential: 0,
};

function edgeKindToConfidence(kind: string): ImpactConfidence {
  return (EDGE_KINDS as readonly string[]).includes(kind) ? EDGE_KIND_CONFIDENCE[kind as EdgeKind] : 'potential';
}

export class BlastRadiusCalculator {
  /**
   * `symbolId` may be any id `SymbolGraph.getNode` resolves, a 2-part data id included. The root is the
   * node it names, and the root's own file is the one co-change is matched against. Dependents come from
   * `getDependentEdges`, so every copy of a table, view or procedure, and its 2-part id, has the dependents
   * of the resource, and no definition of the resource counts as a dependent of another.
   */
  calculate(graph: SymbolGraph, symbolId: string, coChangeMap?: Map<string, CoChangeEntry[]>): BlastRadiusResult {
    const root = graph.getNode(symbolId);
    if (!root) {
      return { impactedSymbols: [], directDependentsCount: 0, confirmedCount: 0, likelyCount: 0, potentialCount: 0, overallRiskScore: 0 };
    }

    const rootId = root.symbolId;
    const sourceFile = rootId.split('::')[0]!;
    const definitions = graph.dataResourceIdentity(rootId)?.definitions.map((definition) => definition.symbolId) ?? [];

    const visited = new Set<string>([rootId, ...definitions]);
    const rawEntries: Array<{ symbolId: string; depth: number; riskScore: number; confidence: ImpactConfidence; edgeKinds: string[]; coChangeFrequency?: number }> = [];

    // BFS via reverse edges (who depends on this symbol?)
    const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      const reverseEdges = graph.getDependentEdges(current.id);

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
        // Keep orphan edge sources (common for test/config files that only
        // import — ts-morph writes their synthetic "file-module" symbolId to
        // the edge's `from` but never to the file's symbols[] array). BFS
        // into an orphan terminates naturally since getReverseEdges returns [].

        const depth = current.depth + 1;
        const riskScore = 1 / Math.pow(depth, 0.7);

        // Co-change boost: if files frequently change together, upgrade potential → likely
        let confidence = info.confidence;
        let coChangeFrequency: number | undefined;
        if (coChangeMap) {
          const nodeFile = nodeId.split('::')[0]!;
          const coEntries = coChangeMap.get(sourceFile);
          if (coEntries) {
            // Each entry pairs the root's file with one partner, so match the dependent's file against that
            // partner. Matching either side would also hit a dependent inside the root's own file, with
            // whatever file the first entry happens to pair the root with.
            const match = coEntries.find(e => (e.file1 === sourceFile ? e.file2 : e.file1) === nodeFile);
            if (match) {
              coChangeFrequency = match.frequency;
              if (confidence === 'potential' && match.frequency > 0.5) {
                confidence = 'likely';
              }
            }
          }
        }

        rawEntries.push({
          symbolId: nodeId,
          depth,
          riskScore: Math.round(riskScore * 1000) / 1000,
          confidence,
          edgeKinds: [...info.kinds],
          coChangeFrequency,
        });

        queue.push({ id: nodeId, depth });
      }
    }

    // GAP-30 FIX: compute dependentCount as blast-scope in-degree (not global)
    const blastSet = new Set([rootId, ...definitions, ...rawEntries.map((e) => e.symbolId)]);

    const entries: BlastRadiusEntry[] = rawEntries.map((e) => ({
      ...e,
      dependentCount: graph.getDependentEdges(e.symbolId).filter((re) => blastSet.has(re.from)).length,
    }));

    // Sort by depth ascending
    entries.sort((a, b) => a.depth - b.depth);

    const directDependentsCount = entries.filter((e) => e.depth === 1).length;

    // Depth-weighted risk mass, squashed into [0, 1). Dividing by
    // directDependentsCount (the old GAP-29 formula) always yielded >= 1
    // because every direct dependent contributes exactly 1.0.
    const totalRisk = entries.reduce((sum, e) => sum + e.riskScore, 0);
    const overallRiskScore = Math.round((totalRisk / (totalRisk + RISK_HALF_POINT)) * 1000) / 1000;

    const confirmedCount = entries.filter((e) => e.confidence === 'confirmed').length;
    const likelyCount = entries.filter((e) => e.confidence === 'likely').length;
    const potentialCount = entries.filter((e) => e.confidence === 'potential').length;

    return { impactedSymbols: entries, directDependentsCount, confirmedCount, likelyCount, potentialCount, overallRiskScore };
  }
}
