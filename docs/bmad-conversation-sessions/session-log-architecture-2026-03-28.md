---
title: "Architecture Session Log"
date: "2026-03-28"
project: "Ctxo"
workflow: "bmad-create-architecture (Steps 1-8)"
status: "complete"
---

# Ctxo Architecture Session Log

**Date:** 2026-03-28
**User:** Alper Hankendi
**Project:** Ctxo — Logic-Slice Based MCP Server
**Workflow:** bmad-create-architecture (Steps 1–8, Complete)

---

## Session Summary

This session completed the full architecture workflow for **Ctxo**, an MCP (Model Context Protocol) server that delivers dependency-aware, intent-enriched context to AI agents — reducing token costs and hallucinations in AI-assisted development.

Three BMad workflows ran in sequence across this project:

1. **bmad-brainstorming** — 111 ideas across First Principles, Cross-Pollination, SCAMPER
2. **bmad-technical-research** — Full stack validation (tree-sitter, MCP SDK, AST graph)
3. **bmad-create-architecture** — Complete architecture decision document (this session)

---

## Key Decisions Made

### Storage Architecture (ADR-STORAGE-01)

**Problem:** Committing a binary SQLite `.db` file causes unresolvable merge conflicts in GitHub/GitLab PRs.

**Decision:** Split into two layers:

- `.ctxo/index/` — committed, per-source-file JSON (text-based, diffable, mergeable)
- `.ctxo/.cache/symbols.db` — gitignored, local SQLite cache rebuilt from JSON on startup

**Per-file JSON format:**

```json
{
  "file": "src/payment/processPayment.ts",
  "lastModified": 1711620000,
  "symbols": [
    {
      "symbolId": "src/payment/processPayment.ts::processPayment::function",
      "name": "processPayment",
      "kind": "function",
      "startLine": 12,
      "endLine": 45
    }
  ],
  "edges": [
    {
      "from": "src/payment/processPayment.ts::processPayment::function",
      "to": "src/auth/TokenValidator.ts::TokenValidator::class",
      "kind": "imports"
    }
  ],
  "intent": [
    {
      "hash": "abc123",
      "message": "fix race condition under load",
      "date": "2024-03-15",
      "kind": "commit"
    }
  ],
  "antiPatterns": [
    {
      "hash": "def456",
      "message": "revert: remove mutex — caused deadlock",
      "date": "2024-02-01"
    }
  ],
  "complexity": { "cyclomatic": 12, "cognitive": 8, "nestingDepth": 4, "paramCount": 5 },
  "churn": { "changeCount": 47, "lastChanged": "2024-03-15", "authors": 3 },
  "healthScore": 0.23
}
```

---

### Core Domain Model (Party Mode Decision)

**Option chosen:** Option C — Separate graph topology + metadata store

- `SymbolNode` + `GraphEdge` — lean topology for fast traversal (blast radius, logic-slice)
- `SymbolMeta` — lazy join, only materialised for MCP tool responses
- Symbol ID: deterministic string `"file::name::kind"` — stable, human-readable, safe as FK

**Party Mode consensus (Winston, Amelia, Barry):**

> "Option C isn't even a tradeoff decision. It's just... correct." — Barry

---

### Storage Replaceability (Party Mode Q&A)

**Q: If I want to replace storage later, what's the effect and effort?**

| Swap scenario | Files changed | Core impact | Effort |
|---|---|---|---|
| SQLite → DuckDB | 1 new adapter + 1 line | Zero | Small |
| SQLite → In-memory | 1 new adapter + 1 line | Zero | Tiny |
| SQLite → Remote graph DB | 1 new adapter + 1 line | Zero | Medium |

The `IStoragePort` contract (5 methods) is the insurance policy. The committed JSON index means no data is lost on any storage swap.

---

### Cache Invalidation Strategy (Three Scenarios)

**Scenario A — Cold start:** Read all `.ctxo/index/*.json` → batch-insert SQLite. No re-parsing.

**Scenario B — Dev session:** Chokidar file change → re-parse single file → update JSON → update SQLite rows.

**Scenario C — Git pull:** On next MCP startup, compare JSON `lastModified` vs SQLite timestamps → re-import changed files. No re-parsing.

**Performance targets:**

| Codebase | Full index | SQLite rebuild from JSON | Incremental |
|---|---|---|---|
| Small (100 files) | ~1–3s | ~100ms | ~20ms |
| Medium (1000 files) | ~10–30s | ~500ms | ~20ms |
| Large (5000 files) | ~60–150s | ~2–3s | ~20ms |

---

### CI/GitHub Actions Indexing

**Q: Can we run indexing in CI and commit the JSON index?**

Yes — two patterns:

**Pattern A (recommended):** CI runs `ctxo index`, commits updated JSON back to branch:

```yaml
- run: npx ctxo index
- run: git add .ctxo/index/ && git diff --staged --quiet || git commit -m "chore: update ctxo index [skip ci]" && git push
```

**Pattern B (simpler):** CI gates on stale index:

```yaml
- run: npx ctxo index
- run: git diff --exit-code .ctxo/index/
```

---

### Change Intelligence Module (FR-15) — User Addition

**User request:** "There is missing core functionality — I want to put change-log structure based module. The module can calculate code complexity, trace-changes, etc and give them a score."

**Decision:** New `core/change-intelligence/` module:

- `complexity-calculator.ts` — cyclomatic, cognitive, nesting depth, param count
- `churn-analyzer.ts` — change frequency, coupling from git log
- `health-scorer.ts` — composite score: `f(complexity, churn)` (formula TBD in story)
- New MCP tool: `get_change_intelligence`

`ILanguageAdapter` extended with optional `extractComplexity?()` method.

---

## Technology Stack (Final)

| Concern | Technology | Notes |
|---|---|---|
| Runtime | Node.js ≥ 20 | ESM-first |
| Language | TypeScript 5.x | strict, ES2022, Node16 |
| Build | tsup (esbuild) | native addon externals |
| MCP SDK | `@modelcontextprotocol/sdk` | StdioServerTransport |
| Validation | zod v4 | MCP input schemas |
| TS/JS Parsing | ts-morph | full type-aware tier |
| Multi-lang Parsing | tree-sitter-language-pack | syntax tier, V1.5 |
| SQLite | better-sqlite3 WAL | local cache, gitignored |
| Git | simple-git | intent + churn extraction |
| File watching | chokidar v5 | dev-time incremental |
| Testing | Vitest | ESM-native, co-located |
| Dev runner | tsx | zero-build dev mode |
| Architecture | Hexagonal (Ports & Adapters) | |

---

## Functional Requirements (15 total)

| ID | Requirement | Version |
|---|---|---|
| FR-1 | Logic-Slice: dependency-aware context assembly | V1 |
| FR-2 | Blast Radius Scoring | V1 |
| FR-3 | Architectural Overlay | V1 |
| FR-4 | Why-Driven Context (git intent) | V1 |
| FR-5 | Anti-Pattern Memory (revert detection) | V1 |
| FR-6 | Privacy-First Masking | V1 |
| FR-7 | Progressive Detail Levels (L1→L4) | V1 |
| FR-8 | MCP Tools (5 tools) | V1 |
| FR-9 | Monorepo tsconfig auto-discovery | V1 |
| FR-10 | Lazy indexing (zero-setup) | V1 |
| FR-11 | Incremental updates (watcher + git hook) | V1 |
| FR-12 | Multi-language: Go + C# via tree-sitter | V1.5 |
| FR-13 | Go deep analysis: gopls MCP composition | V2 |
| FR-14 | C# deep analysis: Roslyn LSP | V2 |
| FR-15 | Change Intelligence: complexity + churn scoring | V1 |

---

## MCP Tools (5)

| Tool | Purpose |
|---|---|
| `get_logic_slice` | Dependency-aware context bundle for a symbol |
| `get_blast_radius` | Impact analysis — what breaks if this symbol changes |
| `get_architectural_overlay` | Project structure map by layer |
| `get_why_context` | Git intent + anti-patterns for a symbol |
| `get_change_intelligence` | Complexity score + churn + health score |

---

## Project Structure (Top Level)

```
src/
  index.ts                      ← composition root
  ports/                        ← 4 interfaces (ILanguageAdapter, IStoragePort, IGitPort, IMaskingPort)
  core/
    types.ts
    graph/
    logic-slice/
    blast-radius/
    overlay/
    why-context/
    change-intelligence/        ← FR-15 (scoring formula TBD)
    detail-levels/
    masking/
  adapters/
    language/                   ← ts-morph (full) + tree-sitter (syntax)
    storage/                    ← SQLite adapter + JSON index reader/writer
    git/                        ← simple-git adapter
    watcher/                    ← chokidar adapter
    mcp/                        ← 5 MCP tool handlers
  cli/
    index-command.ts            ← ctxo index
    sync-command.ts             ← ctxo sync
    verify-command.ts           ← ctxo verify-index
```

---

## CLI Commands

| Command | Purpose |
|---|---|
| `ctxo index` | Full or incremental parse → write JSON files |
| `ctxo index --since <ref>` | Incremental CI runs (V1 stretch) |
| `ctxo sync` | Rebuild SQLite from JSON (post-merge hook) |
| `ctxo verify-index` | CI gate: fail if any source file unindexed |

---

## Implementation Sequence

1. Project scaffold + tsup build + composition root skeleton
2. `IStoragePort` + `SqliteStorageAdapter`
3. `ILanguageAdapter` + ts-morph adapter
4. Core graph traversal — logic-slice + blast radius
5. MCP tool handlers wired to core
6. git adapter — intent + anti-pattern extraction
7. `ctxo index` CLI command + chokidar file watcher
8. Privacy masking pipeline
9. Change Intelligence module (FR-15)
10. tree-sitter adapter for multi-language (V1.5)

---

## Key Architectural Rules (for AI Agents)

1. **Never use `console.log`** — corrupts MCP stdio JSON-RPC. Use `console.error` only.
2. **`core/` never imports from `adapters/`** — hexagonal boundary, enforced via ESLint.
3. **Every adapter implements a port** — no adapter without an interface.
4. **Composition root is `src/index.ts` only** — no wiring elsewhere.
5. **Symbol IDs are `file::name::kind`** — deterministic, stable, human-readable.
6. **All MCP responses use content-array shape** — `{ content: [{ type: 'text', text: '...' }] }`
7. **Storage is a replaceable cartridge** — `IStoragePort` is the only boundary.
8. **JSON index fields: camelCase. SQLite columns: snake_case.**

---

## Output Files

| File | Description |
|---|---|
| `artifacts/architecture.md` | Complete architecture decision document |
| `artifacts/brainstorming/brainstorming-session-2026-03-28-1400.md` | 111 ideas, prioritized backlog |
| `artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md` | Full stack technical research |
| `artifacts/session-log-architecture-2026-03-28.md` | This file |

---

*Session completed 2026-03-28. Architecture workflow status: COMPLETE.*
