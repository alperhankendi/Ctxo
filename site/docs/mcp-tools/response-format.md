---
title: "Response Format"
description: "The MCP content wrapper and the three payload shapes every Ctxo tool returns."
---

# Response Format

Every Ctxo MCP tool returns a single JSON text block wrapped in the MCP `content` array. Parsers should `JSON.parse` the inner `text` field and branch on three shapes: **success** (domain payload + `_meta`), **graceful miss** (`{ found: false, hint }`), or **error** (`{ error: true, message }`). Tool handlers never throw — every failure is converted to the error shape inside the adapter boundary.

## Minimal example

```ts
const payload = JSON.parse(response.content[0].text);
if (payload.error) { /* log + bail */ }
else if (payload.found === false) { /* show payload.hint */ }
else { /* use payload + payload._meta */ }
```

Full field reference: [Response envelope](/reference/response-envelope).
