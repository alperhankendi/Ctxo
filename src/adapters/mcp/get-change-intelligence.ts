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
      const normalizePath = (p: string) => p.replace(/\\/g, '/');

      // Get churn data for all files in parallel
      const allFiles = storage.listIndexedFiles();
      const churnResults = await Promise.all(allFiles.map((f) => git.getFileChurn(f)));

      const maxChurn = Math.max(1, ...churnResults.map((c) => c.commitCount));
      const targetChurn = churnResults.find((c) => normalizePath(c.filePath) === normalizePath(filePath));
      const commitCount = targetChurn?.commitCount ?? 0;

      const normalizedChurn = churnAnalyzer.normalize(commitCount, maxChurn);

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
