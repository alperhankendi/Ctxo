---
title: "Response Format"
description: "The MCP content wrapper, _meta envelope, intent filtering, error shapes, truncation rules, and tool annotations."
---

# Response Format

Every Ctxo MCP tool returns a **single JSON text block** wrapped in the MCP `content` array. Parsers should always `JSON.parse` the inner `text` field and branch on three shapes: success, graceful miss, or error.

## Outer MCP wrapper

All tools — success or failure — return exactly this envelope:

```json
{
  "content": [
    { "type": "text", "text": "<stringified JSON payload>" }
  ]
}
```

::: warning Tool handlers never throw
Errors are caught inside the adapter boundary and returned as a structured payload. A client should never see a JSON-RPC error response from a Ctxo tool — only the three payload shapes below.
:::

## Success shape

Successful responses carry the tool's domain payload plus a `_meta` envelope:

```json
{
  "symbol": {
    "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
    "name": "SqliteStorageAdapter",
    "kind": "class"
  },
  "dependencies": [
    { "symbolId": "packages/cli/src/ports/i-storage-port.ts::IStoragePort::interface", "name": "IStoragePort" }
  ],
  "_meta": {
    "totalItems": 128,
    "returnedItems": 42,
    "truncated": true,
    "totalBytes": 8192,
    "hint": "Response truncated at 8192 bytes. Narrow with `intent` or raise CTXO_RESPONSE_LIMIT."
  }
}
```

### `_meta` fields

| Field | Type | Description |
| --- | --- | --- |
| `totalItems` | number | Total items matched before truncation |
| `returnedItems` | number | Items actually serialized in this response |
| `truncated` | boolean | `true` when `returnedItems < totalItems` |
| `totalBytes` | number | Byte size of the serialized payload |
| `hint` | string? | Optional next-step guidance (only present when `truncated` or degraded) |

## Graceful miss shape

When a lookup succeeds at the protocol level but finds nothing — unknown `symbolId`, empty result set, stale index — tools return:

```json
{
  "found": false,
  "hint": "Symbol not found. Run `ctxo index` to refresh, or check the id with `search_symbols`."
}
```

Always branch on `found === false` **before** indexing into domain fields.

## Error shape

Unexpected failures (parser crash, corrupt cache, git unavailable) surface as:

```json
{
  "error": true,
  "message": "SQLite cache corrupt — delete .ctxo/.cache and re-run `ctxo sync`."
}
```

::: tip Client pattern
```ts
const payload = JSON.parse(response.content[0].text);
if (payload.error) { /* log + bail */ }
else if (payload.found === false) { /* show hint */ }
else { /* use payload + payload._meta */ }
```
:::

## Truncation

Ctxo caps serialized payloads at **8192 bytes by default** to keep responses within typical LLM tool-result token budgets. Raise or lower the threshold with an environment variable:

```bash
CTXO_RESPONSE_LIMIT=16384 ctxo   # 16 KB limit
CTXO_RESPONSE_LIMIT=4096  ctxo   # tighter for small-context models
```

When truncation kicks in, `_meta.truncated` becomes `true` and `_meta.hint` suggests a remedy (usually: apply an `intent` filter or request a smaller `detail` level).

## Intent filtering

Four tools accept an optional `intent` parameter — a free-form keyword string matched against symbol names, file paths, and commit messages — to narrow results *before* truncation:

- [`get_blast_radius`](/mcp-tools/get-blast-radius)
- [`get_logic_slice`](/mcp-tools/get-logic-slice)
- [`find_importers`](/mcp-tools/find-importers)
- [`find_dead_code`](/mcp-tools/find-dead-code)

Example: narrow a blast-radius query to storage-layer impact only.

```json
{
  "symbolId": "packages/cli/src/core/graph/graph.ts::Graph::class",
  "intent": "storage sqlite cache"
}
```

## Tool annotations

Every tool ships with MCP annotations so clients can reason about safety and caching:

| Annotation | Value (all Ctxo tools) | Meaning |
| --- | --- | --- |
| `readOnlyHint` | `true` | Tool never mutates repo or index state |
| `idempotentHint` | `true` | Identical inputs produce identical outputs until the index changes |
| `openWorldHint` | `false` | No network / external state — all reads are local |

::: info Ctxo is read-only by design
Indexing, hook installation, and plugin install are **CLI commands** (`ctxo index`, `ctxo init`, `ctxo install`), never MCP tools. The MCP surface is purely a query layer — safe to grant to any agent without write concerns.
:::

## See also

- [MCP Tools Overview](/mcp-tools/overview) — all 14 tools grouped by category
- [Tool Selection Guide](/mcp-tools/tool-selection-guide) — decision tree
