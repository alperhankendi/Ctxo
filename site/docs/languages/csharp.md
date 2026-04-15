---
title: "C#"
description: "@ctxo/lang-csharp: Roslyn full tier + tree-sitter fallback."
---

# C#

Plugin: **`@ctxo/lang-csharp`** ([npm](https://www.npmjs.com/package/@ctxo/lang-csharp))
Parser: **`ctxo-roslyn`** helper (.NET SDK 8+) with **tree-sitter-c-sharp** fallback
Tier: **`full`** (advertised), downgrades to `syntax` when .NET SDK is missing
Extensions: `.cs`

## What this plugin does

The C# plugin wraps a small .NET helper project (`tools/ctxo-roslyn`) that
hosts the Roslyn compiler APIs. At index time the plugin launches the helper
as a long-running process, loads the solution or project, and streams
per-file index results back over stdio. A composite adapter picks between
Roslyn and a tree-sitter fallback at `initialize()` time so you never have
to configure which one is active.

If .NET SDK 8+ is not on `PATH`, or no `.sln` / `.csproj` is found, the
plugin downgrades to the tree-sitter syntax adapter. Both adapters produce
the same `SymbolNode` and `GraphEdge` shapes; only the resolution quality
differs.

## Install

::: code-group
```bash [pnpm]
pnpm add -D @ctxo/lang-csharp
```
```bash [npm]
npm install --save-dev @ctxo/lang-csharp
```
```bash [yarn]
yarn add -D @ctxo/lang-csharp
```
:::

Or:

```bash
npx ctxo install csharp --yes
```

For full tier, install a .NET SDK 8+ alongside Node.js. The helper project
lives inside the installed plugin and is restored on first use.

## Roslyn vs tree-sitter

| Capability                                                     | Roslyn (`full`) | tree-sitter (`syntax`) |
| -------------------------------------------------------------- | :-------------: | :--------------------: |
| Symbol extraction                                              |       yes       |          yes           |
| `imports` edges                                                |       yes       |          yes           |
| Cross-file `calls` resolution                                  |       yes       |        limited         |
| `extends` / `implements` on nominal types                      |       yes       |          yes           |
| Generic type argument `uses` edges                             |       yes       |         no             |
| Extension methods resolved to defining class                   |       yes       |         no             |
| Partial class merging across files                             |       yes       |         no             |
| Cyclomatic complexity                                          |       yes       |          yes           |

Roslyn drives the `full` tier because it can ask the real compiler for the
symbol behind every `IdentifierNameSyntax`, which tree-sitter cannot.

## What it extracts

### Symbols

| Kind        | Sources                                                         |
| ----------- | --------------------------------------------------------------- |
| `class`     | `class` declarations (partial classes merged in full tier)      |
| `interface` | `interface` declarations                                        |
| `method`    | Methods, constructors, property accessors                       |
| `function`  | Local functions, top-level statements                           |
| `type`      | `struct`, `record`, `enum`, `delegate`                          |
| `variable`  | Top-level fields and constants                                  |

### Edges

| Kind         | Notes                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| `imports`    | `using` directives                                                       |
| `calls`      | Method invocations; resolved against the `IMethodSymbol` in full tier    |
| `extends`    | Base class in `: Base` clauses                                           |
| `implements` | Interfaces in the same base list                                         |
| `uses`       | Type references in fields, parameters, generic arguments, attributes     |

## Solution (.sln) discovery

Roslyn needs a project or solution to open. The plugin probes the project
root for the first match:

1. Any `*.sln` file in the root
2. Any `*.csproj` file in the root

If neither is found, Roslyn logs `Roslyn adapter unavailable: no .sln or
.csproj found` and the tree-sitter fallback takes over. For nested layouts,
keep a solution file at the ctxo project root, or run `ctxo index` from the
directory that contains the `.sln`.

## Known issues

- **Cold start:** the first Roslyn run restores NuGet packages for
  `ctxo-roslyn` and warms up MSBuild. Subsequent runs are much faster
  thanks to the keep-alive process used by `ctxo watch`.
- **Source generators:** generated files in `obj/Generated` are indexed
  like any other `.cs` file. If you do not want them in the graph, add
  `obj/**` to `.ctxo/config.yaml#index.ignore`.
- **Scripting files** (`.csx`) are not supported.

## Related

- [Dependency graph](/concepts/dependency-graph)
- [Symbol IDs](/reference/symbol-ids)
- [Edge kinds](/reference/edge-kinds)
- [Languages overview](/languages/overview)
