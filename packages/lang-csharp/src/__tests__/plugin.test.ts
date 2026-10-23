import { describe, it, expect } from 'vitest';
import type { IWorkspace, PluginCapabilities, PluginContext } from '@ctxo/plugin-api';
import { plugin } from '../index.js';
import { CSharpCompositeAdapter } from '../composite-adapter.js';

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

describe('csharp plugin', () => {
  it('createAdapter enables SQL call sites only when capabilities.sqlCallSites is true', () => {
    const adapters = [context(), context({ sqlCallSites: false }), context({ sqlCallSites: true })].map(
      (ctx) => plugin.createAdapter(ctx),
    );

    for (const adapter of adapters) expect(adapter).toBeInstanceOf(CSharpCompositeAdapter);
    expect(adapters.map((adapter) => (adapter as CSharpCompositeAdapter).sqlCallSites)).toEqual([false, false, true]);
  });
});
