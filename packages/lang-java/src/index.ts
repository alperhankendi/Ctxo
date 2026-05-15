import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter } from '@ctxo/plugin-api';
import { JavaAdapter } from './java-adapter.js';

export { JavaAdapter } from './java-adapter.js';
export { TreeSitterAdapter } from './tree-sitter-adapter.js';

const VERSION = '0.8.0';

export const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'java',
  name: 'Java (tree-sitter)',
  version: VERSION,
  extensions: ['.java'],
  tier: 'syntax',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new JavaAdapter();
  },
};

export default plugin;
