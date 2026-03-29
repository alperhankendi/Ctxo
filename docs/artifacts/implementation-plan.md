# Ctxo Implementation Plan

## Context

Ctxo is a greenfield MCP server delivering dependency-aware context ("Logic-Slices") to AI coding assistants. All planning is complete (PRD with 28 FRs + 18 NFRs, hexagonal architecture, 8 epics / 38 stories). Zero source code exists — we need to scaffold and build from scratch following the architecture doc's 10-step implementation sequence.

**Key docs:** [architecture.md](docs/artifacts/architecture.md), [epics.md](docs/artifacts/epics.md), [prd.md](docs/artifacts/prd.md)

***

## Testing Strategy (All Phases)

Every phase follows these mandatory testing practices from [testing.md](docs/conventions/testing.md) and [anti-patterns.md](docs/conventions/anti-patterns.md):

### Test Structure & Naming

* **TS-001:** Test names describe outcomes: `"returns empty array when input is null"` not `"test null input"`
* **TS-002/TS-013:** Assertions MUST match test titles — if title says "different IDs", assert `not.toBe`, not `toHaveLength`
* **TS-003:** Assert specific values: `toEqual({ status: 'success', items: ['a', 'b'] })` not `toBeDefined()`
* **TS-004:** One concept per test — if test name needs "and", split it
* **TS-006:** Arrange-Act-Assert structure in every test

### Edge Cases (TS-008/TS-014 — Mandatory per input type)

* **Strings:** empty `""`, whitespace-only `"   "`, very long (10K+), unicode/emoji, injection patterns
* **Numbers:** NaN, Infinity, 0, negatives, fractional, MAX\_SAFE\_INTEGER boundaries
* **Collections:** empty `[]`/`{}`, single element, duplicates, nested, circular refs, very large
* **Null/Undefined:** `null`, `undefined`, missing optional properties
* **Domain-specific:** invalid symbol IDs, malformed file paths, corrupt JSON, missing git

### Patterns & Anti-Patterns

* **TS-005:** Bugs cluster — when a bug is found, test related scenarios in the same area
* **TS-007:** Test behavior, not implementation — no `toHaveBeenCalledWith(exact_sql_query)`
* **TS-009:** Use `buildArgs()` fixture pattern for shared setup, `it.each` for parameterized tests
* **TS-010:** Test cleanup functions (resource management) — verify `clearTimeout`, `close()` calls via `vi.spyOn`
* **TS-011:** Test error type AND message: `toThrow(ConfigurationError)` + `toThrow('Config file not found')`
* **TS-012:** Mock globals with `vi.spyOn` + `mockRestore()` — never direct reassignment
* **AP-002:** Never skip tests for file length limits — split into `*.test.ts` + `*.edge-cases.test.ts`
* **AP-003:** Never change assertions when tests fail — understand the failure first
* **AP-004:** Never pass empty strings as valid — fail fast or use proper types
* **AP-006:** No lazy coverage ignores — write the test or document why truly unreachable

### Test Organization

* Tests co-located in `__tests__/` adjacent to source files
* Fixtures in `__tests__/fixtures/` with `buildArgs()` pattern (TS-009)
* Coverage target: 90% for `src/core/`, 80% for `src/adapters/`
* Integration tests in `tests/e2e/` (Phase 10)
* **Never export test fixtures across packages** (AP-005)

### Per-Phase Test Checklist

Each phase MUST deliver:

1. Unit tests for every public function with outcome-based names
2. Edge case coverage per TS-008 checklist for each input type
3. Error path tests (invalid input, missing deps, corrupt data)
4. Contract tests for port implementations (adapter satisfies interface)
5. Fixture files for complex test data (not inline objects)

***

## Phase Dependency Graph

```
Phase 1 (Scaffold)
  ├──► Phase 2 (Storage) ──► Phase 6 (CLI index) ──► Phase 9 (Lifecycle)
  │      └──► Phase 5 (MCP + Masking) ──► Phase 7 (Git + Why-Context)
  │                                    └──► Phase 8 (Blast Radius + Overlay)
  └──► Phase 3 (ts-morph) ──► Phase 4 (Core Graph) ──► Phase 5
                                                     └──► Phase 8
  All ──► Phase 10 (Release Gate)
```

***

## Phase 1: Project Scaffold & Build (Epic 1 / Story 1.1)

**Files to create:**

* `package.json` — `"type": "module"`, `engines: { node: ">=20" }`, `bin: { ctxo: "dist/index.js" }`, all deps
* `tsconfig.json` — `target: ES2022`, `module: Node16`, `strict: true`
* `tsup.config.ts` — entry `src/index.ts`, format `esm`, external `['better-sqlite3', 'tree-sitter']`
* `vitest.config.ts` — 90% coverage for `src/core/`
* `eslint.config.js` — hexagonal boundary enforcement, `no-console` (allow `error`)
* `src/index.ts` — minimal composition root skeleton (starts StdioServerTransport, registers zero tools)
* `src/core/types.ts` — all shared domain types + Zod schemas (`SymbolNode`, `GraphEdge`, `FileIndex`, `DetailLevel`, `EdgeKind`, `SymbolKind`)
* Empty directory structure: `src/{ports,core/*,adapters/*,cli}/`

**Tests:** `src/core/__tests__/types.test.ts`

```
describe('SymbolKindSchema')
  ✓ parses valid kind "function"
  ✓ parses valid kind "class"
  ✓ rejects unknown kind "widget"
  ✓ rejects empty string
  ✓ rejects undefined
  ✓ rejects null

describe('SymbolNodeSchema')
  ✓ parses valid symbol node with all required fields
  ✓ rejects symbol node missing symbolId
  ✓ rejects symbol node with negative startLine
  ✓ rejects symbol node where endLine < startLine
  ✓ rejects symbol node with empty name

describe('GraphEdgeSchema')
  ✓ parses valid edge with "imports" kind
  ✓ rejects edge with empty "from" field
  ✓ rejects edge with invalid edge kind

describe('FileIndexSchema')
  ✓ parses valid file index with symbols and edges
  ✓ parses file index with empty symbols array
  ✓ rejects file index with missing "file" field
  ✓ rejects file index with negative lastModified
  ✓ rejects file index with duplicate symbolIds (if enforced)

describe('SymbolId format')
  ✓ accepts "src/foo.ts::myFn::function"
  ✓ rejects symbolId without "::" separator
  ✓ rejects symbolId with invalid kind segment
```

**Verify:** `npm install` → `npx tsup` → `node dist/index.js` exits 0 → `vitest run` passes → ESLint catches `console.log` and boundary violations

***

## Phase 2: Storage Foundation (Story 1.2)

**Files to create:**

* `src/ports/i-storage-port.ts` — `IStoragePort` interface (write/read/list/delete/getById/edges/bulk)
* `src/adapters/storage/json-index-writer.ts` — deterministic JSON (sorted keys, 2-space indent) to `.ctxo/index/`
* `src/adapters/storage/json-index-reader.ts` — reads + Zod-validates `.ctxo/index/**/*.json`
* `src/adapters/storage/sqlite-storage-adapter.ts` — implements `IStoragePort`, WAL mode, auto-rebuild from JSON on cold start
* `src/adapters/storage/schema-manager.ts` — version tracking for index schema

**Tests:**

`src/adapters/storage/__tests__/json-index-writer.test.ts`

```
describe('JsonIndexWriter')
  ✓ writes deterministic JSON with sorted keys for identical input
  ✓ produces 2-space indented output
  ✓ creates nested directories for deep file paths
  ✓ overwrites existing index file without corruption
  ✓ deletes index file for removed source file
  ✓ throws when file path is empty string (AP-004)
  ✓ handles file path with unicode characters
  ✓ handles file path with spaces
  ✓ produces byte-identical output across repeated writes (same input)
```

`src/adapters/storage/__tests__/json-index-reader.test.ts`

```
describe('JsonIndexReader')
  ✓ reads valid JSON index file and returns FileIndex
  ✓ rejects JSON with invalid schema (missing required fields)
  ✓ rejects JSON with unknown symbol kind
  ✓ returns empty array for empty index directory
  ✓ skips non-JSON files in index directory
  ✓ logs warning to stderr for corrupt JSON file (warn-and-continue)
  ✓ handles index directory with 100+ files
```

`src/adapters/storage/__tests__/sqlite-storage-adapter.test.ts`

```
describe('SqliteStorageAdapter — IStoragePort contract')
  ✓ writes and reads back a symbol file
  ✓ lists all indexed files after multiple writes
  ✓ deletes a symbol file and confirms removal
  ✓ returns undefined for non-existent symbol ID
  ✓ returns empty array for edges from non-existent symbol
  ✓ returns forward edges for a given symbol
  ✓ returns reverse edges pointing to a given symbol
  ✓ bulk writes multiple file indices atomically
  ✓ rebuilds from JSON index on cold start (no SQLite DB)
  ✓ auto-rebuilds when SQLite DB is corrupt (integrity check fails)
  ✓ uses WAL journal mode
  ✓ handles concurrent reads without blocking
  ✓ handles symbol ID with special characters (::, unicode)
```

`src/adapters/storage/__tests__/schema-manager.test.ts`

```
describe('SchemaManager')
  ✓ writes schema version on first run
  ✓ reads existing schema version
  ✓ detects version mismatch between current and stored
```

**Verify:** Identical input → byte-identical JSON output; SQLite rebuild from JSON fixtures

***

## Phase 3: TypeScript Language Adapter (Story 1.3)

**Files to create:**

* `src/ports/i-language-adapter.ts` — `ILanguageAdapter` interface (`extractSymbols`, `extractEdges`, `extractComplexity?`)
* `src/adapters/language/ts-morph-adapter.ts` — ts-morph parsing for TS/JS/TSX/JSX, symbol/edge extraction, complexity counting
* `src/adapters/language/language-adapter-registry.ts` — extension → adapter mapping

**Tests:**

`src/adapters/language/__tests__/ts-morph-adapter.test.ts`

```
describe('TsMorphAdapter — symbol extraction')
  ✓ extracts exported function as symbol with correct ID format
  ✓ extracts class with correct kind "class"
  ✓ extracts interface with correct kind "interface"
  ✓ extracts type alias with correct kind "type"
  ✓ extracts exported variable with correct kind "variable"
  ✓ extracts method inside class with correct symbolId
  ✓ generates deterministic symbolId across repeated parses
  ✓ skips non-exported symbols (private functions)
  ✓ handles re-exported symbols without infinite loops
  ✓ returns empty array for empty file
  ✓ returns empty array and logs stderr for syntax error file (warn-and-continue)
  ✓ handles TSX file with JSX elements
  ✓ handles JSX file
  ✓ handles file with only comments (no symbols)

describe('TsMorphAdapter — edge extraction')
  ✓ detects "imports" edge for named import
  ✓ detects "imports" edge for default import
  ✓ detects "extends" edge for class inheritance
  ✓ detects "implements" edge for interface implementation
  ✓ detects "calls" edge for static function call
  ✓ handles circular imports without infinite loop
  ✓ returns empty edges for file with no imports or references

describe('TsMorphAdapter — complexity extraction')
  ✓ returns complexity 1 for function with no branches
  ✓ returns higher complexity for function with if/else/switch
  ✓ counts nested conditionals correctly

describe('TsMorphAdapter — edge cases (TS-008)')
  ✓ handles file path with unicode characters
  ✓ handles very large file (1000+ lines)
  ✓ handles file with duplicate function names in different scopes
```

`src/adapters/language/__tests__/language-adapter-registry.test.ts`

```
describe('LanguageAdapterRegistry')
  ✓ returns TsMorphAdapter for .ts extension
  ✓ returns TsMorphAdapter for .tsx extension
  ✓ returns TsMorphAdapter for .js extension
  ✓ returns TsMorphAdapter for .jsx extension
  ✓ returns undefined for unsupported extension .py
  ✓ returns undefined for empty string extension
  ✓ returns undefined for null/undefined input
```

**Fixtures:** `src/adapters/language/__tests__/fixtures/` — sample TS/TSX/JS files covering each symbol and edge kind

**Verify:** Parse 100+ line TS file → all symbols + edges extracted; deterministic across repeated runs

***

## Phase 4: Core Graph & Logic-Slice (Stories 1.4, 1.5)

**Files to create:**

* `src/core/graph/symbol-graph.ts` — directed adjacency list, forward/reverse traversal
* `src/core/logic-slice/logic-slice-query.ts` — BFS transitive closure, cycle-safe, depth-limited
* `src/core/detail-levels/detail-formatter.ts` — L1 (≤150 lines), L2, L3, L4 (8000 token budget)

**Tests:**

`src/core/graph/__tests__/symbol-graph.test.ts`

```
describe('SymbolGraph')
  ✓ adds node and retrieves it by symbolId
  ✓ returns undefined for non-existent symbolId
  ✓ adds edge and retrieves forward edges
  ✓ retrieves reverse edges (dependents)
  ✓ reports correct nodeCount and edgeCount
  ✓ handles empty graph (zero nodes, zero edges)
  ✓ handles single node with no edges
  ✓ handles duplicate edge addition (no double-count)
  ✓ handles symbolId with special characters (::, unicode)
```

`src/core/logic-slice/__tests__/logic-slice-query.test.ts`

```
describe('LogicSliceQuery')
  ✓ returns root symbol with no dependencies when isolated
  ✓ returns direct dependency at depth 1
  ✓ returns transitive dependencies 3 levels deep
  ✓ terminates safely on circular dependency (A→B→C→A)
  ✓ respects depth limit parameter
  ✓ returns typed error for non-existent symbolId
  ✓ returns empty dependencies for leaf node
  ✓ handles graph with 1000 nodes in < 50ms (performance)
  ✓ includes all edges in the returned slice
  ✓ does not include nodes outside the transitive closure
```

`src/core/detail-levels/__tests__/detail-formatter.test.ts`

```
describe('DetailFormatter')
  ✓ L1 output contains root signature only and is ≤ 150 lines
  ✓ L2 output includes root + depth-1 dependencies
  ✓ L3 output includes full transitive closure
  ✓ L4 output includes source bodies within 8000 token budget
  ✓ L4 truncates and includes truncation metadata when budget exceeded
  ✓ returns truncation info with reason "token_budget_exceeded"
  ✓ handles empty dependency list at all levels
  ✓ handles single-line function at L1
```

**Verify:** 1000-node graph → logic-slice < 50ms; cycles don't hang

***

## Phase 5: MCP Server + Masking + `get_logic_slice` (Stories 1.6, 1.7)

**Files to create:**

* `src/ports/i-masking-port.ts` — `IMaskingPort` interface
* `src/core/masking/masking-pipeline.ts` — regex-based redaction (AWS keys, JWT, IPs, env vars), configurable patterns
* `src/adapters/mcp/get-logic-slice.ts` — tool handler, Zod input validation, never throws
* `src/adapters/mcp/tool-registry.ts` — registers tools with MCP Server
* Update `src/index.ts` — full wiring: storage → language → graph → masking → MCP

**Tests:**

`src/core/masking/__tests__/masking-pipeline.test.ts`

```
describe('MaskingPipeline')
  ✓ redacts AWS access key pattern (AKIA...)
  ✓ redacts JWT token pattern (eyJ...)
  ✓ redacts private IPv4 address (192.168.x.x, 10.x.x.x)
  ✓ redacts private IPv6 address (fc00::)
  ✓ redacts env variable values (*_SECRET, *_KEY, *_TOKEN, *_PASSWORD)
  ✓ does not redact normal code identifiers (no false positives)
  ✓ does not redact public IP-like version numbers (1.2.3.4 in semver context)
  ✓ redacts multiple sensitive patterns in single string
  ✓ returns empty string unchanged
  ✓ returns non-matching string unchanged
  ✓ applies custom patterns injected via constructor
  ✓ handles very long string (10K+ chars) without performance degradation
  ✓ handles string with unicode characters
```

`src/adapters/mcp/__tests__/get-logic-slice.test.ts`

```
describe('GetLogicSliceHandler')
  ✓ returns MCP response with content array for valid symbolId
  ✓ returns { found: false, hint: "run ctxo index" } for missing symbol
  ✓ returns { error: true, message } for invalid params (Zod rejection)
  ✓ returns correct shape for each detail level (1-4)
  ✓ applies masking — planted AWS key in fixture is redacted in response
  ✓ never throws — returns error shape on internal failure
  ✓ includes staleness warning when index is stale
  ✓ rejects symbolId that is empty string (AP-004)
  ✓ rejects detail level outside 1-4 range
  ✓ rejects detail level that is NaN
```

`src/adapters/mcp/__tests__/tool-registry.test.ts`

```
describe('ToolRegistry')
  ✓ tools/list returns get_logic_slice with valid inputSchema
  ✓ inputSchema includes required "symbolId" property
  ✓ inputSchema includes optional "level" property with enum [1,2,3,4]
```

`src/adapters/mcp/__tests__/mcp-integration.test.ts` (InMemoryTransport)

```
describe('MCP Integration — get_logic_slice round-trip')
  ✓ client calls get_logic_slice and receives valid JSON response
  ✓ response content[0].type is "text"
  ✓ parsed response payload contains root symbol and dependencies
```

**Verify:** `tools/list` returns `get_logic_slice`; startup < 100ms; no `console.log`

***

## Phase 6: `ctxo index` CLI Command (Story 1.8)

**Files to create:**

* `src/cli/index-command.ts` — file discovery (git ls-files), pipeline: discover → filter → extract → write JSON → populate SQLite
* `src/cli/cli-router.ts` — `process.argv` routing to subcommands
* Update `src/index.ts` — CLI mode vs MCP server mode

**Tests:**

`src/cli/__tests__/index-command.test.ts`

```
describe('IndexCommand')
  ✓ discovers all .ts and .tsx files in project directory
  ✓ skips .py and other unsupported extensions
  ✓ writes one JSON file per source file to .ctxo/index/
  ✓ populates SQLite cache from extracted data
  ✓ creates schema-version file on first run
  ✓ ensures .ctxo/.cache/ is in .gitignore
  ✓ logs progress to stderr (not stdout — MCP safe)
  ✓ handles project with zero supported files gracefully
  ✓ handles project with nested directory structure
  ✓ respects .gitignore patterns (skips node_modules, dist)
```

`src/cli/__tests__/cli-router.test.ts`

```
describe('CliRouter')
  ✓ routes "index" to IndexCommand
  ✓ outputs help text for --help flag
  ✓ returns error for unknown subcommand
  ✓ returns error when no subcommand provided (in CLI mode)
```

**Fixtures:** `src/cli/__tests__/fixtures/` — mini TypeScript project (3-5 files with cross-file imports)

**Verify:** E2E: temp dir with 5 TS files → `ctxo index` → 5 JSON files in `.ctxo/index/`

***

## Phase 7: Git + Why-Context + Change Intelligence (Epic 3)

**Files to create:**

* `src/ports/i-git-port.ts` — `IGitPort` interface
* `src/adapters/git/simple-git-adapter.ts` — commit history, blame, churn, warn-and-continue
* `src/core/why-context/why-context-assembler.ts` — assembles history + anti-patterns
* `src/core/why-context/revert-detector.ts` — `Revert "..."` / `revert:` pattern detection
* `src/core/change-intelligence/complexity-calculator.ts` — cyclomatic complexity from AST
* `src/core/change-intelligence/churn-analyzer.ts` — normalized churn (0-1)
* `src/core/change-intelligence/health-scorer.ts` — composite score, low/medium/high bands
* `src/adapters/mcp/get-why-context.ts` — MCP tool handler
* `src/adapters/mcp/get-change-intelligence.ts` — MCP tool handler

**Tests:**

`src/adapters/git/__tests__/simple-git-adapter.test.ts`

```
describe('SimpleGitAdapter')
  ✓ extracts commit history for a file with correct fields
  ✓ follows renamed files with --follow
  ✓ returns empty array when git is not available (warn-and-continue)
  ✓ returns empty array for file with no commits
  ✓ counts file churn (number of commits touching file)
  ✓ logs warning to stderr on git error (not stdout)
  ✓ handles file path with spaces
```

`src/core/why-context/__tests__/revert-detector.test.ts`

```
describe('RevertDetector')
  ✓ detects 'Revert "original message"' pattern
  ✓ detects 'revert: description' prefix pattern
  ✓ returns empty array when no revert commits found
  ✓ detects multiple revert commits in history
  ✓ extracts original commit reference from revert message
  ✓ handles commit message with only "revert" word (not a pattern match)
  ✓ handles empty commit message
  ✓ handles commit message with unicode characters
```

`src/core/why-context/__tests__/why-context-assembler.test.ts`

```
describe('WhyContextAssembler')
  ✓ assembles result with commit history and anti-pattern warnings
  ✓ returns empty commitHistory when no history provided
  ✓ includes anti-pattern warnings when revert commits present
  ✓ returns empty antiPatternWarnings when no reverts found
```

`src/core/change-intelligence/__tests__/complexity-calculator.test.ts`

```
describe('ComplexityCalculator')
  ✓ returns complexity 1 for function with no decision points
  ✓ returns higher complexity for nested if/else/switch
  ✓ handles zero decision points (baseline 1)
  ✓ handles NaN input gracefully
```

`src/core/change-intelligence/__tests__/churn-analyzer.test.ts`

```
describe('ChurnAnalyzer')
  ✓ normalizes churn to 0-1 range relative to repo max
  ✓ returns 0 for file with zero commits
  ✓ returns 1 for file with maximum churn in repo
  ✓ handles repo with single file (churn = 1.0)
  ✓ handles negative churn value (invalid input — fail fast)
```

`src/core/change-intelligence/__tests__/health-scorer.test.ts`

```
describe('HealthScorer')
  ✓ returns "low" band for score 0.0 - 0.3
  ✓ returns "medium" band for score 0.3 - 0.7
  ✓ returns "high" band for score 0.7 - 1.0
  ✓ handles boundary value 0.0 as "low"
  ✓ handles boundary value 0.3 as "medium" (inclusive)
  ✓ handles boundary value 0.7 as "high" (inclusive)
  ✓ handles boundary value 1.0 as "high"
  ✓ handles new symbol with zero churn → "low"
  ✓ computes composite as complexity × churn
```

`src/adapters/mcp/__tests__/get-why-context.test.ts`

```
describe('GetWhyContextHandler')
  ✓ returns MCP response shape with commit history
  ✓ includes anti-pattern badge when revert warnings exist
  ✓ applies masking to commit messages (redacts planted credential in message)
  ✓ returns { found: false } for non-existent symbol
  ✓ never throws on internal failure
```

`src/adapters/mcp/__tests__/get-change-intelligence.test.ts`

```
describe('GetChangeIntelligenceHandler')
  ✓ returns MCP response with complexity, churn, composite score, band
  ✓ returns correct band for known fixture data
  ✓ returns { found: false } for non-existent symbol
```

**Fixtures:** `src/adapters/git/__tests__/fixtures/` — scripted git repo with commits + reverts

**Verify:** Fixture git repo with revert → anti-pattern warning surfaced

***

## Phase 8: Blast Radius & Architectural Overlay (Epic 2)

**Files to create:**

* `src/core/blast-radius/blast-radius-calculator.ts` — reverse BFS, ranked by depth
* `src/core/overlay/architectural-overlay.ts` — path-based layer classification, configurable
* `src/adapters/mcp/get-blast-radius.ts` — MCP tool handler
* `src/adapters/mcp/get-architectural-overlay.ts` — MCP tool handler

**Tests:**

`src/core/blast-radius/__tests__/blast-radius-calculator.test.ts`

```
describe('BlastRadiusCalculator')
  ✓ returns direct dependents for a symbol
  ✓ returns transitive dependents (A depends B depends C → blast of C includes A, B)
  ✓ ranks dependents by depth ascending
  ✓ returns empty array for leaf symbol (no dependents)
  ✓ terminates safely on circular dependency (visited set guard)
  ✓ returns correct dependentCount for each entry
  ✓ handles symbol with 100+ dependents (performance)
```

`src/core/overlay/__tests__/architectural-overlay.test.ts`

```
describe('ArchitecturalOverlay')
  ✓ classifies core/ files as "Domain" layer
  ✓ classifies adapters/ files as "Adapter" layer
  ✓ classifies infra/db/queue files as "Infrastructure" layer
  ✓ classifies unknown paths as "Unknown" layer
  ✓ applies custom configurable rules
  ✓ returns all layers with file lists
  ✓ handles empty file list
  ✓ handles flat project structure (all Unknown)
```

`src/adapters/mcp/__tests__/get-blast-radius.test.ts`

```
describe('GetBlastRadiusHandler')
  ✓ returns MCP response with ranked dependents
  ✓ returns { found: false } for missing symbol
  ✓ applies masking to response
```

`src/adapters/mcp/__tests__/get-architectural-overlay.test.ts`

```
describe('GetArchitecturalOverlayHandler')
  ✓ returns MCP response with layer map
  ✓ filters by specific layer when parameter provided
  ✓ returns all layers when no filter
```

`src/adapters/mcp/__tests__/mcp-all-tools-integration.test.ts` (InMemoryTransport)

```
describe('MCP Integration — all 5 tools')
  ✓ tools/list returns all 5 tool names
  ✓ each tool responds with valid MCP content shape
  ✓ each tool handles missing symbol gracefully
```

**Verify:** All 5 MCP tools registered in `tools/list`; InMemoryTransport integration for all 5

***

## Phase 9: Index Lifecycle & Team Collaboration (Epics 4 + 5)

**Files to create:**

* `src/cli/watch-command.ts` — chokidar watcher, 300ms debounce
* `src/cli/sync-command.ts` — rebuild SQLite from JSON
* `src/cli/verify-command.ts` — `ctxo verify-index` (index + git diff --exit-code)
* `src/cli/status-command.ts` — `ctxo status` manifest
* `src/cli/init-command.ts` — git hook installation (idempotent markers)
* `src/core/staleness/staleness-detector.ts` — mtime comparison
* `src/core/staleness/content-hasher.ts` — SHA-256 for `--check`
* `src/adapters/watcher/chokidar-watcher-adapter.ts` — wraps chokidar
* Update `src/cli/index-command.ts` — add `--file`, `--check` flags

**Tests:**

`src/cli/__tests__/watch-command.test.ts`

```
describe('WatchCommand')
  ✓ triggers re-index after 300ms debounce on file change
  ✓ does not trigger multiple re-indexes within debounce window
  ✓ stops gracefully on SIGINT without corrupting index
  ✓ re-validates SQLite vs JSON on restart
  ✓ ignores changes in .ctxo/.cache/ directory
```

`src/cli/__tests__/sync-command.test.ts`

```
describe('SyncCommand')
  ✓ rebuilds SQLite from committed JSON index files
  ✓ handles empty index directory
  ✓ skips corrupt JSON files with stderr warning
```

`src/cli/__tests__/verify-command.test.ts`

```
describe('VerifyCommand')
  ✓ exits 0 when index matches source files
  ✓ exits 1 when source file modified after index
  ✓ exits 1 when new source file not yet indexed
```

`src/cli/__tests__/status-command.test.ts`

```
describe('StatusCommand')
  ✓ reports correct indexed file count
  ✓ reports schema version
  ✓ detects orphaned index files (source deleted, index remains)
  ✓ handles empty index directory
```

`src/cli/__tests__/init-command.test.ts`

```
describe('InitCommand')
  ✓ installs post-commit and post-merge git hooks
  ✓ preserves existing hook content (appends ctxo block)
  ✓ is idempotent — running twice does not duplicate ctxo block
  ✓ uses # ctxo-start / # ctxo-end markers
```

`src/core/staleness/__tests__/staleness-detector.test.ts`

```
describe('StalenessDetector')
  ✓ returns empty list when all files are fresh
  ✓ returns stale file when source mtime > index mtime
  ✓ returns multiple stale files
  ✓ handles missing index file for existing source
```

`src/core/staleness/__tests__/content-hasher.test.ts`

```
describe('ContentHasher')
  ✓ produces identical hash for identical content
  ✓ produces different hash for different content
  ✓ handles empty string input
  ✓ handles very large string (100K+ chars)
```

`src/adapters/watcher/__tests__/chokidar-watcher-adapter.test.ts`

```
describe('ChokidarWatcherAdapter')
  ✓ emits change event for modified file
  ✓ respects .gitignore patterns
  ✓ debounces rapid changes to single event
  ✓ calls cleanup on stop (TS-010 — verify close() called)
```

**Verify:** E2E: index → modify file → `--check` fails → re-index → passes

***

## Phase 10: Cross-Client Compliance & Release (Epic 6)

**Files to create:**

* `tests/e2e/mcp-spec-compliance.test.ts` — JSON Schema validation for all tools
* `tests/e2e/performance-benchmark.test.ts` — startup < 100ms, p95 < 500ms, build < 30s
* `tests/e2e/privacy-zero-leakage.test.ts` — planted credentials, scan all responses
* `tests/e2e/fixtures/` — credential fixture + 1000-file project generator
* Finalize `package.json` — `files`, `bin`, `npm pack` verification

**Verify:** `npm pack` → clean tarball; all benchmarks pass; zero credential leakage

***

## V1.5 (Future — Not in scope)

* **Epic 7:** tree-sitter adapter for Go + C# (syntax tier)
* **Epic 8:** Webhook listener for GitHub/GitLab push events

***

## Relative Effort

| Phase                | Effort | Running Total |
| -------------------- | ------ | ------------- |
| 1. Scaffold          | 1x     | 1x            |
| 2. Storage           | 2x     | 3x            |
| 3. ts-morph          | 3x     | 6x            |
| 4. Core Graph        | 2x     | 8x            |
| 5. MCP + Masking     | 3x     | 11x           |
| 6. CLI index         | 2x     | 13x           |
| 7. Git + Why-Context | 3x     | 16x           |
| 8. Blast Radius      | 2x     | 18x           |
| 9. Lifecycle         | 3x     | 21x           |
| 10. Release          | 2x     | 23x           |

## Key Risks

1. **ts-morph performance** → benchmark at Phase 3, single `Project` instance, `skipLibCheck: true`
2. **Symbol ID collisions** (overloads) → append `:N` suffix if same file::name::kind detected
3. **better-sqlite3 native build on Windows** → marked external in tsup, documented Node.js requirement
4. **MCP SDK API changes** → pin version, InMemoryTransport tests catch breaks early

