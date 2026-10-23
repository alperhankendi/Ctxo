import { describe, it, expect, vi } from 'vitest';
import type { CtxoLanguagePlugin, PluginContext } from '@ctxo/plugin-api';

const seen: Array<{ id: string; capabilities: PluginContext['capabilities'] }> = [];

function fake(id: string, extensions: string[]): CtxoLanguagePlugin {
  return {
    apiVersion: '2',
    id,
    name: id,
    version: '0.0.1',
    extensions,
    tier: 'syntax',
    createAdapter: (ctx: PluginContext) => {
      seen.push({ id, capabilities: ctx.capabilities });
      return {
        extractSymbols: async () => [],
        extractEdges: async () => [],
        extractComplexity: async () => [],
        isSupported: () => true,
      };
    },
  };
}

vi.mock('../../adapters/language/plugin-discovery.js', () => ({
  discoverPlugins: async () => ({
    plugins: [
      { plugin: fake('typescript', ['.ts']), specifier: '@ctxo/lang-typescript' },
      { plugin: fake('sql', ['.sql']), specifier: '@ctxo/lang-sql' },
    ],
    failures: [],
  }),
}));

import { loadPlugins } from '../plugin-loader.js';

describe('loadPlugins capabilities', () => {
  it('loadPlugins hands the same capabilities to every createAdapter', async () => {
    seen.length = 0;
    const loaded = await loadPlugins(process.cwd(), { facts: true });
    expect(loaded).toHaveLength(2);
    expect(seen).toHaveLength(2);
    for (const s of seen) expect(s.capabilities).toEqual({ facts: true, sqlCallSites: true });
    expect(seen[0]!.capabilities).toBe(seen[1]!.capabilities);
  });
});
