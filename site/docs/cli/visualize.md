---
title: "ctxo visualize"
description: "Generate an interactive dependency graph HTML."
---

# ctxo visualize

Produces a self-contained HTML file showing the project's symbol graph, with
PageRank-weighted node sizing, dead code highlighting, architectural layer
coloring, cyclomatic complexity, and per-file git intent. The file opens in
your default browser by default.

## Synopsis

```shell
npx ctxo visualize [options]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--max-nodes <N>` | all | Keep only the top N symbols by PageRank. Useful for very large graphs |
| `--output <path>` | `.ctxo/visualize.html` | Where to write the HTML file |
| `--no-browser` | `false` | Do not open the result in a browser |

## What is in the output

| Dimension | Source |
| --- | --- |
| Node size | PageRank score (`core/importance/pagerank-calculator.ts`) |
| Node color | Architectural layer (`core/overlay/architectural-overlay.ts`) |
| Dead-code badge | `find_dead_code` detector |
| Cyclomatic complexity | Per-symbol complexity stored in the index |
| Anti-pattern flag | Files with revert or churn anti-patterns |
| Edges | `imports`, `calls`, `extends`, `implements`, `uses` |

Each file's commit intent and anti-pattern history are embedded for on-hover
inspection.

## Examples

::: code-group
```shell [default]
npx ctxo visualize
```

```shell [large repo]
# Keep only the 200 most central symbols.
npx ctxo visualize --max-nodes 200
```

```shell [custom path, no browser]
npx ctxo visualize --output ./reports/graph.html --no-browser
```

```shell [CI artifact]
# Generate the HTML in a CI job; upload it as an artifact.
npx ctxo visualize --output artifacts/ctxo-graph.html --no-browser
```
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | HTML written |
| `1` | No index found (run `ctxo index` first), or `--max-nodes` is not a positive integer |

## See also

- [`ctxo index`](./index.md) — must run before `visualize` has data.
- [`ctxo status`](./status.md) — verify the index before visualizing.
