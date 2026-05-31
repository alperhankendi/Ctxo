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
| `--json` | `false` | Machine-readable JSON output. When omitted, prints a human-readable summary |

## JSON output shape

```json
{
  "symbolId": "src/core/graph.ts::buildGraph::function",
  "impactScore": 0.84,
  "confirmed": ["src/adapters/storage/sqlite.ts::SqliteAdapter::class"],
  "likely": ["src/cli/index-command.ts::IndexCommand::class"],
  "potential": [],
  "_meta": {
    "totalItems": 2,
    "returnedItems": 2,
    "truncated": false,
    "totalBytes": 412
  }
}
```

## Examples

::: code-group
```shell [human output]
ctxo blast-radius "src/core/graph.ts::buildGraph::function"
```

```shell [JSON to stdout]
ctxo blast-radius "src/core/graph.ts::buildGraph::function" --json
```

```shell [pipe to jq]
ctxo blast-radius "src/core/graph.ts::buildGraph::function" --json \
  | jq '.confirmed | length'
```

```shell [CI script - fail if high impact]
SCORE=$(ctxo blast-radius "$SYMBOL" --json | jq '.impactScore')
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
