import { z } from 'zod';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IGitPort } from '../../ports/i-git-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import { RevertDetector } from '../../core/why-context/revert-detector.js';
import { WhyContextAssembler } from '../../core/why-context/why-context-assembler.js';
import type { CommitIntent } from '../../core/types.js';

const InputSchema = z.object({
  symbolId: z.string().min(1),
});

export function handleGetWhyContext(
  storage: IStoragePort,
  git: IGitPort,
  masking: IMaskingPort,
) {
  const revertDetector = new RevertDetector();
  const assembler = new WhyContextAssembler();

  return async (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { symbolId } = parsed.data;

      // Find which file this symbol belongs to
      const symbol = storage.getSymbolById(symbolId);
      if (!symbol) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ found: false, hint: 'Symbol not found. Run "ctxo index" to build the codebase index.' }) }],
        };
      }

      const filePath = symbolId.split('::')[0]!;

      // Get commit history
      const commits = await git.getCommitHistory(filePath);

      // Convert to CommitIntent format
      const commitHistory: CommitIntent[] = commits.map((c) => ({
        hash: c.hash,
        message: c.message,
        date: c.date,
        kind: 'commit' as const,
      }));

      // Detect anti-patterns
      const antiPatterns = revertDetector.detect(commits);

      // Assemble result
      const result = assembler.assemble(commitHistory, antiPatterns);

      // Apply masking
      const payload = masking.mask(JSON.stringify(result));

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
