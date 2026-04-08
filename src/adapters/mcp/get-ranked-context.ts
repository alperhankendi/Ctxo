import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { ContextAssembler } from '../../core/context-assembly/context-assembler.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { wrapResponse } from '../../core/response-envelope.js';
import { SearchEngine } from '../../core/search/search-engine.js';
import type { ISearchPort } from '../../ports/i-search-port.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('ctxo:search');

const InputSchema = z.object({
  query: z.string().min(1),
  tokenBudget: z.number().min(100).optional().default(4000),
  strategy: z.enum(['combined', 'dependency', 'importance']).optional().default('combined'),
  fuzzy: z.boolean().optional().default(true),
  searchMode: z.enum(['fts', 'legacy']).optional().default('fts'),
});

export function handleGetRankedContext(
  storage: IStoragePort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
  searchEngine?: ISearchPort,
) {
  const assembler = new ContextAssembler();
  const engine: ISearchPort = searchEngine ?? new SearchEngine();

  const getGraph = () => {
    const jsonGraph = buildGraphFromJsonIndex(ctxoRoot);
    if (jsonGraph.nodeCount > 0) return jsonGraph;
    return buildGraphFromStorage(storage);
  };

  let lastNodeCount = -1;

  return (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { query, tokenBudget, strategy, searchMode } = parsed.data;
      const graph = getGraph();

      // Use new search engine when mode is 'fts'
      if (searchMode === 'fts' && strategy !== 'importance') {
        // Rebuild search index when graph changes (detected by node count change)
        const currentNodeCount = graph.nodeCount;
        if (currentNodeCount !== lastNodeCount) {
          const allNodes = graph.allNodes();
          // Compute PageRank scores (normalized reverse edge count)
          const pageRankScores = new Map<string, number>();
          let maxReverseEdges = 1;
          for (const node of allNodes) {
            const count = graph.getReverseEdges(node.symbolId).length;
            if (count > maxReverseEdges) maxReverseEdges = count;
          }
          for (const node of allNodes) {
            const count = graph.getReverseEdges(node.symbolId).length;
            pageRankScores.set(node.symbolId, count / maxReverseEdges);
          }

          engine.buildIndex(allNodes, pageRankScores);
          lastNodeCount = currentNodeCount;
          log.info(`Search engine: ${engine.getTier()} (${allNodes.length} symbols)`);
        }

        const searchResult = engine.search(query, 100);

        // Greedy pack within token budget
        const results: Array<{
          symbolId: string;
          name: string;
          kind: string;
          file: string;
          relevanceScore: number;
          importanceScore: number;
          combinedScore: number;
          tokens: number;
        }> = [];
        let totalTokens = 0;

        for (const sr of searchResult.results) {
          const node = graph.getNode(sr.symbolId);
          const tokens = node ? assembler.estimateTokensPublic(node) : 90;

          if (totalTokens + tokens > tokenBudget) continue;
          results.push({
            symbolId: sr.symbolId,
            name: sr.name,
            kind: sr.kind,
            file: sr.filePath,
            relevanceScore: Math.round(sr.relevanceScore * 1000) / 1000,
            importanceScore: Math.round(sr.importanceScore * 1000) / 1000,
            combinedScore: Math.round(sr.combinedScore * 1000) / 1000,
            tokens,
          });
          totalTokens += tokens;
        }

        const payload = masking.mask(JSON.stringify(wrapResponse({
          query,
          strategy,
          results,
          totalTokens,
          tokenBudget,
          searchMetrics: searchResult.metrics,
          ...(searchResult.fuzzyCorrection ? { fuzzyCorrection: searchResult.fuzzyCorrection } : {}),
        })));

        const content: Array<{ type: 'text'; text: string }> = [];
        if (staleness) {
          const warning = staleness.check(storage.listIndexedFiles());
          if (warning) content.push({ type: 'text', text: `⚠️ ${warning.message}` });
        }
        content.push({ type: 'text', text: payload });

        return { content };
      }

      // Legacy mode: use existing substring matching
      const result = assembler.assembleRanked(graph, query, strategy, tokenBudget);

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
