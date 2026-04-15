---
title: "Windsurf"
description: "Windsurf MCP setup."
---

# Windsurf

[Windsurf](https://codeium.com/windsurf) (from Codeium) ships a built-in MCP
client. Its Cascade agent will auto-suggest Ctxo tools whenever a prompt looks
like dependency analysis, refactoring, or code exploration.

See [MCP Client Setup](/introduction/mcp-client-setup) for the cross-client
overview.

## Config file

Windsurf reads from one user-global location:

| Scope    | Path                                        |
| -------- | ------------------------------------------- |
| Per-user | `~/.codeium/windsurf/mcp_config.json`       |

On Windows, substitute `%USERPROFILE%\.codeium\windsurf\mcp_config.json`.

There is no per-project override today - pick the repos where you want Ctxo
active and let the user-global config apply to all of them.

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

With debug logging:

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

1. Open Windsurf's **Cascade** panel.
2. Click the hammer / tools icon. `ctxo` should appear with 14 tools listed
   underneath.
3. Prompt Cascade:

> What Ctxo tools do you have access to?

Cascade will enumerate the tool names and describe each one.

::: tip Reload, don't restart
Use **Cascade -> Refresh MCP Servers** instead of a full Windsurf restart
after editing `mcp_config.json`.
:::

## Using Ctxo tools

Windsurf's Cascade is aggressive about suggesting tool use. A prompt like:

> Is `SqliteStorageAdapter` safe to delete?

triggers Cascade to call `find_importers` and then `get_blast_radius` without
being told, then presents a go/no-go recommendation with the evidence inline.

## Tips

- **Auto-suggest is a feature.** Cascade picks MCP tools proactively. You
  rarely need to name them; describe the task instead.
- **Cache the index.** Cascade's loops are fast - a stale index is noticeable.
  Keep `ctxo watch` running, or add a pre-prompt shell step.
- **Cascade memories.** Tell Cascade once: "Always call `get_blast_radius`
  before proposing edits." Saved memories persist across sessions.
- **HTTP transport.** Set `CTXO_HTTP_PORT=7337` in the `env` block if you want
  to share one Ctxo process with other tools on the same machine.

## Next steps

- [MCP Client Setup](/introduction/mcp-client-setup)
- [MCP Tools Overview](/mcp-tools/overview)
- [Quick Start](/introduction/quick-start)
