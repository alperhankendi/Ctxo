---
title: "Cline"
description: "Cline MCP setup."
---

# Cline

[Cline](https://cline.bot) is an agentic VS Code extension (formerly Claude
Dev). It treats MCP servers as first-class and enforces approval-gated
execution by default - every tool call asks for your OK before running.

See [MCP Client Setup](/introduction/mcp-client-setup) for the cross-client
overview.

## Config file

Cline stores MCP servers in its extension storage. The file lives at:

| OS      | Path                                                                                   |
| ------- | -------------------------------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Linux   | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Windows | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |

You rarely need to edit this by hand - use the **MCP Servers** panel inside
Cline (gear icon -> MCP Servers -> Configure MCP Servers).

## Configuration

Copy the canonical Cline block from
[MCP Client Setup](/introduction/mcp-client-setup#cline). Save it at
`cline_mcp_settings.json` (path varies by OS — see the table above), or
just paste it into the **MCP Servers** panel in the Cline UI.

`autoApprove` is a Cline-specific field - list tool names here to skip the
approval prompt. Start with `[]` and add tools as you build trust:

```json
"autoApprove": [
  "search_symbols",
  "get_ranked_context",
  "get_blast_radius",
  "get_why_context"
]
```

::: tip Read-only tools are safe to auto-approve
All 14 Ctxo tools are read-only (they declare `readOnlyHint: true`). You can
safely add any of them to `autoApprove` without risking destructive actions.
:::

## Verify

1. Click **MCP Servers** in the Cline sidebar.
2. `ctxo` appears with a green dot and its 14 tools underneath.
3. If it is red, click the server name to see the spawn log.

Smoke test:

> Read the `ctxo://status` resource and tell me when the index was last built.

## Using Ctxo tools

Cline's loop is "propose -> approve -> execute -> observe". An example turn:

> I need to understand how `get_logic_slice` works before I extend it.

Cline proposes calling `get_context_for_task` with
`taskType: "understand"`. You approve. Cline reads the returned JSON,
summarizes the symbol, and only then offers to open files.

Because every step is gated, you always see which Ctxo tool fired and with
what arguments - useful for debugging prompts.

## Tips

- **Approval gates are a feature, not a bug.** They make Cline's Ctxo usage
  auditable. Use `autoApprove` only for the read-only tools you trust.
- **No `env` block? Set it globally.** If Cline's JSON schema refuses `env`,
  export `DEBUG=ctxo:*` in the shell Cline inherits from.
- **Per-workspace is not supported.** `cline_mcp_settings.json` is
  user-global. Use `disabled: true` to temporarily turn Ctxo off for a
  workspace where you do not have an index.
- **HTTP transport.** Same pattern as other clients: add
  `"env": { "CTXO_HTTP_PORT": "7337" }` and Ctxo serves over HTTP on that
  port.

## Next steps

- [MCP Client Setup](/introduction/mcp-client-setup)
- [MCP Tools Overview](/mcp-tools/overview)
- [Quick Start](/introduction/quick-start)
