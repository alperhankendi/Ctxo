---
title: "get_blast_radius"
description: "What breaks if I change this symbol?"
---

# get_blast_radius

Answers the question **"what breaks if I change this?"** Returns every symbol
that could be affected by modifying the target, graded across three confidence
tiers so you know what is certain vs speculative.

See [the mandatory sequence](/mcp-tools/tool-selection-guide#modifying-existing-code) before editing.

## Parameters

| Name         | Type                                         | Required | Description                                                         |
| ------------ | -------------------------------------------- | -------- | ------------------------------------------------------------------- |
| `symbolId`   | string                                       | yes      | Fully-qualified symbol id (`<file>::<name>::<kind>`), or the 2-part id of a table, view or procedure (`dbo.loans::table`) |
| `confidence` | `"confirmed" \| "likely" \| "potential"`     | no       | Restrict results to a single tier                                   |
| `intent`     | string                                       | no       | Keyword filter on impacted symbols (e.g. `"test"`, `"adapter"`)     |

### Confidence tiers

Results are grouped into 3 confidence tiers by the strongest edge that reaches each dependent: `confirmed` (`calls`, `extends`, `implements` and the data edges `reads`, `writes`, `executes`), `likely` (`uses`, or co-changed) and `potential` (`imports`). The traversal follows every reverse edge, so transitive dependents appear at their depth with a lower `riskScore`. See [Blast Radius tiers](/concepts/blast-radius#confidence-tiers).

### Tables, views and procedures

The target can be any symbol, including a SQL `table`, `view` or `procedure` from [`@ctxo/lang-sql`](/languages/sql). Its readers and writers (SQL views, procedures and functions, and C# methods with constant SQL at known call sites) are `confirmed` dependents:

```json
{ "symbolId": "db/lending.sql::dbo.loans::table", "confidence": "confirmed" }
```

The 2-part id works too, and gives the same answer:

```json
{ "symbolId": "dbo.loans::table" }
```

When several files define the same table, view or procedure (migrations that
`CREATE OR ALTER` it again, a docs or test copy), every copy reports the same
dependents: every data edge points at one winning definition, and a lookup of
any copy, or of the 2-part id, returns the winner's dependents. A procedure
changed in a new migration therefore shows its callers, not zero. See
[several definitions](/languages/sql#several-definitions-of-one-object) for how
the winner is picked.

Because the safe-edit guard counts `confirmed + likely` dependents, a table that many methods write is guarded like any other high-impact symbol.

## Example

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class"
}
```

Filter to high-confidence only:

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "confidence": "confirmed"
}
```

## Response

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "impactScore": 27,
  "directDependentsCount": 6,
  "confirmedCount": 6,
  "likelyCount": 14,
  "potentialCount": 7,
  "overallRiskScore": 0.82,
  "impactedSymbols": [
    {
      "symbolId": "packages/cli/src/index.ts::main::function",
      "name": "main",
      "kind": "function",
      "confidence": "confirmed",
      "riskScore": 0.91
    },
    {
      "symbolId": "packages/cli/src/cli/sync-command.ts::SyncCommand::class",
      "name": "SyncCommand",
      "kind": "class",
      "confidence": "likely",
      "riskScore": 0.62,
      "coChangeFrequency": 0.78
    }
  ],
  "coChangedFiles": [
    { "file": "packages/cli/src/adapters/storage/schema-manager.ts", "frequency": 0.71, "sharedCommits": 9 }
  ],
  "byCluster": {
    "packages/cli/src/adapters/storage": 12,
    "packages/cli/src/core/graph": 3,
    "packages/cli/src/adapters/mcp": 8,
    "packages/cli/src/cli": 4
  },
  "crossClusterEdges": 15,
  "multiClusterHint": "Change impacts 4 clusters — multi-team review recommended.",
  "_meta": { "totalItems": 27, "returnedItems": 27, "truncated": false }
}
```

If the symbol is missing from the index:

```json
{ "found": false, "hint": "Symbol not found. Run \"ctxo index\" to build the codebase index." }
```

### Co-change evidence

When `.ctxo/index/co-changes.json` exists, the response uses git history in two ways. Both come from the same co-change matrix that `get_pr_impact`, `get_context_for_task`, `ctxo blast-radius` and the safe-edit guard read.

| Field | When present | Meaning |
| :--- | :--- | :--- |
| `impactedSymbols[].confidence: "likely"` | A `potential` dependent whose file co-changes with the target's file at a frequency above 0.5 | Promoted from `potential` to `likely` |
| `impactedSymbols[].coChangeFrequency` | The dependent's file has a co-change entry with the target's file | The pair's frequency (`shared commits / min(commits of A, commits of B)`), whether or not it changed the tier |
| `coChangedFiles` | At least one file co-changes with the target's file at `frequency >= 0.5` and has no dependency path to the target. Omitted when empty or when there is no matrix | Up to 10 files, strongest first, each with `file`, `frequency` and `sharedCommits`. **Informational**: not counted in the tiers, the risk scores, the impact score or the safe-edit guard, and not affected by the `confidence` or `intent` filters |

Read `coChangedFiles` as "did I forget a file?": it lists the files that historically change together with the target but that the dependency graph cannot reach (a script, a config, a mirror of the same rule). The matrix is built by `ctxo index` from a window of recent commits that is independent of `--max-history`; see [`cochange` in the config reference](/reference/config-schema#cochange).

Because the safe-edit guard counts `confirmed + likely` dependents, a co-change-upgraded dependent counts toward it, so the guard may fire somewhat more often than it did before co-change reached it. `ctxo gate --preview` shows which symbols the current sensitivity would flag.

### v0.8 cluster fields

| Field | When present | Meaning |
| :--- | :--- | :--- |
| `byCluster` | A community snapshot exists (`ctxo index` after v0.8) | Map of `clusterLabel` → count of impacted symbols in that cluster |
| `crossClusterEdges` | Same | Count of impacted-set edges that cross the target's own cluster |
| `multiClusterHint` | `byCluster` touches ≥ 3 clusters | Human-readable nudge for multi-team review |

## Killer example: same `impactScore`, different risk

Two candidate refactors both report `impactScore: 10`. Before v0.8, they look identical.

| Change | `byCluster` (v0.8) | Verdict |
| :--- | :--- | :--- |
| **A** — rename a private method | `{ "src/billing": 10 }` | One cluster, one team; proceed. |
| **B** — tweak a shared DTO | `{ "src/billing": 4, "src/auth": 3, "src/reporting": 3 }` + `multiClusterHint` | Three clusters, three teams; needs coordination. |

The raw numbers are identical. The cluster breakdown is the difference between "go" and "stop".

## Interpreting `overallRiskScore`

| Score        | Risk level | Action                                                             |
| ------------ | ---------- | ------------------------------------------------------------------ |
| `> 0.7`      | high       | Plan carefully, write tests first, review with a teammate          |
| `0.3 - 0.7`  | medium     | Read `get_why_context` before editing                              |
| `< 0.3`      | low        | Safe to edit, still verify imports via `find_importers` if unsure  |

## See it in action

See a worked comparison of blind edits vs blast-radius-aware edits:
[Blast Radius comparison](/comparisons/blast-radius).

## Common pitfalls

::: warning Skipping this tool
Editing a symbol without calling `get_blast_radius` first is the #1 cause of
broken dependencies. The static graph catches couplings that grep and manual
reading will miss, especially through re-exports and dynamic dispatch.
:::

- **Treating `potential` as noise** - import-only reach may be unused, but a
  `potential` dependent whose file co-changes with the target's file is
  promoted to `likely`; two files that always change together are coupled
  even when the parser sees no call.
- **Ignoring `coChangedFiles`** - it lists the files the graph cannot reach
  but history ties to the target. It is informational and capped at 10.
- **Ignoring `_meta.truncated`** — large impact sets are capped by
  `CTXO_RESPONSE_LIMIT`. If truncated, narrow with `confidence` or `intent`.
- **Using the symbol name instead of id** — always pass the full
  `<file>::<name>::<kind>` id. Look it up with
  [`search_symbols`](/mcp-tools/search-symbols) if you only know the name.
  The one exception is a SQL table, view or procedure, whose 2-part id
  (`dbo.loans::table`, as the contexts view names shared tables) is accepted.

## Related tools

- [`get_why_context`](/mcp-tools/get-why-context) — required follow-up before editing
- [`get_logic_slice`](/mcp-tools/get-logic-slice) — forward deps (what this symbol needs)
- [`find_importers`](/mcp-tools/find-importers) — direct reverse lookup only
- [`get_pr_impact`](/mcp-tools/get-pr-impact) — blast radius across every changed symbol in a diff
