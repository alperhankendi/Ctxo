import { createRequire } from 'node:module';
import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter } from '@ctxo/plugin-api';
import { TsMorphAdapter } from './ts-morph-adapter.js';
import { readFactOptions } from './facts/fact-options.js';

export { TsMorphAdapter } from './ts-morph-adapter.js';

// package.json sits one level above both src/ and dist/, so the same path resolves in dev and when published.
const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

export const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'typescript',
  name: 'TypeScript / JavaScript (ts-morph)',
  version: VERSION,
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  tier: 'full',
  createAdapter(ctx: PluginContext): ILanguageAdapter {
    const facts = ctx.capabilities?.facts === true ? readFactOptions(ctx.config) : undefined;
    return new TsMorphAdapter({
      sqlCallSites: ctx.capabilities?.sqlCallSites === true,
      projectRoot: ctx.projectRoot,
      // Absent on older cores: the adapter then uses its built-in test-file rule.
      ...(ctx.testGlobs ? { testGlobs: ctx.testGlobs } : {}),
      ...(facts ? { facts } : {}),
    });
  },
};

export default plugin;
