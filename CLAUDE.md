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

## MCP Tools (5 total)

| Tool | Purpose |
|---|---|
| `get_logic_slice` | Symbol + transitive deps (L1-L4 progressive detail) |
| `get_blast_radius` | Impact score + affected symbols |
| `get_architectural_overlay` | Project layer map (Domain/Infra/Adapters) |
| `get_why_context` | Git commit intent + anti-pattern warnings |
| `get_change_intelligence` | Complexity x churn composite score |

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

### Bugs (Open Issues)
- [ ] **#2** Masking pipeline false negative — AWS secrets not redacted after `=` character
- [ ] **#3** Git commit hashes falsely masked as `AWS_SECRET` in `get_why_context` output
- [ ] **#4** RevertDetector only catches 2 patterns — misses undo, rollback, and indirect reverts
- [ ] **#5** Missing test coverage for masking pipeline edge cases (git hashes, `=` prefix, index persistence)

### Analysis Required
- [ ] Investigate why `intent: []` and `antiPatterns: []` were hardcoded in `IndexCommand` from Phase 6 through V1 delivery — this was a core PRD feature (FR14-FR16) that should have been caught during implementation. Root cause: `IndexCommand` was built in Phase 6 before git adapter (Phase 7) existed, and the wiring was never added when Phase 7 landed. Review process gap: 4 code review rounds focused on runtime bugs but missed this feature completeness gap.

### V1.1 Improvements
- [ ] `get_why_context` should read intent/antiPatterns from committed index first, fall back to on-demand git query
- [ ] Performance: batch `git log` calls during indexing (currently N sequential calls for N files)
- [ ] Add `--skip-history` flag to `ctxo index` for fast re-indexing without git history
- [ ] README.md content (quick start, feature overview, MCP config examples)

### V1.5 Features
- [ ] Epic 7: tree-sitter adapter for Go + C# (syntax-level parsing)
- [ ] Epic 8: GitHub/GitLab webhook listener for auto-indexing on push events
- [ ] npm publish via CI/CD pipeline (GitHub Actions release workflow)

## Documentation

- [Project Idea](docs/Project-Idea.md) — vision and feature overview
- [Product Brief](docs/artifacts/product-brief-Ctxo.md) — detailed product brief
- [PRD](docs/artifacts/prd.md) — full product requirements
- [Architecture](docs/artifacts/architecture.md) — architecture decisions and structure
- [Epics](docs/artifacts/epics.md) — implementation epics breakdown
