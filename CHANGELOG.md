# Changelog

All notable changes to Ctxo MCP Server are documented in this file.

## [0.4.1] - 2026-04-10

### Added
- `ctxo stats` command — usage statistics dashboard with `--json`, `--days N`, `--clear` flags
- Session recording middleware (`withRecording`) tracks all MCP tool calls automatically
- Opt-out via `stats.enabled: false` in `.ctxo/config.yaml`

### Fixed
- Stats session events now persist to disk after each MCP tool call (was in-memory only)
- `ctxo index` no longer wipes session_events table — existing stats survive index rebuilds

## [0.4.0] - 2026-04-09

### Added

**Advanced Search Engine — Phase 1**
- **BM25 search engine** replacing old substring matching in `get_ranked_context` (default `searchMode: 'fts'`)
- **camelCase/PascalCase/snake_case tokenization**: searching "change" now finds `getCoChangeMetrics`, `CoChangeEntry`, etc.
- **Two-phase cascade**: primary tokenized search → trigram fallback (activated when < 3 results)
- **Bigram boost**: multi-word queries like "blast radius" rank `BlastRadiusCalculator` highest (adjacent token bonus)
- **Fuzzy correction**: Damerau-Levenshtein with adaptive threshold (d≤1 for short terms, d≤2 for longer) — "detctor" → "detector"
- **PageRank multiplicative boost**: structural importance as tiebreaker among BM25-equal results
- **Exact match 5x boost**: full symbol name matches dominate ranking
- `searchMetrics` in response: `porterHits`, `trigramHits`, `phase2Activated`, `fuzzyApplied`, `latencyMs`
- `fuzzyCorrection` in response when typo correction applied
- `search_symbols` now supports `mode: 'fts'` for BM25-based search
- `searchMode: 'legacy'` parameter preserves old substring matching behavior
- Gold standard query set (50 queries, 9 categories) for NDCG@10 quality measurement
- `ISearchPort` interface for search engine abstraction

### Fixed
- Search index now auto-rebuilds when graph changes (stale index bug in watch mode)
- Fuzzy-corrected results now receive bigram + PageRank boosts (previously skipped)
- `relevanceScore` and `combinedScore` are now distinct values (raw BM25 vs boosted)

### Changed
- `get_ranked_context` defaults to FTS search mode (use `searchMode: 'legacy'` for old behavior)
- Tarball size limit bumped from 600KB to 700KB (new search engine code)
- HTML visualizer search upgraded to camelCase-aware tokenized matching
- Validation runbook updated with BM25 search quality tests (Steps 11.2-11.5, 12.6-12.7)

## [0.3.1] - 2026-04-08

### Fixed
- Fix C# method overload crash: disambiguate symbol IDs with parameter count (`Class.Method(2)`)
- Fix SQLite `UNIQUE constraint failed: symbols.symbol_id` fatal error on C# codebases with overloaded methods
- Use `INSERT OR REPLACE` for symbols table as a safety net against duplicate symbol IDs

## [0.3.0] - 2026-04-08

### Added

**9 New MCP Tools (5 -> 14 total)**
- `find_dead_code` — unreachable symbols/files with confidence scoring (1.0/0.9/0.7), cascading detection, scaffolding markers
- `get_context_for_task` — task-optimized context assembly (fix/extend/refactor/understand workflows)
- `get_ranked_context` — BM25 + PageRank search within token budget
- `search_symbols` — name/regex symbol search across index
- `get_changed_symbols` — symbols in recently changed files (git diff)
- `find_importers` — reverse dependency lookup with transitive BFS
- `get_class_hierarchy` — class inheritance tree (extends/implements)
- `get_symbol_importance` — PageRank centrality ranking on dependency graph
- `get_pr_impact` — full PR risk assessment (changed symbols + blast radius + co-change)

**Response Envelope (`_meta`)**
- All tool responses now include `_meta: { totalItems, returnedItems, truncated, totalBytes }`
- Large responses auto-truncated at 8KB with drill-in hints
- Configurable threshold via `CTXO_RESPONSE_LIMIT` environment variable

**Intent Filtering**
- `get_blast_radius`, `get_logic_slice`, `find_importers`, `find_dead_code` accept optional `intent` parameter
- Keyword-based filtering against symbolId, file, name, kind, edgeKind, reason
- Case-insensitive, multiple keywords with OR logic

**Tool Annotations**
- All 14 tools annotated with `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`
- Enables auto-approval in agent frameworks and IDEs

**MCP Resource**
- `ctxo://status` resource registered — prevents `-32601` errors from clients calling `listResources`

**Debug Mode**
- Structured logger with `DEBUG=ctxo:*` environment variable support
- Namespaced: `ctxo:git`, `ctxo:storage`, `ctxo:mcp`, `ctxo:index`, `ctxo:masking`
- Info/warn/error always output; debug only when matching namespace enabled

**LLM Documentation**
- `llms.txt` — compact tool overview for LLM consumption (~1.5KB)
- `llms-full.txt` — full reference with all schemas and usage guide (~7KB)
- Both included in npm package

**Agentic AI Integration Guide**
- `docs/agentic-ai-integration.md` — Claude Agent SDK, OpenAI Agents SDK, LangChain, raw MCP client examples

**Multi-Language Support (V1.1)**
- Go adapter (tree-sitter) — struct, interface, function, method extraction
- C# adapter (tree-sitter) — class, interface, method, enum, namespace qualification
- Dynamic adapter registry with `getSupportedExtensions()`
- Graceful degradation when tree-sitter not installed

**Cross-File Resolution (V1.1)**
- Multi-file project preloading for accurate import edge resolution
- `this.method()` intra-class call edge extraction
- `uses` edges for likely-tier blast radius

**Blast Radius Enhancements (V1.1)**
- 3-tier confidence model: confirmed/likely/potential
- Risk scoring: `1/depth^0.7` per entry
- `edgeKinds` array per impacted symbol
- `confidence` filter parameter
- Co-change analysis boost (potential -> likely when frequency > 0.5)

**Co-Change Analysis**
- Git history mined during indexing (zero extra calls)
- `.ctxo/index/co-changes.json` committed artifact
- Blast radius entries boosted by co-change frequency

**Indexing Improvements**
- Batch git log calls (N sequential -> 1 batch call, 2.1x faster)
- `--max-history N` flag for limiting commit history per file
- `--skip-history` flag for fast re-indexing without git history
- Byte offset indexing for O(1) source retrieval per symbol

**Tool Descriptions**
- All 14 tools enriched with "when to use" guidance and cross-references
- Tool Selection Guide decision tree in CLAUDE.md

### Changed
- Blast radius `impactedSymbols` now includes `edgeKinds`, `confidence`, `coChangeFrequency` fields
- `get_why_context` reads from committed index first (no git calls for cached data)
- Coverage threshold relaxed to 88% branches for `src/core/**`
- Tarball size limit increased to 600KB

### Fixed
- Anti-patterns and intent never persisted to committed index (#1)
- Masking pipeline false negative for AWS secrets after `=` (#2)
- Git commit hashes falsely masked as `AWS_SECRET` (#3)
- RevertDetector extended with undo, rollback, indirect patterns (#4)
- `get_pr_impact` reported raw git paths instead of indexed file count (#24)
- Pre-existing TypeScript errors in go-adapter, tree-sitter-adapter, blast-radius-calculator
- ESLint `no-require-imports` errors in tree-sitter lazy loading

## [0.2.0] - 2026-03-29

### Added
- Initial npm publish as `ctxo-mcp`
- 5 core MCP tools: `get_logic_slice`, `get_blast_radius`, `get_architectural_overlay`, `get_why_context`, `get_change_intelligence`
- Progressive detail levels (L1-L4)
- Privacy masking pipeline (AWS/GCP/Azure/JWT/IP/env patterns)
- Committed JSON index (`.ctxo/index/`)
- SQLite cache with auto-rebuild from JSON
- Staleness detection with MCP response warnings
- `ctxo index` CLI command with incremental re-indexing
- `ctxo watch` file watcher (chokidar)
- `ctxo init` git hook installation
- `ctxo sync` rebuild SQLite from JSON
- `ctxo verify-index` CI freshness gate
- GitHub Actions CI/CD pipeline
- 354 tests
