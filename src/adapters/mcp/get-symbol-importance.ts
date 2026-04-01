import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { PageRankCalculator } from '../../core/importance/pagerank-calculator.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(200).optional().default(25),
  kind: z.enum(['function', 'class', 'interface', 'method', 'variable', 'type']).optional(),
  filePattern: z.string().optional(),
  damping: z.number().min(0).max(1).optional().default(0.85),
});

export function handleGetSymbolImportance(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const calculator = new PageRankCalculator();
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

      const { limit, kind, filePattern, damping } = parsed.data;
      const graph = getGraph();

      const result = calculator.calculate(graph, { damping, limit: graph.nodeCount, maxIterations: 100 });

      // Filter after full PageRank computation (filtering before would distort scores)
      let filtered = result.rankings;
      if (kind) {
        filtered = filtered.filter((e) => e.kind === kind);
      }
      if (filePattern) {
        const lowerPattern = filePattern.toLowerCase();
        filtered = filtered.filter((e) => e.file.toLowerCase().includes(lowerPattern));
      }
      filtered = filtered.slice(0, limit);

      const payload = masking.mask(JSON.stringify({
        rankings: filtered,
        totalSymbols: result.totalSymbols,
        iterations: result.iterations,
        converged: result.converged,
        damping,
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
