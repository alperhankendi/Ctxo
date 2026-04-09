# Ctxo — Competitive Analysis & Improvement Plan

> Session: 2026-04-08 | Source: Deep analysis of [context-mode](https://github.com/mksglu/context-mode) vs Ctxo

***

## 1. Competitive Analysis Summary

### What is context-mode?

**context-mode** (by Mert Koseoğlu) is an MCP server + Claude Code plugin that optimizes context window usage for AI coding assistants. It claims 98% context savings, extending sessions from \~30 min to \~3 hours.

* **Version:** 1.0.75
* **License:** Elastic License 2.0
* **Users:** 70.5k+ (60.1k npm, 10.3k marketplace)
* **Runtime:** Node 18+ (Bun auto-detected for 3-5x faster JS/TS)
* **Languages:** 11 (JS, TS, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, Elixir)
* **Platforms:** 12 (Claude Code, Gemini CLI, VS Code Copilot, Cursor, OpenClaw, Kiro, OpenCode, KiloCode, Codex CLI, Antigravity, Zed, Pi Coding Agent)

### Core Philosophy Difference

|                    | context-mode                                                            | Ctxo                                                                      |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Thesis**         | "Think in Code" — sandbox execution, only printed output enters context | "Logic Slices" — symbol-level dependency graphs, blast radius, git intent |
| **Problem solved** | Token throughput optimization                                           | Deep code understanding                                                   |
| **Approach**       | Horizontal context optimizer (any task)                                 | Vertical code intelligence (structural analysis)                          |

**These are fundamentally complementary, not competing products.**

***

## 2. context-mode Feature Inventory

### MCP Tools (10 total)

| Tool                  | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `ctx_execute`         | Sandbox code execution (11 langs); output >5KB auto-indexed                |
| `ctx_execute_file`    | Process files via FILE\_CONTENT variable without loading into context      |
| `ctx_batch_execute`   | Run multiple shell commands + search in one call                           |
| `ctx_index`           | Chunk markdown/JSON/text into FTS5 knowledge base                          |
| `ctx_search`          | BM25+trigram search with RRF fusion, proximity reranking, fuzzy correction |
| `ctx_fetch_and_index` | Fetch URL, convert HTML to markdown, index with 24h TTL cache              |
| `ctx_stats`           | Context savings breakdown per tool                                         |
| `ctx_doctor`          | Installation diagnostics (runtimes, FTS5, hooks, version)                  |
| `ctx_upgrade`         | In-place version update                                                    |
| `ctx_purge`           | Delete all session data irreversibly                                       |

### Architecture

Flat architecture (not hexagonal):

```
src/
  server.ts          -- MCP server with all 10 tool handlers
  store.ts           -- ContentStore (FTS5 knowledge base)
  executor.ts        -- PolyglotExecutor (11 languages)
  security.ts        -- Permission deny/allow/ask enforcement
  runtime.ts         -- Runtime detection (Bun/Node/etc.)
  lifecycle.ts       -- Orphan process prevention
  truncate.ts        -- Smart output truncation
  exit-classify.ts   -- Shell exit code classification
  types.ts           -- Shared types
  cli.ts             -- CLI entry (doctor, upgrade, hook dispatch)
  session/           -- Session management (DB, extraction, snapshots, analytics)
  adapters/          -- 12 platform adapters (claude-code, gemini-cli, cursor, etc.)
```

### Storage & Caching

**Knowledge Base (ContentStore):**

* SQLite with WAL mode, better-sqlite3
* Two parallel FTS5 virtual tables: Porter stemmer + Trigram tokenizer
* BM25 scoring (K1=5.0, B=1.0)
* 24 prepared statements
* Vocabulary table for Levenshtein fuzzy correction
* 4096-byte max chunk size with paragraph-boundary splitting

**Session Database (SessionDB):**

* Separate SQLite DB per project (worktree-isolated)
* 3 tables: session\_events, session\_meta, session\_resume
* SHA256 deduplication within sliding 5-event window
* 1000 max events per session with priority-based eviction
* 7-day session cleanup

### Search Strategy (3-Layer)

1. **Reciprocal Rank Fusion (RRF):** Merges Porter and Trigram results using `score += 1/(60+rank)`
2. **Proximity Reranking:** Sweep-line algorithm finds minimum text span covering all query terms
3. **Fuzzy Correction:** Levenshtein distance against vocabulary table; re-runs RRF with corrected query
4. **Progressive throttling:** After 3 searches → reduced results; after 8+ → blocked

### Chunking Algorithms (3 strategies)

1. **Markdown:** Heading hierarchy (H1-H4), code block preservation, 4096-byte max
2. **Plain Text:** Natural section detection (3-200 blank-line-separated sections)
3. **JSON:** Recursive descent by key, array batching with identity-field-aware titles

### Hook System (5 hooks)

| Hook               | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `preToolUse`       | Route data-fetching tools to sandbox; security deny checks |
| `postToolUse`      | Extract session events from tool results                   |
| `preCompact`       | Build <2KB XML resume snapshot from SessionDB              |
| `sessionStart`     | Restore session state; inject rules; clean stale data      |
| `userPromptSubmit` | Capture prompts as priority-1 events                       |

### Session Continuity System (Most Innovative Feature)

1. **Event Extraction:** Every tool call generates structured events across 15 categories with 4 priority tiers
2. **Pre-Compaction Snapshot:** Before context overflow, builds XML "table of contents" (<2KB)
3. **Session Resume:** After compaction, injects snapshot + pre-built search queries for LLM recovery
4. **Zero information loss:** Full data in SQLite; snapshot is navigational only

### Security Model

* Deny-only enforcement on server side
* Chained command splitting (`&&`, `||`, `;`, `|` checked independently)
* Shell escape detection in Python/JS/Ruby/PHP/Go/Rust code
* File path deny patterns with glob matching
* Environment variable denylist (60+ dangerous vars stripped)

### Performance Claims

| Scenario               | Raw     | Context | Savings |
| ---------------------- | ------- | ------- | ------- |
| Playwright snapshot    | 56.2 KB | 299 B   | 99%     |
| 20 GitHub issues       | 58.9 KB | 1.1 KB  | 98%     |
| 500-request access log | 45.1 KB | 155 B   | 100%    |
| 7.5 MB JSON API        | 7.5 MB  | 0.9 KB  | 99%     |

### Test Coverage

* 125+ tests across 4 suites
* Framework: Vitest with forks pool, 30s timeout, CI retry x2
* 21 benchmark scenarios with measured compression ratios

***

## 3. Ctxo Current Feature Inventory

### MCP Tools (16 total)

1. `get_logic_slice` — Transitive dependency closure (L1-L4 detail levels)
2. `get_why_context` — Git commit history + anti-pattern warnings
3. `get_change_intelligence` — Complexity x churn composite score
4. `get_blast_radius` — Impact analysis with depth-weighted risk scoring
5. `get_architectural_overlay` — Layer mapping (Domain/Infra/Adapter/Test)
6. `find_dead_code` — Unreachable symbols, unused exports, scaffolding markers
7. `get_context_for_task` — Task-aware context (fix/extend/refactor/understand)
8. `get_ranked_context` — BM25 search + token budget packing
9. `search_symbols` — Symbol search by name/regex with filters
10. `get_changed_symbols` — Recently changed files (git diff based)
11. `find_importers` — Reverse dependency lookup
12. `get_class_hierarchy` — Inheritance chain traversal
13. `get_symbol_importance` — PageRank-based importance ranking

### CLI Commands (7)

1. `index` — Build full codebase index (--file, --check, --skip-history, --max-history)
2. `sync` — Rebuild SQLite from committed JSON
3. `watch` — File watcher for incremental re-indexing
4. `verify-index` — CI gate for stale index
5. `status` — Index manifest
6. `init` — Install git hooks
7. `--help` — Display help

### Core Algorithms

* **SymbolGraph** — Bidirectional dependency graph with fuzzy node resolution
* **PageRank** — Centrality ranking (damping=0.85, max iterations=100)
* **BlastRadius** — BFS on reverse edges, confirmed vs potential confidence
* **DeadCode** — Multi-faceted analysis (7 categories, cascade depth, framework exclusions)
* **LogicSlice** — BFS transitive closure with max-depth limiting
* **ChurnAnalyzer** — Normalized commit count (0-1)
* **ComplexityCalculator** — Cyclomatic complexity metrics
* **HealthScorer** — Composite score with bands (low/medium/high)
* **RevertDetector** — Anti-pattern detection from git history
* **MaskingPipeline** — Secret redaction (AWS, JWT, IP, GCP, Azure, env vars)
* **DetailFormatter** — 4-level progressive detail with token budgeting
* **TaskContextStrategy** — Weighted scoring by task type
* **StalenessDetector** — Content-hash based change detection

### Ports/Interfaces (5)

IStoragePort, IGitPort, ILanguageAdapter, IMaskingPort, IWatcherPort

***

## 4. Gap Analysis: What Ctxo is Missing

### Features Worth Stealing (Priority Ranked)

#### P0 — HIGH PRIORITY

| # | Feature                           | What context-mode Does                                                               | Ctxo Gap                                  |
| - | --------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| 1 | **Dual FTS5 Search + RRF Fusion** | Porter + Trigram FTS5, Reciprocal Rank Fusion, proximity reranking, fuzzy correction | `get_ranked_context` uses basic BM25 only |
| 2 | **Session Continuity**            | Pre-compaction snapshots, SessionDB, zero-loss recovery                              | No session management at all              |
| 3 | **Multi-Platform Adapters**       | 12 platform adapters (Cursor, Copilot, Gemini CLI, etc.)                             | MCP-only (universal but unoptimized)      |

#### P1 — MEDIUM PRIORITY

| # | Feature                             | What context-mode Does                                       | Ctxo Gap                                     |
| - | ----------------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| 4 | **Self-Diagnostics** (`ctx_doctor`) | Runtime checks, DB health, hook validation, version info     | No diagnostic command                        |
| 5 | **Context Budget Analytics**        | Per-tool byte tracking, token estimation, cumulative savings | Detail levels exist but no savings reporting |
| 6 | **Progressive Search Throttling**   | Limits after 3/8 searches to prevent loops                   | No throttling                                |

#### P2 — LOW PRIORITY

| # | Feature               | What context-mode Does                                | Ctxo Gap                            |
| - | --------------------- | ----------------------------------------------------- | ----------------------------------- |
| 7 | **URL Fetch + Index** | Fetch web pages, convert to markdown, chunk and index | No external content ingestion       |
| 8 | **In-Place Upgrade**  | `ctx_upgrade` command                                 | Manual npm update only              |
| 9 | **Sandbox Execution** | 11-language polyglot executor                         | Not applicable (different paradigm) |

***

## 5. What context-mode is Missing (Ctxo Advantages / Moat)

context-mode has **zero code intelligence**:

* No AST parsing / symbol resolution
* No dependency graph / blast radius
* No architectural overlay / layer detection
* No git intent / anti-pattern detection
* No change intelligence / complexity scoring
* No dead code / PageRank / class hierarchy
* No logic slices / transitive dependency traversal
* No committed index format (all local SQLite only)

**This is Ctxo's core moat.**

***

## 6. Strategic Comparison

| Dimension          | context-mode            | Ctxo                                 | Winner           |
| ------------------ | ----------------------- | ------------------------------------ | ---------------- |
| Code understanding | None                    | Deep (graph, PageRank, blast radius) | **Ctxo**         |
| Token optimization | 98% savings via sandbox | L1-L4 progressive detail             | **context-mode** |
| Search quality     | Dual FTS5 + RRF + fuzzy | Basic BM25                           | **context-mode** |
| Platform reach     | 12 platforms            | MCP-only                             | **context-mode** |
| Session management | Full continuity system  | None                                 | **context-mode** |
| Architecture       | Flat, pragmatic         | Hexagonal, clean                     | **Ctxo**         |
| Security/masking   | Deny-list execution     | Secret redaction pipeline            | Tie              |
| User base          | 70K+                    | Pre-launch                           | **context-mode** |
| Extensibility      | Hook-based (fragile)    | Port-based (stable)                  | **Ctxo**         |

***

## 7. Implementation Plan

### Phase 1: Search Quality Upgrade (1-2 weeks)

* [ ] Add Trigram FTS5 virtual table alongside existing Porter-based search
* [ ] Implement Reciprocal Rank Fusion (RRF) scoring in `get_ranked_context`
  * Merge Porter + Trigram results using `score += 1/(60+rank)`
* [ ] Add proximity reranking (minimum span algorithm covering all query terms)
* [ ] Build vocabulary table for Levenshtein fuzzy correction
* [ ] Add progressive throttling config (optional, off by default)
* [ ] Update `SqliteStorageAdapter` with dual FTS5 table management
* [ ] Add benchmarks comparing old BM25 vs new RRF search quality

**Files to modify:**

* `src/adapters/storage/sqlite-storage-adapter.ts` — Add trigram FTS5 table, prepared statements
* `src/core/search/` — New module: RRF fusion, proximity reranking, fuzzy correction
* `src/adapters/mcp/get-ranked-context.ts` — Wire new search pipeline
* `src/ports/i-storage-port.ts` — Extend with trigram search methods

### Phase 2: Diagnostics & DX (3-5 days)

* [ ] Add `ctxo doctor` CLI command
  * Check git availability
  * Check Node.js version (>= 20)
  * Check index existence and file count
  * Run staleness report
  * Run SQLite integrity check
  * Show symbol/edge counts
  * Show disk usage (.ctxo/ directory)
  * Check ts-morph availability
* [ ] Add `--stats` flag to MCP tools showing token budget usage
* [ ] Add context savings reporting to DetailFormatter
  * "L2 saved \~12K tokens vs L4 for this query"

**Files to create/modify:**

* `src/cli/doctor-command.ts` — New CLI command
* `src/index.ts` — Register doctor command
* `src/core/detail-levels/detail-formatter.ts` — Add savings tracking

### Phase 3: Session Continuity (1-2 weeks)

* [ ] Design session event schema
  * Categories: symbol\_query, blast\_radius, dead\_code, architecture, search
  * Fields: timestamp, tool\_name, primary\_symbol, result\_summary, token\_count
* [ ] Add SessionDB (separate SQLite, per-project)
  * Table: session\_events (id, timestamp, category, tool, symbol, summary, tokens)
  * Table: session\_meta (key, value) — project path, last active, etc.
  * Auto-cleanup: 7-day retention
  * Max 500 events per session with FIFO eviction
* [ ] Implement pre-compaction snapshot builder
  * JSON summary (<2KB) of last N queries + key findings
  * Include: symbols analyzed, blast radius hotspots, dead code found, arch layers touched
  * Include pre-built search queries for recovery
* [ ] Add `get_session_context` MCP tool
  * Returns current session snapshot
  * LLM can call this after compaction to recover state
* [ ] Wire into staleness detection
  * "Since your last query, these 3 files changed affecting 12 symbols"

**Files to create/modify:**

* `src/core/session/` — New module: SessionDB, event schema, snapshot builder
* `src/adapters/storage/session-storage-adapter.ts` — SQLite implementation
* `src/adapters/mcp/get-session-context.ts` — New MCP tool
* `src/ports/i-session-port.ts` — New port interface
* `src/index.ts` — Wire session adapter

### Phase 4: Multi-Platform Support (2-3 weeks)

* [ ] Define platform adapter interface
  * Methods: `detectPlatform()`, `getInstructions()`, `getHookConfig()`
  * Properties: `name`, `supportsHooks`, `hookTypes[]`
* [ ] Add Cursor adapter
  * Custom instruction injection via `.cursor/rules/`
  * MCP config generation for `.cursor/mcp.json`
* [ ] Add VS Code Copilot adapter
  * Chat participant API integration
  * MCP config for VS Code settings
* [ ] Add Gemini CLI adapter
  * Hook dispatch support
  * MCP config generation
* [ ] Add `ctxo setup <platform>` CLI command
  * Interactive platform detection
  * Auto-generate platform-specific config files
  * Validate MCP connection
* [ ] Platform-specific installation docs

**Files to create/modify:**

* `src/adapters/platform/` — New module: platform adapters
* `src/ports/i-platform-adapter.ts` — New port interface
* `src/cli/setup-command.ts` — New CLI command
* Platform config templates

### Phase 5: External Docs Integration (1 week, optional)

* [ ] Add `index_url` MCP tool
  * Fetch URL content (HTML → markdown conversion)
  * Chunk using context-mode's markdown chunking strategy
  * Index into FTS5 knowledge base
  * 24h TTL cache
* [ ] Integrate with `get_ranked_context`
  * Blend code symbols + doc chunks in search results
  * Source tagging: "code" vs "docs" for result filtering
* [ ] Add `--docs` flag to `ctxo index` for bulk URL indexing from config

**Files to create/modify:**

* `src/adapters/mcp/index-url.ts` — New MCP tool
* `src/core/search/doc-chunker.ts` — Markdown/HTML chunking
* `src/adapters/storage/sqlite-storage-adapter.ts` — Doc content table
* `.ctxo/config.yaml` — docs URL list

***

## 8. Key Decisions to Make

1. **Search: Replace or augment existing BM25?** — Recommend augment (keep existing as fallback)
2. **Session: Separate DB or extend existing SQLite?** — Recommend separate (different lifecycle)
3. **Platforms: Support via MCP-only or platform-specific hooks?** — Recommend MCP + optional hooks
4. **Docs indexing: In-scope for V2 or deferred?** — Recommend deferred (Phase 5 is optional)

***

## 9. Estimated Effort Summary

| Phase                       | Scope                   | Effort        | Priority |
| --------------------------- | ----------------------- | ------------- | -------- |
| Phase 1: Search Quality     | Dual FTS5 + RRF + fuzzy | 1-2 weeks     | P0       |
| Phase 2: Diagnostics        | `ctxo doctor` + stats   | 3-5 days      | P1       |
| Phase 3: Session Continuity | SessionDB + snapshots   | 1-2 weeks     | P0       |
| Phase 4: Multi-Platform     | 3+ platform adapters    | 2-3 weeks     | P0       |
| Phase 5: External Docs      | URL fetch + index       | 1 week        | P2       |
| **Total**                   |                         | **6-9 weeks** |          |

***

## 10. Next Steps

1. Start with Phase 1 (Search Quality) — biggest bang for buck on existing tool
2. Phase 2 (Diagnostics) can run in parallel — small, independent
3. Phase 3 (Session) after search is solid — builds on storage layer
4. Phase 4 (Multi-Platform) can start anytime — mostly independent
5. Phase 5 deferred until V2 roadmap

