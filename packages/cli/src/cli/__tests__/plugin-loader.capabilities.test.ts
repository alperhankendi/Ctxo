import { describe, it, expect, vi } from 'vitest';
import type { CtxoLanguagePlugin, PluginContext } from '@ctxo/plugin-api';

const seen: Array<{
  id: string;
  capabilities: PluginContext['capabilities'];
  config: PluginContext['config'];
  testGlobs: PluginContext['testGlobs'];
}> = [];

function fake(id: string, extensions: string[]): CtxoLanguagePlugin {
  return {
    apiVersion: '2',
    id,
    name: id,
    version: '0.0.1',
    extensions,
    tier: 'syntax',
    createAdapter: (ctx: PluginContext) => {
      seen.push({ id, capabilities: ctx.capabilities, config: ctx.config, testGlobs: ctx.testGlobs });
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
import type { FactDetectorOptions } from '../../ports/i-ctxo-module.js';
import { DEFAULT_TEST_GLOBS } from '../../core/test-files/test-file-classifier.js';

const O: FactDetectorOptions = { trivialLiterals: [0, ''], normalizationMethods: ['trim'] };

describe('loadPlugins capabilities', () => {
  it('loadPlugins hands the same capabilities to every createAdapter', async () => {
    seen.length = 0;
    const loaded = await loadPlugins(process.cwd(), { facts: true });
    expect(loaded).toHaveLength(2);
    expect(seen).toHaveLength(2);
    for (const s of seen) expect(s.capabilities).toEqual({ facts: true, sqlCallSites: true });
    expect(seen[0]!.capabilities).toBe(seen[1]!.capabilities);
  });

  it('loadPlugins hands config.facts to every plugin only with a fact request and options', async () => {
    seen.length = 0;
    await loadPlugins(process.cwd(), { facts: true, factOptions: O });
    expect(seen.map((s) => s.config)).toEqual([{ facts: O }, { facts: O }]);

    for (const options of [{ facts: false, factOptions: O }, { facts: true }]) {
      seen.length = 0;
      await loadPlugins(process.cwd(), options);
      expect(seen.map((s) => s.config)).toEqual([{}, {}]);
    }
  });

  it('loadPlugins hands every plugin the default test globs followed by index.tests, as one frozen array', async () => {
    seen.length = 0;
    await loadPlugins(process.cwd(), { testGlobs: ['spec/**/*.check.ts', '**/__tests__/**'] });
    expect(seen).toHaveLength(2);
    // Defaults first, then the extra globs in config order; a glob the defaults already hold appears once.
    expect(seen[0]!.testGlobs).toEqual([...DEFAULT_TEST_GLOBS, 'spec/**/*.check.ts']);
    expect(seen[1]!.testGlobs).toBe(seen[0]!.testGlobs);
    expect(Object.isFrozen(seen[0]!.testGlobs)).toBe(true);
  });

  it('loadPlugins hands the default test globs alone when index.tests is empty or unset', async () => {
    for (const options of [{}, { testGlobs: [] }]) {
      seen.length = 0;
      await loadPlugins(process.cwd(), options);
      for (const s of seen) expect(s.testGlobs).toEqual([...DEFAULT_TEST_GLOBS]);
    }
  });
});
