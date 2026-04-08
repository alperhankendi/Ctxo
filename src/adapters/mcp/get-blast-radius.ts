import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { BlastRadiusCalculator } from '../../core/blast-radius/blast-radius-calculator.js';
import { wrapResponse } from '../../core/response-envelope.js';
import { filterByIntent } from '../../core/intent-filter.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
  confidence: z.enum(['confirmed', 'likely', 'potential']).optional(),
  intent: z.string().optional().describe('Filter results by intent keywords (e.g., "test", "adapter", "security")'),
});

export function handleGetBlastRadius(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const calculator = new BlastRadiusCalculator();
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

      const { symbolId } = parsed.data;
      const graph = getGraph();

      if (!graph.hasNode(symbolId)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }

      const result = calculator.calculate(graph, symbolId);

      // Apply confidence filter if requested
      let symbols = result.impactedSymbols;
      if (parsed.data.confidence) {
        symbols = symbols.filter(s => s.confidence === parsed.data.confidence);
      }

      // Apply intent filter if requested
      symbols = filterByIntent(symbols as unknown as Record<string, unknown>[], parsed.data.intent) as unknown as typeof symbols;

      const confirmedCount = symbols.filter(s => s.confidence === 'confirmed').length;
      const likelyCount = symbols.filter(s => s.confidence === 'likely').length;
      const potentialCount = symbols.filter(s => s.confidence === 'potential').length;

      const payload = masking.mask(JSON.stringify(wrapResponse({
        symbolId,
        impactScore: symbols.length,
        directDependentsCount: result.directDependentsCount,
        confirmedCount,
        likelyCount,
        potentialCount,
        overallRiskScore: result.overallRiskScore,
        impactedSymbols: symbols,
      })));

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
