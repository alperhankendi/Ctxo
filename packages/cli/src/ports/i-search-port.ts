import type { SymbolNode, SearchResponse } from '../core/types.js';

export type {
  SearchResult,
  SearchMetrics,
  FuzzyCorrection,
  SearchResponse,
} from '../core/types.js';

export interface ISearchPort {
  /**
   * Build the search index from symbols.
   * Call after index rebuild or incremental update.
   */
  buildIndex(symbols: SymbolNode[], pageRankScores?: Map<string, number>): void;

  /**
   * Search for symbols matching the query.
   * Implements two-phase cascade: primary → trigram fallback → fuzzy correction.
   */
  search(query: string, limit?: number): SearchResponse;

  /**
   * Update index for a single file (incremental).
   * Removes old symbols for the file and adds new ones.
   */
  updateFile(filePath: string, symbols: SymbolNode[]): void;

  /**
   * Get the active search tier name for observability.
   */
  getTier(): 'fts5' | 'in-memory' | 'legacy';
}
