---
title: "Go"
description: "@ctxo/lang-go: ctxo-go-analyzer + tree-sitter, full tier."
---

# Go

Plugin: **`@ctxo/lang-go`** ([npm](https://www.npmjs.com/package/@ctxo/lang-go))
Parser: **`ctxo-go-analyzer`** (Go binary, full tier) with
**tree-sitter-go** fallback
Tier: **`full`** (advertised), downgrades to `syntax` when Go toolchain is missing
Extensions: `.go`

## What this plugin does

The Go plugin ships a small Go program (`tools/ctxo-go-analyzer`) that uses
`go/packages` + `go/types` to produce fully resolved symbols and edges across
a module. At index time the plugin compiles the analyzer to a binary, runs
one batch analysis pass over the module, and caches the per-file results.
Individual `extractSymbols` / `extractEdges` calls read from that cache,
keeping the `ILanguageAdapter` per-file contract intact while only invoking
the Go toolchain once per index.

If Go 1.22+ is not on `PATH`, or no `go.mod` / `go.work` is discoverable,
the plugin transparently downgrades to a tree-sitter-go syntax adapter.
Complexity is always computed by tree-sitter, because the analyzer binary
intentionally emits empty complexity.

## Install

::: code-group
```bash [pnpm]
pnpm add -D @ctxo/lang-go
```
```bash [npm]
npm install --save-dev @ctxo/lang-go
```
```bash [yarn]
yarn add -D @ctxo/lang-go
```
:::

Or:

```bash
npx ctxo install go --yes
```

For full tier, also install a Go 1.22+ toolchain. The first `ctxo index` run
builds the analyzer binary into the plugin's `node_modules` directory
(typically under 5 seconds, cached after).

## What it extracts

### Symbols

| Kind        | Sources                                                    |
| ----------- | ---------------------------------------------------------- |
| `function`  | Top-level `func` declarations                              |
| `method`    | Methods with receivers (`func (r *T) M()`)                 |
| `type`      | `type` declarations (structs, aliases, named primitives)   |
| `interface` | `type X interface { ... }` declarations                    |
| `variable`  | Package-level `var` and `const` declarations               |

### Edges

| Kind         | Notes                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| `imports`    | `import` statements. Standard-library and module imports both tracked.      |
| `calls`      | Function and method calls resolved by `go/types`                            |
| `implements` | Struct-implements-interface relationships (structural, not declared)        |
| `uses`       | Type references in field lists, function signatures, composite literals    |

Note that Go has no `extends`. Embedding is modeled as a mix of `uses` and
`implements` relationships because the analyzer reports implementation
satisfaction explicitly via `go/types`.

## Go modules and workspaces

The analyzer discovers the module root by walking up from the project root
looking for `go.mod` and then `go.work`. A Go workspace (`go.work`) is
supported: all modules listed in the `use` block are analyzed in a single
pass. For repositories that nest a Go module inside a larger polyglot
workspace, the analyzer rebases symbol IDs relative to the ctxo project
root, not the module root.

## Graceful degradation

| Condition                                | Result                                       |
| ---------------------------------------- | -------------------------------------------- |
| Go toolchain missing or < 1.22           | Falls back to tree-sitter syntax tier        |
| No `go.mod` / `go.work` found            | Falls back to tree-sitter syntax tier        |
| Analyzer build fails                     | Falls back to tree-sitter syntax tier, warn  |
| Analyzer batch times out                 | Marks batch `timedOut`, uses partial results |

The active tier is reported by `ctxo doctor` (look for the Go language
coverage check).

## Known issues

- **tree-sitter peer version:** `tree-sitter@0.22.x` and the native
  `tree-sitter-go@0.23.x` binding currently advertise mismatched peer ranges
  in the pnpm dependency graph. Installs succeed but may emit a peer warning.
  This is a known upstream issue and does not affect runtime behaviour.
- **Generics:** type parameter lists are parsed but the `uses` edges for
  generic constraints are best-effort under the syntax fallback.
- **CGo files** (`import "C"`) are indexed as regular Go files; the C side
  is not analyzed.

## Related

- [Dependency graph](/concepts/dependency-graph)
- [Edge kinds](/reference/edge-kinds)
- [Languages overview](/languages/overview)
