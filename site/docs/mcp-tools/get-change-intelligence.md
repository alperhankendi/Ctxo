---
title: "get_change_intelligence"
description: "Composite change-risk score combining cyclomatic complexity and git churn."
---

# get_change_intelligence

Tells you which symbols are dangerous to change by blending two signals the
index already has: **cyclomatic complexity** (from the parser) and **churn**
(commit count from git). High score = hotspot.

::: tip When to use
Run this on any symbol before a non-trivial edit. Pair it with
[`get_blast_radius`](/mcp-tools/get-blast-radius) to understand **how far** a
change spreads, and with [`get_why_context`](/mcp-tools/get-why-context) to
learn **why** the area is risky.
:::

## Parameters

| Name       | Type   | Required | Description                                          |
| ---------- | ------ | -------- | ---------------------------------------------------- |
| `symbolId` | string | yes      | Fully-qualified symbol id (`<file>::<name>::<kind>`) |

## Example

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class"
}
```

## Response

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "complexity": 0.78,
  "churn": 0.92,
  "composite": 0.85,
  "band": "high"
}
```

Symbol missing from the index:

```json
{ "found": false, "hint": "Symbol not found. Run \"ctxo index\" to build the codebase index." }
```

## Interpreting the score

| Field        | Range    | Meaning                                                                |
| ------------ | -------- | ---------------------------------------------------------------------- |
| `complexity` | 0.0-1.0  | Normalized cyclomatic complexity (1 -> 0.0, 10+ -> 1.0)                |
| `churn`      | 0.0-1.0  | Normalized commit count vs the hottest file in the repo                |
| `composite`  | 0.0-1.0  | Weighted blend                                                         |
| `band`       | enum     | `low` (< 0.3), `medium` (0.3-0.7), `high` (>= 0.7)                    |

## When to use

- **Refactor planning** -- rank candidates by composite score; start with `high`-band symbols only if you have a test net.
- **Code review triage** -- a diff that touches multiple `high`-band symbols deserves a closer look.
- **Hotspot discovery** -- combined with [`get_symbol_importance`](/mcp-tools/get-symbol-importance), you get the "critical **and** volatile" shortlist.

## Pitfalls

::: warning Class-level aggregation
For a class or file symbol, the handler aggregates complexity as the **max**
across its methods. A class can score `high` even if most methods are trivial.
Drill down with [`search_symbols`](/mcp-tools/search-symbols) to inspect the
offending method directly.
:::

- **Drifted index** -- if the JSON index is missing for the file, `complexity`
  falls back to 0 and a warning is surfaced alongside the response. Do not
  mistake this for a real "low" verdict. Run `ctxo index` to resync.
- **Git not found** -- `churn` will be 0. The score stops being meaningful.
- **No unit here is "commits per week"** -- values are normalized against the
  repo's busiest file.

## Related tools

- [`get_blast_radius`](/mcp-tools/get-blast-radius) -- scope of a change
- [`get_why_context`](/mcp-tools/get-why-context) -- why the area is risky
- [`get_symbol_importance`](/mcp-tools/get-symbol-importance) -- structural centrality
- [`get_pr_impact`](/mcp-tools/get-pr-impact) -- change intelligence rolled up across a PR
