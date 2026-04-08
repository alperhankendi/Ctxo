import type { SymbolNode } from '../core/types.js';

export interface SearchResult {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  /** BM25 relevance score (higher = more relevant) */
  relevanceScore: number;
  /** PageRank importance score (0-1) */
  importanceScore: number;
  /** Final combined score after all boosts */
  combinedScore: number;
}

export interface SearchMetrics {
  porterHits: number;
  trigramHits: number;
  phase2Activated: boolean;
  fuzzyApplied: boolean;
  latencyMs: number;
}

export interface FuzzyCorrection {
  originalQuery: string;
  correctedQuery: string;
  corrections: Array<{
    original: string;
    corrected: string;
    distance: number;
  }>;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  metrics: SearchMetrics;
  fuzzyCorrection?: FuzzyCorrection;
}

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
