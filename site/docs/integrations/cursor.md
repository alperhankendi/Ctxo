---
title: "Cursor"
description: "Cursor MCP setup."
---

# Cursor

[Cursor](https://cursor.com) has first-class MCP support. Once Ctxo is
registered, its tools are available inside the chat panel and can be summoned
explicitly with an `@` mention.

See [MCP Client Setup](/introduction/mcp-client-setup) for the cross-client
overview.

## Config file

Cursor reads from two locations:

| Scope       | Path                         | Committed? |
| ----------- | ---------------------------- | ---------- |
| Per-user    | `~/.cursor/mcp.json`         | no         |
| Per-project | `.cursor/mcp.json` (repo)    | yes        |

Per-project wins. Commit `.cursor/mcp.json` so every teammate's Cursor picks up
Ctxo automatically.

## Configuration

```json
{
  "mcpServers": {
    "ctxo": {
      "command": "npx",
      "args": ["@ctxo/cli", "mcp"]
    }
  }
}
```

With debug output:

```json
{
  "mcpServers": {
    "ctxo": {
      "command": "npx",
      "args": ["@ctxo/cli", "mcp"],
      "env": { "DEBUG": "ctxo:*" }
    }
  }
}
```

## Verify

1. Restart Cursor (settings are read once at startup).
2. Open **Settings -> MCP**. `ctxo` should appear with a green dot and a
   14-tool list.
3. In chat, ask:

> @ctxo call `ctxo://status`

Cursor will route the request to the server and print the manifest.

::: warning Restart required
Cursor does not hot-reload `mcp.json`. Changes need a full Cursor restart, not
just a window reload.
:::

## Using Ctxo tools

Cursor supports explicit at-mentions. Typing `@ctxo` in the composer scopes the
next turn to Ctxo tools, which nudges the agent to pick one instead of reading
files blindly.

Example prompt:

> @ctxo before I refactor `TsMorphAdapter.extractSymbols`, show me the blast
> radius and any revert history.

Cursor will chain two calls:

1. `get_blast_radius` on the symbol id
2. `get_why_context` for the anti-pattern list

and surface the JSON before proposing edits.

## Tips

- **At-mentions beat prompting.** `@ctxo` is far more reliable than "please use
  ctxo tools" in the system prompt. It scopes tool selection for that turn.
- **Tool approval.** Cursor prompts the first time a tool is called in a
  workspace. Approve `ctxo.*` once and add it to the allowlist.
- **Composer mode.** The agentic composer (CMD+I) benefits most from Ctxo.
  Chat works too, but composer actually uses the blast radius before editing.
- **HTTP transport.** For multi-window sessions sharing one index, set
  `CTXO_HTTP_PORT=7337` in the `env` block and switch to HTTP transport.

## Next steps

- [MCP Client Setup](/introduction/mcp-client-setup)
- [MCP Tools Overview](/mcp-tools/overview)
- [Quick Start](/introduction/quick-start)
