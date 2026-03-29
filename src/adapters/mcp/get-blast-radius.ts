import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { BlastRadiusCalculator } from '../../core/blast-radius/blast-radius-calculator.js';
import { buildGraphFromStorage } from './get-logic-slice.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
});

export function handleGetBlastRadius(
  storage: IStoragePort,
  masking: IMaskingPort,
) {
  const calculator = new BlastRadiusCalculator();
  const cachedGraph = buildGraphFromStorage(storage);

  return (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId } = parsed.data;

      if (!cachedGraph.hasNode(symbolId)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }

      const entries = calculator.calculate(cachedGraph, symbolId);
      const payload = masking.mask(JSON.stringify({ symbolId, impactScore: entries.length, dependents: entries }));

      return {
        content: [{ type: 'text' as const, text: payload }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: (err as Error).message }) }],
      };
    }
  };
}
