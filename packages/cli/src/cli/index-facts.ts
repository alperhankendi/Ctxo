import type { CodeFact, ILanguageAdapter } from '@ctxo/plugin-api';

/**
 * The facts one adapter extracts from one file. `undefined` when the adapter has no `extractFacts`, when it
 * finds nothing, or when it throws (the failure is reported and indexing carries on without facts).
 */
export async function extractFileFacts(
  adapter: ILanguageAdapter,
  relativePath: string,
  source: string,
): Promise<CodeFact[] | undefined> {
  if (typeof adapter.extractFacts !== 'function') return undefined;
  try {
    const facts = await adapter.extractFacts(relativePath, source);
    return facts.length > 0 ? facts : undefined;
  } catch (err) {
    console.error(`[ctxo] Fact extraction failed for ${relativePath}: ${(err as Error).message}`);
    return undefined;
  }
}
