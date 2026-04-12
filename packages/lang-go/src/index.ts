import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter } from '@ctxo/plugin-api';
import { GoAdapter } from './go-adapter.js';

export { GoAdapter } from './go-adapter.js';
export { TreeSitterAdapter } from './tree-sitter-adapter.js';

const VERSION = '0.7.0-alpha.0';

export const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'go',
  name: 'Go (tree-sitter)',
  version: VERSION,
  extensions: ['.go'],
  tier: 'syntax',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new GoAdapter();
  },
};

export default plugin;
