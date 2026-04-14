---
title: "get_class_hierarchy"
description: "Ancestor and descendant tree for a class or interface."
---

# get_class_hierarchy

Walks `extends` and `implements` edges in both directions. With a `symbolId`,
returns the ancestor and descendant chains for that class or interface. Without
one, returns **every hierarchy tree in the project** rooted at its base
classes.

::: tip When to use
Any time an interface change could ripple to many implementers, or you need to
understand an OOP inheritance chain before overriding a method. This is a
specialized (cheaper) counterpart to
[`find_importers`](/mcp-tools/find-importers) for structural inheritance only.
:::

## Parameters

| Name        | Type                                           | Required | Description                                                          |
| ----------- | ---------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `symbolId`  | string                                         | no       | Root the query at this class/interface. Omit for project-wide trees. |
| `direction` | `"ancestors" \| "descendants" \| "both"`      | no       | Which way to walk. Default `"both"`                                  |

## Examples

Rooted query -- who implements this interface?

```json
{
  "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface",
  "direction": "descendants"
}
```

Full project inheritance forest:

```json
{}
```

## Response (rooted)

```json
{
  "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface",
  "ancestors": [],
  "descendants": [
    {
      "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
      "name": "SqliteStorageAdapter",
      "kind": "class",
      "file": "packages/cli/src/adapters/storage/sqlite.ts",
      "edgeKind": "implements",
      "depth": 1
    }
  ],
  "_meta": { "totalItems": 1, "returnedItems": 1, "truncated": false }
}
```

## Response (full project)

```json
{
  "hierarchies": [
    {
      "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface",
      "name": "IStoragePort",
      "kind": "interface",
      "file": "packages/cli/src/ports/i-storage-port.ts",
      "children": [
        {
          "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
          "name": "SqliteStorageAdapter",
          "kind": "class",
          "file": "packages/cli/src/adapters/storage/sqlite.ts",
          "edgeKind": "implements",
          "children": []
        }
      ]
    }
  ],
  "totalClasses": 14,
  "totalEdges": 13,
  "_meta": { "totalItems": 5, "returnedItems": 5, "truncated": false }
}
```

## When to use

- **Changing an interface** -- list every implementer before you edit the contract.
- **Understanding an abstract class** -- walk `descendants` to see concrete subclasses.
- **Architecture review** -- full-project mode visualises every inheritance tree; pair with [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay) for layer context.

## Notes

::: info Edge kinds
Only `extends` and `implements` edges are followed. For `imports`/`calls`/`uses`
reverse walks, use [`find_importers`](/mcp-tools/find-importers).
:::

- **Roots in full-project mode** are nodes that are the target of an `extends`/`implements` edge but never the source -- i.e., true base classes or interfaces. If cycles exist, all involved nodes become candidate roots.
- **Requires** `ctxo index`.
