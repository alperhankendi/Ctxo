---
title: "get_why_context"
description: "Git commit intent + anti-pattern warnings for a symbol."
---

# get_why_context

> The code shows **what**. Git shows **why**.

Returns the commit history that shaped a symbol plus any anti-pattern
warnings (reverts, re-reverts, "fix of fix" churn) detected from that
history. Reverted code is invisible in the current source but lives on in
git — this tool surfaces it before you repeat a mistake someone already
undid.

See [the mandatory sequence](/mcp-tools/tool-selection-guide#modifying-existing-code) before editing.

## Parameters

| Name         | Type    | Required | Description                                                       |
| ------------ | ------- | -------- | ----------------------------------------------------------------- |
| `symbolId`   | string  | yes      | Fully-qualified symbol id (`<file>::<name>::<kind>`)              |
| `maxCommits` | integer | no       | Limit returned commit history (default: full history from index) |

## Example

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class"
}
```

Trim to the 5 most recent commits:

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "maxCommits": 5
}
```

## Response

```json
{
  "commitHistory": [
    {
      "hash": "def456",
      "message": "revert: remove cache invalidation mutex",
      "date": "2024-02-01",
      "kind": "commit"
    },
    {
      "hash": "abc123",
      "message": "fix race condition in cache invalidation",
      "date": "2024-01-28",
      "kind": "commit"
    }
  ],
  "antiPatternWarnings": [
    {
      "hash": "def456",
      "message": "revert: remove cache invalidation mutex",
      "date": "2024-02-01"
    }
  ],
  "warningBadge": "⚠ Anti-pattern detected"
}
```

If the symbol is missing from the index:

```json
{ "found": false, "hint": "Symbol not found. Run \"ctxo index\" to build the codebase index." }
```

## Reading the signal

- **`antiPatternWarnings` is non-empty** — someone already tried something
  here and reverted it. Read those commits before you write a single line.
  The `warningBadge` field is also set so LLMs and UIs can flag the result.
- **High commit churn on a small symbol** — the code is unstable. Pair with
  [`get_change_intelligence`](/mcp-tools/get-change-intelligence) for a
  complexity x churn score.
- **No intent and no anti-patterns** — either the symbol is new or git
  history is unavailable. The tool degrades gracefully: when the committed
  index lacks intent data it falls back to an on-demand `git log` call.

## Worked example: a reverted fix

A symbol with history like:

1. `abc123` — "fix race condition in cache invalidation"
2. `def456` — "revert: remove cache invalidation mutex"
3. `ghi789` — "add cache with no locking"

`antiPatternWarnings` will flag `def456`. The takeaway: the mutex caused a
problem bad enough to revert, and the current code deliberately has no
locking. Before "fixing" a race you think you see, read `abc123` to
understand what the original attempt looked like and `def456` for why it
was pulled.

## Related tools

- [`get_blast_radius`](/mcp-tools/get-blast-radius) — required prerequisite before any edit
- [`get_change_intelligence`](/mcp-tools/get-change-intelligence) — complexity x churn hotspot scoring
- [`get_pr_impact`](/mcp-tools/get-pr-impact) — run this on every high-risk symbol it surfaces
- [`get_logic_slice`](/mcp-tools/get-logic-slice) — the code itself, once you understand the history
