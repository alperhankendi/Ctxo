import type { SymbolGraph } from '../graph/symbol-graph.js';

export interface PageRankEntry {
  readonly symbolId: string;
  readonly name: string;
  readonly kind: string;
  readonly file: string;
  readonly score: number;
  readonly inDegree: number;
  readonly outDegree: number;
}

export interface PageRankResult {
  readonly rankings: PageRankEntry[];
  readonly totalSymbols: number;
  readonly iterations: number;
  readonly converged: boolean;
}

export interface PageRankOptions {
  readonly damping?: number;
  readonly maxIterations?: number;
  readonly tolerance?: number;
  readonly limit?: number;
}

const DEFAULT_DAMPING = 0.85;
const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_TOLERANCE = 1e-6;
const DEFAULT_LIMIT = 25;

export class PageRankCalculator {
  calculate(graph: SymbolGraph, options: PageRankOptions = {}): PageRankResult {
    const damping = options.damping ?? DEFAULT_DAMPING;
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const limit = options.limit ?? DEFAULT_LIMIT;

    const nodes = graph.allNodes();
    const n = nodes.length;

    if (n === 0) {
      return { rankings: [], totalSymbols: 0, iterations: 0, converged: true };
    }

    // Initialize scores uniformly
    const scores = new Map<string, number>();
    const initialScore = 1 / n;
    for (const node of nodes) {
      scores.set(node.symbolId, initialScore);
    }

    // Precompute out-degree for each node
    const outDegree = new Map<string, number>();
    for (const node of nodes) {
      outDegree.set(node.symbolId, graph.getForwardEdges(node.symbolId).length);
    }

    // Iterative PageRank
    // Edge direction: A->B means "A depends on B" (A imports/calls/uses B)
    // PageRank: B is important if many important nodes link to B
    // Score distribution: each node distributes its score via forward edges to dependencies
    // So we accumulate via reverse edges: for each node, sum score from nodes that point to it
    let iterations = 0;
    let converged = false;

    while (iterations < maxIterations) {
      const newScores = new Map<string, number>();
      const base = (1 - damping) / n;

      // Handle dangling nodes (no outgoing edges) — distribute their score evenly
      let danglingSum = 0;
      for (const node of nodes) {
        if ((outDegree.get(node.symbolId) ?? 0) === 0) {
          danglingSum += scores.get(node.symbolId) ?? 0;
        }
      }
      const danglingContrib = damping * danglingSum / n;

      for (const node of nodes) {
        let incomingScore = 0;

        // Sum contributions from all nodes that have a forward edge TO this node
        // (i.e., reverse edges of this node)
        const reverseEdges = graph.getReverseEdges(node.symbolId);
        const contributors = new Set<string>();
        for (const edge of reverseEdges) {
          if (contributors.has(edge.from)) continue; // deduplicate multi-edges
          contributors.add(edge.from);
          const fromScore = scores.get(edge.from) ?? 0;
          const fromOut = outDegree.get(edge.from) ?? 1;
          incomingScore += fromScore / fromOut;
        }

        newScores.set(node.symbolId, base + damping * incomingScore + danglingContrib);
      }

      // Check convergence
      let maxDelta = 0;
      for (const node of nodes) {
        const delta = Math.abs((newScores.get(node.symbolId) ?? 0) - (scores.get(node.symbolId) ?? 0));
        if (delta > maxDelta) maxDelta = delta;
      }

      // Update scores
      for (const [id, score] of newScores) {
        scores.set(id, score);
      }

      iterations++;

      if (maxDelta < tolerance) {
        converged = true;
        break;
      }
    }

    // Build ranked results
    const entries: PageRankEntry[] = nodes.map((node) => ({
      symbolId: node.symbolId,
      name: node.name,
      kind: node.kind,
      file: node.symbolId.split('::')[0] ?? '',
      score: Math.round((scores.get(node.symbolId) ?? 0) * 1_000_000) / 1_000_000,
      inDegree: graph.getReverseEdges(node.symbolId).length,
      outDegree: outDegree.get(node.symbolId) ?? 0,
    }));

    // Sort by score descending
    entries.sort((a, b) => b.score - a.score);

    return {
      rankings: entries.slice(0, limit),
      totalSymbols: n,
      iterations,
      converged,
    };
  }
}
