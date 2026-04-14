---
title: "Git Intent & Anti-Patterns"
description: "Commit messages tell the why; reverts surface incidents."
---

# Git Intent & Anti-Patterns

A linter can tell you a function is complex. Only git history can tell you
that the last three people who touched it reverted their changes. Ctxo
records that history per symbol so agents stop walking into the same trap.

## Why it exists

Code reads as a snapshot. Bugs and design pressure live in the deltas. An
agent that cannot see "this file has been reverted twice in six weeks" will
happily re-introduce the same broken optimization. Surfacing commit intent
plus revert patterns turns the agent from reactive ("I will try this")
into proactive ("this area has a history; let me be careful").

## Where the data comes from

The adapter is
[`packages/cli/src/adapters/git/simple-git-adapter.ts`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/adapters/git/simple-git-adapter.ts),
a thin wrapper around [`simple-git`](https://www.npmjs.com/package/simple-git).

Two calls do the heavy lifting:

- `getCommitHistory(filePath, maxCount)` uses `git log --follow` to track a
  file across renames.
- `getBatchHistory(maxCount)` a single `git log --name-only` pass that
  builds a `file -> commits` map for the whole repo. This is what `ctxo
  index` uses so indexing stays under the 500 ms target even on large
  repos.

If git is not available, the adapter logs and returns empty arrays. No
crash, no blocking. See [error handling](/architecture/error-handling).

## Two record types per file

The JSON index stores commit data in two arrays, both validated by zod:

```json
{
  "intent": [
    { "hash": "abc123", "message": "fix race condition", "date": "2024-03-15", "kind": "commit" }
  ],
  "antiPatterns": [
    { "hash": "def456", "message": "revert: remove mutex", "date": "2024-02-01" }
  ]
}
```

- **`intent`** every commit message that touched this file, in reverse-
  chronological order. Raw material for the agent.
- **`antiPatterns`** the subset of commits classified as reverts or
  back-outs.

## Anti-pattern detection

The classifier is `RevertDetector` in
[`core/why-context/revert-detector.ts`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/why-context/revert-detector.ts).
It recognizes three families of signal:

**Explicit reverts**

- `Revert "some message"` (git's default revert format)
- `revert: some message` (conventional-commits style)
- `undo: ...` / `rollback: ...`

**Indirect keywords** searched in the full message:

- `revert`, `reverts`, `reverted`, `reverting`
- `rollback`, `roll back`, `rolled back`
- `undo`, `undoes`, `undone`, `undoing`
- `backed out`, `backs out`
- `remove broken`, `remove buggy`, `remove faulty`

A single match flags the commit as an anti-pattern. The heuristic errs on the
side of surfacing too much rather than hiding incidents.

::: warning False positives are expected
"Revert the cursor to start" or "undo button" will trip the keyword
matcher. The agent consuming the output is expected to read the message,
not just the classification. See the
[`get_why_context`](/mcp-tools/get-why-context) response format.
:::

## What this catches that linters do not

| Signal                                        | Linter | Ctxo |
| --------------------------------------------- | ------ | ---- |
| Cyclomatic complexity                         | yes    | yes  |
| "This file was reverted twice last quarter"   | no     | yes  |
| "Last commit here fixed a race condition"     | no     | yes  |
| "Three authors rolled back the same function" | no     | yes  |

These are the signals that prevent re-introducing a regression. They live
exclusively in git history, and Ctxo is the one delivering them to the agent.

## Related

- **[`get_why_context`](/mcp-tools/get-why-context)** the MCP tool that
  returns intent + anti-patterns + optional change intelligence for a symbol.
- **[Change intelligence](./change-intelligence.md)** complements intent with
  churn-weighted complexity.

::: info Implementation detail
Commit intent is currently *file-scoped*, not symbol-scoped. Every symbol in
a file inherits the file's commit history. Finer granularity (via
`git blame` per line range) is on the roadmap; see
[`docs/roadmap.md`](https://github.com/alperhankendi/ctxo/blob/master/docs/roadmap.md).
:::
