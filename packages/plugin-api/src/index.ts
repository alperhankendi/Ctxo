export { SYMBOL_KINDS, EDGE_KINDS } from './types.js';
export type {
  SymbolKind,
  EdgeKind,
  SymbolId,
  SymbolNode,
  GraphEdge,
  ComplexityMetrics,
} from './types.js';

export type { ILanguageAdapter } from './adapter.js';
export type { IWorkspace, IPackage } from './workspace.js';
export type {
  CtxoLanguagePlugin,
  PluginContext,
  PluginLogger,
} from './plugin.js';

/** Protocol version supported by this plugin-api release. */
export const SUPPORTED_API_VERSION = '1' as const;
