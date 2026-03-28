---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-03-28'
inputDocuments:
  - Project-Brief.md
  - artifacts/brainstorming/brainstorming-session-2026-03-28-1400.md
  - artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md
workflowType: 'architecture'
project_name: 'Ctxo'
user_name: 'Alper Hankendi'
date: '2026-03-28'
---

# Architecture Decision Document — Ctxo

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

| ID | Requirement | Version |
|---|---|---|
| FR-1 | Logic-Slice: dependency-aware context assembly with transitive resolution | V1 |
| FR-2 | Blast Radius Scoring: symbol impact analysis before any change | V1 |
| FR-3 | Architectural Overlay: project structure map organized by layer | V1 |
| FR-4 | Why-Driven Context: git commit history + intent extraction per symbol | V1 |
| FR-5 | Anti-Pattern Memory: revert commit detection and surfacing to AI | V1 |
| FR-6 | Privacy-First Masking: sensitive data detection before context delivery | V1 |
| FR-7 | Progressive Detail Levels: L1 (name+purpose) → L4 (raw code) | V1 |
| FR-8 | MCP Tools: get_logic_slice, get_blast_radius, get_architectural_overlay, get_why_context | V1 |
| FR-9 | Monorepo: auto-discover all tsconfig.json files, merge into unified graph | V1 |
| FR-10 | Lazy indexing: zero-setup, index builds on first request | V1 |
| FR-11 | Incremental updates: file watcher (dev-time) + git post-commit hook | V1 |
| FR-12 | Multi-language: Go + C# via tree-sitter syntax adapters | V1.5 |
| FR-13 | Go deep analysis: compose with gopls MCP server | V2 |
| FR-14 | C# deep analysis: Roslyn LSP adapter (dotnet pre-installed) | V2 |
| FR-15 | Change Intelligence: code complexity scoring (cyclomatic, cognitive, nesting, param count) + change tracing (churn rate, change frequency, logical coupling) + composite health score per symbol/file | V1 |

**Non-Functional Requirements:**

| ID | Requirement | Constraint |
|---|---|---|
| NFR-1 | MCP startup time | < 100ms (stdio subprocess) |
| NFR-2 | Context delivery (warm index) | < 500ms |
| NFR-3 | External runtime dependencies | Zero at runtime |
| NFR-4 | Index portability | Relative paths only — no absolute paths stored |
| NFR-5 | Index sharing | Committed to repo — text-based JSON per source file |
| NFR-6 | Config sharing | .ctxo/config.yaml committed to repo |
| NFR-7 | MCP client compatibility | All MCP-compatible clients (Claude Code, Cursor, VS Code Copilot, etc.) |
| NFR-8 | Privacy | Sensitive data never leaves local machine |
| NFR-9 | Platform independence | macOS, Linux, Windows (Node.js 20+) |

**Scale & Complexity:** High — multi-language AST analysis, graph traversal, MCP protocol, git integration, privacy pipeline, team-shared committed index.

### Storage Architecture Decision

**ADR-STORAGE-01: Text-based committed index + gitignored SQLite cache**

**Decision:** Split storage into two layers:

```
.ctxo/
  config.yaml              ← committed  (team settings, masking rules)
  index/                   ← committed  (text-based JSON, one file per source file)
    src/payment/
      processPayment.ts.json
    src/auth/
      TokenValidator.ts.json
  .cache/                  ← gitignored (local SQLite, rebuilt from index/)
    symbols.db
```

**Rationale:**
- SQLite is binary — unresolvable merge conflicts in git, no meaningful diffs
- Per-source-file JSON: conflicts scoped to single files, clean PR diffs on GitHub/GitLab
- SQLite cache rebuilt locally on startup if stale — fast queries preserved
- New developer clone: `git clone` → `ctxo init` → cache auto-built from committed JSON

**Per-file JSON format:**
```json
{
  "file": "src/payment/processPayment.ts",
  "lastModified": 1711620000,
  "symbols": [{ "name": "processPayment", "kind": "function", "startLine": 12, "endLine": 45 }],
  "edges": [{ "from": "processPayment", "to": "TokenValidator", "kind": "imports" }],
  "intent": [{ "hash": "abc123", "message": "fix race condition under load", "date": "2024-03-15", "kind": "commit" }],
  "antiPatterns": [{ "hash": "def456", "message": "revert: remove mutex — caused deadlock", "date": "2024-02-01" }],
  "complexity": { "cyclomatic": 12, "cognitive": 8, "nestingDepth": 4, "paramCount": 5 },
  "churn": { "changeCount": 47, "lastChanged": "2024-03-15", "authors": 3 },
  "healthScore": 0.23
}
```

### Technical Constraints & Dependencies

- **Node.js ≥ 20** — required by Chokidar v5 (ESM-only) and OTel --import flag
- **ts-morph** — TypeScript/JS only; tree-sitter fills the gap for other languages
- **gopls** (optional, V2) — must be installed for Go deep analysis; graceful degradation to syntax-level
- **dotnet SDK** (optional, V2) — must be installed for C# deep analysis; graceful degradation to syntax-level
- **git** — required; simple-git wraps the system git binary

### Cross-Cutting Concerns

1. **Path normalization** — all paths stored relative to repo root; resolved at query time
2. **Schema versioning** — `ctxo/index/schema-version` file; migration auto-runs on startup
3. **Masking pipeline** — all context output passes through masking before MCP response
4. **Language adapter lifecycle** — lazy load per file extension, graceful degradation
5. **MCP spec compatibility** — Nov 2025 spec (2025-11-25); all major clients support it
6. **Index freshness signaling** — MCP resource notification when index completeness changes

---

## Starter Template Evaluation

### Primary Technology Domain

CLI tool / MCP Server — published as an npm package, invoked as a stdio subprocess
by AI clients (Claude Code, Cursor, VS Code Copilot, etc.). Not a web app, not a backend API.

### Starter Options Considered

| Option | Status | Verdict |
|---|---|---|
| `@modelcontextprotocol/create-typescript-server` (official) | ARCHIVED March 2025 | ❌ Disqualified |
| `create-mcp-ts` (stephencme, tsup-based, ejectable) | Active | ⚠️ Viable but adds abstraction layer |
| Custom tsup + TypeScript setup | N/A — first-principles | ✅ Selected |

### Selected Approach: Custom tsup + TypeScript (No Starter)

**Rationale:**
- Hexagonal architecture requires deliberate folder organization from day one — no starter provides this
- Native node addons (`better-sqlite3`, `tree-sitter`) need controlled tsup externals config
- ESM-first (`"type": "module"`) with Node16 module resolution
- No `mcp-scripts` abstraction — direct tsup gives full visibility and control
- Complex multi-adapter project (language, storage, git, MCP transport) benefits from clean setup

**Initialization Command:**

```bash
mkdir ctxo && cd ctxo
git init
npm init -y
npm install @modelcontextprotocol/sdk zod better-sqlite3 ts-morph \
  tree-sitter tree-sitter-language-pack simple-git chokidar
npm install -D typescript tsup @types/node @types/better-sqlite3 \
  vitest @vitest/coverage-v8 tsx
```

**Architectural Decisions Provided by This Setup:**

**Language & Runtime:**
TypeScript 5.x, ESM-first (`"type": "module"`), Node.js ≥ 20, `tsconfig.json` targeting
`ES2022` with `Node16` module resolution. `tsx` for zero-build dev runs.

**Build Tooling:**
tsup (esbuild-backed) with `external: ['better-sqlite3', 'tree-sitter']` to preserve
native addon `.node` binary resolution. Single `dist/index.js` output, `bin` field
in `package.json` for `npx ctxo` invocation.

**Testing Framework:**
Vitest (ESM-native, fast, Jest-compatible API). Unit tests per adapter, integration
tests with in-memory SQLite fixture.

**Code Organization:**
```
src/
  core/           ← Pure domain: symbol graph, blast radius, intent, masking
  adapters/
    language/     ← ILanguageAdapter implementations (ts-morph, tree-sitter)
    storage/      ← SQLite cache + JSON index read/write
    git/          ← simple-git wrapper
    mcp/          ← MCP tool handlers (get_logic_slice, etc.)
  ports/          ← TypeScript interfaces (ILanguageAdapter, IStoragePort, etc.)
  index.ts        ← MCP server entry point (StdioServerTransport)
```

**Development Experience:**
- `tsx src/index.ts` — zero-build dev run
- `tsup` — production build to `dist/`
- `vitest` — unit + integration tests
- `npm link` — local MCP client wiring during development
- `@modelcontextprotocol/inspector` — MCP protocol debugging

**Note:** Project initialization using the command above should be the first implementation story.

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical (block implementation):**
- Core domain model: Option C — separate graph topology + metadata store
- Symbol ID scheme: deterministic string `"<relativeFile>::<name>::<kind>"`
- `ILanguageAdapter` contract: extensions + tier + extractSymbols + extractEdges
- `IStoragePort` contract: 5 methods, storage is a replaceable cartridge
- MCP tool names confirmed (FR-8); parameter fine-tuning deferred

**Important (shape architecture):**
- Index freshness: three-scenario invalidation (cold start / dev session / git pull)
- CI indexing strategy: `ctxo index` command + CI gate pattern
- Error handling: warn-and-continue at every boundary, never MCP protocol errors

**Deferred (post-MVP):**
- MCP tool parameter fine-tuning (detail levels, format options)
- `--since <ref>` incremental CI flag

### Data Architecture

- **Domain graph**: `SymbolNode` + `GraphEdge` — lean topology types in `src/core/`
- **Metadata**: `SymbolMeta` — lazy join, only assembled for MCP tool responses
- **Symbol ID**: deterministic string key `"<relativeFile>::<name>::<kind>"` — stable
  across re-indexing, human-readable in committed JSON, safe as FK in SQLite
- **SQLite schema**: two concern groups — `symbols`/`edges` (topology, hot path) and
  `symbol_meta` (intent, anti-patterns, masking flags, lazy join)

### Cache Invalidation Strategy

Three distinct scenarios:

**Scenario A — Cold start (SQLite missing or corrupt):**
Read all `.ctxo/index/*.json` → batch-insert into SQLite. No re-parsing. Fast.

**Scenario B — Local file change (dev session):**
Chokidar fires → re-parse changed file → overwrite `.ctxo/index/<file>.json` → UPDATE SQLite rows.
Incremental, single-file cost.

**Scenario C — Git pull (new JSON index files from teammates):**
On next MCP startup: compare each JSON `lastModified` vs SQLite row timestamp →
re-import changed JSON files into SQLite. No re-parsing, pure JSON → SQLite sync.
Requires `git post-merge` hook calling `ctxo sync` OR handled by startup check.

**Performance targets:**

| Codebase | Full index (first time) | SQLite rebuild from JSON | Incremental (1 file) |
|---|---|---|---|
| Small (100 files) | ~1–3s | ~100ms | ~20ms |
| Medium (1000 files) | ~10–30s | ~500ms | ~20ms |
| Large (5000 files) | ~60–150s | ~2–3s | ~20ms |

### CI/CD Indexing Pattern

The committed JSON index enables CI-driven index freshness:

**Pattern A — CI writes index (recommended):**
```yaml
- run: npx ctxo index
- run: git add .ctxo/index/ && git diff --staged --quiet || git commit -m "chore: update ctxo index [skip ci]" && git push
```

**Pattern B — CI gate (simpler):**
```yaml
- run: npx ctxo index
- run: git diff --exit-code .ctxo/index/   # fail PR if index not committed
```

Requires additional CLI commands beyond MCP server mode:
- `ctxo index` — full or incremental parse + write JSON files
- `ctxo index --since <ref>` — incremental CI runs (V1 stretch)
- `ctxo sync` — rebuild SQLite from committed JSON (post-merge hook)
- `ctxo verify-index` — CI gate: fail if any source file unindexed

### API & Communication Patterns (MCP Tools)

Four MCP tools confirmed (FR-8); parameter fine-tuning deferred:

| Tool | Core Parameters |
|---|---|
| `get_logic_slice` | `symbol`, `file?`, `depth?`, `detail?` |
| `get_blast_radius` | `symbol`, `file?`, `format?` |
| `get_architectural_overlay` | `layer?`, `detail?` |
| `get_why_context` | `symbol`, `file?`, `include_anti_patterns?` |

All tool responses pass through the masking pipeline before delivery.
All errors surface in tool response content — never as MCP protocol errors.

### Language Adapter Contract

```typescript
interface ILanguageAdapter {
  readonly extensions: string[]          // e.g. ['.ts', '.tsx']
  readonly tier: 'full' | 'syntax'       // full = type-aware, syntax = AST-only
  extractSymbols(file: string, source: string): SymbolNode[]
  extractEdges(file: string, source: string): GraphEdge[]
  isSupported(filePath: string): boolean
  extractComplexity?(file: string, source: string): ComplexityMetrics[]  // optional, FR-15
}

// FR-15: complexity metrics per symbol
type ComplexityMetrics = {
  symbolId: string
  cyclomatic: number      // number of independent execution paths
  cognitive: number       // how hard the code is to understand
  nestingDepth: number    // maximum nesting level
  paramCount: number      // number of parameters
}
```

Adapters lazy-loaded per file extension. Parser failure = skip file + stderr warning.
Graceful degradation: gopls/Roslyn unavailable → fall back to tree-sitter syntax tier.

### Error Handling Strategy

Warn-and-continue at every boundary:

| Failure | Behaviour |
|---|---|
| Parser throws on a file | Skip file, log stderr, mark `unindexed` in response |
| git binary not found | `intent`/`antiPatterns` return `[]`, no crash |
| `symbols.db` corrupt | Delete and rebuild from JSON index |
| Symbol not in index | `{ found: false, hint: "run ctxo index to rebuild" }` |
| gopls/Roslyn not installed | Graceful degradation to tree-sitter syntax tier |

### Infrastructure & Deployment

- **Package**: single npm package `ctxo`, `bin` field for `npx ctxo` invocation
- **Build**: tsup with `external: ['better-sqlite3', 'tree-sitter']`
- **Engines**: Node.js ≥ 20
- **MCP client config**: `{ "command": "npx", "args": ["-y", "ctxo"] }`
- **Versioning**: semantic versioning; index schema version tracked separately

### Decision Impact Analysis

**Implementation sequence:**
1. Project scaffold + tsup build
2. `IStoragePort` + `SqliteStorageAdapter`
3. `ILanguageAdapter` + ts-morph adapter
4. Core graph traversal — logic-slice + blast radius
5. MCP tool handlers wired to core
6. git adapter — intent + anti-pattern extraction
7. `ctxo index` CLI command + chokidar file watcher
8. Privacy masking pipeline
9. Change Intelligence module — complexity + churn scoring (FR-15)
10. tree-sitter adapter for multi-language (V1.5)

---

## Implementation Patterns & Consistency Rules

### Naming Patterns

**SQLite table/column naming — snake_case:**
```sql
CREATE TABLE symbols (symbol_id TEXT PRIMARY KEY, file_path TEXT, symbol_name TEXT, kind TEXT, start_line INT, end_line INT)
CREATE TABLE graph_edges (from_id TEXT, to_id TEXT, edge_kind TEXT)
CREATE TABLE symbol_meta (symbol_id TEXT PRIMARY KEY, intent_json TEXT, anti_patterns_json TEXT, masked INT DEFAULT 0)
```

**TypeScript naming:**
- Domain types: `camelCase` fields, `PascalCase` type names (`SymbolNode`, `GraphEdge`, `SymbolMeta`)
- Port interfaces: `IPascalCase` prefix (`IStoragePort`, `ILanguageAdapter`, `IGitPort`)
- Adapter classes: `PascalCase` + `Adapter` suffix (`SqliteStorageAdapter`, `TsMorphAdapter`, `SimpleGitAdapter`)
- CLI commands: `kebab-case` (`ctxo index`, `ctxo sync`, `ctxo verify-index`)

**File naming — kebab-case throughout:**
```
src/ports/i-storage-port.ts
src/ports/i-language-adapter.ts
src/adapters/storage/sqlite-storage-adapter.ts
src/adapters/language/ts-morph-adapter.ts
src/adapters/language/tree-sitter-adapter.ts
src/core/graph/symbol-graph.ts
src/core/blast-radius/blast-radius-calculator.ts
src/core/masking/masking-pipeline.ts
```

**JSON index fields — camelCase:**
```json
{ "file": "...", "lastModified": 0, "symbols": [], "edges": [], "intent": [], "antiPatterns": [] }
```

### Structure Patterns

**Test co-location — `__tests__/` adjacent to source file:**
```
src/adapters/storage/
  sqlite-storage-adapter.ts
  __tests__/
    sqlite-storage-adapter.test.ts
src/core/graph/
  symbol-graph.ts
  __tests__/
    symbol-graph.test.ts
```

**Port-first rule:** Every adapter MUST implement a port interface. No adapter without a port. No `core/` code importing from `adapters/`. Enforced by TypeScript `paths` or ESLint import rules.

**Composition root:** Dependency wiring happens ONLY in `src/index.ts`. Adapters never instantiate each other. Core never imports adapters.

**No barrel exports** (`index.ts` re-exports): import directly from source file path to avoid circular dependency risks.

### MCP Tool Response Format

All tool handlers return a consistent shape — no exceptions:
```typescript
// Success
{ content: [{ type: 'text', text: JSON.stringify(payload) }] }

// Graceful miss (symbol not found, adapter degraded, etc.)
{ content: [{ type: 'text', text: JSON.stringify({ found: false, hint: '...' }) }] }

// Caught error — never throw from tool handlers
{ content: [{ type: 'text', text: JSON.stringify({ error: true, message: '...' }) }] }
```

**NEVER use `console.log` anywhere in `src/`.** MCP stdio transport uses stdout for JSON-RPC — `console.log` corrupts the protocol. Use `console.error` for debug/warning output only.

### Error Handling Pattern

```typescript
// ALL adapter methods follow this pattern — never throw outward
try {
  return await doWork()
} catch (err) {
  console.error(`[ctxo:${adapterName}] ${(err as Error).message}`)
  return fallbackValue
}
```

Core domain functions may throw (they are pure). Adapter boundary catches and returns fallback.

### Index JSON Schema — Strict Contract

Every agent writing to `.ctxo/index/` MUST produce this exact shape:
```json
{
  "file": "relative/path/from/repo/root.ts",
  "lastModified": 1711620000,
  "symbols": [
    { "symbolId": "src/foo.ts::myFn::function", "name": "myFn", "kind": "function", "startLine": 12, "endLine": 45 }
  ],
  "edges": [
    { "from": "src/foo.ts::myFn::function", "to": "src/bar.ts::TokenValidator::class", "kind": "imports" }
  ],
  "intent": [
    { "hash": "abc123", "message": "fix race condition under load", "date": "2024-03-15", "kind": "commit" }
  ],
  "antiPatterns": [
    { "hash": "def456", "message": "revert: remove mutex — caused deadlock", "date": "2024-02-01" }
  ]
}
```

Valid `kind` values for symbols: `function | class | interface | method | variable | type`
Valid `kind` values for edges: `imports | calls | extends | implements | uses`

### Enforcement Guidelines

**All AI agents MUST:**
- Never use `console.log` — use `console.error` only
- Never import from `adapters/` inside `core/`
- Never import from `core/` inside `ports/`
- Always implement the full port interface when creating an adapter
- Always co-locate tests in `__tests__/` next to the source file
- Always use the deterministic `file::name::kind` symbol ID format
- Always return MCP tool responses in the standard content-array shape
- Always use camelCase for JSON index fields, snake_case for SQLite columns

---

## Project Structure & Boundaries

### Complete Project Directory Structure

```
ctxo/
├── package.json                            ← bin: ctxo, type: module, engines: node>=20
├── tsconfig.json                           ← ES2022, Node16, strict
├── tsup.config.ts                          ← external: [better-sqlite3, tree-sitter]
├── vitest.config.ts
├── .gitignore                              ← node_modules, dist, .ctxo/.cache
├── .github/
│   └── workflows/
│       ├── ci.yml                          ← test + build
│       └── ctxo-index.yml                  ← CI indexing gate
│
├── src/
│   ├── index.ts                            ← composition root + StdioServerTransport
│   │
│   ├── ports/                              ← interfaces only, zero implementation
│   │   ├── i-language-adapter.ts           ← ILanguageAdapter + ComplexityMetrics (FR-1, FR-12, FR-15)
│   │   ├── i-storage-port.ts               ← IStoragePort (FR-1..7, FR-15)
│   │   ├── i-git-port.ts                   ← IGitPort (FR-4, FR-5, FR-15 churn)
│   │   └── i-masking-port.ts               ← IMaskingPort (FR-6)
│   │
│   ├── core/                               ← pure domain, zero adapter imports
│   │   ├── types.ts                        ← SymbolNode, GraphEdge, SymbolMeta,
│   │   │                                      ComplexityMetrics, ChurnData, FileIndex
│   │   ├── graph/
│   │   │   ├── symbol-graph.ts             ← graph construction + adjacency
│   │   │   └── __tests__/symbol-graph.test.ts
│   │   ├── logic-slice/
│   │   │   ├── logic-slice-query.ts        ← transitive dep resolution (FR-1)
│   │   │   └── __tests__/logic-slice-query.test.ts
│   │   ├── blast-radius/
│   │   │   ├── blast-radius-calculator.ts  ← recursive impact scoring (FR-2)
│   │   │   └── __tests__/blast-radius-calculator.test.ts
│   │   ├── overlay/
│   │   │   ├── architectural-overlay.ts    ← layer map assembly (FR-3)
│   │   │   └── __tests__/architectural-overlay.test.ts
│   │   ├── why-context/
│   │   │   ├── why-context-assembler.ts    ← intent + anti-pattern (FR-4, FR-5)
│   │   │   └── __tests__/why-context-assembler.test.ts
│   │   ├── change-intelligence/            ← FR-15 (to be detailed)
│   │   │   ├── complexity-calculator.ts    ← cyclomatic, cognitive, nesting, param count
│   │   │   ├── churn-analyzer.ts           ← change frequency, coupling from git log
│   │   │   ├── health-scorer.ts            ← composite score: f(complexity, churn)
│   │   │   └── __tests__/
│   │   │       ├── complexity-calculator.test.ts
│   │   │       ├── churn-analyzer.test.ts
│   │   │       └── health-scorer.test.ts
│   │   ├── detail-levels/
│   │   │   ├── detail-formatter.ts         ← L1→L4 progressive detail (FR-7)
│   │   │   └── __tests__/detail-formatter.test.ts
│   │   └── masking/
│   │       ├── masking-pipeline.ts         ← privacy filter (FR-6)
│   │       └── __tests__/masking-pipeline.test.ts
│   │
│   ├── adapters/
│   │   ├── language/
│   │   │   ├── ts-morph-adapter.ts         ← full tier: TS/JS + extractComplexity (FR-1, FR-9, FR-15)
│   │   │   ├── tree-sitter-adapter.ts      ← syntax tier: all others (FR-12, V1.5)
│   │   │   ├── language-adapter-registry.ts ← lazy-load by extension
│   │   │   └── __tests__/
│   │   │       ├── ts-morph-adapter.test.ts
│   │   │       └── tree-sitter-adapter.test.ts
│   │   │
│   │   ├── storage/
│   │   │   ├── sqlite-storage-adapter.ts   ← better-sqlite3 WAL (ADR-STORAGE-01)
│   │   │   ├── json-index-reader.ts        ← read committed JSON index files
│   │   │   ├── json-index-writer.ts        ← write per-file JSON index files
│   │   │   └── __tests__/
│   │   │       ├── sqlite-storage-adapter.test.ts
│   │   │       └── json-index-writer.test.ts
│   │   │
│   │   ├── git/
│   │   │   ├── simple-git-adapter.ts       ← intent, anti-patterns, churn (FR-4, FR-5, FR-15)
│   │   │   └── __tests__/simple-git-adapter.test.ts
│   │   │
│   │   ├── watcher/
│   │   │   ├── chokidar-watcher.ts         ← incremental file updates (FR-11)
│   │   │   └── __tests__/chokidar-watcher.test.ts
│   │   │
│   │   └── mcp/
│   │       ├── get-logic-slice.ts          ← MCP tool handler (FR-8)
│   │       ├── get-blast-radius.ts         ← MCP tool handler (FR-8)
│   │       ├── get-architectural-overlay.ts ← MCP tool handler (FR-8)
│   │       ├── get-why-context.ts          ← MCP tool handler (FR-8)
│   │       ├── get-change-intelligence.ts  ← MCP tool handler (FR-15)
│   │       └── __tests__/tool-handlers.test.ts
│   │
│   └── cli/
│       ├── index-command.ts                ← ctxo index (FR-10, FR-11, CI pattern)
│       ├── sync-command.ts                 ← ctxo sync (post-merge hook)
│       └── verify-command.ts              ← ctxo verify-index (CI gate)
│
└── dist/                                   ← gitignored, tsup output
```

### Architectural Boundaries

**Dependency flow — one direction only:**
```
CLI commands
     ↓
src/index.ts  (composition root — only file that imports across all layers)
     ↓
adapters/mcp/  (tool handlers — orchestrate core + adapters)
     ↓
core/          (pure domain — SymbolGraph, BlastRadius, ChangeIntelligence, etc.)
     ↑
ports/         (TypeScript interfaces — injected at composition root)
     ↑
adapters/language, storage, git, watcher  (implement ports)
```

**Forbidden import paths (enforced via ESLint `import/no-restricted-paths`):**
- `core/**` → NEVER import from `adapters/**`
- `core/**` → NEVER import from `ports/**` (ports import from core types only)
- `ports/**` → NEVER import from `adapters/**`
- `adapters/mcp/**` → may import from `core/**` and `ports/**` only

### Requirements to Structure Mapping

| FR | Core module | Adapter(s) | MCP tool |
|---|---|---|---|
| FR-1 Logic-Slice | `core/logic-slice/` | `language/`, `storage/` | `get_logic_slice` |
| FR-2 Blast Radius | `core/blast-radius/` | `storage/` | `get_blast_radius` |
| FR-3 Overlay | `core/overlay/` | `storage/` | `get_architectural_overlay` |
| FR-4 Why-Context | `core/why-context/` | `git/` | `get_why_context` |
| FR-5 Anti-Patterns | `core/why-context/` | `git/` | `get_why_context` |
| FR-6 Masking | `core/masking/` | all mcp handlers | all tools |
| FR-7 Detail Levels | `core/detail-levels/` | all mcp handlers | all tools |
| FR-8 MCP Tools | — | `adapters/mcp/` | all 5 tools |
| FR-9 Monorepo | — | `language/language-adapter-registry.ts` | — |
| FR-10 Lazy Index | — | `src/index.ts` startup | — |
| FR-11 Incremental | — | `watcher/`, `cli/index-command.ts` | — |
| FR-12 Multi-lang | — | `language/tree-sitter-adapter.ts` | — |
| FR-15 Change Intel | `core/change-intelligence/` | `git/`, `language/` (extractComplexity) | `get_change_intelligence` |

### Data Flow

```
Source files
     → language adapters (ts-morph / tree-sitter)
     → SymbolNode[] + GraphEdge[] + ComplexityMetrics[]
     → json-index-writer → .ctxo/index/<file>.json  (committed)
     → sqlite-storage-adapter → .ctxo/.cache/symbols.db  (gitignored)

git log
     → simple-git-adapter
     → CommitIntent[] + AntiPattern[] + ChurnData
     → stored in symbol_meta (SQLite) + JSON index

MCP tool call
     → tool handler (adapters/mcp/)
     → core domain query (graph traversal / scoring)
     → metadata enrichment (lazy join from symbol_meta)
     → masking pipeline
     → MCP response
```

### Integration Points

**MCP client integration:**
```json
{ "command": "npx", "args": ["-y", "ctxo"] }
```
Clients spawn Ctxo as a stdio subprocess. Zero configuration beyond this line.

**CI integration:**
```yaml
- run: npx ctxo index
- run: git diff --exit-code .ctxo/index/
```

**git hooks (optional, installed via `ctxo init`):**
- `post-commit`: `ctxo index --since HEAD~1`
- `post-merge`: `ctxo sync`

---

## Architecture Validation Results

### Coherence Validation ✅

All 15 technology choices compatible. No version conflicts. Hexagonal boundaries
consistent throughout. Port-first rule enforced. ESM + Node16 module resolution
compatible with all dependencies including native addons.

### Requirements Coverage ✅

| ID | Requirement | Status |
|---|---|---|
| FR-1 | Logic-Slice | ✅ `core/logic-slice/` + ts-morph adapter |
| FR-2 | Blast Radius | ✅ `core/blast-radius/` + SQLite recursive CTE |
| FR-3 | Architectural Overlay | ✅ `core/overlay/` |
| FR-4 | Why-Driven Context | ✅ `core/why-context/` + simple-git adapter |
| FR-5 | Anti-Pattern Memory | ✅ `core/why-context/` + revert detection |
| FR-6 | Privacy Masking | ✅ `core/masking/` applied at all MCP handlers |
| FR-7 | Progressive Detail | ✅ `core/detail-levels/` |
| FR-8 | MCP Tools (5) | ✅ `adapters/mcp/` — 5 handlers |
| FR-9 | Monorepo tsconfig discovery | ✅ `language-adapter-registry.ts` |
| FR-10 | Lazy indexing | ✅ startup check in `src/index.ts` |
| FR-11 | Incremental updates | ✅ chokidar + `cli/index-command.ts` |
| FR-12 | Multi-language (V1.5) | ✅ deferred — tree-sitter adapter |
| FR-13 | Go deep analysis (V2) | ✅ deferred — gopls MCP composition |
| FR-14 | C# deep analysis (V2) | ✅ deferred — Roslyn LSP |
| FR-15 | Change Intelligence | ✅ `core/change-intelligence/` — formula TBD in story |
| NFR-1 | Startup < 100ms | ✅ lazy init, no index load at startup |
| NFR-2 | Context < 500ms | ✅ warm SQLite WAL + pre-built graph |
| NFR-3 | Zero external runtime deps | ✅ all npm packages, no Docker/cloud |
| NFR-4 | Relative paths only | ✅ enforced in JSON index schema |
| NFR-5 | Committed text index | ✅ ADR-STORAGE-01 |
| NFR-6 | Config committed | ✅ `.ctxo/config.yaml` |
| NFR-7 | All MCP clients | ✅ StdioServerTransport, Nov 2025 spec |
| NFR-8 | Privacy | ✅ masking pipeline, local machine only |
| NFR-9 | Platform independence | ✅ Node.js 20+, no platform-specific code |

### Gap Analysis

**No critical gaps.**

**Tracked items (not blocking):**
1. FR-15 health score formula — `f(complexity, churn)` algorithm to be defined in story
2. Monorepo overlapping symbol ID strategy — low risk, `file::name::kind` handles naturally

### Architecture Completeness Checklist

- [x] Requirements analyzed, FRs/NFRs mapped
- [x] Storage architecture decided (ADR-STORAGE-01)
- [x] Technology stack selected and validated
- [x] Hexagonal port/adapter contracts defined (4 ports)
- [x] 5 MCP tool contracts established
- [x] Cache invalidation strategy (3 scenarios documented)
- [x] CI/CD indexing pattern defined
- [x] Implementation patterns and naming conventions
- [x] Complete project tree (~45 files mapped)
- [x] FR→file→tool mapping table
- [x] Error handling strategy (warn-and-continue)
- [x] Change Intelligence module placed (FR-15)

### Architecture Readiness: READY FOR IMPLEMENTATION

**Confidence: High**

**Key strengths:**
- Replaceable storage cartridge — swap cost: 1 file, zero core impact
- Committed JSON index — team sharing, no git conflicts, CI-indexable
- Hexagonal core — parsers, storage, git all independently testable in isolation
- Graceful degradation at every boundary — no single point of failure
- Change Intelligence module architecturally positioned from day one

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect hexagonal boundary: `core/` never imports from `adapters/`
- Refer to this document for ALL architectural questions
- No new decisions should be made outside this document without explicit user approval

**First implementation story:** Project scaffold + tsup build + composition root skeleton

