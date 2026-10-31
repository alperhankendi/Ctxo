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
            "riskScore": 0.78,
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
    "distinctCommits": 4,
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
{ "since": "HEAD~1", "changedFiles": 0, "changedSymbols": 0, "totalImpact": 0, "riskLevel": "low", "files": [], "summary": { "confirmedTotal": 0, "likelyTotal": 0, "potentialTotal": 0, "highRiskSymbols": [] }, "_meta": { "totalItems": 0, "returnedItems": 0, "truncated": false, "totalBytes": 186 } }
```

The empty response goes through the same envelope and masking as every other response, so it carries `_meta`, and module fields (see below) are added to it too.

## Named contexts

With `@ctxo/domain` and a registry, two fields are added:

- `context` on each changed symbol: the id of the one named context that owns its file.
- `contextBoundaryViolations`: the cross-context edges that touch a changed symbol and fall outside the source context's `contracts`. Each entry has `from` and `to` (`symbolId`, `file`, `context`), `edgeKind` and `severity` (`error` or `warning`, from `domain.boundaries.enforce` and the contexts' rungs). Capped at 50, with `contextBoundaryViolationsTotal` when more existed. Absent when no edge qualifies, and without a registry.

### Contexts, cards and untested rules

With a domain graph (built by `ctxo index`), three more lists show which named contexts the change touched, which cards it changed and which rules in those contexts have no test:

- `contextsTouched`: each named context with a changed non-test file. Each entry has `id`, `status` (`card-changed`, `acknowledged`, `unresolved` or `no-card`, as in [`ctxo contexts-touched`](/cli/domain#ctxo-contexts-touched)), `card`, `cardChanged`, `acknowledged` (`{ commit, reason? }`, from a `Domain-Unchanged` trailer) when present, `fileCount` and up to 10 `files`.
- `cardsChanged`: every registry card changed in the range or the working tree, touched context or not, in path order.
- `rulesWithoutTests`: the rules of the touched contexts that have no test link, each with `ruleId`, `title`, `context`, `card`, and `untested` when the card gives an `Untested:` reason.

```json
{
  "contextsTouched": [
    { "id": "lending", "status": "unresolved", "card": "docs/domain/lending/domain.md", "cardChanged": false, "fileCount": 1, "files": ["src/lending/loan-limit.ts"] }
  ],
  "cardsChanged": [],
  "rulesWithoutTests": [
    { "ruleId": "LEND-01", "title": "A loan lasts fourteen days", "context": "lending", "card": "docs/domain/lending/domain.md", "untested": "the due date is set by the loan service and has no test yet" }
  ]
}
```

::: info Two meanings of `since`
`files` and the risk figures come from `git diff <since>`, as before. The three domain lists use the change set of `ctxo contexts-touched`: the commits after the merge base of `since` and HEAD, plus the working tree (staged, unstaged and untracked files). When `since` is an ancestor of HEAD and the working tree is clean the two agree; otherwise, for example with `since` on another branch or with uncommitted edits, the lists can name files that `files` does not.
:::

The three lists are present, possibly empty, whenever a valid graph exists and git can resolve the range; when git cannot resolve `since` (no merge base, an unknown ref) they are left out with one warning on stderr. Each is capped at 50 entries with `contextsTouchedTotal`, `cardsChangedTotal` or `rulesWithoutTestsTotal` when entries were cut, and is never truncated by the response envelope. If the domain fields take longer than 5 seconds, the response comes back without them.

## Reading the verdict

- **`riskLevel`** — `high` if any changed symbol has `riskScore > 0.7`,
  `medium` above `0.3`, else `low`. Use it as the top-line gate for review
  depth. A symbol's `riskScore` is its
  [`overallRiskScore`](/mcp-tools/get-blast-radius#interpreting-overallriskscore),
  `sum / (sum + 5)` over the depth-weighted blast, which approaches 1 without
  reaching it. `high` therefore needs about 12 direct dependents (or the
  equivalent weighted mass), `medium` about 3, and a symbol with one or two
  dependents is `low`. Earlier versions scored `1.0` for any symbol with a
  dependent, so `high` fired far more often and `medium` was unreachable; expect
  `high` much less often now, and CI checks on `riskLevel === "high"` to pass
  where they used to fail.
- **`summary.highRiskSymbols`** — the symbols most likely to break something.
  Review these first.
- **`files[].coChangedWith`** - files that historically change together with
  this one but are **not** in the current diff. A strong signal that the PR
  may be incomplete. It reads the same co-change matrix as
  [`get_blast_radius`](/mcp-tools/get-blast-radius), which `ctxo index` builds
  from a window of recent commits (see the
  [`cochange` config](/reference/config-schema#cochange)).
- **`boundaryViolations.violations[]`** (v0.8) - edges introduced by this PR
  between clusters that had no edges between them historically. `severity:
  "high"` + `historicalEdgesBetweenClusters: 0` is a first-ever layer
  crossing.
- **`boundaryViolations.confidence`** - computed from `distinctCommits`, the
  number of different commits in the snapshot history (other than the current
  one): `low` below 3, `medium` for 3-6, `high` for 7+. Without at least 2
  distinct commits a missing historical edge is not treated as evidence.
  `snapshotsAvailable` is kept for compatibility and is not what confidence
  uses. Install the post-commit hook (`ctxo init`) to build history;
  `ctxo index --check` records no snapshot.
- **`clustersAffected[]`** (v0.8) — distinct clusters the PR touches. A PR
  spanning 3+ clusters is usually a cross-team change.

## Killer example: the first-ever cluster crossing

A PR wires a direct call from `CheckoutFlow` (Billing cluster) to `UserPermissions` (Auth cluster). Typecheck passes. Tests pass. `riskLevel` from blast radius alone may even come back `low` — the affected set is tiny.

But the last 10 snapshotted commits show **zero** edges between these two clusters. A senior reviewer would ask "why is Billing reaching into Auth internals?" Ctxo now hands that exact question to the AI reviewer before a human ever sees the PR:

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
- Migration review: a `CREATE OR ALTER PROCEDURE` (or table change) in a new
  `.sql` migration reports the dependents of the procedure, like every other
  copy of it, because the copies of a multi-defined object share one identity
  ([several definitions](/languages/sql#several-definitions-of-one-object))

## Related tools

- [`get_blast_radius`](/mcp-tools/get-blast-radius) — per-symbol deep dive
- [`get_changed_symbols`](/mcp-tools/get-changed-symbols) — just the symbol list, no blast radius
- [`get_why_context`](/mcp-tools/get-why-context) — follow up on any high-risk symbol to read its history
