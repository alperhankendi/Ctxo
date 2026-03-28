---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - 'artifacts/planning-artifacts/prd.md'
  - 'artifacts/architecture.md'
---

# Ctxo - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Ctxo, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Developer can build a full codebase index from the command line in a single command
FR2: Developer can trigger incremental re-indexing for a single file or directory
FR3: Developer can start a file watcher that automatically re-indexes changed files
FR4: Developer can verify whether the current index is up to date with source code (for CI use)
FR5: Developer can view a manifest of what is currently indexed (file count, last-updated timestamps)
FR6: The system detects index staleness and surfaces an actionable warning in MCP tool responses
FR7: The system auto-discovers monorepo workspaces and indexes all packages
FR8: AI assistant can retrieve a Logic-Slice for a named symbol — the symbol plus all transitive dependencies (interfaces, types, helpers) across files
FR9: AI assistant can request a Logic-Slice at four progressive detail levels (L1 minimal → L4 full) to manage context window size
FR10: AI assistant can retrieve the blast radius for a symbol — symbols that would break if it changed, ranked by dependency depth
FR11: AI assistant can retrieve an architectural overlay — a layer map identifying Domain, Infrastructure, and Adapter boundaries
FR12: AI assistant can retrieve why-context for a symbol — git commit intent, PR rationale, and anti-pattern warnings from revert history
FR13: AI assistant can retrieve a change intelligence score for a symbol — a composite of cyclomatic complexity and change frequency
FR14: The system parses git history to detect revert commits and associates revert rationale with affected symbols
FR15: The system surfaces anti-pattern warnings when a symbol with revert history is queried via `get_why_context`
FR16: Anti-pattern warnings persist in the committed index and are available to any developer or AI assistant after `git clone`
FR17: The system strips API keys, credentials, tokens, and private IP addresses from all MCP tool responses before delivery to the AI client
FR18: The privacy masking pipeline is configurable — developers can extend the pattern list for domain-specific sensitive identifiers
FR19: The local SQLite query cache is never committed to git (enforced via `.gitignore` template generated on first run)
FR20: Developer can commit the codebase index to git as text-based, per-file JSON artifacts
FR21: The committed index is diffable in pull requests — changes to indexed symbols appear as line-level diffs
FR22: A developer who clones a repository with a committed index gets full context immediately, without running `ctxo index`
FR23: The CI system can gate pull requests on index freshness — failing the build when source changes are not reflected in the index
FR24: Developer can configure any MCP-compatible AI client to use Ctxo with a single JSON configuration entry
FR25: Ctxo MCP server starts as a subprocess and is ready to serve queries without manual startup steps
FR26: All five MCP tools are callable from Claude Code, Cursor, and VS Code Copilot without client-specific configuration differences
FR27: Developer can index and query TypeScript, JavaScript, and TSX/JSX codebases with full type-aware dependency resolution (V1)
FR28: Developer can index and query Go and C# codebases with syntax-level dependency resolution (V1.5)

### Non-Functional Requirements

NFR1: All five MCP tools respond in < 500ms p95 on a warm index for a TypeScript codebase of ≤ 1,000 files
NFR2: MCP server process is ready to accept connections in < 100ms from process spawn
NFR3: Full initial index build completes in ≤ 30s for a 1,000-file codebase on a modern developer machine (MacBook M-series or equivalent)
NFR4: Incremental re-indexing for a single changed file completes in < 2s
NFR5: Logic-Slice responses at L1 depth are ≤ 150 lines; L4 depth responses stay within an 8,000-token budget
NFR6: Index size for a 1,000-file TypeScript codebase does not exceed 10MB on disk
NFR7: No source code, symbol names, or index content is transmitted to any remote server — all processing is strictly local
NFR8: Privacy masking pipeline detects and redacts AWS/GCP/Azure credential patterns, JWT tokens, private IPv4/IPv6 addresses, and common `.env` variable patterns (`*_SECRET`, `*_KEY`, `*_TOKEN`, `*_PASSWORD`)
NFR9: SQLite query cache (`.ctxo/.cache/`) contains no plaintext source code — only derived query results
NFR10: Ctxo runs with no elevated privileges; does not require sudo or admin rights
NFR11: Index staleness is detected and reported within the MCP tool response — never silently served as fresh context
NFR12: A crashed or stopped file watcher does not corrupt the committed index; on restart re-validates state before resuming
NFR13: If the SQLite cache is deleted or corrupted, Ctxo rebuilds it from the committed JSON index without user intervention
NFR14: `npx ctxo index --check` exits with a non-zero code when any source file has been modified after the index was last built
NFR15: Ctxo implements the MCP specification without extensions or deviations that break conformant MCP client compatibility
NFR16: All five MCP tools are tested for functional equivalence across Claude Code, Cursor, and VS Code Copilot before V1 release
NFR17: The MCP server exposes a `tools/list` response conformant with the MCP spec
NFR18: Ctxo requires only Node.js ≥ 18 and git as runtime dependencies — no additional system installation required

### Additional Requirements

Architecture & Infrastructure:
- AR1: Project uses Node.js ≥ 20 (required by Chokidar v5 ESM-only and OTel --import flag)
- AR2: No starter template — custom tsup + TypeScript setup from scratch; first story is project scaffold
- AR3: ESM-first ("type": "module"), ES2022 target, Node16 module resolution in tsconfig
- AR4: tsup build with external: ['better-sqlite3', 'tree-sitter'] to preserve native addon .node binary resolution
- AR5: Single dist/index.js output with bin field in package.json for npx ctxo invocation

Hexagonal Architecture Rules (enforced by ESLint import/no-restricted-paths):
- AR6: core/ NEVER imports from adapters/ — pure domain logic only
- AR7: ports/ NEVER imports from adapters/ — interfaces only
- AR8: Every adapter MUST implement a corresponding port interface
- AR9: Dependency wiring happens ONLY in src/index.ts (composition root)
- AR10: No barrel exports (index.ts re-exports) — import directly from source file paths

Naming & Consistency Rules:
- AR11: console.log FORBIDDEN anywhere in src/ — MCP stdio uses stdout for JSON-RPC; use console.error only
- AR12: Symbol ID format: deterministic string "relativeFile::name::kind" (e.g. "src/foo.ts::myFn::function")
- AR13: SQLite table/column naming: snake_case; TypeScript types: PascalCase; files: kebab-case; JSON index fields: camelCase
- AR14: MCP tool response shape: { content: [{ type: 'text', text: JSON.stringify(payload) }] } — no exceptions
- AR15: All adapter methods follow warn-and-continue: try/catch returns fallback, never throws outward
- AR16: Tests co-located in __tests__/ adjacent to source file

Index & Storage:
- AR17: Per-file JSON index at .ctxo/index/<relative-path>.json (committed to git)
- AR18: SQLite cache at .ctxo/.cache/symbols.db (gitignored) — WAL mode, rebuilt from JSON on cold start
- AR19: Schema versioning: .ctxo/index/schema-version file; auto-migration on startup
- AR20: All paths stored relative to repo root; resolved at query time

CI/CD Patterns:
- AR21: CLI commands required: ctxo index, ctxo sync, ctxo verify-index
- AR22: CI gate pattern: npx ctxo index then git diff --exit-code .ctxo/index/
- AR23: Optional git hooks installed via ctxo init: post-commit (ctxo index --since HEAD~1), post-merge (ctxo sync)

Testing Requirements:
- AR24: Unit tests: vitest, ≥90% line coverage on core domain modules
- AR25: Integration tests: InMemoryTransport from @modelcontextprotocol/sdk — no real MCP client needed
- AR26: E2E tests: real TypeScript fixture projects on disk; CI on macOS + Linux across Node 18, 20, 22
- AR27: Privacy masking validation: dedicated synthetic credential fixture set, zero-leakage gate before release

### UX Design Requirements

N/A — Ctxo is a CLI tool and MCP server with no visual UI. All user interaction occurs via the AI assistant client (Claude Code, Cursor, etc.) or the terminal.

### FR Coverage Map

FR1: Epic 1 — Full index build command
FR2: Epic 4 — Incremental re-indexing
FR3: Epic 4 — File watcher
FR4: Epic 4 — CI freshness check command
FR5: Epic 4 — Index manifest
FR6: Epic 4 — Staleness detection & warnings
FR7: Epic 5 — Monorepo auto-discovery
FR8: Epic 1 — Logic-Slice retrieval
FR9: Epic 1 — L1–L4 progressive detail levels
FR10: Epic 2 — Blast radius
FR11: Epic 2 — Architectural overlay
FR12: Epic 3 — Why-context
FR13: Epic 3 — Change intelligence score
FR14: Epic 3 — Revert commit detection
FR15: Epic 3 — Anti-pattern warnings
FR16: Epic 3 — Persistent anti-pattern memory in committed index
FR17: Epic 1 — Privacy masking pipeline
FR18: Epic 1 — Configurable masking patterns
FR19: Epic 1 — .gitignore cache enforcement
FR20: Epic 5 — Committed JSON index
FR21: Epic 5 — PR-diffable index
FR22: Epic 5 — Clone-ready context
FR23: Epic 5 — CI gate
FR24: Epic 1 — Single-line MCP client config
FR25: Epic 1 — MCP server auto-start subprocess
FR26: Epic 6 — Cross-client compatibility
FR27: Epic 1 — TypeScript/JavaScript/TSX support
FR28: Epic 7 — Go + C# syntax-level support

## Epic List

### Epic 1: Developer Installs Ctxo and Gets First Logic-Slice
Developer installs Ctxo with a single command, indexes their TypeScript codebase, configures their MCP client with one JSON line, and receives surgical Logic-Slice context in their AI assistant — with privacy masking active from the first response.
**FRs covered:** FR1, FR8, FR9, FR17, FR18, FR19, FR24, FR25, FR27
**ARs covered:** AR1–AR20 (project scaffold, hexagonal foundation, index/storage)

#### Story 1.1: Project Scaffold & Hexagonal Foundation
**As a** contributor, **I want** the project scaffolded with the hexagonal architecture enforced at the tooling level, **so that** all future code lands in the correct layer without manual review.

**Acceptance Criteria:**
- `package.json` has `"type": "module"`, Node ≥ 20, tsup build, `bin: { ctxo: "dist/index.js" }`
- `tsconfig.json`: `target: ES2022`, `module: Node16`, `moduleResolution: Node16`, `strict: true`
- Directory structure exists: `src/core/`, `src/ports/`, `src/adapters/`, `src/cli/`, `src/index.ts`
- ESLint configured with `import/no-restricted-paths`: `core/` cannot import from `adapters/`; `ports/` cannot import from `adapters/`
- ESLint rule bans `console.log` anywhere in `src/` (use `console.error` only)
- `vitest` configured with coverage threshold ≥ 90% for `src/core/`
- `npx ctxo --help` exits 0 after `tsup` build

#### Story 1.2: Storage Foundation — IStoragePort, JSON Index Writer & SQLite Cache
**As a** developer, **I want** a storage layer that writes per-file JSON index artifacts and maintains a local SQLite query cache, **so that** the index is git-committable and the cache is fast and recoverable.

**Acceptance Criteria:**
- `src/ports/storage.port.ts` defines `IStoragePort` with methods: `writeSymbolFile`, `readSymbolFile`, `listIndexedFiles`, `deleteSymbolFile`
- `src/adapters/storage/json-index-writer.ts` implements `IStoragePort`, writes to `.ctxo/index/<relative-path>.json`
- `src/adapters/storage/sqlite-cache.ts` implements cache adapter; SQLite in WAL mode; tables: `symbols`, `edges`, `metadata`
- On first `ctxo index` run, `.gitignore` is checked/updated to include `.ctxo/.cache/`
- Schema version stored in `.ctxo/index/schema-version`; adapter reads and validates on startup
- All paths stored relative to repo root
- Unit tests: `IStoragePort` contract tested against both adapters; `__tests__/` co-located

#### Story 1.3: TypeScript Language Adapter — ts-morph Symbol & Edge Extraction
**As a** developer, **I want** the system to parse TypeScript/JavaScript/TSX files and extract symbols with their dependency edges, **so that** the dependency graph can be built accurately.

**Acceptance Criteria:**
- `src/ports/language.port.ts` defines `ILanguageAdapter` with `extractSymbols(filePath): SymbolNode[]` and `extractEdges(filePath): Edge[]`
- `src/adapters/language/ts-morph.adapter.ts` implements `ILanguageAdapter` using ts-morph
- Extracts symbol kinds: `function`, `class`, `interface`, `type`, `variable` (exported only)
- Symbol ID format: `"relativeFile::name::kind"` (e.g. `"src/foo.ts::myFn::function"`)
- Edges extracted: `imports`, `implements`, `extends`, `calls` (where statically resolvable)
- `.tsx` and `.jsx` files handled without errors
- Unit tests cover: function, class, interface, generic type, re-export, barrel file

#### Story 1.4: Core Symbol Graph & Logic-Slice Query
**As an** AI assistant, **I want** to query the symbol graph for a Logic-Slice rooted at a named symbol, **so that** I receive the symbol plus all transitive dependencies in a single response.

**Acceptance Criteria:**
- `src/core/graph.ts` builds an in-memory directed graph from `IStoragePort` data
- `src/core/logic-slice.ts` implements `getLogicSlice(symbolId, depth)` using BFS transitive closure
- Returns: `{ root: SymbolNode, dependencies: SymbolNode[], edges: Edge[] }`
- Cycles in the dependency graph do not cause infinite loops (visited-set guard)
- Graph rebuild triggered when index mtime is newer than cache mtime
- Unit tests: direct dep, transitive dep 3 levels deep, circular dep guard, missing symbol returns typed error

#### Story 1.5: Progressive Detail Levels L1–L4
**As an** AI assistant, **I want** to request a Logic-Slice at a specific detail level, **so that** I can manage my context window and avoid exceeding token budgets.

**Acceptance Criteria:**
- `level` parameter accepted on `getLogicSlice`: `1 | 2 | 3 | 4`
- L1: root symbol signature only (≤ 150 lines enforced)
- L2: root + direct (depth-1) dependencies
- L3: root + full transitive dependency closure
- L4: L3 + source bodies included, token budget enforcer caps at 8,000 tokens (characters/4 approximation acceptable for V1)
- Token budget exceeded → response truncated with `{ truncated: true, reason: "token_budget_exceeded" }` field
- Unit tests cover all four levels and truncation path

#### Story 1.6: Privacy Masking Pipeline
**As a** developer, **I want** all MCP tool responses sanitized before delivery, **so that** API keys, credentials, and sensitive tokens never reach the AI model.

**Acceptance Criteria:**
- `src/ports/masking.port.ts` defines `IMaskingPort` with `mask(text: string): string`
- `src/adapters/masking/regex-masking.adapter.ts` implements `IMaskingPort`
- Default patterns detected and redacted (replaced with `[REDACTED]`):
  - AWS Access Key (`AKIA[0-9A-Z]{16}`)
  - GCP/Azure credential JSON fields
  - JWT tokens (`eyJ...`)
  - Private IPv4 (`10.x`, `172.16–31.x`, `192.168.x`)
  - Private IPv6 (`::1`, `fc00::/7`)
  - Env variable patterns: `*_SECRET`, `*_KEY`, `*_TOKEN`, `*_PASSWORD` (value-side only)
- Developer can extend patterns via `.ctxo/masking.config.json` (array of regex strings)
- Masking applied as the final step in every MCP tool response before serialization
- Privacy validation tests: synthetic credential fixture → zero leakage assertion

#### Story 1.7: MCP Server Entry Point & `get_logic_slice` Tool Handler
**As an** AI assistant client, **I want** to connect to Ctxo as an MCP server and call `get_logic_slice`, **so that** I receive structured dependency-aware context.

**Acceptance Criteria:**
- `src/index.ts` is the composition root; wires all ports → adapters; starts `StdioServerTransport`
- MCP server starts and is ready in < 100ms from process spawn
- `tools/list` response lists all 5 tools with correct JSON Schema parameter definitions
- `get_logic_slice` accepts `{ symbolId: string, level?: 1|2|3|4 }`, returns `{ content: [{ type: 'text', text: JSON.stringify(payload) }] }`
- Staleness warning prepended to response when source mtime > index mtime: `{ warning: "Index may be stale. Run ctxo index." }`
- `console.log` absent from all `src/` files (ESLint enforced)
- Integration test using `InMemoryTransport` from `@modelcontextprotocol/sdk`

#### Story 1.8: `ctxo index` CLI Command — Full Pipeline
**As a** developer, **I want** to run `ctxo index` and build the complete codebase index in a single command, **so that** my AI assistant has full context immediately.

**Acceptance Criteria:**
- `ctxo index` discovers all `.ts`, `.tsx`, `.js`, `.jsx` files from repo root (respects `.gitignore`)
- Pipeline: file discovery → ts-morph extraction → graph build → JSON index write → SQLite cache populate
- Progress reported to `stderr` (not `stdout`): file count, elapsed time
- Completes in ≤ 30s for 1,000-file codebase on M-series Mac (measured in E2E test)
- `.ctxo/index/schema-version` written/updated
- `.ctxo/.cache/` added to `.gitignore` if not present
- `npx ctxo index` exits 0 on success, non-zero on unrecoverable error
- E2E test: fixture TypeScript project → run `ctxo index` → assert `.ctxo/index/` files created

### Epic 2: Risk Intelligence — Blast Radius & Architectural Overlay
AI assistant can retrieve the blast radius of any symbol (what breaks if it changes) and an architectural layer map of the codebase, enabling risk-aware changes before any modification is made.
**FRs covered:** FR10, FR11

#### Story 2.1: Reverse Dependency Graph & Blast Radius Score
**As an** AI assistant, **I want** to query the blast radius of a symbol, **so that** I understand the downstream risk before modifying it.

**Acceptance Criteria:**
- `src/core/blast-radius.ts` implements `getBlastRadius(symbolId)` via reverse edge traversal on the dependency graph
- Returns ranked list: `{ symbolId, depth, dependentCount }[]` sorted by depth ascending
- `get_blast_radius` MCP tool handler wired in `src/index.ts`; accepts `{ symbolId: string }`
- Response shape: `{ content: [{ type: 'text', text: JSON.stringify({ root, impactedSymbols }) }] }`
- Masking pipeline applied to all symbol source snippets in response
- Unit tests: direct dependent, transitive chain, no dependents (leaf symbol), circular reference guard

#### Story 2.2: Architectural Overlay — Layer Detection & Map
**As an** AI assistant, **I want** to retrieve an architectural layer map of the codebase, **so that** I understand Domain, Infrastructure, and Adapter boundaries before editing.

**Acceptance Criteria:**
- `src/core/architectural-overlay.ts` implements `getArchitecturalOverlay()` using path + naming heuristics
- Layer classification rules: `core/` → Domain; `adapters/` → Adapter; `infra/`, `db/`, `queue/` → Infrastructure; unclassified → Unknown
- Returns: `{ layers: { [layer: string]: string[] } }` (layer → list of file paths)
- `get_architectural_overlay` MCP tool handler wired; accepts no required parameters
- Result cached in SQLite; invalidated when index mtime changes
- Unit tests: standard hexagonal layout, flat layout (all Unknown), mixed layout

### Epic 3: Historical Consciousness — Why-Context, Anti-Pattern Memory & Change Intelligence
AI assistant can retrieve git commit intent, revert-sourced anti-pattern warnings, and a composite complexity×churn health score for any symbol — giving it the institutional memory of a well-onboarded senior developer.
**FRs covered:** FR12, FR13, FR14, FR15, FR16

#### Story 3.1: Git Port — Commit History & Blame Per Symbol
**As a** developer, **I want** the index to capture git commit history per symbol, **so that** the AI can retrieve the intent behind each change.

**Acceptance Criteria:**
- `src/ports/git.port.ts` defines `IGitPort` with `getCommitHistory(filePath): Commit[]` and `getBlameLines(filePath): BlameLine[]`
- `src/adapters/git/git-log.adapter.ts` implements `IGitPort` using `git log --follow -p` subprocess
- Commit record: `{ sha, author, date, message, touchedSymbols: string[] }` — symbol IDs derived from diff hunks
- Commit history stored as `gitHistory` array in per-file JSON index artifact
- `IGitPort` methods follow warn-and-continue: any git subprocess failure returns `[]` with `console.error` log
- Unit tests with fixture git repo (bare init + commits); tests for renamed file (`--follow`)

#### Story 3.2: Revert Commit Detection & Anti-Pattern Memory
**As an** AI assistant, **I want** to be warned when a symbol has a revert history, **so that** I don't repeat an approach that was already tried and abandoned.

**Acceptance Criteria:**
- `src/core/revert-detector.ts` scans commit history for messages matching `Revert "..."` or `revert:` prefix
- Extracts reverted commit SHA, retrieves original commit message as rationale
- Anti-pattern record: `{ symbolId, revertSha, originalSha, rationale, date }` stored in per-file JSON index (persists in git)
- Anti-pattern records survive `git clone` — no rebuild needed (FR16)
- `get_why_context` response includes `antiPatternWarnings: AntiPattern[]` field
- Unit tests: revert commit pattern matching, rationale extraction, no-revert path

#### Story 3.3: Change Intelligence Score
**As an** AI assistant, **I want** a composite health score for any symbol, **so that** I know whether it is high-risk to modify before I start.

**Acceptance Criteria:**
- `src/core/change-intelligence.ts` implements `getChangeIntelligence(symbolId)`
- Cyclomatic complexity: counted from AST (decision points: `if`, `else if`, `for`, `while`, `case`, `&&`, `||`, `??`, ternary)
- Churn: `git log --follow --format="%H" -- <file>` line count → change frequency
- Composite score: `complexity × churn` (both normalized 0–1 relative to repo max before multiplication)
- Score bands: `low` (0–0.3), `medium` (0.3–0.7), `high` (0.7–1.0)
- `get_change_intelligence` MCP tool handler wired; accepts `{ symbolId: string }`
- Unit tests: pure function (low complexity, low churn), hotspot (high both), new symbol (zero churn)

#### Story 3.4: `get_why_context` MCP Tool — History + Anti-Pattern Surface
**As an** AI assistant, **I want** to call `get_why_context` and receive commit intent plus anti-pattern warnings for a symbol in one response, **so that** I have full historical context before modifying it.

**Acceptance Criteria:**
- `get_why_context` MCP tool handler wired; accepts `{ symbolId: string }`
- Response assembles: `{ commitHistory: Commit[], antiPatternWarnings: AntiPattern[], changeIntelligence: Score }`
- Anti-pattern warnings include a `warningBadge: "⚠ Anti-pattern detected"` string field when warnings present
- Masking pipeline applied to all commit message text and source snippets
- Response shape conforms to `{ content: [{ type: 'text', text: JSON.stringify(payload) }] }`
- Integration test: fixture repo with revert commit → assert warning present in response

### Epic 4: Index Lifecycle & Developer Experience
Developer has a seamless local workflow: incremental re-indexing on file change, a file watcher for continuous freshness, a CI check command, an index manifest, and actionable staleness warnings in MCP responses.
**FRs covered:** FR2, FR3, FR4, FR5, FR6

#### Story 4.1: Incremental Re-indexing — `ctxo index --file <path>`
**As a** developer, **I want** to re-index a single changed file without rebuilding the entire index, **so that** incremental updates complete in under 2 seconds.

**Acceptance Criteria:**
- `ctxo index --file <path>` re-runs extraction only for the specified file and updates `.ctxo/index/<path>.json` and SQLite cache
- Hash comparison (SHA-256 of file content) skips re-indexing if file is unchanged
- Completes in < 2s for a single file on a 1,000-file indexed codebase
- File not found → exits non-zero with clear error to stderr
- Unit tests: changed file re-indexed, unchanged file skipped, deleted file removes index artifact

#### Story 4.2: File Watcher — `ctxo watch`
**As a** developer, **I want** a file watcher that automatically re-indexes changed files as I edit, **so that** my AI assistant always has fresh context without manual commands.

**Acceptance Criteria:**
- `ctxo watch` starts Chokidar v5 watcher on repo root (respects `.gitignore`)
- Debounce: 300ms after last change event before triggering re-index
- Re-index triggered per changed file via Story 4.1 pipeline
- Watcher stop (SIGINT/SIGTERM) does not corrupt committed index
- On restart, re-validates SQLite cache against JSON index before resuming (NFR12)
- Status messages logged to stderr: `[ctxo watch] Watching N files...`, `[ctxo watch] Re-indexed src/foo.ts (120ms)`

#### Story 4.3: Staleness Detection in MCP Responses
**As an** AI assistant, **I want** to be notified when the index is stale, **so that** I can prompt the developer to refresh before I act on outdated context.

**Acceptance Criteria:**
- On every MCP tool call, compare mtime of each source file in the response against its index artifact mtime
- If any source file is newer than its index artifact: prepend `{ warning: "Index may be stale for N file(s). Run: ctxo index", stale: true }` to response payload
- Staleness never silently served as fresh context (NFR11)
- Staleness check completes within the 500ms p95 budget (fast mtime stat, not full re-parse)
- Unit tests: fresh index (no warning), one stale file (warning), all stale (warning with count)

#### Story 4.4: CI Freshness Check — `ctxo index --check`
**As a** CI system, **I want** `ctxo index --check` to exit non-zero when source changes are not reflected in the index, **so that** stale PRs are gated automatically.

**Acceptance Criteria:**
- `ctxo index --check` computes SHA-256 hash for each source file and compares against stored hash in JSON index
- Exits 0 when all hashes match
- Exits 1 when any file hash differs or any source file has no corresponding index artifact
- Prints stale file list to stderr
- Exits 0 on a repo with no `.ctxo/index/` directory (not-yet-indexed is not a failure)
- E2E test: index built → file modified → `--check` exits 1; file re-indexed → `--check` exits 0

#### Story 4.5: Index Manifest — `ctxo status`
**As a** developer, **I want** to see what is currently indexed and when each file was last indexed, **so that** I can verify coverage and diagnose staleness.

**Acceptance Criteria:**
- `ctxo status` reads `.ctxo/index/` directory and outputs to stderr:
  - Total indexed file count
  - Schema version
  - Per-file: relative path + last-indexed timestamp (ISO 8601)
  - Files with no source match flagged as `[orphaned]`
- Output formatted as plain text table (no external table library)
- Works without SQLite cache present (reads JSON index directly)

### Epic 5: Team Collaboration — Committed Index & CI Gate
Team commits the index to git as text-based per-file JSON, CI gates stale PRs, new joiners get full context on git clone, and monorepo workspaces are auto-discovered.
**FRs covered:** FR7, FR20, FR21, FR22, FR23

#### Story 5.1: Committed Index — PR-Diffable JSON Format
**As a** developer, **I want** the index artifacts to produce clean, line-level diffs in PRs, **so that** reviewers can see exactly which symbols changed.

**Acceptance Criteria:**
- JSON index files written with deterministic key ordering and 2-space indentation
- Arrays of symbols sorted by symbol ID (alphabetically) to prevent spurious diff churn
- Schema-version file at `.ctxo/index/schema-version` contains semver string
- Auto-migration: on startup, if schema version mismatch detected, adapter migrates in place and updates version file
- E2E test: index built → one symbol changed → `git diff .ctxo/index/` shows only that symbol's file changed

#### Story 5.2: Clone-Ready Context — Cold Start Rebuild
**As a** new team member, **I want** full AI context immediately after `git clone`, without running `ctxo index`, **so that** onboarding is instant.

**Acceptance Criteria:**
- On MCP server startup, if `.ctxo/.cache/symbols.db` is absent or corrupted, `SqliteCacheAdapter` rebuilds from `.ctxo/index/` JSON files automatically
- Rebuild completes before first MCP tool call is served
- If `.ctxo/index/` is also absent → server starts but all tools return `{ warning: "No index found. Run ctxo index." }`
- Corruption detection: SQLite `PRAGMA integrity_check` on startup; failure triggers rebuild
- Integration test: delete `.ctxo/.cache/` → start server → call `get_logic_slice` → assert success

#### Story 5.3: CI Gate — `ctxo verify-index` Command
**As a** CI system, **I want** a dedicated command that fails the build when the committed index is out of sync with source, **so that** stale index PRs are blocked from merging.

**Acceptance Criteria:**
- `ctxo verify-index` runs `ctxo index` (re-indexes everything) then checks `git diff --exit-code .ctxo/index/`
- Exits 0 if no diff (index is current)
- Exits 1 if diff present; prints list of changed index files to stderr
- Suitable for use in GitHub Actions `- run: npx ctxo verify-index` step
- E2E test: source modified without re-indexing → `ctxo verify-index` exits 1

#### Story 5.4: Monorepo Auto-Discovery
**As a** developer on a monorepo, **I want** `ctxo index` to automatically discover and index all workspace packages, **so that** I don't have to configure each package separately.

**Acceptance Criteria:**
- `ctxo index` reads `workspaces` field from root `package.json` (supports npm/yarn glob patterns)
- Each workspace package indexed under `.ctxo/index/<package-name>/`
- Workspace packages discovered recursively (nested workspaces not required for V1)
- `ctxo status` reports per-workspace file count
- E2E test: fixture monorepo with 2 packages → `ctxo index` → assert both packages present in `.ctxo/index/`

#### Story 5.5: Git Hook Installation — `ctxo init`
**As a** developer, **I want** `ctxo init` to install git hooks that keep the index current automatically, **so that** I never have to remember to re-index after commits or merges.

**Acceptance Criteria:**
- `ctxo init` installs `.git/hooks/post-commit` running `ctxo index --since HEAD~1`
- `ctxo init` installs `.git/hooks/post-merge` running `ctxo sync` (alias for `ctxo index`)
- Hook installation is idempotent — re-running `ctxo init` does not duplicate hook entries
- Existing hooks not overwritten — Ctxo block appended between `# ctxo-start` / `# ctxo-end` markers
- `ctxo init` outputs installed hook paths to stderr
- Unit tests: idempotency, existing hook preservation, marker block detection

### Epic 6: Cross-Client Compatibility, Performance Validation & Release
All five MCP tools verified functional across Claude Code, Cursor, and VS Code Copilot. Performance benchmarks met (500ms p95, 100ms startup). MCP spec compliance confirmed. V1 release gate.
**FRs covered:** FR26
**NFRs addressed:** NFR1–NFR18

#### Story 6.1: MCP Spec Compliance Audit
**As a** developer, **I want** the MCP server to pass a conformance check against the MCP specification, **so that** any conformant client can connect without surprises.

**Acceptance Criteria:**
- `tools/list` response returns all 5 tools with valid JSON Schema `inputSchema` for each
- Every tool response conforms to `{ content: [{ type: 'text', text: string }] }` — no deviations
- Error responses use MCP-standard error codes (invalid params, internal error)
- No custom protocol extensions used
- Automated test: parse `tools/list`, validate each tool schema against JSON Schema Draft 7

#### Story 6.2: Cross-Client Smoke Tests — Claude Code, Cursor, VS Code Copilot
**As a** developer, **I want** all 5 MCP tools verified across the 3 target clients, **so that** I can confidently recommend Ctxo regardless of which AI client the team uses.

**Acceptance Criteria:**
- Test matrix: 5 tools × 3 clients = 15 test cases
- Each test case: invoke tool → assert response received → assert response shape correct → assert no client-specific errors
- Configuration: single `{ "command": "npx", "args": ["-y", "ctxo"] }` entry works for all 3 clients
- Results documented in `docs/compatibility-matrix.md`
- Blocking failures (tool not callable, response garbled) gate V1 release

#### Story 6.3: Performance Benchmark Suite
**As a** developer, **I want** automated performance benchmarks that run in CI, **so that** regressions against the performance NFRs are caught before release.

**Acceptance Criteria:**
- Benchmark harness measures: MCP server startup time, `get_logic_slice` p95 latency (1,000 iterations), full index build time, incremental index time
- Fixture: 1,000-file TypeScript project (generated or static)
- Pass/fail thresholds: startup < 100ms, tool response < 500ms p95, full index < 30s, incremental < 2s
- Index size assertion: `.ctxo/index/` ≤ 10MB for fixture
- Results output as JSON to stderr; CI step fails if any threshold breached

#### Story 6.4: Privacy Masking Zero-Leakage Gate
**As a** security-conscious team, **I want** a dedicated test gate that asserts zero credential leakage across all MCP tool responses, **so that** no release ships with a masking gap.

**Acceptance Criteria:**
- Synthetic fixture project containing: AWS keys, GCP JSON creds, JWT tokens, private IPs, `*_SECRET`/`*_KEY`/`*_TOKEN`/`*_PASSWORD` env vars
- Test indexes fixture, then calls all 5 MCP tools and scans every response for unmasked patterns
- Any match → test fails with specific pattern + location reported
- Gate runs in CI on every PR and blocks merge on failure

#### Story 6.5: `npx ctxo` Release Packaging
**As a** developer, **I want** `npx ctxo` to just work with zero prior installation, **so that** adoption friction is minimal.

**Acceptance Criteria:**
- `package.json` `bin` field maps `ctxo` → `dist/index.js`
- `files` field includes only `dist/`, `README.md`, `LICENSE`
- `npx ctxo --help` works without prior `npm install`
- `npx ctxo index` on a fresh TypeScript project produces `.ctxo/index/` successfully
- `npm pack` → inspect tarball → no source code, no test fixtures, no `.ctxo/` artifacts included
- Pre-publish checklist documented in `RELEASING.md`

### Epic 7: Multi-Language Support — Go & C# (V1.5)
Go and C# codebases can be indexed and queried via tree-sitter syntax-level adapters, extending all five Ctxo tools to backend polyglot developers.
**FRs covered:** FR28

#### Story 7.1: tree-sitter Adapter Foundation
**As a** contributor, **I want** a generic tree-sitter-based language adapter, **so that** adding new languages requires only a grammar and a symbol-extraction visitor — not a new adapter architecture.

**Acceptance Criteria:**
- `src/adapters/language/tree-sitter.adapter.ts` implements `ILanguageAdapter` using `tree-sitter` native bindings
- Language detection by file extension (`.go`, `.cs`); grammar loaded dynamically
- `tsup` build config: `external: ['tree-sitter']` to preserve native `.node` binary resolution
- Adapter returns `SymbolNode[]` and `Edge[]` in the same format as `ts-morph.adapter.ts`
- Unit tests: adapter instantiates, loads a grammar, parses a trivial source file

#### Story 7.2: Go Language Adapter
**As a** developer working in Go, **I want** `ctxo index` to extract symbols and dependency edges from `.go` files, **so that** all 5 MCP tools work on my Go codebase.

**Acceptance Criteria:**
- Go grammar loaded via `tree-sitter-go`
- Extracts: `function`, `method`, `interface`, `struct`, `type` declarations
- Edges extracted: `import` directives → package-level dependency, interface implementation (heuristic: method set match)
- Symbol ID format: `"relativeFile::packageName.funcName::function"`
- E2E test: fixture Go project (3 packages, cross-package calls) → `ctxo index` → `get_logic_slice` returns transitive deps

#### Story 7.3: C# Language Adapter
**As a** developer working in C#, **I want** `ctxo index` to extract symbols and dependency edges from `.cs` files, **so that** all 5 MCP tools work on my C# codebase.

**Acceptance Criteria:**
- C# grammar loaded via `tree-sitter-c-sharp`
- Extracts: `class`, `method`, `interface`, `struct`, `enum`, `record` declarations
- Edges extracted: `using` directives → namespace-level dependency, `: interface` / `: baseClass` → inheritance edges
- Symbol ID format: `"relativeFile::Namespace.ClassName.MethodName::method"`
- E2E test: fixture C# project (2 namespaces, interface implementation) → `ctxo index` → `get_blast_radius` returns dependents

#### Story 7.4: Multi-Language Integration Tests
**As a** developer on a polyglot project, **I want** Ctxo to handle mixed-language codebases, **so that** cross-language symbol resolution works end-to-end.

**Acceptance Criteria:**
- Fixture project: TypeScript frontend + Go backend in one repo
- `ctxo index` indexes both languages; symbols coexist in the same graph
- All 5 MCP tools return results spanning both languages where applicable
- `ctxo status` shows per-language file counts
- CI matrix: macOS + Linux, Node 18, 20, 22

### Epic 8: Event-Driven Index Updates — GitHub & GitLab Integration (Optional, V1.5)
Ctxo listens for push and pull-request/merge-request events from GitHub/GitLab webhooks and automatically triggers index re-builds and freshness checks — eliminating manual `ctxo index` runs for teams that prefer event-driven automation over scheduled CI jobs.
**FRs covered:** FR29, FR30, FR31, FR32
**Dependencies:** Epic 4 (incremental index, `--check` flag), Epic 5 (committed index, CI gate)

New FRs introduced by this epic:
- FR29: Developer can run `ctxo webhook serve` to start an HTTP listener that receives GitHub push/PR events and triggers `ctxo index --since <sha>`
- FR30: The same webhook listener handles GitLab push/MR events under the same trigger model
- FR31: Webhook secret validation is enforced — unsigned or tampered payloads are rejected before any indexing occurs
- FR32: On PR/MR events, the listener runs `ctxo index --check` and posts a commit status check / pipeline badge back to the hosting provider (pass/fail)

#### Story 8.1: Webhook HTTP Listener — `ctxo webhook serve`
**As a** developer, **I want** to run `ctxo webhook serve` and start an HTTP listener that receives GitHub/GitLab webhook events, **so that** index updates can be triggered automatically by push events.

**Acceptance Criteria:**
- `ctxo webhook serve` starts an HTTP server on configurable port (default: `3847`, env: `CTXO_WEBHOOK_PORT`)
- Accepts `POST /webhook` endpoint only; all other routes return 404
- Request body parsed as JSON; Content-Type validated
- HMAC-SHA256 signature validation using `CTXO_WEBHOOK_SECRET` env var — unsigned or invalid payloads rejected with 401
- Server logs to stderr: `[ctxo webhook] Listening on port 3847`
- Graceful shutdown on SIGINT/SIGTERM
- Unit tests: valid signature accepted, invalid signature rejected, missing secret rejects all requests

#### Story 8.2: GitHub Push Event Handler
**As a** CI/CD system, **I want** GitHub push events to trigger incremental re-indexing, **so that** the committed index stays current without manual intervention.

**Acceptance Criteria:**
- Webhook listener detects `X-GitHub-Event: push` header
- Parses push payload: extracts `before`/`after` SHAs, `commits[].added/modified/removed` file lists
- Triggers `ctxo index --since <before-sha>` (re-indexes only changed files)
- Response: 200 OK with `{ status: "indexing", files: N }` on accepted; 400 on parse failure
- Non-TypeScript/JavaScript files in diff are ignored (filtered by `ILanguageAdapter.supports(ext)`)
- Integration test: mock GitHub push payload → assert correct files re-indexed

#### Story 8.3: GitHub PR Event Handler & Status Check
**As a** team lead, **I want** Ctxo to post a commit status check on PRs indicating whether the index is fresh, **so that** stale-index PRs are visible in the GitHub UI.

**Acceptance Criteria:**
- Webhook listener detects `X-GitHub-Event: pull_request` with `action: opened | synchronize`
- Runs `ctxo index --check` against the PR head SHA
- Posts commit status via GitHub API: `pending` → `success` (index fresh) or `failure` (index stale)
- GitHub API auth via `CTXO_GITHUB_TOKEN` env var (PAT or GitHub App installation token)
- Status context: `ctxo/index-freshness`
- Missing `CTXO_GITHUB_TOKEN` → skip status post, log warning to stderr, still return 200
- Integration test: mock PR payload + mock GitHub API → assert status posted

#### Story 8.4: GitLab Push & MR Event Handler
**As a** developer using GitLab, **I want** the same webhook-driven index freshness workflow available on GitLab, **so that** the team isn't locked to GitHub.

**Acceptance Criteria:**
- Webhook listener detects `X-Gitlab-Event: Push Hook` and `Merge Request Hook` headers
- Push handler: extracts `before`/`after` + `commits[].added/modified/removed`; triggers `ctxo index --since <sha>`
- MR handler: on `open` and `update` actions, runs `ctxo index --check`, posts commit status via GitLab Commit Status API
- GitLab API auth via `CTXO_GITLAB_TOKEN` env var
- Status name: `ctxo/index-freshness`
- Secret validation uses `X-Gitlab-Token` header (GitLab's secret token mechanism)
- Integration test: mock GitLab push/MR payloads → assert correct behavior

#### Story 8.5: Auth Configuration & Security Hardening
**As a** security-conscious team, **I want** webhook authentication to be secure by default with clear configuration guidance, **so that** no unauthorized party can trigger indexing on our machines.

**Acceptance Criteria:**
- `CTXO_WEBHOOK_SECRET` is required — server refuses to start without it (exits 1 with clear error)
- `CTXO_GITHUB_TOKEN` and `CTXO_GITLAB_TOKEN` are optional — absence disables status posting, not webhook processing
- Rate limiting: max 10 requests/second per source IP; excess returns 429
- Request body size limit: 1MB (rejects oversized payloads before parsing)
- `ctxo webhook serve --help` documents all env vars with examples
- Security guide in `docs/webhook-security.md`: secret generation, token scoping, network exposure considerations
