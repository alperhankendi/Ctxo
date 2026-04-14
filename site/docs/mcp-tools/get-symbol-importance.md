---
title: "get_symbol_importance"
description: "PageRank centrality ranking across every symbol in the index."
---

# get_symbol_importance

Ranks symbols by structural centrality using PageRank over the dependency
graph. High-ranked symbols are the ones many other symbols depend on --
breaking them breaks a lot.

::: tip When to use
Orientation in a new codebase, and before risky refactors to confirm you are
not about to change a **critical** symbol. Pair with
[`get_change_intelligence`](/mcp-tools/get-change-intelligence) to find the
"critical **and** volatile" shortlist.
:::

## Parameters

| Name          | Type                                                                       | Required | Description                                      |
| ------------- | -------------------------------------------------------------------------- | -------- | ------------------------------------------------ |
| `limit`       | number (1-200)                                                             | no       | Max rankings returned. Default `25`              |
| `kind`        | `"function" \| "class" \| "interface" \| "method" \| "variable" \| "type"` | no       | Filter to a single symbol kind                   |
| `filePattern` | string                                                                     | no       | Case-insensitive substring match on file path    |
| `damping`     | number (0-1)                                                               | no       | PageRank damping factor. Default `0.85`          |

## Example

Top 10 interfaces in the whole repo:

```json
{ "limit": 10, "kind": "interface" }
```

Most important symbols under `packages/cli/src/core`:

```json
{ "filePattern": "packages/cli/src/core", "limit": 20 }
```

## Response

```json
{
  "rankings": [
    {
      "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface",
      "name": "IStoragePort",
      "kind": "interface",
      "file": "packages/cli/src/ports/i-storage-port.ts",
      "score": 0.0412
    }
  ],
  "totalSymbols": 1847,
  "iterations": 42,
  "converged": true,
  "damping": 0.85,
  "_meta": { "totalItems": 25, "returnedItems": 25, "truncated": false }
}
```

## When to use

- **Onboarding** -- top 25 gives you the "backbone" of the codebase in seconds.
- **Refactor safety** -- if a symbol is top-10 by PageRank and top-10 by [`get_change_intelligence`](/mcp-tools/get-change-intelligence), plan carefully.
- **Architecture checks** -- unexpected high-importance symbols in an `adapters/` layer are a smell; see [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay).

## Notes

::: info Filtering is post-PageRank
`kind` and `filePattern` are applied **after** PageRank runs on the full graph,
so scores remain comparable across calls. Filtering before would distort the
ranking by removing inbound edges.
:::

- **`converged: false`** means the algorithm hit its 100-iteration cap. The ranking is still usable but less stable -- consider lowering `damping` slightly.
- **Requires** `ctxo index`.
