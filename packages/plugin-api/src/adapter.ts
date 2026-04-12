import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from './types.js';

/**
 * Language adapter contract. A plugin's `createAdapter` factory returns an
 * object implementing this interface. Extraction is async to allow heavy
 * analyzers (ts-morph, Roslyn launcher) to run off the main thread.
 */
export interface ILanguageAdapter {
  /** Extract symbol nodes from a single source file. */
  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]>;

  /** Extract graph edges (imports/calls/extends/implements/uses) from a file. */
  extractEdges(filePath: string, source: string): Promise<GraphEdge[]>;

  /** Compute per-symbol cyclomatic complexity for a file. */
  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]>;

  /**
   * True if this adapter should handle the given file path. Implementations
   * typically check extension against the plugin's declared `extensions`.
   */
  isSupported(filePath: string): boolean;

  /**
   * Cross-file symbol registry populated during pass 1. Allows pass 2 edge
   * extraction to resolve call/import targets to their owning files.
   */
  setSymbolRegistry?(registry: Map<string, SymbolKind>): void;

  /** Called once before the first extract*() call of an indexing session. */
  initialize?(rootDir: string): Promise<void>;

  /** Called once after the last extract*() call of an indexing session. */
  dispose?(): Promise<void>;
}
