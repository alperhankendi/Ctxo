---
title: "MCP Tools Overview"
description: "All 14 Ctxo MCP tools, grouped by purpose, with links to detailed specs and cross-cutting behavior."
---

# MCP Tools Overview

Ctxo ships **14 MCP tools** over stdio transport with **zero external network dependencies** — every tool reads from the local `.ctxo/` index and returns results in **under 500ms** on typical repositories. Tools are grouped into four categories matching the sidebar: Context & Search, Impact & Change, Structure & Deps, and History & Cleanup.

See [the mandatory sequence](/mcp-tools/tool-selection-guide#modifying-existing-code) before editing.

## Context & Search

| Tool | Purpose |
| --- | --- |
| [`get_logic_slice`](/mcp-tools/get-logic-slice) | Symbol plus transitive dependencies with progressive detail (L1-L4) |
| [`get_context_for_task`](/mcp-tools/get-context-for-task) | Task-aware bundle for `fix` / `extend` / `refactor` / `understand` |
| [`get_ranked_context`](/mcp-tools/get-ranked-context) | Two-phase BM25 search (camelCase-aware, trigram fallback, fuzzy) + PageRank within a token budget |
| [`search_symbols`](/mcp-tools/search-symbols) | Symbol name or regex lookup across the index (supports `mode: 'fts'`) |

## Impact & Change

| Tool | Purpose |
| --- | --- |
| [`get_blast_radius`](/mcp-tools/get-blast-radius) | Impact score + affected symbols in three tiers (confirmed / likely / potential) |
| [`get_pr_impact`](/mcp-tools/get-pr-impact) | Full PR risk assessment: changes + blast radius + co-change history |
| [`get_changed_symbols`](/mcp-tools/get-changed-symbols) | Symbols in recently changed files (git diff) |
| [`get_change_intelligence`](/mcp-tools/get-change-intelligence) | Complexity x churn composite score for hotspot detection |

## Structure & Deps

| Tool | Purpose |
| --- | --- |
| [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay) | Project layer map (Domain / Infrastructure / Adapters) |
| [`find_importers`](/mcp-tools/find-importers) | Reverse dependency lookup — who uses this symbol? |
| [`get_class_hierarchy`](/mcp-tools/get-class-hierarchy) | Class inheritance tree (ancestors + descendants) |
| [`get_symbol_importance`](/mcp-tools/get-symbol-importance) | PageRank centrality ranking of symbols |

## History & Cleanup

| Tool | Purpose |
| --- | --- |
| [`get_why_context`](/mcp-tools/get-why-context) | Git commit intent + anti-pattern / revert warnings |
| [`find_dead_code`](/mcp-tools/find-dead-code) | Unreachable symbols and files |

## Cross-cutting Features

All 14 tools share the same response envelope and behavior. See [Response Format](/mcp-tools/response-format) for full examples.

### The `_meta` envelope

Every successful response carries a `_meta` block:

```json
{
  "_meta": {
    "totalItems": 128,
    "returnedItems": 42,
    "truncated": true,
    "totalBytes": 8192,
    "hint": "Response truncated — narrow with `intent` or raise CTXO_RESPONSE_LIMIT"
  }
}
```

Truncation threshold defaults to **8192 bytes** and is configurable via the `CTXO_RESPONSE_LIMIT` environment variable.

### Intent filtering

[`get_blast_radius`](/mcp-tools/get-blast-radius), [`get_logic_slice`](/mcp-tools/get-logic-slice), [`find_importers`](/mcp-tools/find-importers), and [`find_dead_code`](/mcp-tools/find-dead-code) accept an optional `intent` parameter — a keyword filter applied to symbol names, file paths, and commit messages — to narrow noisy result sets before truncation kicks in.

### Tool annotations

Every tool declares MCP annotations so clients can reason about safety:

| Annotation | Meaning |
| --- | --- |
| `readOnlyHint` | Tool never mutates repo or index state |
| `idempotentHint` | Identical inputs produce identical outputs |
| `openWorldHint` | Tool may touch unbounded external state (always `false` for Ctxo — all reads are local) |

::: info Resources
Ctxo also exposes one MCP resource — `ctxo://status` — as a health-check endpoint to prevent `-32601 Method not found` errors from clients that call `listResources` at startup.
:::

## Next

- [Tool Selection Guide](/mcp-tools/tool-selection-guide) — decision tree mapping tasks to tools
- [Response Format](/mcp-tools/response-format) — full envelope, error shapes, and examples
