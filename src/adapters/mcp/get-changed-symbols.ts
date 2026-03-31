import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IGitPort } from '../../ports/i-git-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';

const InputSchema = z.object({
  since: z.string().optional().default('HEAD~1'),
  maxFiles: z.number().int().min(1).optional().default(50),
});

export function handleGetChangedSymbols(
  storage: IStoragePort,
  git: IGitPort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const getGraph = () => {
    const jsonGraph = buildGraphFromJsonIndex(ctxoRoot);
    if (jsonGraph.nodeCount > 0) return jsonGraph;
    return buildGraphFromStorage(storage);
  };

  return async (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { since, maxFiles } = parsed.data;
      const changedPaths = await git.getChangedFiles(since);
      const graph = getGraph();

      // Index all nodes by file for fast lookup
      const nodesByFile = new Map<string, Array<{ symbolId: string; name: string; kind: string; startLine: number; endLine: number }>>();
      for (const node of graph.allNodes()) {
        const file = node.symbolId.split('::')[0] ?? '';
        const existing = nodesByFile.get(file) ?? [];
        existing.push({ symbolId: node.symbolId, name: node.name, kind: node.kind, startLine: node.startLine, endLine: node.endLine });
        nodesByFile.set(file, existing);
      }

      const files: Array<{ file: string; symbols: Array<{ symbolId: string; name: string; kind: string; startLine: number; endLine: number }> }> = [];
      let totalSymbols = 0;

      for (const filePath of changedPaths.slice(0, maxFiles)) {
        const symbols = nodesByFile.get(filePath);
        if (symbols && symbols.length > 0) {
          files.push({ file: filePath, symbols });
          totalSymbols += symbols.length;
        }
      }

      const payload = masking.mask(JSON.stringify({
        since,
        changedFiles: files.length,
        changedSymbols: totalSymbols,
        files,
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
