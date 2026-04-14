---
title: "search_symbols"
description: "Find symbols by name, regex, or BM25 full-text search."
---

# search_symbols

Find a symbol by name or pattern without grepping source files. Returns the
canonical `symbolId` you need to feed into every other ctxo tool.

::: tip When to use
Use this whenever an MCP tool asks for a `symbolId` and you only know the name.
For free-text questions ("where does retry happen?") reach for
[`get_ranked_context`](/mcp-tools/get-ranked-context) instead.
:::

## Parameters

| Name          | Type                                                                       | Required | Description                                                              |
| ------------- | -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `pattern`     | string                                                                     | yes      | Name, regex, or free-text (depends on `mode`)                            |
| `kind`        | `"function" \| "class" \| "interface" \| "method" \| "variable" \| "type"` | no       | Restrict to one symbol kind                                              |
| `filePattern` | string                                                                     | no       | Case-insensitive substring match on the file path                        |
| `limit`       | number (1-100)                                                             | no       | Max results. Default `25`                                                |
| `mode`        | `"regex" \| "fts"`                                                        | no       | `regex` (default): case-insensitive regex. `fts`: BM25 search            |

## Example

Regex (default):

```json
{ "pattern": "^SqliteStorage", "kind": "class" }
```

Full-text search (typo-tolerant):

```json
{ "pattern": "sqlite storage adapter", "mode": "fts", "limit": 10 }
```

## Response

```json
{
  "totalMatches": 3,
  "results": [
    {
      "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
      "name": "SqliteStorageAdapter",
      "kind": "class",
      "file": "packages/cli/src/adapters/storage/sqlite.ts",
      "startLine": 24,
      "endLine": 312,
      "relevanceScore": 0.91
    }
  ],
  "searchMetrics": { "tier": "bm25", "tookMs": 6, "candidates": 42 },
  "_meta": { "totalItems": 3, "returnedItems": 3, "truncated": false }
}
```

::: info `relevanceScore` only appears in `fts` mode.
Regex mode returns rows in insertion order with no ranking.
:::

## When to use

- **Resolving a symbol id** -- required input for [`get_blast_radius`](/mcp-tools/get-blast-radius), [`get_why_context`](/mcp-tools/get-why-context), [`get_logic_slice`](/mcp-tools/get-logic-slice), [`find_importers`](/mcp-tools/find-importers), [`get_context_for_task`](/mcp-tools/get-context-for-task).
- **Narrowing by kind** -- find every interface with `IStorage` in its name: `{ "pattern": "IStorage", "kind": "interface" }`.
- **Typo tolerance** -- `mode: "fts"` corrects small spelling mistakes and handles camelCase splitting.

## Pitfalls

- **Invalid regex falls back to substring** -- if `pattern` is not a valid regex, `mode: "regex"` silently becomes a case-insensitive `includes` match.
- **`filePattern` is substring, not glob** -- `"adapters"` matches any file path containing that string.
- **No results?** Run `ctxo index`. The graph is loaded from `.ctxo/index/`.
