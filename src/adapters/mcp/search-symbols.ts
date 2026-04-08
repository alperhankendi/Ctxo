import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';
import { wrapResponse } from '../../core/response-envelope.js';

const InputSchema = z.object({
  pattern: z.string().min(1),
  kind: z.enum(['function', 'class', 'interface', 'method', 'variable', 'type']).optional(),
  filePattern: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(25),
});

export function handleSearchSymbols(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
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

      const { pattern, kind, filePattern, limit } = parsed.data;
      const graph = getGraph();
      const allNodes = graph.allNodes();

      // Try regex first, fall back to literal substring
      let matcher: (name: string) => boolean;
      try {
        const regex = new RegExp(pattern, 'i');
        matcher = (name: string) => regex.test(name);
      } catch {
        const lowerPattern = pattern.toLowerCase();
        matcher = (name: string) => name.toLowerCase().includes(lowerPattern);
      }

      const matches = allNodes.filter((node) => {
        if (!matcher(node.name)) return false;
        if (kind && node.kind !== kind) return false;
        if (filePattern) {
          const file = node.symbolId.split('::')[0] ?? '';
          if (!file.toLowerCase().includes(filePattern.toLowerCase())) return false;
        }
        return true;
      });

      const results = matches.slice(0, limit).map((node) => ({
        symbolId: node.symbolId,
        name: node.name,
        kind: node.kind,
        file: node.symbolId.split('::')[0],
        startLine: node.startLine,
        endLine: node.endLine,
      }));

      const payload = masking.mask(JSON.stringify(wrapResponse({
        totalMatches: matches.length,
        results,
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
