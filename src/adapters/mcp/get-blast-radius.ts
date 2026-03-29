import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { BlastRadiusCalculator } from '../../core/blast-radius/blast-radius-calculator.js';
import { SymbolGraph } from '../../core/graph/symbol-graph.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { buildGraphFromStorage } from './get-logic-slice.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
});

export function handleGetBlastRadius(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
) {
  const calculator = new BlastRadiusCalculator();
  let cachedGraph: SymbolGraph | undefined;

  const getGraph = () => {
    if (!cachedGraph) {
      cachedGraph = buildGraphFromStorage(storage);
    }
    return cachedGraph;
  };

  return (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId } = parsed.data;
      const graph = getGraph();

      if (!graph.hasNode(symbolId)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }

      const entries = calculator.calculate(graph, symbolId);
      const payload = masking.mask(JSON.stringify({ symbolId, impactScore: entries.length, dependents: entries }));

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
