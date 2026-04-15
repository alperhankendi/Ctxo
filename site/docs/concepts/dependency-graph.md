---
title: "Dependency Graph"
description: "Symbols as nodes, imports/calls/extends/uses as edges."
---

# Dependency Graph

The dependency graph is the data structure at the heart of Ctxo. Every MCP
tool, whether it answers "what breaks if I change this?" or "who uses this?",
is ultimately a query against this graph.

## Shape of the graph

- **Nodes** are **symbols**, one per declared identifier worth tracking.
- **Edges** are **directed** and **typed**. They record how one symbol reaches
  another.

The graph is maintained in memory by
[`SymbolGraph`](https://github.com/alperhankendi/ctxo/blob/master/packages/cli/src/core/graph/symbol-graph.ts)
and persisted per-file as JSON under `.ctxo/index/` (one file per source
file). SQLite under `.ctxo/.cache/` is a rebuildable mirror.

## Symbol kinds

Nodes are symbols of kind: `function | class | interface | method | variable | type`.
See the [Symbol IDs reference](/reference/symbol-ids) for the full format and
edge-case rules.

## Edge kinds

5 kinds: `imports`, `calls`, `extends`, `implements`, `uses`. See
[Edge kinds](/reference/edge-kinds) for direction, semantics, and per-parser
emission rules.

Edge kinds drive [blast radius](./blast-radius.md) confidence tiering.

## Symbol IDs

Every node has a deterministic, stable ID:

```
<relativeFile>::<name>::<kind>
```

Examples:

```
packages/cli/src/core/graph/symbol-graph.ts::SymbolGraph::class
packages/cli/src/adapters/mcp/get-pr-impact.ts::handle::function
```

This ID is what every MCP tool takes as input and what appears in every edge's
`from` / `to` fields. Files use forward slashes regardless of OS.

See [symbol IDs reference](/reference/symbol-ids) for edge-case rules
(anonymous functions, overloaded methods, re-exports).

## A tiny example

```
file: src/db/user-repo.ts
  class UserRepo ─────────────────┐
    method findById               │
                                  │ extends
file: src/db/base-repo.ts         ▼
  class BaseRepo
    method findById

edges:
  src/db/user-repo.ts::UserRepo::class
    --extends--> src/db/base-repo.ts::BaseRepo::class
  src/db/user-repo.ts::findById::method
    --calls--> src/db/base-repo.ts::findById::method
```

Two nodes, two edges, two different kinds. That is enough for `find_importers`,
`get_class_hierarchy`, `get_logic_slice`, and `get_blast_radius` to all produce
different but correct answers.

## How the graph gets built

1. Plugins (`@ctxo/lang-typescript`, `@ctxo/lang-go`, `@ctxo/lang-csharp`)
   parse source files and emit `{ symbols, edges }` per file.
2. The indexer writes each file's contribution to `.ctxo/index/<file>.json`.
3. At query time, `SymbolGraph.addNode` / `addEdge` assemble the in-memory
   graph. Duplicate edges are deduplicated via an edge-key set.
4. Edge endpoints that do not resolve exactly fall back to a fuzzy lookup by
   `file::name` and a `.js -> .ts` extension swap so downstream queries still
   produce a connected graph even when module specifiers use compiled paths.

## Related docs

- **Index schema** see the committed `.ctxo/index/` JSON.
- **[Symbol IDs](/reference/symbol-ids)** exact rules for naming edge cases.
- **[Edge kinds](/reference/edge-kinds)** semantics and plugin authoring
  guidance.
- **[`search_symbols`](/mcp-tools/search-symbols)** find a node by name or
  regex.
- **[`find_importers`](/mcp-tools/find-importers)** traverse reverse edges.

::: info Implementation detail
Fuzzy edge resolution (file-and-name fallback, `.js` / `.ts` swap) lives in
`SymbolGraph.resolveNodeId`. It is pragmatic; see the source for the current
rules.
:::
