---
title: get_logic_slice
description: Symbol plus transitive dependencies with progressive detail levels
---

# get_logic_slice

Returns a symbol and all symbols it depends on (transitively), filtered and
truncated to fit a token budget. Supports four detail levels (L1-L4).

## Parameters

| Name       | Type                           | Required | Description                         |
| ---------- | ------------------------------ | -------- | ----------------------------------- |
| `symbolId` | string                         | yes      | Fully-qualified symbol id           |
| `detail`   | `"L1" \| "L2" \| "L3" \| "L4"` | no       | Progressive detail (default `L2`)   |
| `intent`   | string                         | no       | Keyword filter on results           |

## Example

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "detail": "L2"
}
```

## Response

```json
{
  "symbol": { "name": "SqliteStorageAdapter", "kind": "class" },
  "dependencies": [ /* ... */ ],
  "_meta": { "totalItems": 42, "returnedItems": 42, "truncated": false }
}
```
