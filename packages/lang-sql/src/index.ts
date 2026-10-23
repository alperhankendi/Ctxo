import { createRequire } from 'node:module';
import type { CtxoLanguagePlugin, ILanguageAdapter, PluginContext } from '@ctxo/plugin-api';
import { SqlAdapter } from './sql-adapter.js';

export { SqlAdapter } from './sql-adapter.js';

// package.json sits one level above both src/ and dist/, so the same path resolves in dev and when published.
const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

export const plugin: CtxoLanguagePlugin = {
  apiVersion: '2',
  id: 'sql',
  name: 'SQL (T-SQL definitions and data access)',
  version: VERSION,
  extensions: ['.sql'],
  tier: 'syntax',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new SqlAdapter();
  },
};

export default plugin;
