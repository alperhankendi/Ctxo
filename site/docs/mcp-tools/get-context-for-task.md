---
title: "get_context_for_task"
description: "Task-aware context for fix / extend / refactor / understand."
---

# get_context_for_task

One call, one right answer. Given a symbol and the task you are about to do,
returns the exact mix of dependencies, dependents, history, and complexity that
matters for that task -- packed into your token budget. Stop assembling context
by hand across four tools.

::: tip Start here
This is the recommended first call for any coding task. It replaces a chain of
[`get_logic_slice`](/mcp-tools/get-logic-slice) +
[`get_blast_radius`](/mcp-tools/get-blast-radius) +
[`get_why_context`](/mcp-tools/get-why-context) +
[`get_change_intelligence`](/mcp-tools/get-change-intelligence) with a single,
task-weighted result.
:::

## Parameters

| Name          | Type                                             | Required | Description                                              |
| ------------- | ------------------------------------------------ | -------- | -------------------------------------------------------- |
| `symbolId`    | string                                           | yes      | Fully-qualified symbol id (`<file>::<name>::<kind>`)     |
| `taskType`    | `"fix" \| "extend" \| "refactor" \| "understand"` | yes      | Weighting strategy applied to the candidate pool         |
| `tokenBudget` | number (min 100)                                 | no       | Target size of the assembled context. Default `4000`     |

### Weighting by `taskType`

| Task         | Emphasizes                                       |
| ------------ | ------------------------------------------------ |
| `fix`        | Direct deps + git history + anti-pattern signals |
| `extend`     | Direct deps + reverse dependents (blast radius)  |
| `refactor`   | Reverse dependents + complexity + churn          |
| `understand` | Interfaces / types + direct deps                 |

## Example

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "taskType": "refactor",
  "tokenBudget": 6000
}
```

## Response

```json
{
  "target": {
    "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
    "name": "SqliteStorageAdapter",
    "kind": "class"
  },
  "taskType": "refactor",
  "context": [
    {
      "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface",
      "name": "IStoragePort",
      "kind": "interface",
      "file": "packages/cli/src/ports/i-storage-port.ts",
      "relevanceScore": 0.92,
      "reason": "direct dependency (interface)",
      "lines": 42,
      "tokens": 180
    }
  ],
  "totalTokens": 3820,
  "tokenBudget": 6000,
  "warnings": [],
  "_meta": { "totalItems": 12, "returnedItems": 12, "truncated": false }
}
```

Symbol missing:

```json
{ "found": false, "hint": "Symbol not found. Run \"ctxo index\"." }
```

## When to use

- **Fixing a bug** -- `taskType: "fix"` pulls deps plus revert/anti-pattern history from [`get_why_context`](/mcp-tools/get-why-context).
- **Adding a feature** -- `taskType: "extend"` gives you what the symbol needs and who will be affected.
- **Refactoring** -- `taskType: "refactor"` surfaces importers and complexity hotspots from [`get_change_intelligence`](/mcp-tools/get-change-intelligence).
- **Onboarding** -- `taskType: "understand"` returns types and interfaces so you learn the shape, not the plumbing.

## Notes

::: info Token budget
Entries are packed greedily by relevance score until `tokenBudget` is reached.
Lower the budget for quick orientation, raise it for deep refactors.
:::

- Requires `ctxo index` to have run at least once.
- Still use [`get_pr_impact`](/mcp-tools/get-pr-impact) when reviewing a diff -- that tool aggregates across every changed symbol.
