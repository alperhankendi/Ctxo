---
title: "Gemini CLI"
description: "Gemini CLI MCP setup with project-level rules in GEMINI.md."
---

# Gemini CLI

[Gemini CLI](https://github.com/google-gemini/gemini-cli) is Google's official
terminal client for the Gemini family. It speaks MCP natively over stdio, and
reads project instructions from a `GEMINI.md` at the repo root - the same
"agents-as-markdown" pattern as `CLAUDE.md` / `AGENTS.md`.

See [MCP Client Setup](/introduction/mcp-client-setup#gemini-cli) for the
cross-client overview.

## Config file

Gemini CLI looks for `mcpServers` in two settings files, project first:

| Scope    | Path                                                |
| -------- | --------------------------------------------------- |
| Project  | `.gemini/settings.json` (committed if you want)     |
| User     | `~/.gemini/settings.json` (global to all projects)  |

`ctxo init` writes the project-level file so the whole team picks up the same
server config.

## Configuration

Drop this into `.gemini/settings.json`:

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

Same schema as Claude Code and Cursor. Add `"env": { "DEBUG": "ctxo:*" }` if
you need stderr logging.

The matching rules file is `GEMINI.md`. `ctxo init` appends a marked block
between `<!-- ctxo-rules-start -->` / `<!-- ctxo-rules-end -->` so subsequent
re-runs replace just that block without touching the rest of your file.

## Verify

```bash
gemini --help        # confirm the binary is on PATH
cd path/to/repo
gemini               # start an interactive session
```

Inside the session ask Gemini to list its MCP tools - the 14 Ctxo tools
(`get_logic_slice`, `get_blast_radius`, ...) should appear with one resource
`ctxo://status`.

Smoke test:

> Use Ctxo's `ctxo://status` resource and tell me when the index was last built.

## Using Ctxo tools

Because Gemini CLI honours `GEMINI.md` as a system prompt, the rules `ctxo init`
installs there are enforced on every turn. The agent is told:

- Call `get_blast_radius` before editing a function.
- Call `get_why_context` before trusting recently-changed code.
- Use `search_symbols` / `get_ranked_context` instead of grepping for names.

This means you do not have to remind Gemini per-message - the rules ride along
with the session.

## Tips

- **Project file beats user file.** If both `.gemini/settings.json` and
  `~/.gemini/settings.json` define `mcpServers.ctxo`, the project copy wins.
  Useful when one repo needs a pinned binary path and another can use `npx`.
- **`GEMINI.md` is large-context-friendly.** Keep team conventions there
  alongside the ctxo-rules block - Gemini's 1M-token window handles it.
- **No `disabled` flag.** To turn Ctxo off, remove (or rename) the
  `mcpServers.ctxo` entry. Restart the CLI to pick the change up.

## Next steps

- [MCP Client Setup](/introduction/mcp-client-setup)
- [MCP Tools Overview](/mcp-tools/overview)
- [Quick Start](/introduction/quick-start)
