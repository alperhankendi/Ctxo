/**
 * In-memory BM25 Search Engine (Tier 2)
 *
 * Implements two-phase cascade search:
 *   Phase 1: Exact + tokenized matching with BM25 scoring
 *   Phase 2: Trigram/partial matching (activated when Phase 1 returns < threshold results)
 *   Phase 3: Fuzzy correction (activated when Phase 1+2 return < threshold results)
 *
 * Scoring: BM25 * (1 + pageRankWeight * pageRankScore) * bigramBoost
 */

import type { SymbolNode, SearchResponse, SearchResult, SearchMetrics } from '../types.js';
import { SymbolTokenizer } from './symbol-tokenizer.js';
import { FuzzyCorrector } from './fuzzy-corrector.js';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:search');

/** BM25 parameters tuned for code search (short documents) */
interface BM25Config {
  k1: number; // term frequency saturation (default: 1.2)
  b: number; // length normalization (default: 0.25 — low for short symbol names)
}

interface SearchEngineConfig {
  bm25: BM25Config;
  /** Weight of PageRank boost: finalScore = bm25 * (1 + pageRankWeight * pr) */
  pageRankWeight: number;
  /** Score penalty for Phase 2 (trigram) results */
  trigramPenalty: number;
  /** Threshold: if Phase 1 returns fewer results, activate Phase 2 */
  phase2Threshold: number;
  /** Threshold: if Phase 1+2 return fewer results, activate fuzzy correction */
  fuzzyThreshold: number;
  /** Maximum results per phase */
  maxPerPhase: number;
}

const DEFAULT_CONFIG: SearchEngineConfig = {
  bm25: { k1: 1.2, b: 0.25 },
  pageRankWeight: 0.5,
  trigramPenalty: 0.8,
  phase2Threshold: 3,
  fuzzyThreshold: 3,
  maxPerPhase: 50,
};

/** A document in the inverted index (one per symbol) */
interface IndexedDocument {
  symbolId: string;
  name: string;
  kind: string;
  filePath: string;
  /** Tokenized name (from SymbolTokenizer) */
  tokens: string[];
  /** Token count (document length for BM25) */
  length: number;
}

/** Posting list entry */
interface Posting {
  docIndex: number;
  termFrequency: number;
}

export class SearchEngine {
  private readonly config: SearchEngineConfig;
  private readonly tokenizer: SymbolTokenizer;
  private readonly fuzzy: FuzzyCorrector;

  // Primary index (exact + tokenized)
  private documents: IndexedDocument[] = [];
  private primaryIndex: Map<string, Posting[]> = new Map();
  private avgDocLength = 0;

  // Trigram index (character 3-grams)
  private trigramIndex: Map<string, Posting[]> = new Map();

  // PageRank scores
  private pageRankScores: Map<string, number> = new Map();

  constructor(config?: Partial<SearchEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokenizer = new SymbolTokenizer({ includeOriginal: true, includeFilePath: true });
    this.fuzzy = new FuzzyCorrector();
  }

  getTier(): 'fts5' | 'in-memory' | 'legacy' {
    return 'in-memory';
  }

  buildIndex(symbols: SymbolNode[], pageRankScores?: Map<string, number>): void {
    const start = performance.now();
    this.documents = [];
    this.primaryIndex = new Map();
    this.trigramIndex = new Map();
    this.pageRankScores = pageRankScores ?? new Map();

    let totalLength = 0;
    const vocabFreq = new Map<string, number>();

    for (const sym of symbols) {
      const filePath = sym.symbolId.split('::')[0] ?? '';
      const tokens = this.tokenizer.tokenize(sym.name, filePath);
      const doc: IndexedDocument = {
        symbolId: sym.symbolId,
        name: sym.name,
        kind: sym.kind,
        filePath,
        tokens,
        length: tokens.length,
      };
      const docIndex = this.documents.length;
      this.documents.push(doc);
      totalLength += tokens.length;

      // Build primary inverted index
      const termFreqs = new Map<string, number>();
      for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
        vocabFreq.set(token, (vocabFreq.get(token) ?? 0) + 1);
      }
      for (const [term, tf] of termFreqs) {
        let postings = this.primaryIndex.get(term);
        if (!postings) {
          postings = [];
          this.primaryIndex.set(term, postings);
        }
        postings.push({ docIndex, termFrequency: tf });
      }

      // Build trigram index from symbol name (lowercased)
      const nameLower = sym.name.toLowerCase();
      const trigrams = this.extractTrigrams(nameLower);
      const trigramFreqs = new Map<string, number>();
      for (const tri of trigrams) {
        trigramFreqs.set(tri, (trigramFreqs.get(tri) ?? 0) + 1);
      }
      for (const [tri, tf] of trigramFreqs) {
        let postings = this.trigramIndex.get(tri);
        if (!postings) {
          postings = [];
          this.trigramIndex.set(tri, postings);
        }
        postings.push({ docIndex, termFrequency: tf });
      }
    }

    this.avgDocLength = this.documents.length > 0 ? totalLength / this.documents.length : 1;

    // Build vocabulary for fuzzy corrector
    this.fuzzy.buildVocabulary(vocabFreq);

    const elapsed = performance.now() - start;
    log.info(`Index built: ${symbols.length} symbols, ${this.primaryIndex.size} terms, ${this.trigramIndex.size} trigrams (${elapsed.toFixed(0)}ms)`);
  }

  search(query: string, limit = 50): SearchResponse {
    const start = performance.now();
    const queryTokens = this.tokenizer.tokenizeQuery(query);

    if (queryTokens.length === 0) {
      return this.emptyResponse(query, start);
    }

    const metrics: SearchMetrics = {
      porterHits: 0,
      trigramHits: 0,
      phase2Activated: false,
      fuzzyApplied: false,
      latencyMs: 0,
    };

    // Phase 1: Primary index search (exact + tokenized)
    const phase1Scores = this.bm25Search(queryTokens, this.primaryIndex);
    metrics.porterHits = phase1Scores.size;

    let allScores = phase1Scores;

    // Phase 2: Trigram search (if Phase 1 insufficient)
    if (phase1Scores.size < this.config.phase2Threshold) {
      metrics.phase2Activated = true;
      const queryLower = query.toLowerCase();

      // Skip trigram for very short queries (< 3 chars produces no useful trigrams)
      if (queryLower.length >= 3) {
        const queryTrigrams = this.extractTrigrams(queryLower);
        const phase2Scores = this.bm25Search(queryTrigrams, this.trigramIndex);
        metrics.trigramHits = phase2Scores.size;

        // Merge: union by symbolId, Phase 2 with penalty
        allScores = this.mergeScores(phase1Scores, phase2Scores, this.config.trigramPenalty);
      }
    }

    // Phase 3: Fuzzy correction (if still insufficient)
    let fuzzyCorrection: SearchResponse['fuzzyCorrection'];
    if (allScores.size < this.config.fuzzyThreshold) {
      const correction = this.fuzzy.correct(queryTokens);
      if (correction) {
        metrics.fuzzyApplied = true;
        fuzzyCorrection = correction;
        const correctedTokens = this.tokenizer.tokenizeQuery(correction.correctedQuery);
        const fuzzyScores = this.bm25Search(correctedTokens, this.primaryIndex);

        // Merge fuzzy results (with slight penalty)
        allScores = this.mergeScores(allScores, fuzzyScores, 0.9);

        // Also try trigram on corrected query
        if (allScores.size < this.config.fuzzyThreshold && correction.correctedQuery.length >= 3) {
          const correctedTrigrams = this.extractTrigrams(correction.correctedQuery.toLowerCase());
          const fuzzyTrigramScores = this.bm25Search(correctedTrigrams, this.trigramIndex);
          allScores = this.mergeScores(allScores, fuzzyTrigramScores, this.config.trigramPenalty * 0.9);
        }
      }
    }

    // Snapshot raw BM25 relevance scores before boosts
    const rawRelevance = new Map(allScores);

    // Apply bigram boost for multi-word queries (applies to ALL paths including fuzzy)
    const effectiveQueryTerms = fuzzyCorrection
      ? this.tokenizer.tokenizeQuery(fuzzyCorrection.correctedQuery)
      : queryTokens;

    if (effectiveQueryTerms.length >= 2) {
      for (const [docIdx, score] of allScores) {
        const doc = this.documents[docIdx]!;
        const boost = this.bigramBoost(effectiveQueryTerms, doc.tokens);
        allScores.set(docIdx, score * boost);
      }
    }

    // Apply PageRank boost (applies to ALL paths including fuzzy)
    for (const [docIdx, score] of allScores) {
      const doc = this.documents[docIdx]!;
      const pr = this.pageRankScores.get(doc.symbolId) ?? 0;
      allScores.set(docIdx, score * (1 + this.config.pageRankWeight * pr));
    }

    metrics.latencyMs = performance.now() - start;
    const results = this.buildResults(allScores, rawRelevance, limit);

    const phaseInfo = metrics.phase2Activated ? 'phase2=yes' : 'phase2=no';
    if (fuzzyCorrection) {
      log.info(`search "${query}" → fuzzy "${fuzzyCorrection.correctedQuery}": ${results.length} results (${metrics.latencyMs.toFixed(0)}ms)`);
    } else {
      log.info(`search "${query}": ${results.length} results, porter=${metrics.porterHits} trigram=${metrics.trigramHits} ${phaseInfo} (${metrics.latencyMs.toFixed(0)}ms)`);
    }

    return { query, results, metrics, ...(fuzzyCorrection ? { fuzzyCorrection } : {}) };
  }

  updateFile(filePath: string, symbols: SymbolNode[]): void {
    // Remove old documents for this file
    const oldIndices = new Set<number>();
    for (let i = 0; i < this.documents.length; i++) {
      if (this.documents[i]!.filePath === filePath) {
        oldIndices.add(i);
      }
    }

    if (oldIndices.size === 0 && symbols.length === 0) return;

    // Full rebuild (simpler and correct for incremental updates)
    const allSymbols: SymbolNode[] = [];
    for (let i = 0; i < this.documents.length; i++) {
      if (!oldIndices.has(i)) {
        const doc = this.documents[i]!;
        allSymbols.push({
          symbolId: doc.symbolId,
          name: doc.name,
          kind: doc.kind as SymbolNode['kind'],
          startLine: 0,
          endLine: 0,
        });
      }
    }
    allSymbols.push(...symbols);
    this.buildIndex(allSymbols, this.pageRankScores);
  }

  /**
   * BM25 scoring over an inverted index.
   * Returns Map<docIndex, score>
   */
  private bm25Search(queryTerms: string[], index: Map<string, Posting[]>): Map<number, number> {
    const scores = new Map<number, number>();
    const N = this.documents.length;
    const { k1, b } = this.config.bm25;

    for (const term of queryTerms) {
      const postings = index.get(term);
      if (!postings) continue;

      const df = postings.length; // document frequency
      // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const { docIndex, termFrequency } of postings) {
        const doc = this.documents[docIndex]!;
        const tf = termFrequency;
        const docLen = doc.length;

        // BM25 term score
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLen / this.avgDocLength));
        const termScore = idf * (numerator / denominator);

        scores.set(docIndex, (scores.get(docIndex) ?? 0) + termScore);
      }
    }

    // Boost exact name matches (FR-1.9: 3-5x higher)
    const queryJoined = queryTerms.join('');
    for (const [docIdx, score] of scores) {
      const doc = this.documents[docIdx]!;
      const nameLower = doc.name.toLowerCase();
      if (nameLower === queryJoined || nameLower === queryTerms.join(' ')) {
        scores.set(docIdx, score * 5.0);
      }
    }

    return scores;
  }

  /**
   * Merge two score maps. Phase 2 scores are penalized.
   */
  private mergeScores(
    primary: Map<number, number>,
    secondary: Map<number, number>,
    penalty: number,
  ): Map<number, number> {
    const merged = new Map(primary);
    for (const [docIdx, score] of secondary) {
      const existing = merged.get(docIdx);
      const penalized = score * penalty;
      if (existing !== undefined) {
        merged.set(docIdx, Math.max(existing, penalized));
      } else {
        merged.set(docIdx, penalized);
      }
    }
    return merged;
  }

  /**
   * Bigram boost for multi-word queries.
   * Each adjacent query term pair found adjacent in symbol tokens → 2x boost.
   */
  private bigramBoost(queryTerms: string[], symbolTokens: string[]): number {
    if (queryTerms.length < 2) return 1.0;

    let adjacentPairs = 0;
    for (let i = 0; i < queryTerms.length - 1; i++) {
      const idxA = symbolTokens.findIndex((t) => t.includes(queryTerms[i]!));
      const idxB = symbolTokens.findIndex((t) => t.includes(queryTerms[i + 1]!));
      if (idxA >= 0 && idxB >= 0 && Math.abs(idxA - idxB) === 1) {
        adjacentPairs++;
      }
    }

    return 1 + adjacentPairs * 2.0;
  }

  /**
   * Extract character trigrams from a string.
   * "sqlite" → ["sql", "qli", "lit", "ite"]
   */
  private extractTrigrams(text: string): string[] {
    const trigrams: string[] = [];
    for (let i = 0; i <= text.length - 3; i++) {
      trigrams.push(text.substring(i, i + 3));
    }
    return trigrams;
  }

  private buildResults(
    combinedScores: Map<number, number>,
    rawRelevance: Map<number, number>,
    limit: number,
  ): SearchResult[] {
    const entries = [...combinedScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return entries.map(([docIdx, combined]) => {
      const doc = this.documents[docIdx]!;
      const pr = this.pageRankScores.get(doc.symbolId) ?? 0;
      return {
        symbolId: doc.symbolId,
        name: doc.name,
        kind: doc.kind,
        filePath: doc.filePath,
        relevanceScore: rawRelevance.get(docIdx) ?? 0,
        importanceScore: pr,
        combinedScore: combined,
      };
    });
  }

  private emptyResponse(query: string, start: number): SearchResponse {
    return {
      query,
      results: [],
      metrics: {
        porterHits: 0,
        trigramHits: 0,
        phase2Activated: false,
        fuzzyApplied: false,
        latencyMs: performance.now() - start,
      },
    };
  }
}
