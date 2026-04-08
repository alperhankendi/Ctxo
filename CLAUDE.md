# CLAUDE.md — Ctxo

## Project Overview

Ctxo is a **Model Context Protocol (MCP) server** that gives AI coding assistants dependency-aware, history-enriched context for codebases. It delivers "Logic-Slices" — a symbol plus all transitive dependencies, git intent, anti-pattern warnings, and change health scores — in under 500ms.

- **Type:** npm package / CLI tool / MCP server (stdio transport)
- **Author:** Alper Hankendi
- **Status:** Greenfield — pre-implementation (architecture complete, ready to build)
- **Language:** TypeScript (ESM-first, `"type": "module"`)
- **Runtime:** Node.js >= 20

## Quick Reference

```bash
# Dev
tsx src/index.ts              # zero-build dev run
tsup                          # production build to dist/
vitest                        # run tests
npm link                      # local MCP client wiring

# Usage
npx ctxo index                # build codebase index
npx ctxo index --check        # CI gate: fail if index stale
npx ctxo watch                # file watcher for incremental re-index
npx ctxo sync                 # rebuild SQLite from committed JSON
```

## Architecture

**Hexagonal (Ports & Adapters)** — strict dependency direction:

```
CLI commands → src/index.ts (composition root) → adapters/mcp/ → core/ ← ports/ ← adapters/*
```

### Key Rules

- **`core/` NEVER imports from `adapters/`** — pure domain logic only
- **`core/` NEVER imports from `ports/`** — ports import from core types
- **`ports/` NEVER imports from `adapters/`**
- **`adapters/mcp/` may import from `core/` and `ports/` only**
- **Composition root (`src/index.ts`)** is the ONLY file that wires adapters to ports
- **No barrel exports** (`index.ts` re-exports) — import directly from source file path
- **Port-first rule:** every adapter MUST implement a port interface

### Project Structure

```
src/
  index.ts                     # composition root + StdioServerTransport
  ports/                       # interfaces only (ILanguageAdapter, IStoragePort, IGitPort, IMaskingPort)
  core/                        # pure domain (graph, logic-slice, blast-radius, overlay, why-context, change-intelligence, masking, detail-levels)
  adapters/
    language/                  # ts-morph (full tier), tree-sitter (syntax tier)
    storage/                   # SQLite cache + JSON index read/write
    git/                       # simple-git wrapper
    watcher/                   # chokidar file watcher
    mcp/                       # MCP tool handlers (5 tools)
  cli/                         # index, sync, verify commands
```

### Storage (ADR-STORAGE-01)

```
.ctxo/
  config.yaml                  # committed (team settings)
  index/                       # committed (per-file JSON, one per source file)
  .cache/                      # gitignored (local SQLite, rebuilt from index/)
```

## Naming Conventions

| Context | Convention | Example |
|---|---|---|
| TypeScript types | PascalCase | `SymbolNode`, `GraphEdge` |
| Port interfaces | IPascalCase | `IStoragePort`, `ILanguageAdapter` |
| Adapter classes | PascalCase + Adapter | `SqliteStorageAdapter`, `TsMorphAdapter` |
| Files | kebab-case | `sqlite-storage-adapter.ts`, `i-storage-port.ts` |
| SQLite columns | snake_case | `symbol_id`, `file_path`, `edge_kind` |
| JSON index fields | camelCase | `lastModified`, `symbolId`, `antiPatterns` |
| CLI commands | kebab-case | `ctxo index`, `ctxo verify-index` |
| Symbol IDs | deterministic | `"<relativeFile>::<name>::<kind>"` |

## MCP Tools (14 total)

| Tool | Purpose |
|---|---|
| `get_logic_slice` | Symbol + transitive deps (L1-L4 progressive detail) |
| `get_blast_radius` | Impact score + affected symbols (3-tier: confirmed/likely/potential) |
| `get_architectural_overlay` | Project layer map (Domain/Infra/Adapters) |
| `get_why_context` | Git commit intent + anti-pattern warnings |
| `get_change_intelligence` | Complexity x churn composite score |
| `find_dead_code` | Unreachable symbols and files |
| `get_context_for_task` | Task-aware context (fix/extend/refactor/understand) |
| `get_ranked_context` | BM25 + PageRank search within token budget |
| `search_symbols` | Symbol name/regex search across index |
| `get_changed_symbols` | Symbols in recently changed files (git diff) |
| `find_importers` | Reverse dependency lookup ("who uses this?") |
| `get_class_hierarchy` | Class inheritance tree (ancestors + descendants) |
| `get_symbol_importance` | PageRank centrality ranking |
| `get_pr_impact` | Full PR risk assessment (changes + blast radius + co-changes) |

### Tool Selection Guide — When to Use Which Tool

```
Reviewing a PR or recent changes?
  → get_pr_impact (single call, full risk assessment)

About to modify a function or class?
  → get_blast_radius (what breaks if I change this?)
  → then get_why_context (any history of problems?)

Need to understand what a symbol does?
  → get_context_for_task(taskType: "understand")
  → or get_logic_slice (L2 for overview, L3 for full closure)

Fixing a bug?
  → get_context_for_task(taskType: "fix")
    (includes history, anti-patterns, and deps)

Adding a feature / extending code?
  → get_context_for_task(taskType: "extend")
    (includes deps and blast radius)

Refactoring?
  → get_context_for_task(taskType: "refactor")
    (includes importers, complexity, and churn)

Don't know the symbol name?
  → search_symbols (by name/regex)
  → get_ranked_context (by natural language query)

Onboarding to a new codebase?
  → get_architectural_overlay (layer map)
  → get_symbol_importance (most critical symbols)

Cleaning up code?
  → find_dead_code (unused symbols)
  → get_change_intelligence (complexity hotspots)

Checking if safe to delete/rename?
  → find_importers (who depends on this?)
  → get_blast_radius (full impact)

Working with class hierarchies?
  → get_class_hierarchy (extends/implements tree)
```

### MCP Tool Response Format (all tools)

```typescript
// Success
{ content: [{ type: 'text', text: JSON.stringify(payload) }] }
// Graceful miss
{ content: [{ type: 'text', text: JSON.stringify({ found: false, hint: '...' }) }] }
// Error — NEVER throw from tool handlers
{ content: [{ type: 'text', text: JSON.stringify({ error: true, message: '...' }) }] }
```

## Critical Rules

1. **NEVER use `console.log`** — MCP stdio uses stdout for JSON-RPC. Use `console.error` for debug/warning only.
2. **Error handling: warn-and-continue** — adapter boundary catches errors and returns fallback values. Core may throw.
3. **All MCP responses pass through masking pipeline** before delivery.
4. **Tests co-located** in `__tests__/` adjacent to source files.
5. **Testing framework:** `vitest` with `InMemoryTransport` for MCP integration tests.

## Error Handling Pattern

```typescript
// All adapter methods:
try {
  return await doWork()
} catch (err) {
  console.error(`[ctxo:${adapterName}] ${(err as Error).message}`)
  return fallbackValue
}
```

| Failure | Behavior |
|---|---|
| Parser throws on file | Skip file, log stderr, mark `unindexed` |
| git not found | intent/antiPatterns return `[]` |
| SQLite corrupt | Delete and rebuild from JSON index |
| Symbol not in index | `{ found: false, hint: "run ctxo index" }` |
| gopls/Roslyn missing | Graceful degradation to tree-sitter |

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript 5.x (ESM, strict) |
| Build | tsup (esbuild), `external: [better-sqlite3, tree-sitter]` |
| MCP SDK | `@modelcontextprotocol/sdk` |
| TS/JS Parser | ts-morph (full tier) |
| Multi-lang Parser | tree-sitter + tree-sitter-language-pack (V1.5) |
| Database | better-sqlite3 (WAL mode) |
| Git | simple-git |
| File Watcher | chokidar |
| Validation | zod |
| Testing | vitest + @vitest/coverage-v8 |
| Dev Runner | tsx |

## Index JSON Schema (strict contract)

```json
{
  "file": "relative/path.ts",
  "lastModified": 1711620000,
  "symbols": [{ "symbolId": "src/foo.ts::myFn::function", "name": "myFn", "kind": "function", "startLine": 12, "endLine": 45 }],
  "edges": [{ "from": "src/foo.ts::myFn::function", "to": "src/bar.ts::TokenValidator::class", "kind": "imports" }],
  "intent": [{ "hash": "abc123", "message": "fix race condition", "date": "2024-03-15", "kind": "commit" }],
  "antiPatterns": [{ "hash": "def456", "message": "revert: remove mutex", "date": "2024-02-01" }]
}
```

- Valid symbol kinds: `function | class | interface | method | variable | type`
- Valid edge kinds: `imports | calls | extends | implements | uses`

## Implementation Sequence

1. Project scaffold + tsup build + composition root skeleton
2. `IStoragePort` + `SqliteStorageAdapter`
3. `ILanguageAdapter` + ts-morph adapter
4. Core graph traversal — logic-slice + blast radius
5. MCP tool handlers wired to core
6. Git adapter — intent + anti-pattern extraction
7. `ctxo index` CLI command + chokidar file watcher
8. Privacy masking pipeline
9. Change Intelligence module — complexity + churn scoring
10. Tree-sitter adapter for multi-language (V1.5)

## Documentation

## TODO

### Bugs (All Closed)
- [x] **#1** Anti-patterns and intent never persisted to committed index — fixed in `86b1e42`
- [x] **#2** Masking pipeline false negative — AWS secrets after `=` — fixed in `f986712`
- [x] **#3** Git commit hashes falsely masked as `AWS_SECRET` — fixed in `f986712`
- [x] **#4** RevertDetector extended with undo, rollback, indirect patterns — fixed in `f986712`
- [x] **#5** Masking pipeline edge case test coverage — fixed in `f986712`

### Analysis (Completed)
- [x] Root cause: `intent: []` hardcoded because IndexCommand (Phase 6) predated git adapter (Phase 7). Wiring never added. Fixed in `86b1e42`.

### V1.1 Improvements (Remaining)
- [x] `get_why_context` reads from committed index first — fixed in `e06c6d5`
- [x] `--skip-history` flag for fast re-indexing — fixed in `d7f880e`
- [x] Blast radius risk score (`1/depth^0.7`) — fixed in `5b10b3a`
- [x] npm publish via CI/CD — `ctxo-mcp@0.2.0` live on npm
- [ ] Performance: batch `git log` calls during indexing (currently N sequential calls for N files)
- [ ] README.md content (quick start, feature overview, MCP config examples)
- [x] Confirmed vs potential blast radius split → 3-tier model (confirmed/likely/potential) with `edgeKinds` per entry and `confidence` filter — fixed in `e43db17`

### Learnings from jCodeMunch (Completed)
- [x] **PageRank centrality** — `get_symbol_importance` tool using PageRank on import graph (damping=0.85)
- [x] **Byte offset indexing** — store byte offsets per symbol for O(1) source retrieval
- [x] **Dead code detection** — `find_dead_code` tool: unreachable symbols via reverse import graph
- [x] **Query-driven context assembly** — `get_ranked_context(query, token_budget)` with BM25 + PageRank

### V1.1 Features (Completed)
- [x] Multi-file cross-file resolution — `loadProjectSources`/`clearProjectSources` in TsMorphAdapter — fixed in `2e33cdc`
- [x] `this.method()` intra-class call edge extraction — `resolveThisMethodCall` helper — fixed in `2e33cdc`
- [x] 3-tier blast radius confidence (confirmed/likely/potential) with `edgeKinds` and `confidence` filter
- [x] Epic 7: tree-sitter adapter for Go + C# (syntax-level parsing) — `GoAdapter`, `CSharpAdapter` with graceful degradation — fixed in `e43db17`
- [x] Co-change analysis — mine git history during indexing (zero extra calls), `.ctxo/index/co-changes.json`, blast radius boost (potential → likely when frequency > 0.5)
- [x] `get_pr_impact` MCP tool (14th tool) — combines changed symbols + blast radius + co-change into single PR risk assessment

### V1.5 Features (Remaining)
- [ ] Epic 8: GitHub/GitLab webhook listener for auto-indexing on push events

## Documentation

- [Project Idea](docs/Project-Idea.md) — vision and feature overview
- [Product Brief](docs/artifacts/product-brief-Ctxo.md) — detailed product brief
- [PRD](docs/artifacts/prd.md) — full product requirements
- [Architecture](docs/artifacts/architecture.md) — architecture decisions and structure
- [Epics](docs/artifacts/epics.md) — implementation epics breakdown
- [V1 Walkthrough](docs/walkthrough-v1.md) — V1 implementation log (354 tests)
- [V1.1 Walkthrough](docs/walkthrough-v1.1.md) — V1.1 features: cross-file resolution, Go/C#, 3-tier blast radius
- [Agentic AI Integration](docs/agentic-ai-integration.md) — Claude Agent SDK, OpenAI Agents SDK, LangChain, raw MCP client usage
