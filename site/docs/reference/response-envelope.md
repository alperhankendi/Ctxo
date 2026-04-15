---
title: "Response Envelope"
description: "The _meta wrapper and truncation rules."
---

# Response Envelope

Every Ctxo MCP tool response is wrapped in a uniform envelope before it is returned to the client. The envelope adds a `_meta` field with item counts and truncation state, and it enforces a byte-size cap that protects LLM context windows.

## Transport shape

All responses follow the MCP `content` array convention. The payload is a single text part carrying a JSON document:

```json
{
  "content": [
    { "type": "text", "text": "<JSON stringified payload + _meta>" }
  ]
}
```

## Three response shapes

### 1. Success

```json
{
  "importers": [ /* ... */ ],
  "_meta": {
    "totalItems": 42,
    "returnedItems": 42,
    "truncated": false,
    "totalBytes": 3194
  }
}
```

### 2. Graceful miss

Returned when the requested symbol, file, or range is not in the index. Never an error.

```json
{ "found": false, "hint": "Run \"ctxo index\" to build the codebase index." }
```

### 3. Error

Input validation or internal failure. Tool handlers **never throw**; they convert exceptions into this shape.

```json
{ "error": true, "message": "symbolId: String must contain at least 1 character(s)" }
```

## `_meta` fields

| Field | Type | Description |
| --- | --- | --- |
| `totalItems` | number | Size of the largest truncatable array in the payload (pre-truncation). `0` when the payload has no truncatable array. |
| `returnedItems` | number | Number of items actually included after truncation. |
| `truncated` | boolean | `true` when the response was cut to fit under the byte threshold. |
| `totalBytes` | number | Byte size of the **full, untruncated** payload (UTF-8). |
| `hint` | string (optional) | When truncated, a drill-in suggestion for the calling LLM (e.g. "Use `search_symbols` with a narrower query"). |
| `workspace` | object (optional) | Workspace descriptor `{ root, package? }`. Forward-compat for monorepo workspaces. |

## Truncation

Truncation preserves the response schema while fitting within a byte budget.

- **Default threshold:** `8192` bytes.
- **Override:** set the environment variable `CTXO_RESPONSE_LIMIT` to any positive integer.
- **Algorithm:** the envelope identifies the largest known array field (e.g. `impactedSymbols`, `importers`, `results`, `rankings`), then binary-searches for the largest prefix that serialises under the threshold.
- **Hint:** when truncation occurs, `_meta.hint` contains a tool-specific next step. Hints are stable strings, safe to pattern-match on.

```bash
# Raise the cap for a session
export CTXO_RESPONSE_LIMIT=16384
```

Payloads under the threshold are returned verbatim with `truncated: false`. Payloads with no truncatable array are returned in full regardless of size.

## Truncatable fields

Only these array fields are truncatable. Every MCP tool that produces large output writes into one of them.

`impactedSymbols`, `importers`, `deadSymbols`, `unusedExports`, `results`, `rankings`, `context`, `hierarchies`, `scaffolding`, `deadFiles`, `files`

::: tip
When `_meta.truncated === true`, the calling agent should either narrow its query (using `_meta.hint`) or raise `CTXO_RESPONSE_LIMIT`. Never assume the array is complete without checking the flag.
:::

::: warning
Tool handlers must not throw. All error paths convert to `{ error: true, message }`. A thrown exception would surface to the MCP client as a transport-level failure and break stdio framing.
:::

## See also

- [MCP Response Format](/mcp-tools/response-format) - tool-by-tool payload shapes
