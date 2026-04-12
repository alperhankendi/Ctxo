import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter } from '@ctxo/plugin-api';
import { TsMorphAdapter } from './ts-morph-adapter.js';

export { TsMorphAdapter } from './ts-morph-adapter.js';

const VERSION = '0.7.0-alpha.0';

export const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'typescript',
  name: 'TypeScript / JavaScript (ts-morph)',
  version: VERSION,
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  tier: 'full',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new TsMorphAdapter();
  },
};

export default plugin;
