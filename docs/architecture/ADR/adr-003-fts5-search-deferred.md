# ADR-003: FTS5 Search Engine Deferred (Hold)

| Field        | Value          |
| ------------ | -------------- |
| **Status**   | Hold           |
| **Date**     | 2026-04-11     |
| **Deciders** | Alper Hankendi |
| **PRD**      | [prd-phase1-search-quality.md](../../artifacts/prd-phase1-search-quality.md) |

## Context

Phase 1 PRD defined a dual-tokenizer FTS5 search pipeline (Porter + Trigram virtual tables in SQLite) with Reciprocal Rank Fusion, proximity reranking, and Levenshtein fuzzy correction. The goal was to replace the original substring matcher in `get_ranked_context` with a production-grade search engine.

During implementation (commit `75de5e1`), we delivered an **in-memory BM25 search engine (Tier 2)** that fulfills the core search quality requirements without FTS5:

### What Was Delivered (Tier 2 — In-Memory)

| PRD Requirement | Implementation |
|----------------|----------------|
| SymbolTokenizer (camelCase, snake_case, PascalCase, digits) | Fully implemented — `src/core/search/symbol-tokenizer.ts` |
| BM25 scoring with tuned parameters (k1=1.2, b=0.25) | Custom in-memory BM25 — `src/core/search/search-engine.ts` |
| Trigram fallback search | In-memory trigram index with cascade activation (Phase 2 when primary < 3 results) |
| Fuzzy correction | Damerau-Levenshtein with adaptive threshold — `src/core/search/fuzzy-corrector.ts` |
| Multi-word proximity boost | Bigram adjacency boost (simpler alternative to span-based proximity) |
| PageRank multiplicative boost | `finalScore = bm25 * (1 + 0.5 * pageRankScore)` |
| `searchMode: 'legacy'` backward compat | Preserved in `get-ranked-context.ts` |
| `mode: 'fts'` in `search_symbols` | Implemented |
| ISearchPort interface | Defined with `getTier()` returning `'fts5' \| 'in-memory' \| 'legacy'` |
| Test coverage | 91 tests, 99.6% coverage, 50-query gold standard benchmark |

### What Was NOT Delivered (Tier 3 — FTS5)

| PRD Requirement | Reason Deferred |
|----------------|-----------------|
| Porter FTS5 virtual table (`tokenize = 'porter unicode61'`) | Requires better-sqlite3 (sql.js has no FTS5 support) |
| Trigram FTS5 virtual table (`tokenize = 'trigram'`) | Same — requires better-sqlite3 |
| Persisted vocabulary table in SQLite | Currently in-memory `Map<string, number>` — rebuilt on every server start |
| Reciprocal Rank Fusion (RRF) | Replaced with simpler `max(primary, penalized)` merge — sufficient for current scale |
| Porter stemming (`"indexing"` → `"index"`) | FTS5 Porter tokenizer handles this natively; no in-memory equivalent implemented |
| Persisted search index in `.ctxo/.cache/` | Index rebuilt in-memory on each MCP server startup |
| sql.js → better-sqlite3 migration | Core blocker — see rationale below |

## Decision

**Hold.** The FTS5 implementation is deferred until monorepo support or large-codebase demand materializes. The in-memory Tier 2 engine remains the active search implementation.

## Rationale

### 1. sql.js → better-sqlite3 is a high-risk migration

The entire `.ctxo/.cache/` storage layer uses sql.js (WASM SQLite). Migrating to better-sqlite3 (native C++ addon) introduces:

- **Native compilation dependency** — `npm install` triggers `node-gyp` build on every platform. Known failure modes on Windows (missing Visual Studio build tools), Alpine Linux (musl libc), ARM (Raspberry Pi, M-series without Rosetta), and CI containers without build essentials.
- **Binary distribution complexity** — Prebuilt binaries exist via `prebuild-install` but don't cover all platform/arch combinations. Fallback to source compilation breaks the "zero-config npm install" DX that Ctxo targets.
- **Breaking change for existing users** — Anyone running `npx ctxo-mcp` would need native build toolchain. This is acceptable for a dev tool but raises the install friction significantly.

### 2. In-memory engine meets current scale requirements

| Codebase Size | Symbols | Index Build | Search Latency | Verdict |
|--------------|---------|-------------|----------------|---------|
| Small (< 500 files) | < 2K | < 100ms | < 10ms | No issue |
| Medium (500-2K files) | 2K-10K | 100-500ms | 10-50ms | No issue |
| Large (2K-5K files) | 10K-25K | 500ms-1s | 50-100ms | Acceptable |
| Monorepo (5K+ files) | 25K-100K | 1-5s | 100-500ms | **FTS5 needed** |

Ctxo's current user profile is single-repo TypeScript/Go/C# projects. The 10K symbol threshold where in-memory starts to strain is well above typical usage.

### 3. Search quality is already validated

The 50-query gold standard benchmark (commit `75de5e1`) demonstrates:

- camelCase queries (`"change"` → `getCoChangeMetrics`) — working
- Partial queries (`"stor"` → `SqliteStorageAdapter`) — working via trigram cascade
- Typo queries (`"databse"` → `database`) — working via Damerau-Levenshtein
- Multi-word queries (`"blast radius"`) — working via bigram boost
- PageRank tiebreaking — working

The missing Porter stemming (`"indexing"` ✗ `IndexCommand`) is a minor gap that affects morphological variants only.

### 4. ISearchPort interface is ready for FTS5

The port interface already defines `getTier(): 'fts5' | 'in-memory' | 'legacy'`, making FTS5 a drop-in adapter replacement when the time comes. No core or MCP handler changes needed.

## Trigger Conditions for Reactivation

This ADR should be revisited when ANY of the following occur:

1. **Monorepo support requested** — a user or team needs to index 5K+ files / 25K+ symbols across multiple packages
2. **Startup latency complaints** — MCP server cold start takes >2s due to in-memory index rebuild (currently ~500ms for medium codebases)
3. **Porter stemming demand** — users report that morphological variants (`"indexing"` vs `"index"`, `"validators"` vs `"validate"`) are causing missed search results
4. **better-sqlite3 becomes easier** — prebuilt binaries cover all target platforms reliably, or Node.js ships native SQLite support (proposal exists)

## Implementation Plan (When Reactivated)

The original PRD ([prd-phase1-search-quality.md](../../artifacts/prd-phase1-search-quality.md)) remains the specification. Key steps:

### Step 1: better-sqlite3 Migration (3-5 days)
- Replace sql.js with better-sqlite3 in `SqliteStorageAdapter`
- Ensure `.ctxo/.cache/` database uses WAL mode
- Add FTS5 availability check at startup (`PRAGMA compile_options` → look for `ENABLE_FTS5`)
- Fallback to in-memory engine if FTS5 unavailable
- CI matrix: test on Windows, macOS, Ubuntu, Alpine, ARM64

### Step 2: FTS5 Dual Tables (2-3 days)
- Create `fts_symbols_porter` (Porter stemmed) and `fts_symbols_trigram` (character trigrams)
- Populate during `ctxo sync` from JSON index
- Add incremental update (delete + re-insert per file)
- Prepared statements with column weights: `tokenized_name=10, name=15, kind=1, file_path=2`

### Step 3: RRF Fusion (1 day)
- Replace current `mergeScores(max)` with proper Reciprocal Rank Fusion
- `score += weight * (1 / (k + rank))` per result list (k=60)
- Weights: porter=1.0, trigram=0.8, pagerank=0.5

### Step 4: Persisted Vocabulary (0.5 day)
- Move `FuzzyCorrector` vocabulary from in-memory `Map` to `search_vocabulary` SQLite table
- Populate during `ctxo sync`, query during search

### Step 5: Tier Selection (0.5 day)
- `ISearchPort.getTier()` returns `'fts5'` when better-sqlite3 + FTS5 available
- Auto-fallback to `'in-memory'` when not available
- `ctxo doctor` reports active search tier

**Estimated total effort when reactivated: 7-10 days**

## Consequences

- Ctxo ships with Tier 2 (in-memory BM25) as the production search engine
- No native module dependency — `npx ctxo-mcp` works on all platforms without build tools
- Porter stemming unavailable — morphological variants require exact sub-token match
- Search index rebuilt on every MCP server startup (~500ms for medium codebases)
- PRD remains the source of truth for FTS5 specification
- `ISearchPort` interface is FTS5-ready — migration is an adapter swap, not an architecture change
