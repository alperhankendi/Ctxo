import type { SymbolNode, GraphEdge, ComplexityMetrics } from './types.js';

/** Result of re-analyzing a single file via a keep-alive analyzer. */
export interface ReindexResult {
  symbols: SymbolNode[];
  edges: GraphEdge[];
  complexity: ComplexityMetrics[];
}

/**
 * Optional capability a composite adapter MAY expose for fast watch-mode
 * incremental re-index via a long-lived analyzer process. Feature-detected,
 * never required by the core ILanguageAdapter contract (LSP/VS Code pattern).
 */
export interface IIncrementalReindex {
  isReady(): boolean;
  startKeepAlive(): Promise<boolean>;
  reindexFile(relativePath: string): Promise<ReindexResult | null>;
  dispose(): Promise<void>;
}

/** A composite adapter that can supply an incremental-reindex capability. */
export interface IncrementalReindexCapable {
  getIncrementalReindex(): IIncrementalReindex | null;
}
