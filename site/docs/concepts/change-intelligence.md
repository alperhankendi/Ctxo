---
title: "Change Intelligence"
description: "Complexity x churn composite score."
---

# Change Intelligence

Change intelligence is Ctxo's answer to **"where are the hotspots?"** It
combines how complex a symbol is with how often it changes, producing a
single composite score that highlights code that is both gnarly *and*
actively churning.

## Why multiply, not add?

The insight (popularized by Michael Feathers) is that **complexity alone is
tolerable and churn alone is tolerable, but the intersection is where bugs
concentrate.** A deeply complex function nobody has touched in three years is
working. A trivial utility that changes weekly is harmless. A complex
function that changes weekly is a ticking hotspot.

Multiplication makes this explicit: `composite = complexity * churn`. Either
factor at zero collapses the score.

The code is three small files under
[`packages/cli/src/core/change-intelligence/`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/change-intelligence):

- `complexity-calculator.ts` normalizes cyclomatic complexity.
- `churn-analyzer.ts` normalizes commit counts.
- `health-scorer.ts` multiplies and bands the result.

## Complexity

Cyclomatic complexity is supplied **by the language plugin**. Ctxo core
does not compute it; each plugin measures it with whatever is idiomatic for
the language (ts-morph AST walk for TypeScript, tree-sitter queries for Go,
Roslyn for C#). The core calculator just clamps invalid inputs:

```
if (!Number.isFinite(x) || x < 1) return 1
else return x
```

So every symbol gets at least `complexity = 1`.

::: info Plugin contract
A plugin that ships `ComplexityMetrics` in its `FileIndex` output feeds this
pipeline. A plugin that omits complexity still gets a default of `1` and the
score degenerates to pure churn.
:::

## Churn

Churn is the commit count for the file the symbol lives in, normalized
against the repo-wide maximum:

```
churn = min(commitCount / maxCommitCount, 1)
```

So the hottest file in the repo scores `1.0` and everything else scales
against it. This is a **repo-relative** signal, not absolute: a freshly
cloned repo and a ten-year-old repo produce scores on the same scale.

Commit counts come from git via `SimpleGitAdapter.getFileChurn`, which runs
`git log --follow` so renames do not reset the counter.

## Composite and bands

```
composite = complexity * churn

band = low    if composite < 0.3
     = medium if composite < 0.7
     = high   otherwise
```

| Band   | Typical meaning                                              |
| ------ | ------------------------------------------------------------ |
| low    | Stable or simple. Default assumption: safe to edit.          |
| medium | One factor is high. Read the history before refactoring.     |
| high   | Hotspot. Expect subtle failure modes; pair with anti-patterns. |

## How to use it

**Pick refactor targets.** Sort by composite, descending. High-band symbols
with anti-patterns from [`get_why_context`](/mcp-tools/get-why-context) are
the textbook "refactor this first" candidates.

**PR review.** `get_pr_impact` includes the change-intelligence score for
every modified symbol. A PR that concentrates changes in high-band symbols
warrants extra review.

**Task routing.** `get_context_for_task(taskType: "refactor")` attaches
change intelligence to its response so the agent knows which part of the
surface is hot.

## Related

- **[`get_change_intelligence`](/mcp-tools/get-change-intelligence)** raw
  per-symbol scores.
- **[`get_pr_impact`](/mcp-tools/get-pr-impact)** aggregated per-PR.
- **[Git intent](./git-intent.md)** the same git log drives both features.

::: info Implementation detail
The band thresholds (0.3, 0.7) and the decision to use file-level churn as
a proxy for symbol-level churn are documented in
`change-intelligence/health-scorer.ts` and `churn-analyzer.ts`. Symbol-level
churn via `git blame` is on the roadmap.
:::
