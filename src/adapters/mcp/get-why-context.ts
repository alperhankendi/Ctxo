import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IGitPort } from '../../ports/i-git-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { RevertDetector } from '../../core/why-context/revert-detector.js';
import { JsonIndexReader } from '../storage/json-index-reader.js';
import type { CommitIntent, AntiPattern } from '../../core/types.js';
import type { StalenessCheck } from './get-logic-slice.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
});

export function handleGetWhyContext(
  storage: IStoragePort,
  git: IGitPort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const revertDetector = new RevertDetector();
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

      // Try committed index first (FR16: anti-patterns persist in committed index)
      const indices = indexReader.readAll();
      const fileIndex = indices.find((i) => i.file === filePath);

      let commitHistory: CommitIntent[];
      let antiPatterns: AntiPattern[];

      if (fileIndex && fileIndex.intent.length > 0) {
        commitHistory = fileIndex.intent;
        antiPatterns = fileIndex.antiPatterns;
      } else {
        // Fallback: compute on-demand from git
        const commits = await git.getCommitHistory(filePath);
        commitHistory = commits.map((c) => ({
          hash: c.hash,
          message: c.message,
          date: c.date,
          kind: 'commit' as const,
        }));
        antiPatterns = revertDetector.detect(commits);
      }

      // Assemble result — separation of concerns: no changeIntelligence here
      // Use get_change_intelligence tool for complexity/churn scoring
      const responsePayload: Record<string, unknown> = {
        commitHistory,
        antiPatternWarnings: antiPatterns,
      };

      if (antiPatterns.length > 0) {
        responsePayload.warningBadge = '⚠ Anti-pattern detected';
      }

      const payload = masking.mask(JSON.stringify(responsePayload));

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
