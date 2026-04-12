import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter } from '@ctxo/plugin-api';
import { CSharpCompositeAdapter } from './composite-adapter.js';

export { CSharpCompositeAdapter } from './composite-adapter.js';
export { CSharpAdapter } from './csharp-adapter.js';
export { RoslynAdapter } from './roslyn/roslyn-adapter.js';
export { TreeSitterAdapter } from './tree-sitter-adapter.js';

const VERSION = '0.7.0-alpha.0';

export const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'csharp',
  name: 'C# (Roslyn full tier, tree-sitter fallback)',
  version: VERSION,
  extensions: ['.cs'],
  // Plugin advertises full-tier capability; the composite adapter downgrades to
  // syntax at runtime when .NET SDK 8+ is unavailable.
  tier: 'full',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new CSharpCompositeAdapter();
  },
};

export default plugin;
