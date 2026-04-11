# CLAUDE.md — Ctxo

## Project Overview

Ctxo is a **Model Context Protocol (MCP) server** that gives AI coding assistants dependency-aware, history-enriched context for codebases. It delivers "Logic-Slices" — a symbol plus all transitive dependencies, git intent, anti-pattern warnings, and change health scores — in under 500ms.

- **Type:** npm package / CLI tool / MCP server (stdio transport)
- **Author:** Alper Hankendi
- **Status:** v0.3.0 — production (14 MCP tools, 718 tests, published on npm)
- **Language:** TypeScript (ESM-first, `"type": "module"`)
- **Runtime:** Node.js >= 20

## Quick Reference

```bash
# Dev
tsx src/index.ts              # zero-build dev run
tsup                          # production build to dist/
vitest                        # run tests (718 tests)
vitest run --coverage         # run with coverage report
npm link                      # local MCP client wiring

# Usage
npx ctxo index                # build codebase index
npx ctxo index --check        # CI gate: fail if index stale
npx ctxo index --skip-history # fast re-index without git history
npx ctxo index --max-history 5 # limit commit history per file
npx ctxo watch                # file watcher for incremental re-index
npx ctxo sync                 # rebuild SQLite from committed JSON
npx ctxo init                 # install git hooks (post-commit, post-merge)
npx ctxo status               # show index manifest
npx ctxo doctor               # health check all subsystems (--json, --quiet)

# Environment
DEBUG=ctxo:*                  # enable all debug output
DEBUG=ctxo:git,ctxo:storage   # enable specific namespaces
CTXO_RESPONSE_LIMIT=16384     # response truncation threshold (default 8192)
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
    language/                  # ts-morph (full tier), tree-sitter Go/C# (syntax tier)
    storage/                   # SQLite cache + JSON index read/write
    git/                       # simple-git wrapper
    watcher/                   # chokidar file watcher
    mcp/                       # MCP tool handlers (14 tools)
  cli/                         # index, init, sync, status, verify, watch commands
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
| `get_ranked_context` | Two-phase BM25 search (camelCase-aware, trigram fallback, fuzzy correction) + PageRank within token budget |
| `search_symbols` | Symbol name/regex search across index (supports `mode: 'fts'` for BM25 search) |
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
// Success — all responses include _meta with item counts and truncation info
{ content: [{ type: 'text', text: JSON.stringify({ ...payload, _meta: { totalItems, returnedItems, truncated, totalBytes, hint? } }) }] }
// Graceful miss
{ content: [{ type: 'text', text: JSON.stringify({ found: false, hint: '...' }) }] }
// Error — NEVER throw from tool handlers
{ content: [{ type: 'text', text: JSON.stringify({ error: true, message: '...' }) }] }
```

### MCP Resources

| Resource | URI | Purpose |
|---|---|---|
| `ctxo-status` | `ctxo://status` | Health check — prevents `-32601` from clients calling `listResources` |

### Cross-Cutting Features

- **Response envelope (`_meta`):** All tool responses include `_meta: { totalItems, returnedItems, truncated, totalBytes }`. Large responses auto-truncated at 8KB (configurable via `CTXO_RESPONSE_LIMIT` env).
- **Intent filtering:** `get_blast_radius`, `get_logic_slice`, `find_importers`, `find_dead_code` accept optional `intent` parameter for keyword-based result filtering.
- **Tool annotations:** All 14 tools declare `readOnlyHint`, `idempotentHint`, `openWorldHint` annotations for MCP clients.

## AI Assistant Rules (MCP Tool Usage — MANDATORY)

**ALWAYS use ctxo MCP tools before reading source files or making code changes.** The ctxo index contains dependency graphs, git intent, anti-patterns, and change health that cannot be derived from reading files alone. Skipping these tools leads to blind edits and broken dependencies.

### Before ANY Code Modification
1. Call `get_blast_radius` for the symbol you are about to change — understand what breaks
2. Call `get_why_context` for the same symbol — check for revert history or anti-patterns
3. Only then read and edit source files

### Before Starting a Task
| Task Type | REQUIRED First Call |
|---|---|
| Fixing a bug | `get_context_for_task(taskType: "fix")` |
| Adding/extending a feature | `get_context_for_task(taskType: "extend")` |
| Refactoring | `get_context_for_task(taskType: "refactor")` |
| Understanding code | `get_context_for_task(taskType: "understand")` |

### Before Reviewing a PR or Diff
- Call `get_pr_impact` — single call gives full risk assessment with co-change analysis

### When Exploring or Searching Code
- Use `search_symbols` for name/regex lookup — DO NOT grep source files for symbol discovery
- Use `get_ranked_context` for natural language queries — DO NOT manually browse directories

### Orientation in Unfamiliar Areas
- Call `get_architectural_overlay` to understand layer boundaries
- Call `get_symbol_importance` to identify critical symbols

### NEVER Do These
- NEVER edit a function without first calling `get_blast_radius` on it
- NEVER skip `get_why_context` — reverted code and anti-patterns are invisible without it
- NEVER grep source files to find symbols when `search_symbols` exists
- NEVER manually trace imports when `find_importers` gives the full reverse dependency graph

## Critical Rules

1. **NEVER use `console.log`** — MCP stdio uses stdout for JSON-RPC. Use `createLogger('ctxo:namespace')` from `src/core/logger.ts`. Debug output controlled via `DEBUG=ctxo:*` env.
2. **Error handling: warn-and-continue** — adapter boundary catches errors and returns fallback values. Core may throw.
3. **All MCP responses pass through masking pipeline** before delivery.
4. **Tests co-located** in `__tests__/` adjacent to source files.
5. **Testing framework:** `vitest` with `InMemoryTransport` for MCP integration tests.

## Error Handling Pattern

```typescript
// All adapter methods use createLogger:
import { createLogger } from '../../core/logger.js';
const log = createLogger('ctxo:adapterName');

try {
  return await doWork()
} catch (err) {
  log.error(`${(err as Error).message}`)
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
| Database | sql.js (WASM SQLite) |
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

## TODO

### Remaining
- [ ] C# full-tier: Roslyn LSP adapter (cross-file resolution, call graph, type-aware) — [ADR-007](docs/architecture/ADR/adr-007-csharp-roslyn-lsp.md)
- [ ] Go full-tier: gopls MCP composition (type-aware, cross-package)
- [ ] Epic 8: GitHub/GitLab webhook listener for auto-indexing on push events
- [ ] Streamable HTTP transport (for remote/cloud MCP usage)
- [ ] Performance benchmarks (p95 latency, startup time, index build time)

## Documentation

- [Project Idea](docs/Project-Idea.md) — vision and feature overview
- [Product Brief](docs/artifacts/product-brief-Ctxo.md) — detailed product brief
- [PRD](docs/artifacts/prd.md) — full product requirements
- [Architecture](docs/artifacts/architecture.md) — architecture decisions and structure
- [Epics](docs/artifacts/epics.md) — implementation epics breakdown
- [V1 Walkthrough](docs/walkthrough-v1.md) — V1 implementation log
- [V1.1 Walkthrough](docs/walkthrough-v1.1.md) — V1.1 features: cross-file resolution, Go/C#, 3-tier blast radius
- [Agentic AI Integration](docs/agentic-ai-integration.md) — Claude Agent SDK, OpenAI Agents SDK, LangChain, raw MCP client usage
- [Changelog](CHANGELOG.md) — version history (v0.2.0, v0.3.0)
- [Validation Runbook](docs/runbook/mcp-validation/mcp-validation.md) — 86-check end-to-end validation
- [llms.txt](llms.txt) / [llms-full.txt](llms-full.txt) — LLM-friendly project documentation

<!-- ctxo-rules-start -->
## ctxo MCP Tool Usage (MANDATORY)

**ALWAYS use ctxo MCP tools before reading source files or making code changes.** The ctxo index contains dependency graphs, git intent, anti-patterns, and change health that cannot be derived from reading files alone. Skipping these tools leads to blind edits and broken dependencies.

### Before ANY Code Modification
1. Call `get_blast_radius` for the symbol you are about to change — understand what breaks
2. Call `get_why_context` for the same symbol — check for revert history or anti-patterns
3. Only then read and edit source files

### Before Starting a Task
| Task Type | REQUIRED First Call |
|---|---|
| Fixing a bug | `get_context_for_task(taskType: "fix")` |
| Adding/extending a feature | `get_context_for_task(taskType: "extend")` |
| Refactoring | `get_context_for_task(taskType: "refactor")` |
| Understanding code | `get_context_for_task(taskType: "understand")` |

### Before Reviewing a PR or Diff
- Call `get_pr_impact` — single call gives full risk assessment with co-change analysis

### When Exploring or Searching Code
- Use `search_symbols` for name/regex lookup — DO NOT grep source files for symbol discovery
- Use `get_ranked_context` for natural language queries — DO NOT manually browse directories

### Orientation in Unfamiliar Areas
- Call `get_architectural_overlay` to understand layer boundaries
- Call `get_symbol_importance` to identify critical symbols

### NEVER Do These
- NEVER edit a function without first calling `get_blast_radius` on it
- NEVER skip `get_why_context` — reverted code and anti-patterns are invisible without it
- NEVER grep source files to find symbols when `search_symbols` exists
- NEVER manually trace imports when `find_importers` gives the full reverse dependency graph
<!-- ctxo-rules-end -->
