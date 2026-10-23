import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { getGraphAndFiles } from './get-logic-slice.js';
import { wrapResponse } from '../../core/response-envelope.js';
import { filterByIntent } from '../../core/intent-filter.js';
import { EdgeKindSchema, type EdgeKind } from '../../core/types.js';

export const InputSchema = z.object({
  symbolId: z.string().min(1),
  edgeKinds: z.array(EdgeKindSchema).optional(),
  transitive: z.boolean().optional().default(false),
  maxDepth: z.number().int().min(1).max(10).optional().default(5),
  intent: z.string().optional().describe('Filter results by intent keywords (e.g., "test", "adapter", "core")'),
});

export function handleFindImporters(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const getGraph = () => getGraphAndFiles(ctxoRoot, storage);

  return (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId, edgeKinds, transitive, maxDepth } = parsed.data;
      const { graph, indexedFiles } = getGraph();

      // Resolve the id once: a 2-part data id names its winning definition. getDependentEdges gives every
      // copy of a table, view or procedure the importers of the resource.
      const root = graph.getNode(symbolId);
      if (!root) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }
      const rootId = root.symbolId;

      const importers: Array<{
        symbolId: string;
        name: string;
        kind: string;
        file: string;
        edgeKind: string;
        edgeKinds?: string[];
        depth: number;
      }> = [];

      if (!transitive) {
        // Direct importers only — deduplicate by symbolId, aggregate edgeKinds
        const reverseEdges = graph.getDependentEdges(rootId);
        const seen = new Map<string, typeof importers[0]>();
        for (const edge of reverseEdges) {
          if (edgeKinds && !edgeKinds.includes(edge.kind as EdgeKind)) continue;
          const node = graph.getNode(edge.from);
          if (node) {
            const existing = seen.get(node.symbolId);
            if (existing) {
              if (!existing.edgeKinds!.includes(edge.kind)) {
                existing.edgeKinds!.push(edge.kind);
              }
            } else {
              const entry = {
                symbolId: node.symbolId,
                name: node.name,
                kind: node.kind,
                file: node.symbolId.split('::')[0] ?? '',
                edgeKind: edge.kind,
                edgeKinds: [edge.kind],
                depth: 1,
              };
              seen.set(node.symbolId, entry);
              importers.push(entry);
            }
          }
        }
      } else {
        // BFS for transitive importers. No definition of the same resource counts as an importer of another.
        const definitions = graph.dataResourceIdentity(rootId)?.definitions.map((definition) => definition.symbolId) ?? [];
        const visited = new Set<string>([rootId, ...definitions]);
        const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (current.depth >= maxDepth) continue;

          const reverseEdges = graph.getDependentEdges(current.id);
          for (const edge of reverseEdges) {
            if (edgeKinds && !edgeKinds.includes(edge.kind as EdgeKind)) continue;
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

      // Apply intent filter if requested
      const filtered = filterByIntent(importers, parsed.data.intent);

      const payload = masking.mask(JSON.stringify(wrapResponse({
        symbolId,
        importerCount: filtered.length,
        importers: filtered,
      })));

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
