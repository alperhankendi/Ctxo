---
title: "ctxo blast-radius"
description: "Compute the blast radius for a single symbol and print it to stdout."
---

# ctxo blast-radius

Computes the blast radius for a single symbol and writes the result to stdout.
Designed for scripting, CI checks, and feeding results into other tools via `jq`
or shell pipelines.

The underlying data is identical to what the `get_blast_radius` MCP tool
returns - the CLI is a thin wrapper that skips the MCP transport and writes
directly to stdout.

## Synopsis

```shell
ctxo blast-radius <symbolId> [--json]
```

## Arguments

| Argument | Description |
| --- | --- |
| `<symbolId>` | Fully-qualified symbol ID in the form `relative/path.ts::SymbolName::kind`, or the 2-part ID of a SQL table, view or procedure (`dbo.loans::table`), which gives the same answer as the defining file's ID ([data IDs](/reference/symbol-ids#data-ids-as-tool-input)) |

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--json` | `false` | Accepted for scripts. The command always writes one JSON document to stdout |

## JSON output shape

```json
{
  "found": true,
  "symbolId": "src/core/graph.ts::buildGraph::function",
  "directDependentsCount": 1,
  "confirmedCount": 1,
  "likelyCount": 1,
  "potentialCount": 0,
  "overallRiskScore": 0.244,
  "impactedSymbols": [
    { "symbolId": "src/adapters/storage/sqlite.ts::SqliteAdapter::class", "confidence": "confirmed", "depth": 1 },
    { "symbolId": "src/cli/index-command.ts::IndexCommand::class", "confidence": "likely", "depth": 2 }
  ],
  "coChangedFiles": [
    { "file": "src/core/graph-builder.ts", "frequency": 0.71, "sharedCommits": 9 }
  ]
}
```

A symbol that is not in the index prints `{ "found": false, "symbolId": "..." }`.

`likely` includes dependents upgraded by co-change: a `potential` dependent
whose file co-changes with the symbol's file (frequency above 0.5, from
`.ctxo/index/co-changes.json`) is reported as `likely`. `coChangedFiles` lists
up to 10 files that co-change with the symbol's file at a frequency of at least
0.5 but have no dependency path to the symbol. It is informational (not counted
in the tiers or the risk score) and is omitted when empty or when no co-change
matrix exists.

## Examples

::: code-group
```shell [JSON to stdout]
ctxo blast-radius "src/core/graph.ts::buildGraph::function" --json
```

```shell [pipe to jq]
ctxo blast-radius "src/core/graph.ts::buildGraph::function" --json \
  | jq '.confirmedCount'
```

```shell [CI script - fail if high impact]
SCORE=$(ctxo blast-radius "$SYMBOL" --json | jq '.overallRiskScore')
# 0.7 is the "high" band: about 12 direct dependents (see below)
if (( $(echo "$SCORE > 0.7" | bc -l) )); then
  echo "High-impact symbol - review blast radius before merging"
  exit 1
fi
```
:::

### Choosing a threshold

`overallRiskScore` is `sum(riskScore) / (sum(riskScore) + 5)`, where each impacted
symbol contributes `1 / depth^0.7` (so a direct dependent adds `1`). It approaches
1 but never reaches it. Useful cut-offs, counting direct dependents only:

| Threshold | Roughly means                         |
| --------- | ------------------------------------- |
| `0.3`     | 3 or more direct dependents (medium)  |
| `0.7`     | 12 or more direct dependents (high)   |
| `0.75`    | 15 or more direct dependents          |

::: warning Scripts copied from earlier versions
The score used to be `1.0` for any symbol with at least one dependent, so a
`> 0.75` check failed on practically every symbol that had a dependent. It now
needs a depth-weighted mass of about 15, so the same script is much less strict
and passes where it used to fail. To keep a stricter gate, lower the threshold
(for example `0.3` for 3 or more direct dependents) or gate on
`.directDependentsCount` or `.confirmedCount` instead.
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Symbol found, result written |
| `1` | Symbol ID missing, index not found, or unexpected error |

## See also

- [`get_blast_radius` MCP tool](/mcp-tools/get-blast-radius) - same data via the MCP protocol
- [`ctxo gate --preview`](./gate.md) - see which symbols the safe-edit guard flags
- [Safe-Edit Guard](/concepts/safe-edit-guard) - how blast radius drives the hook
