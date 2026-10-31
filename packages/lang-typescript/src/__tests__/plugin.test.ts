import { describe, it, expect } from 'vitest';
import type { IWorkspace, PluginCapabilities, PluginContext } from '@ctxo/plugin-api';
import defaultPlugin, { plugin } from '../index.js';
import { TsMorphAdapter } from '../ts-morph-adapter.js';
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';

function context(capabilities?: PluginCapabilities): PluginContext {
  const noop = (): void => {};
  return {
    logger: { debug: noop, info: noop, warn: noop, error: noop },
    projectRoot: '/work/lending',
    workspace: {} as IWorkspace,
    config: {},
    ...(capabilities ? { capabilities } : {}),
  };
}

describe('typescript plugin', () => {
  it('createAdapter enables SQL call sites only when capabilities.sqlCallSites is true', () => {
    const adapters = [context(), context({ sqlCallSites: false }), context({ sqlCallSites: true })].map((ctx) =>
      plugin.createAdapter(ctx),
    );

    for (const adapter of adapters) expect(adapter).toBeInstanceOf(TsMorphAdapter);
    expect(adapters.map((adapter) => (adapter as TsMorphAdapter).sqlCallSites)).toEqual([false, false, true]);
  });

  it('createAdapter passes ctx.projectRoot to the adapter, so incremental runs resolve like full runs', () => {
    const adapter = plugin.createAdapter(context({ sqlCallSites: true })) as unknown as { projectRoot: string | undefined };

    expect(adapter.projectRoot).toBe('/work/lending');
  });

  it('createAdapter enables facts only with capabilities.facts and reads config.facts', () => {
    const facts = (ctx: PluginContext) => (plugin.createAdapter(ctx) as TsMorphAdapter).facts;
    const withConfig = (capabilities: PluginCapabilities | undefined, config: Record<string, unknown>): PluginContext => ({
      ...context(capabilities),
      config,
    });

    expect(facts(context())).toBeUndefined();
    expect(facts(context({ facts: false }))).toBeUndefined();
    expect(facts(withConfig({ facts: false }, { facts: { trivialLiterals: [5] } }))).toBeUndefined();
    expect(facts(context({ facts: true }))).toEqual(DEFAULT_FACT_OPTIONS);
    expect(facts(withConfig({ facts: true }, { facts: { trivialLiterals: [5], normalizationMethods: ['trim'] } }))).toEqual({
      trivialLiterals: [5],
      normalizationMethods: ['trim'],
    });
    expect(facts(withConfig({ facts: true, sqlCallSites: true }, { facts: { trivialLiterals: 'x' } }))).toEqual(DEFAULT_FACT_OPTIONS);
    expect((plugin.createAdapter(context({ facts: true, sqlCallSites: true })) as TsMorphAdapter).sqlCallSites).toBe(true);
  });

  it('createAdapter honours ctx.testGlobs and falls back to the default test-file rule without them', async () => {
    const source = "describe('LoanPolicy', () => { it('LEND-03 at most five loans', () => {}); });\n";
    const file = 'spec/loans/policy.check.ts';
    const testNames = async (ctx: PluginContext): Promise<string[]> =>
      (await plugin.createAdapter(ctx).extractSymbols(file, source))
        .filter((symbol) => symbol.annotations?.some((annotation) => annotation.name === 'test') === true)
        .map((symbol) => symbol.name);

    // An older core sends no testGlobs: the defaults decide, and spec/**/*.check.ts is not a test file.
    expect(await testNames(context())).toEqual([]);
    // A current core sends its defaults plus index.tests.
    expect(await testNames({ ...context(), testGlobs: ['**/__tests__/**', 'spec/**/*.check.ts'] })).toEqual([
      'LoanPolicy',
      'LoanPolicy > LEND-03 at most five loans',
    ]);
  });

  it('the plugin keeps apiVersion 1', () => {
    expect(plugin.apiVersion).toBe('1');
    expect(plugin.id).toBe('typescript');
    expect(plugin.tier).toBe('full');
    expect(defaultPlugin).toBe(plugin);
  });
});
