---
title: "MCP Client Setup"
description: "Per-client config for Claude Code, Cursor, Copilot, Windsurf, and Cline. Copy-paste JSON blocks for stdio MCP."
---

# MCP Client Setup

Ctxo speaks MCP over stdio. Every major coding client supports stdio MCP
servers, usually via a JSON config file. The command is always the same:

```bash
npx @ctxo/cli mcp
```

What differs is *where* each client expects the config and *what field names*
it uses.

::: info One server, many clients
You can register Ctxo in multiple clients simultaneously. They each spawn
their own Ctxo process against the same on-disk index.
:::

## Claude Code

Create `.mcp.json` in your repo root (committed, so your whole team shares the
config):

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

Optional debug logging to stderr:

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

See [Claude Code integration](/integrations/claude-code) for per-project
vs per-user config and hook-based index refresh.

## Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project):

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

Restart Cursor. Ctxo tools appear under the MCP panel.

See [Cursor integration](/integrations/cursor) for more.

## GitHub Copilot

Copilot Chat (VS Code) reads MCP config from `.vscode/mcp.json`:

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

::: warning Field names differ
Copilot uses `servers` (not `mcpServers`) and requires an explicit
`"type": "stdio"`. Claude Code / Cursor / Windsurf use `mcpServers` without a
`type` field.
:::

See [Copilot integration](/integrations/copilot) for more.

## Windsurf

Windsurf reads from `~/.codeium/windsurf/mcp_config.json`:

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

See [Windsurf integration](/integrations/windsurf) for more.

## Cline

Cline (VS Code extension) reads `cline_mcp_settings.json` from its extension
storage. Use the **MCP Servers** panel in the Cline UI, or edit the file
directly:

```json
{
  "mcpServers": {
    "ctxo": {
      "command": "npx",
      "args": ["@ctxo/cli", "mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

See [Cline integration](/integrations/cline) for more.

## Using a pinned binary instead of npx

For tighter reproducibility (CI, shared dev containers), skip `npx` and point
at the installed binary:

```json
{
  "mcpServers": {
    "ctxo": {
      "command": "node",
      "args": ["./node_modules/@ctxo/cli/dist/index.js", "mcp"]
    }
  }
}
```

This avoids network resolution on every client start.

## Verifying the connection

After restarting your client:

1. Confirm `ctxo` shows up as a connected MCP server.
2. Confirm 14 tools are listed (`get_logic_slice`, `get_blast_radius`, ...).
3. Confirm 1 resource is exposed: `ctxo://status`.
4. In your agent, ask: *"Call `ctxo://status` and show me the result."*

If tools are missing, check the client's MCP logs. Common issues:

| Symptom                             | Fix                                          |
| ----------------------------------- | -------------------------------------------- |
| `command not found: npx`            | Install Node.js >= 20 and restart the client |
| Server starts then exits            | Run `npx @ctxo/cli mcp` in a terminal to see the real error |
| No index loaded                     | Run `npx ctxo index` in the repo root        |
| Stale results                       | `npx ctxo index` or start `ctxo watch`       |

## Next steps

- [MCP Tools Overview](/mcp-tools/overview) - the 14 tools in detail
- [Quick Start](/introduction/quick-start) - end-to-end walkthrough
