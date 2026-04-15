---
title: "get_architectural_overlay"
description: "Regex layers + data-driven community clusters, god nodes, and modularity score."
---

# get_architectural_overlay

Returns two views of your codebase's architecture:

1. **Regex layers** (Domain / Adapter / Ports / Tests / Composition / Configuration / Unknown) derived from filename conventions — the pre-v0.8 behaviour.
2. **Data-driven communities** derived from Louvain clustering over the symbol graph — layers that emerge from **actual dependencies**, not folder names. See [Architectural Intelligence](/concepts/architectural-intelligence).

::: tip When to use
First call when entering a new repo. Pair with
[`get_symbol_importance`](/mcp-tools/get-symbol-importance) to find the
critical symbols inside each layer or community.
:::

## Parameters

| Name    | Type                                        | Required | Description                                                                                           |
| ------- | ------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `layer` | string                                      | no       | Return only files in this regex layer (e.g. `"Domain"`, `"Adapter"`).                                  |
| `mode`  | `"regex"` \| `"communities"` \| `"both"`    | no       | Which view to return. Default `"both"`. When `"communities"` and no snapshot exists, returns a hint. |

## Examples

Full overlay (layers + communities):

```json
{}
```

Communities only (skip regex layer classification):

```json
{ "mode": "communities" }
```

Drill into one regex layer:

```json
{ "layer": "Domain" }
```

## Response (full, `mode: "both"`)

```json
{
  "layers": {
    "Domain": [
      "packages/cli/src/core/graph/symbol-graph.ts",
      "packages/cli/src/ports/i-storage-port.ts"
    ],
    "Adapter": [
      "packages/cli/src/adapters/storage/sqlite-storage-adapter.ts"
    ]
  },
  "communities": {
    "modularity": 0.735,
    "edgeQuality": "mixed",
    "crossClusterEdges": 191,
    "commitSha": "78ccc33",
    "computedAt": "2026-04-16T10:00:00.000Z",
    "clusters": [
      {
        "id": 0,
        "label": "packages/cli/src/adapters/storage",
        "memberCount": 24,
        "members": [
          "packages/cli/src/adapters/storage/json-index-reader.ts::JsonIndexReader::class"
        ],
        "godNodes": [
          "packages/cli/src/adapters/storage/json-index-reader.ts::JsonIndexReader::class"
        ]
      }
    ]
  }
}
```

### Community field reference

| Field | Meaning |
| :--- | :--- |
| `modularity` | Louvain modularity score (0..1). `0.3+` indicates a recognisable cluster structure. |
| `edgeQuality` | `"full"` / `"mixed"` / `"syntax-only"` — flags when part of the graph ran on tree-sitter fallback, signalling how much to trust clustering. |
| `crossClusterEdges` | Total edges that cross cluster boundaries in the current snapshot. |
| `commitSha` | Git HEAD the snapshot was computed against. |
| `clusters[].label` | Human-readable name. Defaults to the longest common path prefix of members, falls back to `"<TopSymbol> area"`. |
| `clusters[].godNodes` | Symbols in this cluster that bridge ≥ 3 other clusters. These hold architecture together — refactor carefully. |
| `clusters[].members` | Up to 15 preview members per cluster. Full list is in `.ctxo/index/communities.json`. |

## Response (filtered by regex layer)

```json
{
  "layer": "Domain",
  "files": [
    "packages/cli/src/core/graph/symbol-graph.ts",
    "packages/cli/src/ports/i-storage-port.ts"
  ]
}
```

## Response (communities-only, no snapshot)

```json
{
  "hint": "No community snapshot available. Run `ctxo index` to generate one."
}
```

::: info No `_meta` envelope
This tool returns the raw overlay payload and does not pass through the `wrapResponse` envelope used by most other tools. Cluster member arrays are preview-capped at 15 entries per cluster — read `.ctxo/index/communities.json` for the full list.
:::

## Killer example: regex lies, communities don't

Suppose `src/utils/payments-helper.ts` sits under `utils/`. The regex classifier returns `Unknown`. But dependency-wise every call into it comes from the billing cluster. After v0.8:

```json
{
  "layers": { "Unknown": ["src/utils/payments-helper.ts"] },
  "communities": {
    "clusters": [
      { "label": "src/billing", "members": ["src/billing/checkout.ts::...", "src/utils/payments-helper.ts::..."] }
    ]
  }
}
```

The file's *real* home — the billing cluster — is now visible. A misplaced utility is no longer invisible architecture.

## When to use

- **Onboarding** — communities give you a map of the codebase that matches how it actually works, not how its folders are arranged.
- **Architectural lint** — hand the `godNodes` list to code review checklists; these are the symbols that hold your architecture together.
- **Scoped search** — filter by a cluster label before calling [`get_symbol_importance`](/mcp-tools/get-symbol-importance) or [`find_dead_code`](/mcp-tools/find-dead-code).
- **Non-conforming codebases** — the regex classifier returns `Unknown` for everything when folders do not encode layers; communities still produce useful structure.

## Pitfalls

::: warning Communities need an indexed repo
Community data comes from `.ctxo/index/communities.json`, written during `ctxo index`. If you ran `ctxo index --skip-community` or your index predates v0.8, only `layers` is returned. Re-run `ctxo index`.
:::

- **Low modularity (< 0.3) often means low-quality edges** (syntax-only tree-sitter fallback). Check `edgeQuality`.
- **Labels can collide across clusters with identical path prefixes** — disambiguation adds a numeric suffix (e.g. `src/shared (2)`).
