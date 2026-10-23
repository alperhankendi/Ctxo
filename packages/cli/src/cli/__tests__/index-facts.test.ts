import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CodeFact, ILanguageAdapter } from '@ctxo/plugin-api';
import { extractFileFacts } from '../index-facts.js';

const FACT: CodeFact = { kind: 'endpoint', symbolId: 'src/a.fake::run::function', line: 3, text: 'GET /loans' };

function adapter(extra: Partial<ILanguageAdapter>): ILanguageAdapter {
  return {
    extractSymbols: async () => [],
    extractEdges: async () => [],
    extractComplexity: async () => [],
    isSupported: () => true,
    ...extra,
  };
}

describe('extractFileFacts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns undefined for an adapter without extractFacts or with no facts', async () => {
    expect(await extractFileFacts(adapter({}), 'src/a.fake', 'x')).toBeUndefined();
    expect(await extractFileFacts(adapter({ extractFacts: async () => [] }), 'src/a.fake', 'x')).toBeUndefined();
    expect(await extractFileFacts(adapter({ extractFacts: async () => [FACT] }), 'src/a.fake', 'x')).toEqual([FACT]);
  });

  it('returns undefined and reports a throwing adapter', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await extractFileFacts(
      adapter({ extractFacts: async () => { throw new Error('boom'); } }),
      'src/a.fake',
      'x',
    );
    expect(result).toBeUndefined();
    expect(err).toHaveBeenCalledWith('[ctxo] Fact extraction failed for src/a.fake: boom');
  });
});
