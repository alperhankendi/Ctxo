---
title: "get_blast_radius"
description: "What breaks if I change this symbol?"
---

# get_blast_radius

Answers the question **"what breaks if I change this?"** Returns every symbol
that could be affected by modifying the target, graded across three confidence
tiers so you know what is certain vs speculative.

See [the mandatory sequence](/mcp-tools/tool-selection-guide#modifying-existing-code) before editing.

## Parameters

| Name         | Type                                         | Required | Description                                                         |
| ------------ | -------------------------------------------- | -------- | ------------------------------------------------------------------- |
| `symbolId`   | string                                       | yes      | Fully-qualified symbol id (`<file>::<name>::<kind>`)                |
| `confidence` | `"confirmed" \| "likely" \| "potential"`     | no       | Restrict results to a single tier                                   |
| `intent`     | string                                       | no       | Keyword filter on impacted symbols (e.g. `"test"`, `"adapter"`)     |

### Confidence tiers

Results are grouped into 3 confidence tiers — see [Blast Radius tiers](/concepts/blast-radius#confidence-tiers).

## Example

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class"
}
```

Filter to high-confidence only:

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "confidence": "confirmed"
}
```

## Response

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "impactScore": 27,
  "directDependentsCount": 6,
  "confirmedCount": 6,
  "likelyCount": 14,
  "potentialCount": 7,
  "overallRiskScore": 0.82,
  "impactedSymbols": [
    {
      "symbolId": "packages/cli/src/index.ts::main::function",
      "name": "main",
      "kind": "function",
      "confidence": "confirmed",
      "riskScore": 0.91
    }
  ],
  "_meta": { "totalItems": 27, "returnedItems": 27, "truncated": false }
}
```

If the symbol is missing from the index:

```json
{ "found": false, "hint": "Symbol not found. Run \"ctxo index\" to build the codebase index." }
```

## Interpreting `overallRiskScore`

| Score        | Risk level | Action                                                             |
| ------------ | ---------- | ------------------------------------------------------------------ |
| `> 0.7`      | high       | Plan carefully, write tests first, review with a teammate          |
| `0.3 - 0.7`  | medium     | Read `get_why_context` before editing                              |
| `< 0.3`      | low        | Safe to edit, still verify imports via `find_importers` if unsure  |

## See it in action

See a worked comparison of blind edits vs blast-radius-aware edits:
[Blast Radius comparison](/comparisons/blast-radius).

## Common pitfalls

::: warning Skipping this tool
Editing a symbol without calling `get_blast_radius` first is the #1 cause of
broken dependencies. The static graph catches couplings that grep and manual
reading will miss, especially through re-exports and dynamic dispatch.
:::

- **Treating `potential` as noise** — the tier comes from git co-change
  history; two files that always change together are coupled even when the
  parser sees no edge.
- **Ignoring `_meta.truncated`** — large impact sets are capped by
  `CTXO_RESPONSE_LIMIT`. If truncated, narrow with `confidence` or `intent`.
- **Using the symbol name instead of id** — always pass the full
  `<file>::<name>::<kind>` id. Look it up with
  [`search_symbols`](/mcp-tools/search-symbols) if you only know the name.

## Related tools

- [`get_why_context`](/mcp-tools/get-why-context) — required follow-up before editing
- [`get_logic_slice`](/mcp-tools/get-logic-slice) — forward deps (what this symbol needs)
- [`find_importers`](/mcp-tools/find-importers) — direct reverse lookup only
- [`get_pr_impact`](/mcp-tools/get-pr-impact) — blast radius across every changed symbol in a diff
