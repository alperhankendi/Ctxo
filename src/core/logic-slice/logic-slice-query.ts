import type { SymbolNode, GraphEdge, LogicSliceResult } from '../types.js';
import type { SymbolGraph } from '../graph/symbol-graph.js';

export class LogicSliceQuery {
  getLogicSlice(
    graph: SymbolGraph,
    symbolId: string,
    maxDepth: number = Infinity,
  ): LogicSliceResult | undefined {
    const root = graph.getNode(symbolId);
    if (!root) return undefined;

    const visited = new Set<string>([symbolId]);
    const dependencies: SymbolNode[] = [];
    const collectedEdges: GraphEdge[] = [];

    // BFS transitive closure
    const queue: Array<{ id: string; depth: number }> = [{ id: symbolId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth >= maxDepth) continue;

      const edges = graph.getForwardEdges(current.id);
      for (const edge of edges) {
        const depNode = graph.getNode(edge.to);
        // Only include edges whose target node exists in the graph
        if (!depNode) continue;

        collectedEdges.push(edge);

        if (visited.has(edge.to)) continue;
        visited.add(edge.to);

        dependencies.push(depNode);
        queue.push({ id: edge.to, depth: current.depth + 1 });
      }
    }

    return { root, dependencies, edges: collectedEdges };
  }
}
