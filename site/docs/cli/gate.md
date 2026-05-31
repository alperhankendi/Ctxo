---
title: "ctxo gate"
description: "Preview which symbols the safe-edit guard would block at the current sensitivity."
---

# ctxo gate

Previews which symbols in your codebase the safe-edit guard would intercept
at the current `gate.sensitivity` setting. Use this before changing sensitivity
in `.ctxo/config.yaml` to understand the impact of tuning.

This command is read-only - it does not change any configuration or register
any hooks.

## Synopsis

```shell
ctxo gate --preview [--json]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--preview` | required | Preview mode. Required; `ctxo gate` without `--preview` prints usage and exits 1 |
| `--json` | `false` | Machine-readable JSON output |

## Human output

```
Gate preview (sensitivity: balanced - top 15%, floor 3 dependents)

  src/core/graph.ts::buildGraph::function      impact 0.84  confirmed 6  likely 2
  src/adapters/storage/sqlite.ts::SqliteAdapter::class  impact 0.71  confirmed 4  likely 3
  src/ports/i-storage-port.ts::IStoragePort::interface  impact 0.68  confirmed 3  likely 5

  3 symbol(s) would be gated.
  Run 'ctxo gate --preview --json' for machine-readable output.
```

## JSON output shape

```json
{
  "sensitivity": "balanced",
  "percentile": 15,
  "minDependents": 3,
  "gated": [
    {
      "symbolId": "src/core/graph.ts::buildGraph::function",
      "impactScore": 0.84,
      "confirmedCount": 6,
      "likelyCount": 2
    }
  ],
  "total": 3
}
```

## Tuning workflow

1. Run `ctxo gate --preview` at your current setting.
2. If too many symbols are flagged, set `sensitivity: lenient` in `.ctxo/config.yaml`.
3. If you want wider coverage, try `sensitivity: strict`.
4. Re-run `ctxo gate --preview` to verify.

```yaml
# .ctxo/config.yaml
gate:
  enabled: true
  sensitivity: balanced   # strict | balanced | lenient
```

| Level | PageRank percentile | Min dependents floor |
| --- | --- | --- |
| `strict` | top 30% | 2 |
| `balanced` | top 15% | 3 |
| `lenient` | top 5% | 5 |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Preview completed |
| `1` | `--preview` flag missing, or index not found |

## See also

- [`ctxo blast-radius`](./blast-radius.md) - compute blast radius for a specific symbol
- [Safe-Edit Guard](/concepts/safe-edit-guard) - full guard architecture and configuration
- [Config schema](/reference/config-schema) - `gate:` field reference
