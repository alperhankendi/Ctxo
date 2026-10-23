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
| `<symbolId>` | Fully-qualified symbol ID in the form `relative/path.ts::SymbolName::kind` |

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--json` | `false` | Accepted for scripts. The command always writes one JSON document to stdout |

## JSON output shape

```json
{
  "found": true,
  "symbolId": "src/core/graph.ts::buildGraph::function",
  "directDependentsCount": 2,
  "confirmedCount": 1,
  "likelyCount": 1,
  "potentialCount": 0,
  "overallRiskScore": 0.84,
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
if (( $(echo "$SCORE > 0.75" | bc -l) )); then
  echo "High-impact symbol - review blast radius before merging"
  exit 1
fi
```
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
