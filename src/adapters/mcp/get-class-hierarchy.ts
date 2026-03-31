import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';

const InputSchema = z.object({
  symbolId: z.string().min(1).optional(),
  direction: z.enum(['ancestors', 'descendants', 'both']).optional().default('both'),
});

export function handleGetClassHierarchy(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const getGraph = () => {
    const jsonGraph = buildGraphFromJsonIndex(ctxoRoot);
    if (jsonGraph.nodeCount > 0) return jsonGraph;
    return buildGraphFromStorage(storage);
  };

  return (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId, direction } = parsed.data;
      const graph = getGraph();

      if (symbolId) {
        return handleRooted(graph, symbolId, direction, masking, staleness, storage);
      }

      return handleFull(graph, masking, staleness, storage);
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: (err as Error).message }) }],
      };
    }
  };

  function handleRooted(
    graph: ReturnType<typeof getGraph>,
    symbolId: string,
    direction: 'ancestors' | 'descendants' | 'both',
    maskingPort: IMaskingPort,
    stalenessCheck: StalenessCheck | undefined,
    storagePort: IStoragePort,
  ) {
    if (!graph.hasNode(symbolId)) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
      };
    }

    type HierarchyEntry = { symbolId: string; name: string; kind: string; file: string; edgeKind: string; depth: number };
    const ancestors: HierarchyEntry[] = [];
    const descendants: HierarchyEntry[] = [];

    const isHierarchyEdge = (kind: string) => kind === 'extends' || kind === 'implements';

    // Ancestors: follow forward edges (this symbol extends/implements X)
    if (direction === 'ancestors' || direction === 'both') {
      const visited = new Set<string>([symbolId]);
      const queue: Array<{ id: string; depth: number }> = [{ id: symbolId, depth: 0 }];

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const edge of graph.getForwardEdges(current.id)) {
          if (!isHierarchyEdge(edge.kind)) continue;
          if (visited.has(edge.to)) continue;
          visited.add(edge.to);

          const node = graph.getNode(edge.to);
          if (node) {
            const depth = current.depth + 1;
            ancestors.push({
              symbolId: node.symbolId,
              name: node.name,
              kind: node.kind,
              file: node.symbolId.split('::')[0] ?? '',
              edgeKind: edge.kind,
              depth,
            });
            queue.push({ id: edge.to, depth });
          }
        }
      }
    }

    // Descendants: follow reverse edges (X extends/implements this symbol)
    if (direction === 'descendants' || direction === 'both') {
      const visited = new Set<string>([symbolId]);
      const queue: Array<{ id: string; depth: number }> = [{ id: symbolId, depth: 0 }];

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const edge of graph.getReverseEdges(current.id)) {
          if (!isHierarchyEdge(edge.kind)) continue;
          if (visited.has(edge.from)) continue;
          visited.add(edge.from);

          const node = graph.getNode(edge.from);
          if (node) {
            const depth = current.depth + 1;
            descendants.push({
              symbolId: node.symbolId,
              name: node.name,
              kind: node.kind,
              file: node.symbolId.split('::')[0] ?? '',
              edgeKind: edge.kind,
              depth,
            });
            queue.push({ id: edge.from, depth });
          }
        }
      }
    }

    const result: Record<string, unknown> = { symbolId };
    if (direction === 'ancestors' || direction === 'both') result.ancestors = ancestors;
    if (direction === 'descendants' || direction === 'both') result.descendants = descendants;

    const payload = maskingPort.mask(JSON.stringify(result));
    const content: Array<{ type: 'text'; text: string }> = [];
    if (stalenessCheck) {
      const warning = stalenessCheck.check(storagePort.listIndexedFiles());
      if (warning) content.push({ type: 'text', text: `⚠️ ${warning.message}` });
    }
    content.push({ type: 'text', text: payload });

    return { content };
  }

  function handleFull(
    graph: ReturnType<typeof getGraph>,
    maskingPort: IMaskingPort,
    stalenessCheck: StalenessCheck | undefined,
    storagePort: IStoragePort,
  ) {
    const isHierarchyEdge = (kind: string) => kind === 'extends' || kind === 'implements';
    const hierarchyEdges = graph.allEdges().filter((e) => isHierarchyEdge(e.kind));

    // Collect all nodes involved in hierarchy edges
    const involved = new Set<string>();
    for (const edge of hierarchyEdges) {
      involved.add(edge.from);
      involved.add(edge.to);
    }

    // Find roots: nodes that are targets but never sources of extends/implements (true base classes/interfaces)
    const sources = new Set(hierarchyEdges.map((e) => e.from));
    const roots = [...involved].filter((id) => !sources.has(id));

    // If no clear roots, use all involved nodes as potential roots (handles cycles)
    const rootSet = roots.length > 0 ? roots : [...involved];

    type TreeNode = { symbolId: string; name: string; kind: string; file: string; edgeKind?: string; children: TreeNode[] };

    function buildTree(rootId: string, visited: Set<string>): TreeNode | undefined {
      const node = graph.getNode(rootId);
      if (!node) return undefined;
      visited.add(rootId);

      const children: TreeNode[] = [];
      for (const edge of graph.getReverseEdges(rootId)) {
        if (!isHierarchyEdge(edge.kind)) continue;
        if (visited.has(edge.from)) continue;
        const child = buildTree(edge.from, visited);
        if (child) {
          child.edgeKind = edge.kind;
          children.push(child);
        }
      }

      return {
        symbolId: node.symbolId,
        name: node.name,
        kind: node.kind,
        file: node.symbolId.split('::')[0] ?? '',
        children,
      };
    }

    const visited = new Set<string>();
    const hierarchies: TreeNode[] = [];
    for (const rootId of rootSet) {
      if (visited.has(rootId)) continue;
      const tree = buildTree(rootId, visited);
      if (tree) hierarchies.push(tree);
    }

    const payload = maskingPort.mask(JSON.stringify({
      hierarchies,
      totalClasses: involved.size,
      totalEdges: hierarchyEdges.length,
    }));

    const content: Array<{ type: 'text'; text: string }> = [];
    if (stalenessCheck) {
      const warning = stalenessCheck.check(storagePort.listIndexedFiles());
      if (warning) content.push({ type: 'text', text: `⚠️ ${warning.message}` });
    }
    content.push({ type: 'text', text: payload });

    return { content };
  }
}
