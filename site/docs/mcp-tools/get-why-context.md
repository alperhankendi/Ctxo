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

**v0.8 adds `driftSignals`** — cluster transitions for the queried symbol, so
"this symbol used to live with the Auth cluster but now sits in
Infrastructure" becomes a first-class fact alongside commit history. See
[Architectural Intelligence](/concepts/architectural-intelligence).

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
  "warningBadge": "⚠ Anti-pattern detected",
  "driftSignals": {
    "confidence": "medium",
    "snapshotsAvailable": 5,
    "events": [
      {
        "symbolId": "packages/cli/src/auth/service.ts::AuthService::class",
        "movedFrom": { "id": 3, "label": "Auth" },
        "movedTo":   { "id": 1, "label": "Infrastructure" },
        "firstSeenInNewCluster": "2026-04-16T10:00:00.000Z"
      }
    ]
  }
}
```

### v0.8 `driftSignals` field

Drift is computed by comparing the current community snapshot against the
history stored in `.ctxo/index/communities.history/`. See
[Architectural Intelligence](/concepts/architectural-intelligence).

| Sub-field | Meaning |
| :--- | :--- |
| `events[]` | Cluster transitions that include the queried symbol. Empty unless the symbol drifted. |
| `confidence` | `"low"` when `snapshotsAvailable < 3`, `"medium"` for 3–6, `"high"` for 7+. |
| `snapshotsAvailable` | Number of snapshots fed into the comparison. |
| `hint` | Actionable recovery advice when confidence is low (enable post-commit hook, `ctxo watch`, or CI gate). |

When no `communities.json` exists, the `driftSignals` field is omitted entirely.

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

## Killer example: silent architectural decay

A symbol `AuthService` used to cluster with session/token code. Over 3 commits it starts importing AWS SDK helpers. No test fails, no typecheck complains, but Louvain moves it into the Infrastructure cluster.

`get_why_context` returns:

```json
{
  "commitHistory": [...],
  "antiPatternWarnings": [],
  "driftSignals": {
    "confidence": "medium",
    "snapshotsAvailable": 5,
    "events": [
      {
        "symbolId": ".../AuthService::class",
        "movedFrom": { "label": "Auth" },
        "movedTo":   { "label": "Infrastructure" }
      }
    ]
  }
}
```

The next engineer who tries to extract auth as a standalone service discovers it is tangled with cloud SDK code. **Drift is the decay you cannot see from a single commit** — and the reason snapshots over time matter.

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
