---
title: "get_pr_impact"
description: "Full PR risk assessment (changes + blast + co-changes)."
---

# get_pr_impact

Full risk assessment for a diff in one call. Walks every changed file, maps
them to symbols, runs [`get_blast_radius`](/mcp-tools/get-blast-radius) on
each, and layers on co-change history to surface files that historically
change together but are missing from this PR.

::: tip Single-call convenience
This replaces running
[`get_changed_symbols`](/mcp-tools/get-changed-symbols) plus per-symbol
[`get_blast_radius`](/mcp-tools/get-blast-radius) plus a history lookup.
Use it before every merge.
:::

## Parameters

| Name         | Type                                         | Required | Description                                                    |
| ------------ | -------------------------------------------- | -------- | -------------------------------------------------------------- |
| `since`      | string                                       | no       | Git ref to diff against (default `"HEAD~1"`)                   |
| `maxFiles`   | integer                                      | no       | Cap on changed files analysed (default `50`)                   |
| `confidence` | `"confirmed" \| "likely" \| "potential"`     | no       | Restrict blast radius results to a single tier                 |

`since` accepts anything `git diff` accepts — a branch name (`main`), a tag,
or a commit hash.

## Example

Review the last commit:

```json
{}
```

Review a feature branch against `main`:

```json
{ "since": "main" }
```

Review a specific commit range, confirmed impacts only:

```json
{ "since": "abc123", "confidence": "confirmed", "maxFiles": 20 }
```

## Response

```json
{
  "since": "HEAD~1",
  "changedFiles": 3,
  "changedSymbols": 7,
  "totalImpact": 42,
  "riskLevel": "high",
  "files": [
    {
      "file": "packages/cli/src/core/graph/graph.ts",
      "symbols": [
        {
          "symbolId": "packages/cli/src/core/graph/graph.ts::Graph::class",
          "name": "Graph",
          "kind": "class",
          "blast": {
            "impactScore": 31,
            "confirmedCount": 8,
            "likelyCount": 15,
            "potentialCount": 8,
            "riskScore": 0.88,
            "topImpacted": [ /* up to 10 highest-risk dependents */ ]
          }
        }
      ],
      "coChangedWith": [
        "packages/cli/src/core/graph/graph-builder.ts",
        "packages/cli/src/adapters/storage/sqlite.ts"
      ]
    }
  ],
  "summary": {
    "confirmedTotal": 12,
    "likelyTotal": 21,
    "potentialTotal": 9,
    "highRiskSymbols": [
      "packages/cli/src/core/graph/graph.ts::Graph::class"
    ]
  },
  "boundaryViolations": {
    "confidence": "medium",
    "snapshotsAvailable": 4,
    "violations": [
      {
        "from": { "symbolId": ".../CheckoutFlow::class", "communityId": 1, "label": "Billing" },
        "to":   { "symbolId": ".../UserPermissions::class", "communityId": 3, "label": "Auth" },
        "edgeKind": "calls",
        "historicalEdgesBetweenClusters": 0,
        "severity": "high"
      }
    ]
  },
  "clustersAffected": [
    { "id": 1, "label": "Billing", "symbolCount": 5 },
    { "id": 3, "label": "Auth", "symbolCount": 1 }
  ],
  "_meta": { "totalItems": 3, "returnedItems": 3, "truncated": false }
}
```

If the diff is empty:

```json
{ "since": "HEAD~1", "changedFiles": 0, "changedSymbols": 0, "totalImpact": 0, "riskLevel": "low", "files": [], "summary": { "confirmedTotal": 0, "likelyTotal": 0, "potentialTotal": 0, "highRiskSymbols": [] } }
```

## Reading the verdict

- **`riskLevel`** — `high` if any changed symbol has `riskScore > 0.7`,
  `medium` above `0.3`, else `low`. Use it as the top-line gate for review
  depth.
- **`summary.highRiskSymbols`** — the symbols most likely to break something.
  Review these first.
- **`files[].coChangedWith`** — files that historically change together with
  this one but are **not** in the current diff. A strong signal that the PR
  may be incomplete.
- **`boundaryViolations.violations[]`** (v0.8) — edges introduced by this PR
  between clusters that had no edges between them historically. `severity:
  "high"` + `historicalEdgesBetweenClusters: 0` is a first-ever layer
  crossing.
- **`clustersAffected[]`** (v0.8) — distinct clusters the PR touches. A PR
  spanning 3+ clusters is usually a cross-team change.

## Killer example: the first-ever cluster crossing

A PR wires a direct call from `CheckoutFlow` (Billing cluster) to `UserPermissions` (Auth cluster). Typecheck passes. Tests pass. `riskLevel` from blast radius alone may even come back `low` — the affected set is tiny.

But the last 10 snapshots show **zero** edges between these two clusters. A senior reviewer would ask "why is Billing reaching into Auth internals?" Ctxo now hands that exact question to the AI reviewer before a human ever sees the PR:

```json
"boundaryViolations": {
  "violations": [{
    "from": { "label": "Billing" },
    "to":   { "label": "Auth" },
    "historicalEdgesBetweenClusters": 0,
    "severity": "high"
  }]
}
```

This is architectural review from git history — no competitor MCP server has it.

## When to use

- PR review and pre-merge sanity check
- CI gate on high-risk changes (parse `riskLevel === "high"` or `boundaryViolations.violations.length > 0`)
- "Did I forget a file?" check via `coChangedWith`
- "Should this span multiple teams?" check via `clustersAffected`

## Related tools

- [`get_blast_radius`](/mcp-tools/get-blast-radius) — per-symbol deep dive
- [`get_changed_symbols`](/mcp-tools/get-changed-symbols) — just the symbol list, no blast radius
- [`get_why_context`](/mcp-tools/get-why-context) — follow up on any high-risk symbol to read its history
