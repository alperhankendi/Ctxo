import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IGitPort } from '../../ports/i-git-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { ChurnAnalyzer } from '../../core/change-intelligence/churn-analyzer.js';
import { HealthScorer } from '../../core/change-intelligence/health-scorer.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
});

export function handleGetChangeIntelligence(
  storage: IStoragePort,
  git: IGitPort,
  masking: IMaskingPort,
) {
  const churnAnalyzer = new ChurnAnalyzer();
  const healthScorer = new HealthScorer();

  return async (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId } = parsed.data;

      const symbol = storage.getSymbolById(symbolId);
      if (!symbol) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }

      const filePath = symbolId.split('::')[0]!;

      // Get churn data
      const churnData = await git.getFileChurn(filePath);

      // Get max churn across all indexed files for normalization
      const allFiles = storage.listIndexedFiles();
      let maxChurn = 1;
      for (const file of allFiles) {
        const fileChurn = await git.getFileChurn(file);
        if (fileChurn.commitCount > maxChurn) {
          maxChurn = fileChurn.commitCount;
        }
      }

      const normalizedChurn = churnAnalyzer.normalize(churnData.commitCount, maxChurn);

      // Use line count as a rough proxy for complexity (normalized 0-1)
      const lineCount = symbol.endLine - symbol.startLine + 1;
      const normalizedComplexity = Math.min(lineCount / 100, 1);

      const score = healthScorer.score(symbolId, normalizedComplexity, normalizedChurn);

      const payload = masking.mask(JSON.stringify(score));

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
