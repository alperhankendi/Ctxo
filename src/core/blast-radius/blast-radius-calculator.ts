import type { SymbolGraph } from '../graph/symbol-graph.js';

export interface BlastRadiusEntry {
  readonly symbolId: string;
  readonly depth: number;
  readonly dependentCount: number;
}

export class BlastRadiusCalculator {
  calculate(graph: SymbolGraph, symbolId: string): BlastRadiusEntry[] {
    if (!graph.hasNode(symbolId)) return [];

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
        entries.push({
          symbolId: edge.from,
          depth,
          dependentCount: graph.getReverseEdges(edge.from).length,
        });

        queue.push({ id: edge.from, depth });
      }
    }

    // Sort by depth ascending
    entries.sort((a, b) => a.depth - b.depth);

    return entries;
  }
}
