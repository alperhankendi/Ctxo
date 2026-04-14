---
title: "Logic-Slices"
description: "Symbol + transitive dependencies with L1-L4 progressive detail."
---

# Logic-Slices

A **Logic-Slice** is a symbol together with every other symbol it transitively
depends on, filtered and trimmed to fit a token budget. It is the unit of
context Ctxo hands to an agent when it is about to read or modify code.

The name is deliberate. Instead of handing over an entire file (too big, noisy)
or an isolated function (too small, cannot be reasoned about in isolation),
Ctxo returns a *slice of the program's logic*: the root symbol plus the closure
of callees, imports, supertypes, and implementations needed to make sense of it.

## Why it exists

Agents that read raw files waste tokens on imports they do not need and still
miss dependencies defined across the codebase. A Logic-Slice solves both:

- **Dependency-complete.** If the root calls `foo()` which calls `bar()`, both
  bodies are included.
- **Token-budget aware.** A hard cap (default 8K tokens at L4) stops the slice
  from blowing past the agent's context window.
- **Progressive.** Four detail levels let callers pay only for the depth they
  actually need.

## How it is computed

The algorithm lives in
[`packages/cli/src/core/logic-slice/logic-slice-query.ts`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/logic-slice/logic-slice-query.ts).
It is a BFS over the [dependency graph](./dependency-graph.md) starting at the
requested `symbolId`, following **forward edges** (A -> B means "A depends
on B"):

```
root (symbolId)
  |
  +-- forward edge (imports | calls | extends | implements | uses)
  |     |
  |     +-- dep node -> enqueue its forward edges
  |
  +-- ...
```

Each visited node is collected once. Orphan edges whose target symbol is not in
the graph are dropped so callers never see dangling references. The raw result
is a `LogicSliceResult { root, dependencies, edges }`.

## The four detail levels

`DetailFormatter` in
[`packages/cli/src/core/detail-levels/detail-formatter.ts`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/detail-levels/detail-formatter.ts)
projects that raw result onto one of four views:

| Level | What you get                                              | When to use                                            |
| ----- | --------------------------------------------------------- | ------------------------------------------------------ |
| L1    | Root symbol only, clamped to 150 lines. No dependencies.  | You already know the graph, just want the source body. |
| L2    | Root + direct (depth-1) dependencies.                     | Default. Good for most "what does this call?" tasks.   |
| L3    | Root + full transitive closure. No budget enforcement.    | Deep refactors. Can be large.                          |
| L4    | Full closure, truncated to an 8K token budget.            | Safe default for sending to an LLM.                    |

::: tip Which level should I ask for?
If in doubt, start with **L2**. If the agent says "I cannot see the body of
X", bump to **L3**. If you are feeding a model with a tight context window,
use **L4** so Ctxo enforces the budget for you.
:::

## Token budget enforcement (L4)

L4 estimates size using byte offsets when the parser supplies them, otherwise
falls back to `line_count * 40` characters. Tokens are approximated as
`chars / 4`. When the total exceeds 8,000 tokens, dependencies are added in BFS
order until the budget is full, then dropped. Edges whose endpoints are both
still present survive; others are pruned so you never see a reference into
nothing.

The response carries `truncation: { truncated: true, reason:
'token_budget_exceeded' }` when this happens, so the caller can decide whether
to widen the budget or narrow the root.

## Masking

Every slice passes through the [masking pipeline](./masking.md) before leaving
the MCP server. Secrets embedded in source (AWS keys, JWTs, private IPs) are
redacted without changing symbol counts or byte offsets.

## Related tools

- **[`get_logic_slice`](/mcp-tools/get-logic-slice)** raw access to the slice
  with explicit `detail` parameter.
- **[`get_context_for_task`](/mcp-tools/get-context-for-task)** bundles the
  logic slice with `why-context`, blast radius, or change intelligence
  depending on the task type (`fix`, `extend`, `refactor`, `understand`).

::: info Implementation detail
The exact formula for L4 truncation (breadth-first, no ranking) is deliberately
simple and may evolve. Refer to `detail-formatter.ts` for the current rule.
:::
