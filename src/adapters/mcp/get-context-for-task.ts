import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { ContextAssembler } from '../../core/context-assembly/context-assembler.js';
import { JsonIndexReader } from '../storage/json-index-reader.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { wrapResponse } from '../../core/response-envelope.js';

const TaskTypeSchema = z.enum(['fix', 'extend', 'refactor', 'understand']);

const InputSchema = z.object({
  symbolId: z.string().min(1),
  taskType: TaskTypeSchema,
  tokenBudget: z.number().min(100).optional().default(4000),
});

export function handleGetContextForTask(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const assembler = new ContextAssembler();
  const indexReader = new JsonIndexReader(ctxoRoot);

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

      const { symbolId, taskType, tokenBudget } = parsed.data;
      const graph = getGraph();
      const indices = indexReader.readAll();

      const result = assembler.assembleForTask(graph, symbolId, taskType, indices, tokenBudget);

      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index".' }) }],
        };
      }

      const payload = masking.mask(JSON.stringify(wrapResponse(result as unknown as Record<string, unknown>)));

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
