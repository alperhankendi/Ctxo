---
title: "Blast Radius"
description: "Tiered impact scoring: confirmed, likely, potential."
---

# Blast Radius

Blast radius answers one question: **"if I change this symbol, what else
breaks?"** It is the single most useful query before any code modification,
and the reason the `get_blast_radius` tool is listed as mandatory in the
AI Assistant Rules.

## Why it exists

Grepping for a name gives you *textual* uses. What you actually want is the
*transitive* set of dependents, each tagged with how confident Ctxo is that
the break will be real. That is blast radius.

The algorithm lives in
[`packages/cli/src/core/blast-radius/blast-radius-calculator.ts`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/blast-radius/blast-radius-calculator.ts).

## The algorithm

1. Start at the target `symbolId`.
2. **BFS backwards** along `getReverseEdges` (who points *to* this node).
3. For each dependent node, **group** the incoming edges and pick the
   strongest confidence among them. A node reached by both `uses` and `calls`
   is classified `confirmed`.
4. Record `depth` (BFS layer), the set of edge kinds that hit it, and a
   `riskScore` of `1 / depth^0.7` so deeper dependents count for less.
5. Apply the **co-change boost** (see below).
6. After BFS, recompute `dependentCount` as in-degree *within the blast set*
   (not the whole graph) so you see how interconnected the blast itself is.
7. Aggregate into `overallRiskScore`, capped at 1.

## Confidence tiers

| Tier        | Edge kinds                       | Meaning                                     |
| ----------- | -------------------------------- | ------------------------------------------- |
| `confirmed` | `calls`, `extends`, `implements` | Structural dependency. Breaks are mechanical. |
| `likely`    | `uses`                           | Reference without a call site. Often breaks. |
| `potential` | `imports`                        | Module-level reach only. May be unused.      |

::: tip When to trust which tier
- **`confirmed`** always acts on it. These break at compile time.
- **`likely`** read the dependent before ruling it out.
- **`potential`** skim for surprises. Import-only means "the file pulled you
  in", not that your symbol is exercised.
:::

## Co-change boost

Ctxo also consults a co-change matrix built from git history (see
[`core/co-change/co-change-analyzer.ts`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/co-change/co-change-analyzer.ts)).
If two files change together in more than 50 percent of commits that touch
either, a `potential` link between symbols in those files is upgraded to
`likely`. This catches the case where a symbol is not structurally linked but
*always modified together* in practice.

The `coChangeFrequency` is reported on each entry so you can see why the
upgrade happened.

## Risk score

Per-entry: `round(1 / depth^0.7, 3)`. Overall:

```
overallRiskScore = min( sum(riskScore) / max(directDependents, 1) , 1 )
```

The normalization by direct-dependent count means a symbol with one direct
dependent but a long tail gets a lower overall score than a symbol with ten
direct dependents. This matches intuition: wide blast is riskier than deep
blast.

## Reading the response

```json
{
  "impactedSymbols": [
    {
      "symbolId": "src/api/handler.ts::handleRequest::function",
      "depth": 1,
      "dependentCount": 3,
      "riskScore": 1.0,
      "confidence": "confirmed",
      "edgeKinds": ["calls"]
    }
  ],
  "directDependentsCount": 1,
  "confirmedCount": 1,
  "likelyCount": 0,
  "potentialCount": 0,
  "overallRiskScore": 1.0
}
```

- `directDependentsCount` is your headline number for PR review.
- `confirmedCount` alone tells you how many things will *definitely* need
  touching.

## When to use it

Call **before** any non-trivial edit. Pair with
[`get_why_context`](/mcp-tools/get-why-context) to check whether the symbol
already has a revert history (high blast + prior reverts = proceed carefully).

## Related

- **[`get_blast_radius`](/mcp-tools/get-blast-radius)** the MCP tool.
- **[`get_pr_impact`](/mcp-tools/get-pr-impact)** runs blast radius for every
  changed symbol in a PR.
- **[Blast radius comparison](/comparisons/blast-radius)** how Ctxo's tiered
  model compares to naive text-grep or IDE "find references".

::: info Implementation detail
The exact exponent (`0.7`) and co-change threshold (`0.5`) are chosen
empirically. See `blast-radius-calculator.ts` for the current constants.
:::
