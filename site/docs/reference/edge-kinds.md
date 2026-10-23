---
title: "Edge Kinds"
description: "imports | calls | extends | implements | uses | reads | writes | executes."
---

# Edge Kinds

Edges in the Ctxo dependency graph carry one of eight kinds: five code kinds and three data kinds (plugin protocol v2). The kind tells you how two symbols are related, and it controls which edges each MCP tool will traverse. The enum is closed (`EDGE_KINDS` in `@ctxo/plugin-api`): plugins do not invent new kinds.

## The eight kinds

| Kind | Direction | Example | Emitted by |
| --- | --- | --- | --- |
| `imports` | module A → module B | `import { foo } from './bar'` | TypeScript, Go, C#, Java (module-level) |
| `calls` | caller → callee | `foo()` inside `bar()` | All parsers (call-site) |
| `extends` | subclass → base | `class A extends B` | TypeScript, C#, Go (struct embedding), Java |
| `implements` | class → interface | `class A implements I` | TypeScript, C#, Java |
| `uses` | reference → target | type annotation, generic parameter, identifier reference | All parsers |
| `reads` | code → table or view | `SELECT ... FROM dbo.Loans` | SQL (view, procedure and function bodies), C# (constant SQL at known call sites) |
| `writes` | code → table or view | `UPDATE dbo.Loans ...`, `SqlBulkCopy.DestinationTableName` | SQL, C# |
| `executes` | code → stored procedure | `EXEC dbo.usp_CloseLoan` | SQL, C# |

All edges are directed. The index stores each edge as `{ from, to, kind, typeOnly? }` where `from` is a [symbol ID](/reference/symbol-ids) and `to` is a symbol ID or a 2-part name reference.

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

### reads, writes, executes (data edges)

Emitted by [`@ctxo/lang-sql`](/languages/sql) from view, procedure and function bodies, and by the [C# plugin](/languages/csharp#sql-at-call-sites) for constant SQL at known data-access call sites (only when a SQL plugin is installed). `reads` comes from `FROM`, `JOIN`, `APPLY` and `MERGE ... USING`; `writes` from `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE TABLE`, `SELECT ... INTO` and `OUTPUT ... INTO` targets; `executes` from `EXEC` of a procedure.

The target is a canonical 2-part name reference: `dbo.loans::table` for `reads` and `writes`, `dbo.usp_closeloan::procedure` for `executes` (lowercase ASCII, delimiters stripped, default schema `dbo`). The graph resolves a table reference to any `table` or `view` with that name, and a procedure reference to a `procedure`. When several files define the object, a copy outside test files and docs folders wins, then the first file in sorted path order; see [several definitions](/reference/symbol-ids#several-definitions-of-one-object). A reference that no indexed file defines stays unresolved.

```json
{ "from": "db/lending.sql::dbo.usp_closeloan::procedure", "to": "dbo.loans::table", "kind": "writes" }
```

Data edges are `confirmed` in blast radius. They stay out of symbol-level communities and boundary violations; the [contexts view](/cli/contexts) reports data coupling instead.

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
| [`get_blast_radius`](/mcp-tools/get-blast-radius) | all reverse edges; the kind sets the tier (`calls`, `extends`, `implements`, `reads`, `writes`, `executes` confirmed; `uses` likely; `imports` potential) |
| [`find_importers`](/mcp-tools/find-importers) | reverse edges; filterable via `edgeKinds` |
| [`get_class_hierarchy`](/mcp-tools/get-class-hierarchy) | `extends` and `implements` in both directions |

All tools that accept an `edgeKinds` parameter validate the input against the eight canonical values. Passing any other value returns `{ error: true, message: ... }`.

::: tip
When asking "who uses this?" via `find_importers`, restrict `edgeKinds` to `["calls", "uses"]` to exclude module-level imports and see only runtime dependencies. For a table, `["writes"]` lists every writer.
:::

::: warning
Go's structural interface satisfaction is intentionally not materialised as `implements` edges. Use `uses` plus the interface type to find likely implementers, or call `get_class_hierarchy` on a concrete type.
:::

## See also

- [Dependency Graph](/concepts/dependency-graph) - how edges compose into a DAG
- [`find_importers`](/mcp-tools/find-importers) - the primary reverse-edge query
- [Symbol IDs](/reference/symbol-ids) - the id format edges reference
