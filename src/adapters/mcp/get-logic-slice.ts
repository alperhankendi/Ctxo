import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { SymbolGraph } from '../../core/graph/symbol-graph.js';
import { JsonIndexReader } from '../storage/json-index-reader.js';
import { LogicSliceQuery } from '../../core/logic-slice/logic-slice-query.js';
import { DetailFormatter } from '../../core/detail-levels/detail-formatter.js';
import { DetailLevelSchema } from '../../core/types.js';
import { wrapResponse } from '../../core/response-envelope.js';
import { filterByIntent } from '../../core/intent-filter.js';

const InputSchema = z.object({
  symbolId: z.string().min(1).optional(),
  symbolIds: z.array(z.string().min(1)).optional(),
  level: DetailLevelSchema.optional().default(3),
  intent: z.string().optional().describe('Filter dependencies by intent keywords (e.g., "core", "adapter", "storage")'),
}).refine(
  (data) => data.symbolId || (data.symbolIds && data.symbolIds.length > 0),
  { message: 'Either symbolId or symbolIds must be provided' },
);

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

/**
 * Build graph directly from JSON index files (bypasses SQLite cache).
 * Always reads fresh data from disk — works even if ctxo index ran in another process.
 */
export function buildGraphFromJsonIndex(ctxoRoot: string): SymbolGraph {
  const reader = new JsonIndexReader(ctxoRoot);
  const indices = reader.readAll();

  const graph = new SymbolGraph();
  // Phase 1: all nodes
  for (const fileIndex of indices) {
    for (const sym of fileIndex.symbols) {
      graph.addNode(sym);
    }
  }
  // Phase 2: all edges (fuzzy resolution active since nodes are loaded)
  for (const fileIndex of indices) {
    for (const edge of fileIndex.edges) {
      graph.addEdge(edge);
    }
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
  ctxoRoot = '.ctxo',
) {
  const query = new LogicSliceQuery();
  const formatter = new DetailFormatter();

  // Build graph fresh on each call — try JSON index first (always up to date),
  // fall back to SQLite storage (for tests and when JSON not available).
  const getGraph = () => {
    const jsonGraph = buildGraphFromJsonIndex(ctxoRoot);
    if (jsonGraph.nodeCount > 0) return jsonGraph;
    return buildGraphFromStorage(storage);
  };

  const handler = (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId, symbolIds, level, intent } = parsed.data;
      const ids = symbolIds ?? (symbolId ? [symbolId] : []);

      const graph = getGraph();

      // Batch support: query multiple symbols
      const results = [];
      for (const id of ids) {
        const slice = query.getLogicSlice(graph, id);
        if (slice) {
          const formatted = formatter.format(slice, level) as Record<string, unknown>;
          // Apply intent filter to dependencies if present
          if (intent && Array.isArray(formatted['dependencies'])) {
            formatted['dependencies'] = filterByIntent(
              formatted['dependencies'] as Record<string, unknown>[],
              intent,
            );
          }
          results.push(formatted);
        } else {
          results.push({ found: false, symbolId: id, hint: 'Symbol not found. Run "ctxo index".' });
        }
      }

      // Single symbol: return directly. Batch: return array.
      const responseData = ids.length === 1 ? results[0] : { batch: true, results };

      // Apply masking
      const payload = masking.mask(JSON.stringify(wrapResponse(responseData as Record<string, unknown>)));

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

  return handler;
}
