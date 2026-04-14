---
title: "PageRank Importance"
description: "Symbol centrality via link-based ranking."
---

# PageRank Importance

PageRank answers **"which symbols matter most?"** Not by line count, not by
how recently they changed, but by how central they are to the dependency
graph. An agent dropped into an unfamiliar codebase can read the top-20
PageRank results and immediately know what load-bearing code looks like.

## Why PageRank on code

The original PageRank treats the web as a directed graph: a page is
important if important pages link to it. Code is structurally the same
problem. Substitute:

- **page** -> symbol (class, function, interface, method, variable, type)
- **link** -> dependency edge (imports, calls, extends, implements, uses)

A class that twelve other classes extend is central the same way a web page
with twelve high-authority inbound links is central. PageRank turns this
into a single number per node.

The implementation is
[`packages/cli/src/core/importance/pagerank-calculator.ts`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/importance/pagerank-calculator.ts).

## Edge direction matters

Ctxo's convention: **`A -> B` means "A depends on B"** (A imports / calls /
extends / uses B). PageRank flows score *against* that direction: B
accumulates score *from* the A nodes that point to it. Concretely, for each
node we sum contributions from its **reverse edges** and divide by the
contributor's **forward-edge count** (out-degree).

That makes sense: "B is important because many nodes depend on it" maps
exactly to how PageRank ranks inbound links.

## The algorithm

Standard iterative PageRank with the usual tricks:

```
damping       = 0.85
maxIterations = 100
tolerance     = 1e-6
```

Each iteration:

1. `base = (1 - damping) / n` teleportation baseline.
2. **Dangling-node handling**: nodes with zero forward edges (no outgoing
   dependencies) distribute their score evenly across all nodes, scaled by
   `damping`. Without this, leaf symbols would slowly drain rank into the
   void.
3. For every node, sum `score[from] / outDegree[from]` over unique
   contributors from the reverse-edge list.
4. `newScore = base + damping * incomingScore + danglingContrib`.
5. Stop when the maximum per-node delta is below tolerance.

The result is a converged ranking plus metadata: `iterations`,
`converged`, per-entry `inDegree` and `outDegree`.

## Caching

PageRank is computed once per index build and cached into the index layer.
Querying it at MCP time is a lookup, not a recomputation, which keeps the
500 ms budget intact.

## What it powers

- **[`get_symbol_importance`](/mcp-tools/get-symbol-importance)** the raw
  ranking, useful for onboarding ("show me the top 25 symbols").
- **[`get_ranked_context`](/mcp-tools/get-ranked-context)** two-phase
  retrieval: BM25 finds candidates for a natural-language query, PageRank
  re-ranks them so load-bearing symbols rise to the top within the token
  budget.

## Reading a result

```json
{
  "rankings": [
    {
      "symbolId": "packages/cli/src/core/graph/symbol-graph.ts::SymbolGraph::class",
      "name": "SymbolGraph",
      "kind": "class",
      "file": "packages/cli/src/core/graph/symbol-graph.ts",
      "score": 0.043210,
      "inDegree": 17,
      "outDegree": 3
    }
  ],
  "totalSymbols": 1284,
  "iterations": 42,
  "converged": true
}
```

High `inDegree` alongside a high score means "lots of code depends on this".
High `score` with *low* `inDegree` means "few but important consumers depend
on this" the PageRank signal adds information beyond raw in-degree.

::: tip Intuition check
A test file typically has very high out-degree (it imports production code)
and near-zero in-degree. So tests sit low on PageRank even though they are
*numerous*. This is correct: from a blast-radius perspective, changing a
test file cannot break production.
:::

## Related

- **[Dependency graph](./dependency-graph.md)** the underlying structure.
- **[Blast radius](./blast-radius.md)** answers a different question (who
  depends on *this specific* symbol?) but reads the same graph.

::: info Implementation detail
Multi-edges between the same pair are deduplicated per iteration via a
`contributors` set so a node with both `calls` and `uses` edges from the
same source counts once. See `pagerank-calculator.ts`.
:::
