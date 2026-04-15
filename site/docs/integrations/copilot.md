---
title: "GitHub Copilot"
description: "Copilot Chat MCP setup."
---

# GitHub Copilot

GitHub Copilot Chat (VS Code, agent mode) supports MCP servers. The schema
differs from Claude Code / Cursor / Windsurf - Copilot uses `servers` (not
`mcpServers`) and requires an explicit `"type": "stdio"` field.

See [MCP Client Setup](/introduction/mcp-client-setup) for the cross-client
overview.

## Config file

Copilot reads MCP server definitions from:

| Scope       | Path                            |
| ----------- | ------------------------------- |
| Per-project | `.vscode/mcp.json`              |
| Per-user    | VS Code `settings.json` under `"mcp.servers"` |

Per-project `.vscode/mcp.json` is the recommended default and can be committed.

## Configuration

```json
{
  "servers": {
    "ctxo": {
      "type": "stdio",
      "command": "npx",
      "args": ["@ctxo/cli", "mcp"]
    }
  }
}
```

::: warning Schema is different
Note the three differences from other clients:

- Top-level key is `servers`, not `mcpServers`
- `"type": "stdio"` is **required**
- Env vars live under `env` same as elsewhere

Copying the Claude Code config verbatim will silently fail to register.
:::

With debug logging:

```json
{
  "servers": {
    "ctxo": {
      "type": "stdio",
      "command": "npx",
      "args": ["@ctxo/cli", "mcp"],
      "env": { "DEBUG": "ctxo:*" }
    }
  }
}
```

## Verify

1. Open Copilot Chat, switch to **Agent** mode (dropdown at the top of the
   chat pane).
2. Click the **tools** icon. You should see a `ctxo` group with 14 tools.
3. Ask:

> List the tools available from the `ctxo` server.

If Copilot replies that no MCP tools are configured, check
`Output -> GitHub Copilot Chat` for spawn errors.

## Using Ctxo tools

Copilot Chat will request approval the first time it calls each tool. A
typical flow:

> I'm about to change the signature of `extractSymbols`. What depends on it?

Copilot proposes calling `get_blast_radius`, pops an approval toast, then after
approval returns the impact JSON and adapts its plan.

## Tips

- **Agent mode only.** Ask-mode and inline completions do not use MCP. Switch
  to Agent mode (the dropdown, not a setting).
- **Approve once per tool.** The first call to each Ctxo tool requires a
  click. Check "Always allow" to stop seeing the prompt.
- **Trust the workspace.** MCP servers do not run in untrusted workspaces. If
  `ctxo` fails to start, make sure the folder is trusted.
- **HTTP transport.** Copilot also supports `"type": "http"`. Start Ctxo with
  `CTXO_HTTP_PORT=7337 npx @ctxo/cli mcp` and point Copilot at
  `http://localhost:7337/mcp`.

## Next steps

- [MCP Client Setup](/introduction/mcp-client-setup)
- [MCP Tools Overview](/mcp-tools/overview)
- [Quick Start](/introduction/quick-start)
