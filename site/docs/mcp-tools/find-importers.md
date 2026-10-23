---
title: "find_importers"
description: "Who depends on this symbol? Direct or transitive reverse lookup."
---

# find_importers

The reverse of "what does this call?" -- answers "who calls this?" Walks the
dependency graph backwards, optionally transitively, and lets you filter by
edge kind.

::: tip When to use
Before **renaming, deleting, or changing a signature**. For a full risk
picture (including co-change coupling that has no static edge), escalate to
[`get_blast_radius`](/mcp-tools/get-blast-radius).
:::

## Parameters

| Name         | Type                                                                         | Required | Description                                                     |
| ------------ | ---------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `symbolId`   | string                                                                       | yes      | Fully-qualified symbol id, or the 2-part id of a table, view or procedure (`dbo.loans::table`) |
| `edgeKinds`  | `("imports" \| "calls" \| "extends" \| "implements" \| "uses" \| "reads" \| "writes" \| "executes")[]` | no       | Restrict to specific edge kinds (default: all). `reads`, `writes` and `executes` are data access |
| `transitive` | boolean                                                                      | no       | Walk the graph recursively. Default `false`                     |
| `maxDepth`   | number (1-10)                                                                | no       | BFS depth when `transitive: true`. Default `5`                  |
| `intent`     | string                                                                       | no       | Keyword filter on results (e.g. `"test"`, `"adapter"`)          |

## Example

Direct callers only:

```json
{ "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface" }
```

Every transitive consumer, only `imports` and `implements` edges, production code:

```json
{
  "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface",
  "transitive": true,
  "maxDepth": 6,
  "edgeKinds": ["imports", "implements"],
  "intent": "src"
}
```

## Response

```json
{
  "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface",
  "importerCount": 7,
  "importers": [
    {
      "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
      "name": "SqliteStorageAdapter",
      "kind": "class",
      "file": "packages/cli/src/adapters/storage/sqlite.ts",
      "edgeKind": "implements",
      "edgeKinds": ["implements"],
      "depth": 1
    }
  ],
  "_meta": { "totalItems": 7, "returnedItems": 7, "truncated": false }
}
```

Symbol missing:

```json
{ "found": false, "hint": "Symbol not found. Run \"ctxo index\" to build the codebase index." }
```

::: info Direct vs transitive shape
In **direct mode** (`transitive: false`), duplicates are merged and the full
list of edge kinds per importer is in `edgeKinds`. In **transitive mode**, each
hop appears once with a single `edgeKind` and a `depth` counter.
:::

## When to use

- **Rename / delete safety check** -- zero importers? Safe. Many? Use [`get_blast_radius`](/mcp-tools/get-blast-radius) for the risk score.
- **Interface consumer map** -- `edgeKinds: ["implements"]` lists every concrete adapter.
- **Who writes this table?** -- on a SQL table such as `db/lending.sql::dbo.loans::table`, or its 2-part id `dbo.loans::table` (the name the contexts view gives a shared table), `edgeKinds: ["writes"]` lists every procedure and C# method that writes it (with [`@ctxo/lang-sql`](/languages/sql) installed). Direct and transitive lookups give the same importers for every copy of a table or procedure defined in several files, because every data edge points at one winning definition; see [several definitions](/languages/sql#several-definitions-of-one-object).
- **Impact narrowing** -- `intent: "test"` to see only test callers, or `intent: "adapter"` for adapters.

## Pitfalls

- **Static edges only** -- dynamic dispatch, reflection, and string-based lookups are invisible. [`get_blast_radius`](/mcp-tools/get-blast-radius) adds git co-change coupling to cover these gaps.
- **`maxDepth` caps silently** -- increase it if transitive results look oddly sparse on a hub symbol.

## Related tools

- [`get_blast_radius`](/mcp-tools/get-blast-radius) -- same question, plus history-based coupling and a risk score
- [`get_class_hierarchy`](/mcp-tools/get-class-hierarchy) -- reverse walk restricted to inheritance edges
- [`search_symbols`](/mcp-tools/search-symbols) -- resolve a name to a `symbolId`
