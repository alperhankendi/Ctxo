---
title: "get_architectural_overlay"
description: "Project layer map -- Domain, Infrastructure, Adapters, and more."
---

# get_architectural_overlay

Classifies every indexed file into an architectural layer (Domain, Adapters,
Ports, Infrastructure, Tests, etc.) using path conventions. The fastest way to
orient yourself in an unfamiliar codebase.

::: tip When to use
First call when entering a new repo. Pair with
[`get_symbol_importance`](/mcp-tools/get-symbol-importance) to find the
critical symbols inside each layer.
:::

## Parameters

| Name    | Type   | Required | Description                                                    |
| ------- | ------ | -------- | -------------------------------------------------------------- |
| `layer` | string | no       | Return only files in this layer (e.g. `"core"`, `"adapters"`) |

## Example

Full overlay:

```json
{}
```

Drill into adapters:

```json
{ "layer": "adapters" }
```

## Response (full)

```json
{
  "layers": {
    "core": [
      "packages/cli/src/core/graph/symbol-graph.ts",
      "packages/cli/src/core/blast-radius/blast-radius-calculator.ts"
    ],
    "adapters": [
      "packages/cli/src/adapters/storage/sqlite.ts",
      "packages/cli/src/adapters/git/simple-git.ts"
    ],
    "ports": [
      "packages/cli/src/ports/i-storage-port.ts"
    ]
  }
}
```

## Response (filtered)

```json
{
  "layer": "adapters",
  "files": [
    "packages/cli/src/adapters/storage/sqlite.ts",
    "packages/cli/src/adapters/git/simple-git.ts"
  ]
}
```

::: info No `_meta` envelope
This tool returns the raw overlay payload and does not pass through the
`wrapResponse` envelope used by most other tools. There is no `totalItems` /
`truncated` info.
:::

## When to use

- **Onboarding** -- what are the buckets?
- **Architectural lint** -- quick visual check that a file lives in the right layer.
- **Scoped search** -- filter by layer before calling [`get_symbol_importance`](/mcp-tools/get-symbol-importance) or [`find_dead_code`](/mcp-tools/find-dead-code).

## Pitfalls

::: warning Classifier is path-based
Layer detection is heuristic -- it inspects directory segments like `core/`,
`adapters/`, `ports/`, `__tests__/`. A file that deviates from convention gets
misclassified. Fix the name or adjust project structure rather than fighting
the classifier.
:::

- **Unindexed files are invisible** -- only files in the index appear.
- **Custom layer names** are not configurable today.
