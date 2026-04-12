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
 * Build graph + return file list from a single JSON index read.
 * Returning both from one source prevents staleness warnings from diverging
 * from the graph data (see issue #40).
 */
export function buildGraphAndFilesFromJsonIndex(
  ctxoRoot: string,
): { graph: SymbolGraph; indexedFiles: string[] } {
  const reader = new JsonIndexReader(ctxoRoot);
  const indices = reader.readAll();

  const graph = new SymbolGraph();
  const indexedFiles: string[] = [];

  for (const fileIndex of indices) {
    indexedFiles.push(fileIndex.file);
    for (const sym of fileIndex.symbols) {
      graph.addNode(sym);
    }
  }
  for (const fileIndex of indices) {
    for (const edge of fileIndex.edges) {
      graph.addEdge(edge);
    }
  }
  return { graph, indexedFiles };
}

/**
 * Build graph directly from JSON index files (bypasses SQLite cache).
 * Always reads fresh data from disk — works even if ctxo index ran in another process.
 */
export function buildGraphFromJsonIndex(ctxoRoot: string): SymbolGraph {
  return buildGraphAndFilesFromJsonIndex(ctxoRoot).graph;
}

/**
 * Returns graph + indexedFiles from JSON index, falling back to SQLite storage
 * when JSON is empty. Keeps graph data and staleness check file list aligned.
 */
export function getGraphAndFiles(
  ctxoRoot: string,
  storage: IStoragePort,
): { graph: SymbolGraph; indexedFiles: string[] } {
  const json = buildGraphAndFilesFromJsonIndex(ctxoRoot);
  if (json.graph.nodeCount > 0) return json;
  return { graph: buildGraphFromStorage(storage), indexedFiles: storage.listIndexedFiles() };
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
  const getGraph = () => getGraphAndFiles(ctxoRoot, storage);

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

      const { graph, indexedFiles } = getGraph();

      // Batch support: query multiple symbols
      const results = [];
      for (const id of ids) {
        const slice = query.getLogicSlice(graph, id);
        if (slice) {
          const formatted = formatter.format(slice, level) as unknown as Record<string, unknown>;
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
        const warning = staleness.check(indexedFiles);
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
