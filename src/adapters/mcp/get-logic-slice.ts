import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { SymbolGraph } from '../../core/graph/symbol-graph.js';
import { LogicSliceQuery } from '../../core/logic-slice/logic-slice-query.js';
import { DetailFormatter } from '../../core/detail-levels/detail-formatter.js';
import { DetailLevelSchema } from '../../core/types.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
  level: DetailLevelSchema.optional().default(3),
});

export type GetLogicSliceInput = z.infer<typeof InputSchema>;

export function getLogicSliceInputSchema() {
  return {
    type: 'object' as const,
    properties: {
      symbolId: { type: 'string' as const, description: 'The symbol ID to retrieve (format: file::name::kind)' },
      level: { type: 'number' as const, enum: [1, 2, 3, 4], description: 'Detail level (1=minimal, 4=full)', default: 3 },
    },
    required: ['symbolId'] as const,
  };
}

export function buildGraphFromStorage(storage: IStoragePort): SymbolGraph {
  const graph = new SymbolGraph();
  for (const sym of storage.getAllSymbols()) {
    graph.addNode(sym);
  }
  for (const edge of storage.getAllEdges()) {
    graph.addEdge(edge);
  }
  return graph;
}

export interface StalenessCheck {
  check(indexedFiles: readonly string[]): { message: string } | undefined;
}

export function handleGetLogicSlice(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
) {
  const query = new LogicSliceQuery();
  const formatter = new DetailFormatter();

  // Cache graph — rebuilt only when invalidated
  let cachedGraph: SymbolGraph | undefined;

  const getGraph = () => {
    if (!cachedGraph) {
      cachedGraph = buildGraphFromStorage(storage);
    }
    return cachedGraph;
  };

  const handler = (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId, level } = parsed.data;

      const graph = getGraph();

      // Query logic slice
      const slice = query.getLogicSlice(graph, symbolId);
      if (!slice) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }

      // Format to requested detail level
      const formatted = formatter.format(slice, level);

      // Apply masking
      const payload = masking.mask(JSON.stringify(formatted));

      // Check staleness
      const content: Array<{ type: 'text'; text: string }> = [];
      if (staleness) {
        const warning = staleness.check(storage.listIndexedFiles());
        if (warning) {
          content.push({ type: 'text', text: `⚠️ ${warning.message}` });
        }
      }
      content.push({ type: 'text', text: payload });

      return { content };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: (err as Error).message }) }],
      };
    }
  };

  handler.invalidateCache = () => {
    cachedGraph = undefined;
  };

  return handler;
}
