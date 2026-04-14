---
title: "get_ranked_context"
description: "Natural-language search ranked by BM25 relevance and PageRank importance, packed into a token budget."
---

# get_ranked_context

Ask a natural-language question, get back the most relevant symbols in your
codebase -- ranked by a blend of textual relevance (BM25, camelCase-aware,
trigram fallback, fuzzy correction) and structural importance (PageRank), then
greedily packed to fit your token budget.

::: tip When to use
Use this when you know **what you want** but not **where it lives**. It is the
natural-language counterpart to [`search_symbols`](/mcp-tools/search-symbols),
which takes a name or regex.
:::

## Parameters

| Name          | Type                                          | Required | Description                                                        |
| ------------- | --------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `query`       | string                                        | yes      | Free-text query (e.g. `"how do we mask secrets in responses"`)     |
| `tokenBudget` | number (min 100)                              | no       | Packing budget. Default `4000`                                     |
| `strategy`    | `"combined" \| "dependency" \| "importance"` | no       | Ranking blend. Default `"combined"`                                |
| `fuzzy`       | boolean                                       | no       | Enable typo-tolerant fuzzy correction. Default `true`              |
| `searchMode`  | `"fts" \| "legacy"`                          | no       | `fts` = BM25 engine, `legacy` = substring matcher. Default `"fts"` |

### Strategies

| Strategy     | Behavior                                                    |
| ------------ | ----------------------------------------------------------- |
| `combined`   | BM25 relevance x PageRank importance (recommended)          |
| `dependency` | Prefers symbols that the query text references structurally |
| `importance` | Forces the legacy pipeline; falls back from `fts`           |

## Example

```json
{
  "query": "sanitize secrets before returning to MCP client",
  "tokenBudget": 6000
}
```

## Response (fts mode)

```json
{
  "query": "sanitize secrets before returning to MCP client",
  "strategy": "combined",
  "results": [
    {
      "symbolId": "packages/cli/src/core/masking/secret-masker.ts::SecretMasker::class",
      "name": "SecretMasker",
      "kind": "class",
      "file": "packages/cli/src/core/masking/secret-masker.ts",
      "relevanceScore": 0.842,
      "importanceScore": 0.613,
      "combinedScore": 0.755,
      "tokens": 210
    }
  ],
  "totalTokens": 3920,
  "tokenBudget": 6000,
  "searchMetrics": { "tier": "bm25", "tookMs": 14, "candidates": 87 },
  "fuzzyCorrection": { "from": "santize", "to": "sanitize" },
  "_meta": { "totalItems": 18, "returnedItems": 18, "truncated": false }
}
```

## How the BM25 engine works

1. **Tokenization** -- splits names on camelCase, snake_case, and kebab-case so `SecretMasker` matches `secret mask`.
2. **BM25 ranking** -- classic term-frequency scoring across the symbol corpus.
3. **Trigram fallback** -- if no BM25 hits, falls back to trigram similarity.
4. **Fuzzy correction** -- `fuzzy: true` runs edit-distance correction on the query and reports the substitution in `fuzzyCorrection`.
5. **Importance blend** -- final score mixes BM25 relevance with normalized reverse-edge count (a lightweight PageRank proxy).
6. **Token packing** -- greedy pack until `tokenBudget` is reached.

## When to use

- **Discovery** -- "where is the retry logic for HTTP calls?"
- **Onboarding** -- natural-language map of an unfamiliar area.
- **Query-to-context** -- feed an agent the top N symbols relevant to the user's prompt.
- For exact names or regex, prefer [`search_symbols`](/mcp-tools/search-symbols).

## Pitfalls

::: warning Index freshness
The FTS index rebuilds when the graph's node count changes. If you added files
but the count is stable, run `ctxo index` to refresh.
:::

- **Strategy `"importance"` always uses the legacy pipeline** -- keep the default `combined` for BM25 quality.
- **`tokenBudget` is greedy**, not optimal. Very large symbols can fill the budget with one entry; narrow the query if this happens.
- **Requires** `ctxo index`.
