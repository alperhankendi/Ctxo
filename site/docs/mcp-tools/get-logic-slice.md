---
title: get_logic_slice
description: Symbol plus transitive dependencies with progressive detail levels
---

# get_logic_slice

Returns a symbol and all symbols it depends on (transitively), filtered and
truncated to fit a token budget. Supports four detail levels (L1-L4).

## Parameters

| Name        | Type                 | Required | Description                                           |
| ----------- | -------------------- | -------- | ----------------------------------------------------- |
| `symbolId`  | string               | yes\*    | Fully-qualified symbol id                             |
| `symbolIds` | string[]             | no\*     | Batch: several ids, answered as `{ batch, results }`  |
| `level`     | `1 \| 2 \| 3 \| 4`   | no       | Detail level (default `3`), see [Logic-Slices](/concepts/logic-slices#the-four-detail-levels) |
| `intent`    | string               | no       | Keyword filter on the dependencies                    |

\* Pass `symbolId` or `symbolIds`.

## Example

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "level": 2
}
```

## Response

```json
{
  "root": { "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class", "name": "SqliteStorageAdapter", "kind": "class" },
  "dependencies": [ /* ... */ ],
  "edges": [ /* ... */ ],
  "level": 2,
  "levelDescription": "L2: Root + direct dependencies (depth 1)",
  "_meta": { "totalItems": 42, "returnedItems": 42, "truncated": false }
}
```

## Annotations

Symbols can carry `annotations` (C# attributes, the `columns` of a SQL table).
The nodes of a slice include them at **L4 only**. L1 to L3 leave them out, so
attribute arguments and long column lists do not push dependencies past the
response limit. [`get_context_for_task`](/mcp-tools/get-context-for-task) leaves
them out too.

Annotations live in the JSON index. When the graph comes from the SQLite cache
fallback instead, nodes carry none at any level.

## Tables, views and procedures

The forward edges of a SQL view, procedure or function are its `reads`,
`writes` and `executes`, so a slice of a procedure lists the tables it touches
and the procedures it runs.

- A 2-part id such as `dbo.usp_closeloan::procedure` is accepted and walks the
  body of the definition the name resolves to.
- When several files define the procedure, each copy's full id walks that
  copy's own body, so a `CREATE OR ALTER PROCEDURE` in a later migration shows
  its own accesses. See [several definitions](/languages/sql#several-definitions-of-one-object).
