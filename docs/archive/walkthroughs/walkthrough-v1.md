# Ctxo V1 Development Walkthrough

> Implementation log mapping every development step to the [implementation plan](artifacts/implementation-plan.md).
> Only code changes included planning discussions, analysis conversations, and non-code decisions omitted.

***

## Phase 1: Project Scaffold & Build

**Commit:** `f9bfea3`  Scaffold project with TypeScript, tsup, vitest, ESLint, and core domain types

**Files created:**

* `package.json` — ESM-first (`"type": "module"`), Node >=20, `bin: { ctxo: "dist/index.js" }`, all deps
* `tsconfig.json` — ES2022 target, Node16 module resolution, strict mode
* `tsup.config.ts` — ESM build, external tree-sitter, shebang banner
* `vitest.config.ts` — 90% coverage threshold for `src/core/`
* `eslint.config.js` — TypeScript parser, hexagonal boundary enforcement (`core/ ↛ adapters/`, `ports/ ↛ adapters/`), `no-console` (allow error)
* `src/core/types.ts` — 15 Zod schemas: `SymbolKind`, `EdgeKind`, `DetailLevel`, `SymbolId`, `SymbolNode`, `GraphEdge`, `CommitIntent`, `AntiPattern`, `FileIndex`, plus interfaces for `LogicSliceResult`, `FormattedSlice`, `ComplexityMetrics`, `ChurnData`, `ChangeIntelligenceScore`, `WhyContextResult`
* `src/index.ts` — Minimal composition root with `McpServer` + `StdioServerTransport`

**Tests:** 51 — Zod schema validation/rejection for all domain types

**Commit:** `c808049` — Replace deprecated `Server` with `McpServer` from MCP SDK

***

## Phase 2: Storage Foundation

**Commit:** `a55ee9a` — Add storage foundation: IStoragePort, JSON index writer/reader, SQLite adapter

**Files created:**

* `src/ports/i-storage-port.ts` — `IStoragePort` interface (write/read/list/delete/getById/edges/bulk/close)
* `src/adapters/storage/json-index-writer.ts` — Deterministic JSON (sorted keys, 2-space indent) to `.ctxo/index/`
* `src/adapters/storage/json-index-reader.ts` — Reads + Zod-validates `.ctxo/index/**/*.json`
* `src/adapters/storage/sqlite-storage-adapter.ts` — `IStoragePort` impl with sql.js (WASM SQLite), auto-rebuild from JSON on cold start
* `src/adapters/storage/schema-manager.ts` — Version tracking for index schema

**Design decision:** `sql.js` instead of `better-sqlite3` — Node v24 doesn't have prebuilt binaries for better-sqlite3.

**Tests:** +34 = 85 total — Writer determinism, reader validation, full IStoragePort contract, cold start rebuild, corrupt DB recovery

***

## Phase 3: TypeScript Language Adapter

**Commit:** `07a8564` — Add TypeScript language adapter with ts-morph symbol/edge/complexity extraction

**Files created:**

* `src/ports/i-language-adapter.ts` — `ILanguageAdapter` interface (extractSymbols, extractEdges, extractComplexity)
* `src/adapters/language/ts-morph-adapter.ts` — ts-morph parsing for TS/JS/TSX/JSX, symbol extraction (function, class, interface, type, variable, method), edge detection (imports, extends, implements), cyclomatic complexity counting
* `src/adapters/language/language-adapter-registry.ts` — Extension → adapter mapping

**Test fixtures:** Sample TS/TSX files covering each symbol kind and edge type

**Tests:** +33 = 118 total

***

## Phase 4: Core Graph & Logic-Slice

**Commit:** `ea1b4ea` — Add core graph, logic-slice query, and detail formatter

**Files created:**

* `src/core/graph/symbol-graph.ts` — Directed adjacency list with forward/reverse edges, duplicate-edge guard
* `src/core/logic-slice/logic-slice-query.ts` — BFS transitive closure, cycle-safe (visited set), depth-limited
* `src/core/detail-levels/detail-formatter.ts` — L1 (root only), L2 (depth-1), L3 (full closure), L4 (full + 8000 token budget with truncation metadata)

**Tests:** +28 = 146 total — Including 1000-node graph performance test (<50ms)

***

## Phase 5: MCP Server + Masking + `get_logic_slice`

**Commit:** `fa4701d` — Add MCP server with get\_logic\_slice tool and privacy masking pipeline

**Files created:**

* `src/ports/i-masking-port.ts` — `IMaskingPort` interface
* `src/core/masking/masking-pipeline.ts` — Regex-based redaction (AWS keys, JWT, private IPs, env secrets, GCP, Azure), configurable patterns
* `src/adapters/mcp/get-logic-slice.ts` — Tool handler with Zod input validation, graph build, logic-slice query, detail formatting, masking
* Wired `get_logic_slice` in composition root with `registerTool` API

**Architecture fix:** `MaskingPipeline` in `core/` cannot import from `ports/` — structural typing via composition root instead of `implements`.

**Tests:** +24 = 170 total — Masking patterns (no false positives), MCP response shape, InMemoryTransport-style tests

***

## Bug Fix Round 1

**Commit:** `7b96d98` — Fix 10 runtime bugs found in code review

| #  | Fix                                                                            | Severity |
| -- | ------------------------------------------------------------------------------ | -------- |
| 1  | Clone RegExp objects in MaskingPipeline (shared mutable lastIndex)             | Critical |
| 2  | Persist sql.js DB after every write (was only on close)                        | Critical |
| 3  | deleteFileData only removes from\_symbol edges (was deleting cross-file edges) | Critical |
| 4  | Cache SymbolGraph in get\_logic\_slice (was full DB scan per MCP call)         | High     |
| 5  | Fix import edge attribution (was assigning all to first symbol)                | High     |
| 6  | Fix guessSymbolId (was always "variable" kind)                                 | High     |
| 7  | Clean up ts-morph source files after extraction (memory leak)                  | High     |
| 8  | Explicit empty string check in masking (was falsy check)                       | High     |
| 9  | Path traversal guard in JsonIndexWriter (resolve + prefix check)               | High     |
| 10 | Symlink loop guard in JsonIndexReader (visited set)                            | High     |

***

## Phase 6: `ctxo index` CLI Command

**Commit:** `98ebb21` — Add ctxo index CLI command with file discovery and extraction pipeline

**Files created:**

* `src/cli/index-command.ts` — File discovery via `git ls-files`, pipeline: discover → filter → extract → write JSON → populate SQLite, .gitignore enforcement
* `src/cli/cli-router.ts` — `process.argv` routing to subcommands with help text

**Updated:** `src/index.ts` — CLI mode (args) vs MCP server mode (no args)

**Test fixtures:** Mini TypeScript project (3 files with cross-file imports)

**Tests:** +12 = 182 total

***

## Phase 7: Git + Why-Context + Change Intelligence

**Commit:** `a193b5f` — Add git adapter, why-context, and change intelligence modules

**Files created:**

* `src/ports/i-git-port.ts` — `IGitPort` interface (getCommitHistory, getFileChurn, isAvailable)
* `src/adapters/git/simple-git-adapter.ts` — simple-git wrapper with warn-and-continue
* `src/core/why-context/revert-detector.ts` — `Revert "..."` and `revert:` prefix pattern matching
* `src/core/why-context/why-context-assembler.ts` — Assembles history + anti-patterns + change intelligence
* `src/core/change-intelligence/complexity-calculator.ts` — Cyclomatic complexity from AST
* `src/core/change-intelligence/churn-analyzer.ts` — Normalized churn (0-1)
* `src/core/change-intelligence/health-scorer.ts` — Composite score with low/medium/high bands
* `src/adapters/mcp/get-why-context.ts` — MCP tool handler
* `src/adapters/mcp/get-change-intelligence.ts` — MCP tool handler

**Tests:** +45 = 227 total — Including fixture git repo with scripted commits

***

## Phase 8: Blast Radius & Architectural Overlay

**Commit:** `1b61fa7` — Add blast radius calculator and architectural overlay

**Files created:**

* `src/core/blast-radius/blast-radius-calculator.ts` — Reverse BFS with depth-ranked dependents
* `src/core/overlay/architectural-overlay.ts` — Path-based layer classification (Domain/Adapter/Infrastructure/Unknown), configurable rules
* `src/adapters/mcp/get-blast-radius.ts` — MCP tool handler
* `src/adapters/mcp/get-architectural-overlay.ts` — MCP tool handler

**Milestone:** All 5 MCP tools registered in composition root.

**Tests:** +18 = 245 total

***

## Bug Fix Round 2

**Commit:** `3d2a691` — Fix 7 runtime bugs from second code review

| # | Fix                                                                    | Severity  |
| - | ---------------------------------------------------------------------- | --------- |
| 1 | Enable `PRAGMA foreign_keys = ON` in SQLite                            | Critical  |
| 2 | Parallelize git churn queries with `Promise.all` (was O(n) sequential) | Critical  |
| 3 | Lazy graph cache in get-blast-radius (was eagerly built, always empty) | Critical  |
| 4 | Add `initEmpty()` to avoid double-write in IndexCommand                | Important |
| 5 | Hoist `findExportedSymbolsInFile` outside import loop (O(n²) → O(n))   | Important |
| 6 | Clone RegExp in ArchitecturalOverlay constructor                       | Important |
| 7 | Atomic read-modify-write for .gitignore (TOCTOU fix)                   | Medium    |

**Commit:** `d8f2f5c` — Restore to\_symbol FK with graceful error handling (tryInsertEdge + two-phase bulkWrite)

***

## Test Coverage Expansion

**Commit:** `847c9de` — Add missing MCP handler tests and edge case coverage

**Files created:**

* 4 MCP handler test files: get-why-context, get-change-intelligence, get-blast-radius, get-architectural-overlay (22 tests)
* Edge case tests: ts-morph syntax errors, detail-formatter L1/L4 constraints, SQLite corrupt recovery, FK handling, path traversal protection

**Tests:** +40 = 285 total

***

## Phase 9: CLI Commands + Index Lifecycle

**Commit:** `eb20d2b` — Implement all CLI commands

**Files created:**

* `src/cli/sync-command.ts` — Rebuild SQLite cache from committed JSON index
* `src/cli/status-command.ts` — Index manifest (file count, symbols, edges, schema version, timestamps)
* `src/cli/verify-command.ts` — CI gate: rebuild index in temp dir, compare symbols JSON, exit 1 if stale
* `src/cli/init-command.ts` — Git hooks (post-commit, post-merge) with idempotent `# ctxo-start`/`# ctxo-end` markers
* `src/cli/watch-command.ts` — Chokidar file watcher with 300ms debounce, graceful SIGINT/SIGTERM shutdown

**Tests:** +9 = 294 total

**Commit:** `031d4b7` — Implement missing FRs and NFR benchmarks

* FR2: `--file` incremental indexing + `--check` freshness flag
* FR7: Monorepo auto-discovery via `package.json` workspaces field
* FR18: Configurable masking via `.ctxo/masking.json` + `MaskingPipeline.fromConfig`
* NFR1/3/4/6: Performance benchmark suite (p95 latency, graph build, symbol lookup, index size)
* NFR11: `StalenessDetector` wired into all 5 MCP tool responses
* NFR16: Cross-client MCP spec compliance tests

**Commit:** `a494f9d` — Wire staleness into all 5 tools, npm pack config

**Commit:** `b0f3407` — Phase 9 completion: content hasher + watcher port/adapter extraction

**Files created:**

* `src/core/staleness/content-hasher.ts` — SHA-256 for hash-based freshness checking
* `src/core/staleness/staleness-detector.ts` — File mtime comparison for staleness warnings
* `src/ports/i-watcher-port.ts` — `IWatcherPort` interface
* `src/adapters/watcher/chokidar-watcher-adapter.ts` — Port implementation extracted from watch-command

**Tests:** +32 = 326 total

***

## Bug Fix Round 3

**Commit:** `14ae301` — Fix 5 runtime bugs from round 4 review

| # | Fix                                                                | Severity  |
| - | ------------------------------------------------------------------ | --------- |
| 1 | Windows path in watch-command (`String.replace` → `path.relative`) | Critical  |
| 2 | Path normalize in get-change-intelligence churn lookup             | Critical  |
| 3 | try/finally in sync-command (DB close on error)                    | Important |
| 4 | try/finally in index-command (DB close on error)                   | Important |
| 5 | verify-command uses temp dir (was overwriting committed index)     | Important |

***

## Phase 10: Release Gate

**Commit:** `c7c06a4` — Complete Phase 10: Release gate tests

**Files created:**

* `tests/e2e/privacy-zero-leakage.test.ts` — Planted AWS keys, JWTs, private IPs, env secrets in fixture files; all 5 MCP tools scanned
* `tests/e2e/mcp-spec-compliance.test.ts` — All 5 tools validated for success/miss/error response shapes
* `tests/e2e/release-packaging.test.ts` — package.json validation, npm pack dry-run, tarball size <500KB
* `tests/e2e/performance-benchmark.test.ts` — p95 latency, graph build, symbol lookup (from earlier commit)
* `tests/e2e/cross-client-smoke.test.ts` — MCP spec compliance for Claude Code/Cursor/Copilot

**Tests:** +23 = 349 total

***

## V1 Blockers

**Commit:** `8f6be2d` — Fix TypeScript strict mode and test coverage gate

* Added `src/types/sql.js.d.ts` — Type declaration for sql.js
* Fixed simple-git import (named export instead of default)
* Fixed all implicit `any` destructuring in sqlite-storage-adapter
* Added `MaskingPipeline.fromConfig` tests (5 new) → core/masking 100% coverage

**Tests:** +5 = 354 total. `tsc --noEmit`: 0 errors. Coverage gate: pass.

**Commit:** `e0db181` — Add MIT LICENSE file

***

## Dogfooding (Ctxo on Itself)

**Commit:** `0e90f2b` — Fix 3 dogfooding bugs

| # | Fix                                      | Root Cause                                                                                                                                     |
| - | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | AWS\_SECRET false positive on git hashes | Regex matched any 40-char alphanumeric; fixed to require mixed case                                                                            |
| 2 | Import edge paths unresolved             | Relative paths (`../types.js`) stored instead of project-relative (`src/core/types.ts`); added `resolveRelativeImport`                         |
| 3 | Edge-to-node kind mismatch               | Import targets guessed as `::function` but actual was `::type`; added `inferSymbolKind` heuristic + fuzzy `file::name` matching in SymbolGraph |

**Commit:** `d496a4d` — Fix empty edges in MCP tools (resolveSymbolId LIKE query before insert)

**Commit:** `c7389f8` — Remove FK constraints from edges table

**Decision:** FK caused 5 bugs across 3 reviews, dropped 55% of edges. SQLite is cache — JSON index is source of truth. Removing FK: 232/232 edges stored (was 105/232).

**Removed code:** `resolveSymbolId`, `tryInsertEdge`, `PRAGMA foreign_keys`, two-phase bulkWrite.

**Commit:** `fe25908` — Fix MCP tools reading stale data

**Root cause:** MCP server's in-memory SQLite loaded at startup; `ctxo index` in separate process wrote new DB but MCP server's copy was stale.

**Fix:** `buildGraphFromJsonIndex` reads directly from `.ctxo/index/*.json` on each MCP call. Falls back to SQLite for test scenarios.

***

## V1 Delivery Validation

**Commit:** `a90841b` — V1 delivery test report

**Dogfooding results (93 files, 207 symbols, 233 edges):**

| Tool                        | Result                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `get_logic_slice`           | 4 deps, 6 edges for LogicSliceQuery (transitive resolution working) |
| `get_blast_radius`          | 19 dependents across 3 depths for SymbolNode                        |
| `get_architectural_overlay` | 3 layers (Domain 35, Adapter 46, Unknown 12)                        |
| `get_why_context`           | 5 commits with chronological intent                                 |
| `get_change_intelligence`   | SqliteStorageAdapter: high risk (churn 0.778)                       |

**Token savings:** 48x per query set (2.7K vs 130K tokens)
**Context longevity:** 53x more queries (370 vs 7 sets in 1M window)
**Speed:** 60-100x faster (<2.5s vs 2-4 minutes)

***

## Final Statistics

| Metric                 | Value                 |
| ---------------------- | --------------------- |
| Total commits          | 32                    |
| Feature commits        | 15                    |
| Bug fix commits        | 10                    |
| Infrastructure commits | 7                     |
| Tests                  | 354 across 43 files   |
| Source files           | \~45 TypeScript files |
| Bugs found & fixed     | 30                    |
| Review rounds          | 4                     |
| Phases completed       | 10/10                 |
| MCP tools              | 5/5                   |
| CLI commands           | 7                     |
| Port interfaces        | 5                     |

