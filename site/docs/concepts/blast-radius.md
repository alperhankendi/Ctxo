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

| Tier        | Edge kinds                                                       | Meaning                                     |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `confirmed` | `calls`, `extends`, `implements`, `reads`, `writes`, `executes` | Structural or data dependency. Breaks are mechanical. |
| `likely`    | `uses`                                                           | Reference without a call site. Often breaks. |
| `potential` | `imports`                                                        | Module-level reach only. May be unused.      |

The data edges (`reads`, `writes`, `executes`, from SQL bodies and from
constant SQL at C#, TypeScript, Java and Go call sites) are `confirmed`:
renaming a column or changing a table breaks its readers and writers directly.
Run blast radius on a table such as `db/lending.sql::dbo.loans::table` to see
every SQL object and method, in any of those languages, that reads or writes
it. Because the safe-edit guard counts `confirmed + likely` dependents, it also
guards heavily used tables and procedures.

## Tests as dependents

Tests are symbols with edges in all four official languages: C# and Java test
methods, TypeScript `describe` / `it` / `test` blocks (each owning the edges of
its own callback) and Go `_test.go` functions (full tier). A test that calls a
symbol is therefore one of its `confirmed` dependents, and blast radius shows
which tests exercise the code you are about to change. The flip side: the
safe-edit gate counts those dependents too, so it may fire more often on
well-tested symbols. Java test methods show their code dependencies at their
class, because JDT `calls` and `uses` edges start at the enclosing type.

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

The `coChangeFrequency` is reported on each entry whose file pairs with the
target's file, so you can see why the upgrade happened.

Every blast-radius path uses the same matrix: the `get_blast_radius`,
`get_pr_impact` and `get_context_for_task` tools, `ctxo blast-radius`, the
safe-edit guard hook and `ctxo gate --preview`. `ctxo index` builds it from one
`git log` pass over a window of recent commits (default 2000, set with
`cochange.maxCommits` or `--cochange-commits`) that is independent of
`--max-history`. Merge commits are left out of the log, commits that touch more
than 30 files are skipped and counted, and renames are followed. See the [`cochange` config](/reference/config-schema#cochange).

`get_blast_radius` and `ctxo blast-radius` also return `coChangedFiles`: up to
10 files that co-change with the target's file (frequency of at least 0.5) but
have no dependency path to it. It is informational and does not feed the tiers,
the risk scores or the guard.

## Risk score

Per-entry: `round(1 / depth^0.7, 3)`. Overall:

```
overallRiskScore = round( sum(riskScore) / ( sum(riskScore) + 5 ) , 3 )
```

The score grows with the depth-weighted size of the blast and approaches 1
without saturating: one direct dependent scores `0.167`, three score `0.375`
(medium), twelve score `0.706` (high), and even very central symbols stay
distinguishable from each other. Because each entry is already decayed by depth, a symbol
with three direct dependents scores higher than one with a three-deep chain.
This matches intuition: wide blast is riskier than deep blast.

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
  "overallRiskScore": 0.167
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
