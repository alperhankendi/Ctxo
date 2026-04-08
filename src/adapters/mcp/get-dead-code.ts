import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { DeadCodeDetector } from '../../core/dead-code/dead-code-detector.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';
import { wrapResponse } from '../../core/response-envelope.js';
import { filterByIntent } from '../../core/intent-filter.js';
import type { StalenessCheck } from './get-logic-slice.js';

const InputSchema = z.object({
  includeTests: z.boolean().optional().default(false),
  intent: z.string().optional().describe('Filter dead code results by intent keywords (e.g., "adapter", "core", "function")'),
});

export function handleFindDeadCode(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const detector = new DeadCodeDetector();

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

      const graph = getGraph();
      const result = detector.detect(graph, { includeTests: parsed.data.includeTests });

      // Apply intent filter to deadSymbols if requested
      const filtered = {
        ...result,
        deadSymbols: filterByIntent(result.deadSymbols as unknown as Record<string, unknown>[], parsed.data.intent) as typeof result.deadSymbols,
      };

      const payload = masking.mask(JSON.stringify(wrapResponse(filtered as unknown as Record<string, unknown>)));

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
