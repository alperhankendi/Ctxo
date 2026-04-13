import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter } from '@ctxo/plugin-api';
import { GoCompositeAdapter } from './composite-adapter.js';

export { GoAdapter } from './go-adapter.js';
export { GoAnalyzerAdapter } from './analyzer/analyzer-adapter.js';
export { GoCompositeAdapter } from './composite-adapter.js';
export { TreeSitterAdapter } from './tree-sitter-adapter.js';

const VERSION = '0.8.0-alpha.0';

export const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'go',
  name: 'Go (ctxo-go-analyzer + tree-sitter)',
  version: VERSION,
  extensions: ['.go'],
  tier: 'full',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new GoCompositeAdapter();
  },
};

export default plugin;
