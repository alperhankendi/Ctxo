---
title: "Edge Kinds"
description: "imports | calls | extends | implements | uses."
---

# Edge Kinds

Edges in the Ctxo dependency graph carry one of five kinds. The kind tells you how two symbols are related, and it controls which edges each MCP tool will traverse. The enum is closed: plugins do not invent new kinds.

## The five kinds

| Kind | Direction | Example | Emitted by |
| --- | --- | --- | --- |
| `imports` | module A → module B | `import { foo } from './bar'` | TypeScript, Go, C# (module-level) |
| `calls` | caller → callee | `foo()` inside `bar()` | All parsers (call-site) |
| `extends` | subclass → base | `class A extends B` | TypeScript, C#, Go (struct embedding) |
| `implements` | class → interface | `class A implements I` | TypeScript, C# |
| `uses` | reference → target | type annotation, generic parameter, identifier reference | All parsers |

All edges are directed. The index stores each edge as `{ from, to, kind, typeOnly? }` where `from` and `to` are [symbol IDs](/reference/symbol-ids).

## When each is emitted

### imports

Emitted once per module-level import binding. The `from` side is usually the symbol that owns the import (commonly the file-level module symbol or the top-level declaration that uses the binding). Type-only imports set `typeOnly: true` so tools can distinguish erased imports from runtime edges.

### calls

Emitted at each call-site. If `foo` calls `bar` twice within the same function body, a single `calls` edge is emitted (the graph is a set of edges, not a multiset).

### extends

Emitted for class inheritance. In Go, struct embedding is modelled as `extends` on the embedding struct. Interface inheritance in TypeScript (`interface A extends B`) also uses `extends`.

### implements

Emitted when a class declares conformance to an interface. In Go, implicit interface satisfaction is **not** traced; `implements` only fires for explicit declarations (TypeScript `implements`, C# `:` list).

### uses

The catch-all for non-call references: type positions, generic arguments, identifier reads, and decorator targets. Use this edge when you need every mention of a symbol, not just its invocations.

## JSON shape

```json
{
  "from": "packages/cli/src/foo.ts::myFn::function",
  "to":   "packages/cli/src/bar.ts::TokenValidator::class",
  "kind": "imports",
  "typeOnly": false
}
```

`typeOnly` is optional and only set by the TypeScript plugin. Tools treat missing `typeOnly` as `false`.

## How tools traverse edges

| Tool | Traverses |
| --- | --- |
| [`get_logic_slice`](/mcp-tools/get-logic-slice) | all forward edges from the root |
| [`get_blast_radius`](/mcp-tools/get-blast-radius) | reverse edges across `calls`, `uses`, `imports` |
| [`find_importers`](/mcp-tools/find-importers) | reverse edges; filterable via `edgeKinds` |
| [`get_class_hierarchy`](/mcp-tools/get-class-hierarchy) | `extends` and `implements` in both directions |

All tools that accept an `edgeKinds` parameter validate the input against the five canonical values. Passing any other value returns `{ error: true, message: ... }`.

::: tip
When asking "who uses this?" via `find_importers`, restrict `edgeKinds` to `["calls", "uses"]` to exclude module-level imports and see only runtime dependencies.
:::

::: warning
Go's structural interface satisfaction is intentionally not materialised as `implements` edges. Use `uses` plus the interface type to find likely implementers, or call `get_class_hierarchy` on a concrete type.
:::

## See also

- [Dependency Graph](/concepts/dependency-graph) - how edges compose into a DAG
- [`find_importers`](/mcp-tools/find-importers) - the primary reverse-edge query
- [Symbol IDs](/reference/symbol-ids) - the id format edges reference
