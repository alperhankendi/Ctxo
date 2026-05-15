---
title: "Continue"
description: "Continue MCP setup with per-server files under .continue/mcpServers/."
---

# Continue

[Continue](https://www.continue.dev) is an open-source AI coding assistant
shipped as VS Code and JetBrains extensions. It stores each MCP server in its
own file under `.continue/mcpServers/` rather than merging them into one big
config - a small but important detail when you mix multiple servers.

See [MCP Client Setup](/introduction/mcp-client-setup#continue) for the
cross-client overview.

## Config file

Continue picks up every JSON or YAML file dropped into:

```
.continue/mcpServers/
```

`ctxo init` writes a single file: `.continue/mcpServers/ctxo.json`. To add
another MCP server later, drop another file next to it - do not edit
`ctxo.json` to fit two servers in.

The matching rules file is `.continue/rules/ctxo.md` (the Continue v1 rules
system reads every `.md` under `.continue/rules/`).

## Configuration

`.continue/mcpServers/ctxo.json`:

```json
{
  "mcpServers": {
    "ctxo": {
      "command": "npx",
      "args": ["-y", "@ctxo/cli"]
    }
  }
}
```

This is the same `mcpServers` schema Cursor / Claude Code use. Continue's docs
state explicitly that you can copy JSON config files from those tools straight
into `.continue/mcpServers/` and they work as-is.

## Verify

1. Reload the Continue extension (VS Code: `Continue: Reload` from the command
   palette).
2. Open the **MCP** view in the Continue sidebar.
3. `ctxo` should appear as a green-status server with 14 tools listed
   underneath, plus the `ctxo://status` resource.

Smoke test, asked in the Continue chat:

> Read the `ctxo://status` resource and tell me when the index was last built.

## Using Ctxo tools

Continue exposes MCP tools to the agent on every turn. Combined with the
ctxo-rules in `.continue/rules/ctxo.md`, the model gets pushed toward:

- Calling `get_pr_impact` when you ask for a PR review.
- Calling `get_context_for_task` with the right `taskType` for bugfixes,
  features, refactors, or understanding.
- Preferring `search_symbols` / `get_ranked_context` over native file grep.

You can also @-mention tools directly in chat (`@ctxo get_blast_radius
symbol=...`) when you want to force a specific call.

## Tips

- **One file per server.** If you already had an `.continue/mcpServers/`
  directory before running `ctxo init`, your other server files stay
  untouched. Continue auto-discovers all of them.
- **YAML works too.** Continue accepts `.continue/mcpServers/ctxo.yaml` with
  the same shape. Stick with JSON unless you have a strong preference - it
  matches what every other client uses.
- **Rules vs MCP config are separate concerns.** The MCP file tells Continue
  *which tools exist*; the rules file in `.continue/rules/ctxo.md` tells it
  *when to use them*. You need both for the agent to call Ctxo proactively.
- **Disabled state.** To temporarily turn Ctxo off, rename
  `ctxo.json` to `ctxo.json.disabled` (or move it out of the directory). No
  schema flag - Continue discovers by filename.

## Next steps

- [MCP Client Setup](/introduction/mcp-client-setup)
- [MCP Tools Overview](/mcp-tools/overview)
- [Quick Start](/introduction/quick-start)
