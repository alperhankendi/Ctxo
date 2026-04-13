import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IGitPort } from '../../ports/i-git-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { ChurnAnalyzer } from '../../core/change-intelligence/churn-analyzer.js';
import { JsonIndexReader } from '../storage/json-index-reader.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { HealthScorer } from '../../core/change-intelligence/health-scorer.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
});

export function handleGetChangeIntelligence(
  storage: IStoragePort,
  git: IGitPort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const churnAnalyzer = new ChurnAnalyzer();
  const healthScorer = new HealthScorer();
  const indexReader = new JsonIndexReader(ctxoRoot);

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

      // Read cyclomatic complexity from committed index
      const indices = indexReader.readAll();
      const fileIndex = indices.find((i) => i.file === filePath);
      const complexityEntries = fileIndex?.complexity ?? [];

      // Storage knows the symbol but its JSON index is missing on disk — SQLite and
      // `.ctxo/index/` have drifted. Surface it so the caller does not mistake the
      // fallback `complexity: 0` score for a real "low risk" verdict.
      const indexMissingWarning = !fileIndex
        ? `JSON index for ${filePath} not found on disk — complexity falls back to 0. Run "ctxo index" to resync.`
        : undefined;

      // Exact match first, then aggregate (max of methods for class-level queries)
      let cyclomatic = complexityEntries.find((c) => c.symbolId === symbolId)?.cyclomatic;
      if (cyclomatic === undefined) {
        // For class/file: use max complexity of all methods in this file
        const symbolName = symbolId.split('::')[1] ?? '';
        const relatedEntries = complexityEntries.filter((c) =>
          c.symbolId.startsWith(`${filePath}::${symbolName}.`),
        );
        cyclomatic = relatedEntries.length > 0
          ? Math.max(...relatedEntries.map((c) => c.cyclomatic))
          : 1;
      }
      // Normalize: cyclomatic 1=0, 10+=1.0
      const normalizedComplexity = Math.min((cyclomatic - 1) / 9, 1);

      const score = healthScorer.score(symbolId, normalizedComplexity, normalizedChurn);

      const payload = masking.mask(JSON.stringify(score));

      const content: Array<{ type: 'text'; text: string }> = [];
      if (staleness) {
        const warning = staleness.check(storage.listIndexedFiles());
        if (warning) content.push({ type: 'text', text: `⚠️ ${warning.message}` });
      }
      if (indexMissingWarning) {
        content.push({ type: 'text', text: `⚠️ ${indexMissingWarning}` });
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
