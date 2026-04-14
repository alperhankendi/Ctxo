---
title: "get_changed_symbols"
description: "List symbols inside files changed since a given git ref."
---

# get_changed_symbols

Maps a git diff to symbols. Given a ref (default `HEAD~1`), returns every
indexed symbol living in a file that changed since that ref. The building
block behind diff-aware reviews.

::: tip When to use
Feed the output into [`get_blast_radius`](/mcp-tools/get-blast-radius) or
[`get_why_context`](/mcp-tools/get-why-context) to review a branch symbol by
symbol. For a **single-call** PR review, use
[`get_pr_impact`](/mcp-tools/get-pr-impact) instead -- it wraps this tool and
adds blast radius plus co-change analysis.
:::

## Parameters

| Name       | Type            | Required | Description                                                    |
| ---------- | --------------- | -------- | -------------------------------------------------------------- |
| `since`    | string          | no       | Git ref / range. Default `"HEAD~1"`. Accepts `main`, `v1.0..HEAD`, etc. |
| `maxFiles` | number (min 1)  | no       | Cap on number of changed files to process. Default `50`        |

## Example

Changes in the last commit:

```json
{}
```

All changes since branching off main:

```json
{ "since": "main", "maxFiles": 100 }
```

## Response

```json
{
  "since": "main",
  "changedFiles": 4,
  "changedSymbols": 11,
  "files": [
    {
      "file": "packages/cli/src/adapters/storage/sqlite.ts",
      "symbols": [
        {
          "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
          "name": "SqliteStorageAdapter",
          "kind": "class",
          "startLine": 24,
          "endLine": 312
        }
      ]
    }
  ],
  "_meta": { "totalItems": 11, "returnedItems": 11, "truncated": false }
}
```

## When to use

- **Pre-push sanity check** -- what symbols am I actually touching?
- **PR description generation** -- list of changed symbols grouped by file.
- **Batch blast-radius** -- iterate the list and call [`get_blast_radius`](/mcp-tools/get-blast-radius) on each. Or just call [`get_pr_impact`](/mcp-tools/get-pr-impact) which does this for you.

## Pitfalls

::: warning Files must be indexed
Changed files that were added in the working tree but not yet indexed (or
excluded by `.ctxo/config.yaml`'s `index.ignore`) return no symbols. Run
`ctxo index` after adding new source files.
:::

- **`maxFiles` clips silently** -- if a diff touches more files than the cap, the extras are dropped with no warning.
- **Uncommitted changes** -- the underlying git adapter uses `git diff` semantics; check your ref against `git diff --name-only <since>` if results look off.
- **Renames** -- surfaced as their new path only.
