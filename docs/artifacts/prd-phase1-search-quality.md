# PRD: Advanced Search & Ranking Engine (Phase 1)

**Author:** Alper Hankendi
**Date:** 2026-04-08
**Status:** Draft
**Epic:** Search Quality Upgrade
**Depends on:** V1.1 (current — all existing tools functional)

***

## 1. Executive Summary

Ctxo's `get_ranked_context` tool promises "BM25 + PageRank search within token budget" but currently implements only **substring matching + PageRank importance scoring**. This means:

* Searching `"change"` does **not** match `getCoChangeMetrics` (no camelCase tokenization)
* Searching `"storag"` returns **zero results** (no stemming, no fuzzy correction)
* Searching `"databse"` returns **zero results** (no typo tolerance)
* Multi-word queries like `"blast radius calculator"` use naive word splitting with no term weighting

The result: AI assistants using `get_ranked_context` fall back to `search_symbols` with regex, or worse, stop using Ctxo search entirely and resort to file-by-file `Read` calls — defeating the purpose of the tool.

**This PRD defines a production-grade search engine** that replaces the current substring matcher with a dual-tokenizer FTS5 pipeline, Reciprocal Rank Fusion (RRF) scoring, proximity-aware reranking, and Levenshtein fuzzy correction. The goal: make `get_ranked_context` the **first and last search call** an AI assistant needs.

***

## 2. Problem Statement

### 2.1 Current State

The `computeTextRelevance` method in `ContextAssembler` (line 202-208) scores symbols as:

```
exact match      → 1.0
substring match  → 0.7
any word match   → 0.4
no match         → 0.0
```

This has five critical limitations:

| # | Limitation                                | Impact                                                               | Example                                                                                                                         |
| - | ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **No camelCase/snake\_case tokenization** | Symbols with compound names are unsearchable by component words      | `"change"` ✗ `getCoChangeMetrics`                                                                                               |
| 2 | **No stemming**                           | Morphological variants miss entirely                                 | `"indexing"` ✗ `IndexCommand`                                                                                                   |
| 3 | **No fuzzy/typo tolerance**               | Single-character typos return zero results                           | `"databse"` ✗ `SessionDatabase`                                                                                                 |
| 4 | **No term frequency weighting**           | All matching words score identically regardless of rarity            | `"get"` (appears 200x) scores same as `"pagerank"` (appears 2x)                                                                 |
| 5 | **No partial/trigram matching**           | Searching for fragments fails unless they appear as exact substrings | `"sql"` ✗ `SqliteStorageAdapter` (only works because "sql" is a substring — but `"sqlit"` also scores 0.7 despite being a typo) |

### 2.2 Documentation-Reality Gap

README.md and CLAUDE.md both describe `get_ranked_context` as using "BM25 + PageRank." The validation runbook acknowledges this discrepancy:

> _"co-change query returns relevanceScore=0 because BM25 tokenization doesn't split camelCase symbol names. Not a bug — design limitation of substring matching."_

This PRD closes the gap between documentation and implementation.

### 2.3 Target State

A 3-layer search pipeline that delivers:

1. **Recall** — find all relevant symbols regardless of naming convention (camelCase, snake\_case, PascalCase)
2. **Precision** — rank results by statistical relevance (BM25) not just presence/absence
3. **Resilience** — handle typos, partial queries, and morphological variants gracefully

***

## 3. Success Criteria

### 3.1 Functional

| Metric                                                          | Current                                    | Target                                                                    |
| --------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| camelCase word search (e.g., `"change"` → `getCoChangeMetrics`) | 0 results                                  | Top 10 results include all symbols containing "change" as a word boundary |
| Stemmed search (e.g., `"indexing"` → `IndexCommand`)            | 0 results                                  | Top 5 results include `IndexCommand`, `IndexManifest`, etc.               |
| Typo tolerance (e.g., `"databse"` → `SessionDatabase`)          | 0 results                                  | Fuzzy correction suggests "database"; results returned                    |
| Multi-word precision (e.g., `"blast radius"`)                   | All "blast" OR "radius" scored 0.4 equally | BM25 weights by term rarity; exact phrase matches score higher            |
| Trigram partial match (e.g., `"stor"` → `IStoragePort`)         | Works (substring)                          | Works + ranked by BM25 relevance, not binary 0.7                          |

### 3.2 Performance

| Metric                       | Target            | Constraint                                  |
| ---------------------------- | ----------------- | ------------------------------------------- |
| Search latency (1K symbols)  | < 50ms p95        | Must not regress existing 500ms tool budget |
| Search latency (10K symbols) | < 200ms p95       | Acceptable for large codebases              |
| Index rebuild with FTS5      | < 5s for 1K files | `ctxo sync` must remain fast                |
| SQLite DB size increase      | < 2x current      | FTS5 tables add overhead                    |
| Memory overhead              | < 50MB additional | FTS5 runs in-process                        |

### 3.3 Quality

| Metric                                    | Target                    |
| ----------------------------------------- | ------------------------- |
| **NDCG\@10** on curated test queries      | ≥ 0.75 (vs current \~0.3) |
| Zero-result rate on valid queries         | < 5% (vs current \~30%)   |
| False positive rate (irrelevant in top 5) | < 20%                     |

***

## 4. Architecture

### 4.1 Search Pipeline Overview — Two-Phase Architecture

> **Design principle:** Simplicity over generality. Most queries hit a single FTS5 table and return in < 10ms. Each subsequent phase only activates when the previous phase returns insufficient results. No parallel fan-out, no rank fusion — just a linear fallback chain.

```
Query (tokenized via Symbol Tokenizer)
  │
  ▼
┌─────────────────────────────────────┐
│  Phase 1: Porter FTS5 Search        │
│  BM25 scored, PageRank boosted      │
│  Bigram boost for multi-word queries│
└────────────┬────────────────────────┘
             │
        results ≥ 3?
        ┌────┴────┐
       YES        NO
        │          │
        │          ▼
        │  ┌─────────────────────────────────┐
        │  │  Phase 2: Trigram FTS5 Search    │
        │  │  BM25 scored, PageRank boosted   │
        │  │  Merge with Phase 1 results      │
        │  └────────────┬────────────────────┘
        │               │
        │          results ≥ 3?
        │          ┌────┴────┐
        │         YES        NO
        │          │          │
        │          │          ▼
        │          │  ┌─────────────────────────────┐
        │          │  │  Phase 3: Fuzzy Correction   │
        │          │  │  Damerau-Levenshtein vs vocab│
        │          │  │  → re-run Phase 1 + 2        │
        │          │  └────────────┬────────────────┘
        │          │               │
        ▼          ▼               ▼
┌─────────────────────────────────────┐
│   Token Budget Packing              │
│   greedy fill within budget         │
└────────────┬────────────────────────┘
             │
             ▼
       Final Results
```

**Why Two-Phase over parallel RRF:**
- **Faster common case:** ~80% of well-formed queries are fully served by Phase 1 alone (single FTS5 query)
- **No score normalization needed:** BM25 scores from Porter and Trigram are on different scales — parallel fusion via RRF discards score magnitude. Two-phase avoids this entirely.
- **Simpler implementation:** No RRF algorithm, no rank merging, no weight tuning. Less code = fewer bugs.
- **Same quality ceiling:** When Phase 2 activates, its results are merged with Phase 1 (union + deduplicate by symbol_id, take best score). The final ranking is equivalent to RRF for the cases that matter (low-recall queries).

### 4.2 Component Design

#### 4.2.1 Symbol Tokenizer (`src/core/search/symbol-tokenizer.ts`)

Responsible for splitting symbol names into searchable tokens:

```
Input: "getCoChangeMetrics"
Output: ["get", "co", "change", "metrics"]

Input: "SqliteStorageAdapter"
Output: ["sqlite", "storage", "adapter"]

Input: "i_storage_port"
Output: ["i", "storage", "port"]

Input: "BM25Scorer"
Output: ["bm", "25", "scorer"]  // or ["bm25", "scorer"]
```

**Rules:**

1. Split on camelCase boundaries (`fooBar` → `["foo", "bar"]`)
2. Split on snake\_case/kebab-case boundaries (`foo_bar` → `["foo", "bar"]`)
3. Split on PascalCase boundaries (`FooBar` → `["foo", "bar"]`)
4. Split on digit boundaries (`BM25Scorer` → `["bm", "25", "scorer"]`)
5. Lowercase all tokens
6. Preserve the **full original name** as an additional token for exact matching
7. Include **file path segments** as contextual tokens (`src/core/search/` → `["src", "core", "search"]`)

#### 4.2.2 FTS5 Dual-Table Schema

Two FTS5 virtual tables, each with a different tokenizer:

**Porter Table** (stemmed, for semantic recall):

```SQL
CREATE VIRTUAL TABLE fts_symbols_porter USING fts5(
  symbol_id UNINDEXED,
  name,
  tokenized_name,
  kind,
  file_path,
  tokenize = 'porter unicode61'
);
```

**Trigram Table** (character n-grams, for partial/fuzzy matching):

```SQL
CREATE VIRTUAL TABLE fts_symbols_trigram USING fts5(
  symbol_id UNINDEXED,
  name,
  tokenized_name,
  kind,
  file_path,
  tokenize = 'trigram'
);
```

**Vocabulary Table** (for fuzzy correction):

```SQL
CREATE TABLE search_vocabulary (
  term TEXT PRIMARY KEY,
  frequency INTEGER NOT NULL DEFAULT 1
);
```

Both FTS5 tables are populated during `ctxo sync` from the same source data (symbols table). The `tokenized_name` column stores the space-separated output of the Symbol Tokenizer.

#### 4.2.3 BM25 Scoring

> **⚠ Code Search ≠ Document Search:** Standard BM25 defaults (k1=1.5, b=0.75) are tuned for natural language documents (articles, web pages). Symbol names are 1-5 tokens — extremely short "documents" where term frequency rarely exceeds 1 and length normalization is counterproductive. Production code search engines (Sourcegraph/Zoekt, GitHub Code Search) use custom scoring with heavy exact-match boosting, not standard BM25 defaults. The parameters below are tuned for code search.

SQLite FTS5's built-in `bm25()` function with **code-search-tuned** parameters:

* **k1 = 1.2** (term frequency saturation — lower than default because symbol names rarely repeat terms)
* **b = 0.25** (document length normalization — low because symbol names are uniformly short; high b penalizes longer names unfairly)
* **Column weights:** `tokenized_name` = 10.0, `name` = 15.0 (boosted for exact match priority), `kind` = 1.0, `file_path` = 2.0

**Exact match priority:** Full symbol name matches (via the `name` column) must score 3-5x higher than partial sub-token matches. This mirrors Sourcegraph/Zoekt behavior where exact symbol matches dominate ranking. The `name` column weight of 15.0 (vs `tokenized_name` at 10.0) ensures that searching `"BlastRadiusCalculator"` ranks the exact symbol above symbols that merely contain "blast" as a sub-token.

Query construction:

```SQL
-- Primary: unicode61 + camelCase split search (no aggressive stemming)
SELECT symbol_id, bm25(fts_symbols_porter, 0, 10.0, 15.0, 1.0, 2.0) AS score
FROM fts_symbols_porter
WHERE fts_symbols_porter MATCH ?
ORDER BY score
LIMIT 50;

-- Fallback (only if primary returns < 3 results): Trigram search
SELECT symbol_id, bm25(fts_symbols_trigram, 0, 10.0, 15.0, 1.0, 2.0) AS score
FROM fts_symbols_trigram
WHERE fts_symbols_trigram MATCH ?
ORDER BY score
LIMIT 50;
```

> **Note on Porter stemming:** Porter stemmer is used cautiously for code search. In natural language, stemming `"indexing"` → `"index"` is always desired. In code, `Validate` and `Validation` may be different symbols in the same file. The primary FTS5 table uses `porter unicode61` for recall, but exact `name` column match is weighted higher to prevent stemming-induced false positives. If stemming proves too aggressive in benchmarks, consider switching to `unicode61` only (case-folding + word-boundary split without stemming).

#### 4.2.4 Result Scoring & PageRank Boost

Each phase produces BM25-scored results. PageRank importance is applied as a **multiplicative boost** on BM25 scores:

```typescript
// Final score for each result
finalScore = bm25Score * (1 + pageRankWeight * pageRankScore);
// Default pageRankWeight = 0.5
// pageRankScore is 0-1 from the existing PageRank computation
```

When Phase 2 (Trigram) activates, its results are **merged** with Phase 1:
- Union by `symbol_id` (deduplicate)
- If a symbol appears in both phases, take the higher score
- Trigram results receive a **0.8x penalty** (they are fuzzier, lower precision)

```typescript
// Phase 2 score penalty
trigramFinalScore = bm25Score * 0.8 * (1 + pageRankWeight * pageRankScore);
```

**Why multiplicative PageRank over separate rank list:**
- Single score dimension — no fusion algorithm needed
- PageRank acts as a "tiebreaker among equals" — two symbols with similar BM25 scores are ordered by structural importance
- Simpler to debug: one score per result, not three rank positions

#### 4.2.5 Bigram Boost (Multi-Word Queries)

For multi-word queries, boost symbols where adjacent query terms appear as adjacent tokens in the symbol name. This is simpler and more effective than span-based proximity scoring.

```typescript
function bigramBoost(queryTerms: string[], symbolTokens: string[]): number {
  if (queryTerms.length < 2) return 1.0;
  
  let adjacentPairs = 0;
  for (let i = 0; i < queryTerms.length - 1; i++) {
    const idxA = symbolTokens.findIndex(t => t.includes(queryTerms[i]));
    const idxB = symbolTokens.findIndex(t => t.includes(queryTerms[i + 1]));
    if (idxA >= 0 && idxB >= 0 && Math.abs(idxA - idxB) === 1) {
      adjacentPairs++;
    }
  }
  
  // Each adjacent pair gives a 2x boost (multiplicative)
  return 1 + adjacentPairs * 2.0;
}
```

**Examples:**
- Query `"blast radius"` → `BlastRadiusCalculator` tokens: `["blast", "radius", "calculator"]` → "blast"+"radius" adjacent → **3x boost**
- Query `"blast radius"` → `RadiusHelper` + `BlastConfig` (no adjacency) → **1x (no boost)**

**Why bigram over span-based proximity:**
- Bigram is a simple boolean per pair — no continuous distance function to tune
- Matches how code symbols are composed: `BlastRadius` is a bigram, not a "span of 2"
- Used by Sourcegraph/Zoekt for phrase matching in symbol names

#### 4.2.6 Fuzzy Correction Layer

When the primary search returns **fewer than 3 results** (not just zero — zero is too late for useful correction), attempt correction:

1. Tokenize the query using the Symbol Tokenizer
2. For each token, compute **Damerau-Levenshtein distance** against the vocabulary table (includes transpositions — "tokne" → "token" is distance 1, not 2)
3. **Adaptive threshold:** distance ≤ 1 for terms ≤ 5 chars, distance ≤ 2 for longer terms (short terms have too many d=2 neighbors → false positives)
4. Select the closest match (lowest distance wins)
5. Re-run the full pipeline with corrected tokens
6. Tag the response with `correctedQuery` field

```TypeScript
interface FuzzyCorrection {
  originalQuery: string;
  correctedQuery: string;
  corrections: Array<{
    original: string;
    corrected: string;
    distance: number;
  }>;
}
```

**Vocabulary construction:** During FTS5 index build, extract all unique tokens from tokenized symbol names and file paths. Store with frequency counts for tie-breaking.

***

## 5. Detailed Requirements

### FR-1: Symbol Tokenizer

| ID      | Requirement                                                                                                                                                             | Priority |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-1.1  | Split camelCase names into constituent words                                                                                                                            | P0       |
| FR-1.2  | Split snake\_case and kebab-case names into constituent words                                                                                                           | P0       |
| FR-1.3  | Split PascalCase names into constituent words                                                                                                                           | P0       |
| FR-1.4  | Handle digit boundaries (e.g., `BM25` → `["bm", "25"]`)                                                                                                                 | P1       |
| FR-1.5  | Preserve original name as a token for exact matching                                                                                                                    | P0       |
| FR-1.6  | Include file path segments as contextual tokens                                                                                                                         | P1       |
| FR-1.7  | Lowercase all output tokens                                                                                                                                             | P0       |
| FR-1.8  | Strip common stop-words (`get`, `set`, `is`, `has`) with configurable list                                                                                              | P1       |
| FR-1.9  | Index both the full original symbol name AND split sub-tokens. Exact full-name match must score 3-5x higher than sub-token matches (mirrors Sourcegraph/Zoekt behavior) | P0       |
| FR-1.10 | Handle short queries (1-2 chars) gracefully — skip trigram search (< 3 chars produces no useful trigrams), use prefix match only                                        | P1       |

### FR-2: FTS5 Dual-Table Index

| ID     | Requirement                                                           | Priority |
| ------ | --------------------------------------------------------------------- | -------- |
| FR-2.1 | Create Porter FTS5 virtual table with `tokenize = 'porter unicode61'` | P0       |
| FR-2.2 | Create Trigram FTS5 virtual table with `tokenize = 'trigram'`         | P0       |
| FR-2.3 | Populate both tables during `ctxo sync` from JSON index               | P0       |
| FR-2.4 | Incremental update on single-file re-index (delete + re-insert)       | P0       |
| FR-2.5 | Store `symbol_id`, `name`, `tokenized_name`, `kind`, `file_path`      | P0       |
| FR-2.6 | Build vocabulary table from all unique tokens with frequency counts   | P0       |
| FR-2.7 | FTS5 tables live in `.ctxo/.cache/` SQLite (gitignored, rebuildable)  | P0       |

### FR-3: BM25 Search

| ID     | Requirement                                                                                                                                                         | Priority |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-3.1 | **Two-phase search:** Query Porter FTS5 first; query Trigram FTS5 only if Porter returns < 3 results. No parallel fan-out. | P0       |
| FR-3.2 | Use `bm25()` with configurable column weights                                                                                                                       | P0       |
| FR-3.3 | Default column weights: tokenized\_name=10, name=15 (exact match priority), kind=1, file\_path=2. BM25 params: k1=1.2, b=0.25 (code-search-tuned, not NLP defaults) | P0       |
| FR-3.4 | Limit raw FTS5 results to 50 per table (configurable)                                                                                                               | P1       |
| FR-3.5 | Tokenize query string through Symbol Tokenizer before FTS5 MATCH                                                                                                    | P0       |
| FR-3.6 | Handle FTS5 query syntax escaping (special characters like `*`, `"`, etc.)                                                                                          | P0       |

### FR-4: Result Scoring & Merging (replaces RRF)

| ID     | Requirement                                                              | Priority |
| ------ | ------------------------------------------------------------------------ | -------- |
| FR-4.1 | Apply PageRank as multiplicative boost on BM25: `bm25 * (1 + 0.5 * pageRank)` | P0       |
| FR-4.2 | Trigram (Phase 2) results receive 0.8x score penalty vs Porter (Phase 1) | P0       |
| FR-4.3 | When Phase 2 activates, merge with Phase 1: union by symbol_id, keep highest score | P0       |
| FR-4.4 | Configurable `pageRankWeight` via `get_ranked_context` parameters | P2       |

### FR-5: Bigram Boost (replaces Proximity Reranking)

| ID     | Requirement                                                           | Priority |
| ------ | --------------------------------------------------------------------- | -------- |
| FR-5.1 | For multi-word queries, check if adjacent query terms appear as adjacent tokens in symbol name | P0       |
| FR-5.2 | Each adjacent bigram match applies a **2x multiplicative boost** (e.g., 2 adjacent pairs = 5x total) | P0       |
| FR-5.3 | Skip bigram boost for single-term queries                          | P0       |

### FR-6: Fuzzy Correction

| ID     | Requirement                                                                                                                                                                   | Priority |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-6.1 | Trigger fuzzy correction when primary search returns **< 3 results** (not just zero — catching low-result queries improves UX)                                                | P0       |
| FR-6.2 | Compute **Damerau-Levenshtein** distance (includes transpositions) for each query token vs vocabulary. Use `fastest-levenshtein` npm package — do not implement from scratch. | P0       |
| FR-6.3 | **Adaptive threshold:** distance ≤ 1 for terms ≤ 5 chars, distance ≤ 2 for terms > 5 chars (prevents false positives on short symbols)                                        | P0       |
| FR-6.4 | Break ties by vocabulary frequency (prefer common terms)                                                                                                                      | P1       |
| FR-6.5 | Re-run full pipeline with corrected query                                                                                                                                     | P0       |
| FR-6.6 | Include `fuzzyCorrection` field in response when correction applied                                                                                                           | P0       |
| FR-6.7 | Maximum 3 correction attempts per query (prevent loops)                                                                                                                       | P1       |

### FR-7: API Changes to `get_ranked_context`

| ID     | Requirement                                                                                  | Priority |
| ------ | -------------------------------------------------------------------------------------------- | -------- |
| FR-7.1 | Add optional `fuzzy: boolean` parameter (default: true)                                      | P1       |
| FR-7.2 | Add optional `searchMode: 'fts' \| 'legacy'` parameter (default: 'fts')                      | P1       |
| FR-7.3 | Include `searchMetrics` in response: `{ porterHits, trigramHits, phase2Activated, fuzzyApplied, latencyMs }` | P1       |
| FR-7.4 | Backward-compatible: existing calls work identically (same parameter names/types)            | P0       |
| FR-7.5 | `strategy` parameter continues to work: 'combined' uses two-phase FTS5 + PageRank, 'importance' uses PageRank only | P0       |

### FR-8: API Changes to `search_symbols`

| ID     | Requirement                                                                            | Priority |
| ------ | -------------------------------------------------------------------------------------- | -------- |
| FR-8.1 | Add optional `mode: 'regex' \| 'fts'` parameter (default: 'regex' for backward compat) | P1       |
| FR-8.2 | When `mode: 'fts'`, use FTS5 pipeline instead of regex matching                        | P1       |
| FR-8.3 | Existing regex behavior unchanged when `mode` omitted or `'regex'`                     | P0       |

***

## 6. Non-Functional Requirements

### NFR-1: Performance

| ID      | Requirement                                                 |
| ------- | ----------------------------------------------------------- |
| NFR-1.1 | FTS5 search < 50ms for codebases with < 5,000 symbols       |
| NFR-1.2 | FTS5 search < 200ms for codebases with < 50,000 symbols     |
| NFR-1.3 | FTS5 index rebuild (full) < 5s for 1,000 files              |
| NFR-1.4 | Incremental FTS5 update (single file) < 100ms               |
| NFR-1.5 | Vocabulary table construction < 2s for 10,000 unique tokens |
| NFR-1.6 | Fuzzy correction lookup < 50ms per query term               |

### NFR-2: Storage

| ID      | Requirement                                                                     |
| ------- | ------------------------------------------------------------------------------- |
| NFR-2.1 | FTS5 tables stored in `.ctxo/.cache/` (gitignored, rebuildable from JSON index) |
| NFR-2.2 | SQLite DB size increase < 2x for FTS5 overhead                                  |
| NFR-2.3 | Vocabulary table < 1MB for typical codebases (< 50K symbols)                    |

### NFR-3: Compatibility

| ID      | Requirement                                                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-3.1 | better-sqlite3 is an **optional dependency** (`optionalDependencies` in package.json). FTS5 features activate only when available.                                                             |
| NFR-3.2 | Three-tier graceful degradation: Tier 1 (better-sqlite3 + FTS5) → Tier 2 (Orama in-memory BM25) → Tier 3 (legacy substring matching). Each tier is self-contained.                             |
| NFR-3.5 | Startup logs active search tier: `[ctxo:search] Search engine: FTS5 (better-sqlite3)` or `[ctxo:search] Search engine: Orama (in-memory)` or `[ctxo:search] Search engine: legacy (substring)` |
| NFR-3.3 | No breaking changes to existing MCP tool schemas                                                                                                                                               |
| NFR-3.4 | Works with both JSON index and SQLite storage paths                                                                                                                                            |

### NFR-4: Observability

| ID      | Requirement                                                                                  |
| ------- | -------------------------------------------------------------------------------------------- |
| NFR-4.1 | Log FTS5 query time to stderr: `[ctxo:search] porter=8ms phase2=no total=8ms` or `[ctxo:search] porter=6ms trigram=12ms phase2=yes total=18ms` |
| NFR-4.2 | Log fuzzy corrections: `[ctxo:search] fuzzy correction: "databse" → "database" (distance=1)` |
| NFR-4.3 | Include search metrics in tool response for LLM introspection                                |

***

## 7. Technical Design Decisions

### D-1: Why FTS5 over in-memory search?

**Decision:** Use SQLite FTS5 virtual tables, not in-memory JavaScript search.

**Rationale:**

* FTS5 is battle-tested, handles tokenization/stemming natively
* Inverted index scales to 50K+ symbols without memory pressure
* Built-in BM25 scoring with column weights
* Trigram tokenizer handles partial matching out of the box
* Ctxo already depends on SQLite — zero new dependencies

**Trade-off:** Requires better-sqlite3 (native module) as optional dependency. See D-5 for graceful degradation strategy.

### D-2: Why dual tokenizer (Porter + Trigram) in two-phase cascade?

**Decision:** Two separate FTS5 virtual tables with different tokenizers, queried **sequentially** (Porter first, Trigram fallback).

**Rationale:**

* **Porter** excels at semantic recall: `"indexing"` → `"index"` (stemmed match)
* **Trigram** excels at partial/fuzzy recall: `"sqlit"` → `"sqlite"` (character overlap)
* Neither alone covers all cases; together they cover the spectrum
* **Two-phase cascade** is simpler than parallel query + fusion: ~80% of queries are served by Porter alone, so Trigram is only queried when needed

**Alternative considered:** Parallel query + RRF fusion. Rejected because: (1) RRF discards BM25 score magnitudes (uses only rank positions), losing useful signal; (2) adds an algorithm (RRF) that needs k-parameter tuning with no labeled data to tune against; (3) doubles query load on every request even when Porter alone has sufficient results.

**Alternative considered:** Single FTS5 table with custom tokenizer. Rejected because custom tokenizers require C extensions, breaking the npm install experience.

### D-3: Why two-phase cascade over RRF?

**Decision:** Sequential Porter → Trigram with threshold (< 3 results triggers Phase 2), not parallel fusion.

**Rationale:**

* **Faster common case:** Single FTS5 query for ~80% of well-formed queries
* **No score normalization problem:** BM25 scores from Porter and Trigram are on different scales — RRF "solves" this by discarding scores entirely, but that loses useful information. Two-phase avoids the problem: Phase 2 scores are penalized by a fixed 0.8x factor.
* **Less code, fewer failure modes:** No RRF algorithm, no weight tuning (k=60 is dataset-dependent — Benham & Culpepper 2017 showed sensitivity to number of rankers), no rank merging logic.
* **Same quality ceiling:** When Phase 2 activates, results are merged (union + best-score dedup). For the low-recall queries where Trigram matters, this produces equivalent ranking to RRF.

**Trade-off:** If a query has moderate Porter results (e.g., 5 mediocre matches) but excellent Trigram matches, the Trigram results are never consulted. Mitigation: tune the Phase 2 threshold (default < 3) based on gold standard benchmark results.

### D-4: Why fuzzy correction as low-result fallback, not always-on?

**Decision:** Fuzzy correction triggers when results < 3 (not zero — zero is too late).

**Rationale:**

* Running Damerau-Levenshtein against the full vocabulary on every query adds 20-50ms latency
* Most queries from AI assistants are well-formed (auto-generated, not human-typed)
* Fuzzy correction is most valuable when the user (or AI) makes a typo — rare but painful
* Avoids false corrections on intentionally precise queries (e.g., `"BM25"` should not "correct" to `"BM250"`)
* Triggering at < 3 results (not just zero) catches "near-miss" queries that would otherwise return unhelpful partial results

**Why Damerau-Levenshtein over plain Levenshtein:** Transpositions ("tokne" → "token", "databse" → "database") account for \~10-15% of typos. Damerau-Levenshtein treats a transposition as distance 1 instead of 2, improving correction accuracy at negligible performance cost.

**Why adaptive threshold (d=1 for short terms, d=2 for long):** A 4-character symbol like `"Node"` has hundreds of d=2 neighbors — high false positive risk. Longer symbols like `"Calculator"` safely tolerate d=2.

**Industry comparison:** Elasticsearch/Algolia run fuzzy always-on with score demotion. For code search with well-formed AI queries, fallback-only is pragmatically correct and simpler.

### D-5: SQLite adapter — better-sqlite3 as optional upgrade (not hard migration)

**Decision:** Use better-sqlite3 as an **optional dependency** for FTS5-powered search. Fall back gracefully when unavailable.

**Rationale:**

* sql.js (WASM) does not support FTS5 with trigram tokenizer out of the box
* better-sqlite3 ships with FTS5 enabled by default, 3-8x faster for writes
* **However:** better-sqlite3 is a native module requiring platform-specific prebuilds. On rare platforms or CI environments without build tools, `npm install` / `npx ctxo` can fail hard. Making it a hard requirement breaks the zero-friction install experience.

**Strategy: Graceful upgrade path**

```TypeScript
// At startup, try to load better-sqlite3
let fts5Available = false;
try {
  const Database = require('better-sqlite3');
  // Verify FTS5: PRAGMA compile_options → check for ENABLE_FTS5
  fts5Available = true;
} catch {
  // Fallback: continue with sql.js, FTS5 features disabled
  log.warn('better-sqlite3 not available — FTS5 search disabled, using substring matching');
}
```

**Degradation tiers:**

| Tier                 | Engine         | Search Quality                                     | Install Requirement                     |
| -------------------- | -------------- | -------------------------------------------------- | --------------------------------------- |
| **Tier 1** (full)    | better-sqlite3 | FTS5 Porter + Trigram + fuzzy                      | Native module (prebuild or build tools) |
| **Tier 2** (partial) | sql.js + Orama | In-memory BM25 search via Orama (pure TS), no FTS5 | Zero native deps                        |
| **Tier 3** (legacy)  | sql.js         | Current substring matching + PageRank              | Zero native deps                        |

**Migration path:**

* `.ctxo/.cache/` is gitignored and rebuildable → no data migration needed
* `ctxo sync` rebuilds the cache from JSON index → just rebuild with new schema
* The ISearchPort interface abstracts the search backend — callers don't know which tier is active
* `package.json`: better-sqlite3 as `optionalDependencies`, not `dependencies`

***

## 8. File Inventory

### New Files

| File                                                 | Purpose                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `src/core/search/symbol-tokenizer.ts`                | camelCase/snake\_case/PascalCase tokenization                        |
| `src/core/search/search-engine.ts`                   | Two-phase FTS5 query builder, PageRank boost, bigram scoring         |
| `src/core/search/fuzzy-corrector.ts`                 | Damerau-Levenshtein correction against vocabulary                    |
| `src/core/search/__tests__/symbol-tokenizer.test.ts` | Tokenizer unit tests                                                 |
| `src/core/search/__tests__/search-engine.test.ts`    | Search pipeline integration tests                                    |
| `src/core/search/__tests__/fuzzy-corrector.test.ts`  | Fuzzy correction tests                                               |
| `src/ports/i-search-port.ts`                         | Search port interface                                                |
| `docs/test-data/search-gold-standard.json`           | 50 curated queries with relevance judgments for NDCG\@10 measurement |

### Modified Files

| File                                             | Change                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/adapters/storage/sqlite-storage-adapter.ts` | Add FTS5 table creation, population, query methods (better-sqlite3 path)                  |
| `src/core/context-assembly/context-assembler.ts` | Replace `computeTextRelevance` with search engine call                                    |
| `src/adapters/mcp/get-ranked-context.ts`         | Accept new parameters (`fuzzy`, `searchMode`), pass to assembler                          |
| `src/adapters/mcp/search-symbols.ts`             | Add `mode: 'fts'` option                                                                  |
| `src/index.ts`                                   | Wire search engine, update tool registrations                                             |
| `package.json`                                   | Add better-sqlite3 as `optionalDependencies`; add `fastest-levenshtein` as `dependencies` |
| `tsup.config.ts`                                 | Add better-sqlite3 to externals                                                           |

***

## 9. Response Format Changes

### `get_ranked_context` Response (Updated)

```JSON
{
  "query": "blast radius",
  "strategy": "combined",
  "results": [
    {
      "symbolId": "src/core/blast-radius/blast-radius-calculator.ts::BlastRadiusCalculator::class",
      "name": "BlastRadiusCalculator",
      "kind": "class",
      "file": "src/core/blast-radius/blast-radius-calculator.ts",
      "relevanceScore": 0.892,
      "importanceScore": 0.234,
      "combinedScore": 0.761,
      "tokens": 180
    }
  ],
  "totalTokens": 2840,
  "tokenBudget": 4000,
  "searchMetrics": {
    "porterHits": 12,
    "trigramHits": 0,
    "phase2Activated": false,
    "fuzzyApplied": false,
    "latencyMs": 8
  }
}
```

### `get_ranked_context` Response with Fuzzy Correction

```JSON
{
  "query": "databse",
  "strategy": "combined",
  "results": [ ... ],
  "totalTokens": 1200,
  "tokenBudget": 4000,
  "fuzzyCorrection": {
    "originalQuery": "databse",
    "correctedQuery": "database",
    "corrections": [
      { "original": "databse", "corrected": "database", "distance": 1 }
    ]
  },
  "searchMetrics": {
    "porterHits": 0,
    "trigramHits": 0,
    "phase2Activated": true,
    "fuzzyApplied": true,
    "latencyMs": 45
  }
}
```

***

## 10. Test Plan

### Unit Tests

| Test Suite       | Scope                                                         | Count (est.) |
| ---------------- | ------------------------------------------------------------- | ------------ |
| Symbol Tokenizer | camelCase, snake\_case, PascalCase, digits, edge cases        | 20+          |
| Bigram Boost     | Single-word (no boost), multi-word adjacent, non-adjacent, mixed | 10+          |
| Fuzzy Corrector  | Damerau-Levenshtein, adaptive threshold, tie-breaking, no-match | 15+          |
| Search Engine    | Two-phase cascade, Phase 2 activation threshold, PageRank boost, result merging | 20+          |

### Integration Tests

| Test                    | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| Porter FTS5 round-trip  | Index 100 symbols → search → verify BM25 ranking                |
| Trigram FTS5 round-trip | Index → partial query → verify trigram matches                  |
| Two-phase cascade       | Porter returns < 3 → Trigram activated → merged results correct |
| Bigram boost            | Multi-word query → verify adjacent-token symbols rank higher    |
| Fuzzy fallback          | Typo query → < 3 results → correction → results returned       |
| Incremental update      | Modify 1 file → verify FTS5 tables updated without full rebuild |
| Tier degradation        | Mock better-sqlite3 failure → verify Tier 2 (Orama) or Tier 3 (substring) activates |
| Gold standard baseline  | Run 50 gold standard queries against current substring → record NDCG@10 |

### Gold Standard Query Set (prerequisite for all quality metrics)

> **⚠ Critical gap:** The PRD targets NDCG\@10 ≥ 0.75 and zero-result rate < 5%, but these metrics require ground truth relevance judgments. Before any tuning or quality measurement, a gold standard query set must be created.

**Step 0 — build the ground truth BEFORE implementation:**

Create `docs/test-data/search-gold-standard.json` with 50 curated queries against Ctxo's own codebase:

```JSON
{
  "queries": [
    {
      "query": "change",
      "category": "camelCase-split",
      "expectedTop5": ["getCoChangeMetrics", "CoChangeEdge", "changeIntelligence"],
      "relevanceJudgments": {
        "getCoChangeMetrics": 3,
        "CoChangeEdge": 3,
        "get_change_intelligence": 2,
        "BlastRadiusCalculator": 0
      }
    },
    {
      "query": "databse",
      "category": "typo",
      "expectedTop5": ["SessionDatabase"],
      "expectedCorrection": "database"
    },
    {
      "query": "blast radius calculator",
      "category": "multi-word-exact",
      "expectedTop5": ["BlastRadiusCalculator"],
      "expectedRank1": "BlastRadiusCalculator"
    }
  ]
}
```

**Query categories (minimum 5 queries each):**

| Category                     | Count | Purpose                                           |
| ---------------------------- | ----- | ------------------------------------------------- |
| camelCase word search        | 8     | `"change"` → `getCoChangeMetrics`                 |
| snake\_case word search      | 5     | `"storage"` → `i_storage_port`                    |
| Exact symbol name            | 5     | `"BlastRadiusCalculator"` → rank 1                |
| Stemmed variant              | 5     | `"indexing"` → `IndexCommand`                     |
| Typo / misspelling           | 5     | `"databse"` → `SessionDatabase`                   |
| Multi-word phrase            | 7     | `"blast radius"` → phrase proximity               |
| Partial / prefix             | 5     | `"stor"` → `IStoragePort`, `SqliteStorageAdapter` |
| Short query (1-2 chars)      | 3     | `"db"`, `"fs"` — edge cases                       |
| High-frequency term          | 4     | `"get"` — stop-word handling                      |
| Negative (no match expected) | 3     | `"xyzzy123"` → zero results, no false correction  |

**Relevance scale:** 0 = irrelevant, 1 = marginally relevant, 2 = relevant, 3 = highly relevant

**Baseline measurement:** Run the gold standard queries against the **current substring matcher** to establish the actual NDCG\@10 baseline (estimated \~0.3, but measure it). This baseline is the "before" for all quality comparisons.

### Benchmark Tests

| Scenario                   | Symbols           | Queries                  | Target                                  |
| -------------------------- | ----------------- | ------------------------ | --------------------------------------- |
| Small codebase             | 500               | 50 mixed queries         | < 30ms avg                              |
| Medium codebase            | 5,000             | 50 mixed queries         | < 50ms avg                              |
| Large codebase             | 50,000            | 50 mixed queries         | < 200ms avg                             |
| Fuzzy correction           | 5,000 + 10K vocab | 20 typo queries          | < 50ms avg                              |
| **Gold standard NDCG\@10** | Ctxo's own index  | 50 gold standard queries | ≥ 0.75 (measure current baseline first) |

***

## 11. Implementation Sequence

### Step 0: Gold Standard Query Set (Day 0 — before any implementation)

* Create `docs/test-data/search-gold-standard.json` with 50 curated queries
* Run against current substring matcher to establish NDCG\@10 baseline
* This is the "before" measurement — all quality improvements are measured against this

### Step 1: Symbol Tokenizer (Day 1-2)

* Implement `SymbolTokenizer` class
* Full test coverage for all naming conventions
* No external dependencies — pure TypeScript

### Step 2: better-sqlite3 Optional Integration (Day 2-3)

* Add better-sqlite3 as `optionalDependencies` in `package.json`
* Implement three-tier detection: better-sqlite3 → Orama fallback → legacy substring
* Add FTS5 virtual table creation (Porter + Trigram) when Tier 1 available
* Add vocabulary table
* Verify `ctxo sync` rebuilds FTS5 from JSON index
* Run existing test suite — ensure no regressions on all tiers

### Step 3: BM25 Search Queries (Day 3-4)

* Add prepared statements for Porter and Trigram FTS5 queries
* Implement query tokenization (Symbol Tokenizer → FTS5 MATCH syntax)
* Handle FTS5 special character escaping
* Test with curated query set

### Step 4: Two-Phase Cascade + Bigram Boost (Day 4-5)

* Implement two-phase search logic: Porter first → Trigram fallback (threshold < 3)
* Implement PageRank multiplicative boost on BM25 scores
* Implement bigram boost for multi-word queries
* Implement Phase 2 merge logic (union + dedup + 0.8x penalty)
* Test cascade behavior with gold standard queries

### Step 5: Fuzzy Correction (Day 5-6)

* Add `fastest-levenshtein` npm dependency
* Build vocabulary lookup with frequency tie-breaking
* Implement adaptive threshold (d≤1 for short terms, d≤2 for long)
* Wire as fallback layer (< 3 results trigger)
* Test correction accuracy

### Step 6: Integration & MCP Tool Updates (Day 6-7)

* Create `ISearchPort` interface
* Wire search engine into `ContextAssembler.assembleRanked()`
* Update `get_ranked_context` handler (new params, search metrics)
* Update `search_symbols` handler (FTS mode)
* End-to-end MCP integration tests

### Step 7: Benchmarks & Tuning (Day 7-8)

* Run benchmark suite across codebase sizes
* Run gold standard queries → measure NDCG@10 improvement over baseline
* Tune BM25 column weights and k1/b parameters
* Tune Phase 2 activation threshold (default < 3)
* Tune fuzzy correction adaptive threshold
* Document final parameter choices

### Step 8: Documentation & Cleanup (Day 8)

* Update CLAUDE.md search tool description
* Remove "BM25" claims from docs that referred to old substring matching
* Add search architecture to docs/artifacts/architecture.md

***

## 12. Risks & Mitigations

| Risk                                                                 | Likelihood | Impact | Mitigation                                                                      |
| -------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------- |
| better-sqlite3 native module build failures on some platforms        | Medium     | High   | Keep sql.js as fallback; FTS5 is an upgrade path, not a hard requirement        |
| FTS5 trigram tokenizer not available in older SQLite builds          | Low        | Medium | Check `PRAGMA compile_options` at startup; fall back to Porter-only             |
| BM25 tuning produces worse results than substring for simple queries | Medium     | Medium | `searchMode: 'legacy'` parameter preserves old behavior; A/B test in benchmarks |
| Levenshtein on large vocabulary (>50K terms) is slow                 | Low        | Low    | Limit vocabulary to top 10K terms by frequency; pre-filter by first character   |
| FTS5 index corruption on unclean shutdown                            | Low        | Low    | `.cache/` is rebuildable; `ctxo sync` reconstructs from JSON index              |

***

## 13. Out of Scope

* **Semantic/embedding search** — requires external model, adds latency and dependency complexity. Consider for V2.
* **Cross-language search** — Ctxo indexes per-language; search operates within the language boundary.
* **Natural language query parsing** — e.g., "find all functions that return a Promise". Requires query intent classification. Consider for V2.
* **Search result caching** — FTS5 is fast enough without a query cache for target codebase sizes.
* **Custom user-defined synonyms** — e.g., "db" → "database". Consider for V2 if user demand exists.

***

## 14. Glossary

| Term                     | Definition                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| **BM25**                 | Best Matching 25 — probabilistic relevance scoring function used in information retrieval |
| **FTS5**                 | Full-Text Search version 5 — SQLite extension for inverted-index text search              |
| **Porter stemmer**       | Algorithm that reduces words to root forms (e.g., "indexing" → "index")                   |
| **Trigram**              | 3-character sliding window tokenizer (e.g., "sqlite" → "sql", "qli", "lit", "ite")        |
| **Two-phase cascade**    | Search architecture where a primary index is queried first; a secondary index activates only when primary returns insufficient results |
| **Bigram boost**         | Scoring bonus applied when adjacent query terms appear as adjacent tokens in a symbol name |
| **Damerau-Levenshtein**  | Edit distance that includes transpositions as a single operation (extends Levenshtein)    |
| **NDCG\@k**              | Normalized Discounted Cumulative Gain — standard metric for ranking quality               |
| **Gold standard**        | Curated set of queries with human-judged relevance scores, used to measure search quality |

