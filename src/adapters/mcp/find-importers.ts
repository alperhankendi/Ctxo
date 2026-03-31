import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
  edgeKinds: z.array(z.enum(['imports', 'calls', 'extends', 'implements', 'uses'])).optional(),
  transitive: z.boolean().optional().default(false),
  maxDepth: z.number().int().min(1).max(10).optional().default(5),
});

export function handleFindImporters(
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

      const { symbolId, edgeKinds, transitive, maxDepth } = parsed.data;
      const graph = getGraph();

      if (!graph.hasNode(symbolId)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }

      const importers: Array<{
        symbolId: string;
        name: string;
        kind: string;
        file: string;
        edgeKind: string;
        depth: number;
      }> = [];

      if (!transitive) {
        // Direct importers only
        const reverseEdges = graph.getReverseEdges(symbolId);
        for (const edge of reverseEdges) {
          if (edgeKinds && !edgeKinds.includes(edge.kind as 'imports' | 'calls' | 'extends' | 'implements' | 'uses')) continue;
          const node = graph.getNode(edge.from);
          if (node) {
            importers.push({
              symbolId: node.symbolId,
              name: node.name,
              kind: node.kind,
              file: node.symbolId.split('::')[0] ?? '',
              edgeKind: edge.kind,
              depth: 1,
            });
          }
        }
      } else {
        // BFS for transitive importers
        const visited = new Set<string>([symbolId]);
        const queue: Array<{ id: string; depth: number }> = [{ id: symbolId, depth: 0 }];

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (current.depth >= maxDepth) continue;

          const reverseEdges = graph.getReverseEdges(current.id);
          for (const edge of reverseEdges) {
            if (edgeKinds && !edgeKinds.includes(edge.kind as 'imports' | 'calls' | 'extends' | 'implements' | 'uses')) continue;
            if (visited.has(edge.from)) continue;
            visited.add(edge.from);

            const node = graph.getNode(edge.from);
            if (node) {
              const depth = current.depth + 1;
              importers.push({
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

      // Sort by depth ascending
      importers.sort((a, b) => a.depth - b.depth);

      const payload = masking.mask(JSON.stringify({
        symbolId,
        importerCount: importers.length,
        importers,
      }));

      const content: Array<{ type: 'text'; text: string }> = [];
      if (staleness) {
        const warning = staleness.check(storage.listIndexedFiles());
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
