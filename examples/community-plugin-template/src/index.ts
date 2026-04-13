import type { CtxoLanguagePlugin, PluginContext, ILanguageAdapter } from '@ctxo/plugin-api';
import { ExampleAdapter } from './adapter.js';

export { ExampleAdapter } from './adapter.js';

/**
 * Ctxo language plugin default export. The plugin manifest mirrors the
 * CtxoLanguagePlugin contract in @ctxo/plugin-api: apiVersion locks the
 * protocol version you were built against, extensions declares which files
 * ctxo should hand to your adapter, and tier tells ctxo whether you provide
 * full-tier (type-aware) or syntax-tier (structural only) analysis.
 */
const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'example',
  name: 'Example Language',
  version: '0.1.0',
  extensions: ['.example'],
  tier: 'syntax',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new ExampleAdapter();
  },
};

export default plugin;
