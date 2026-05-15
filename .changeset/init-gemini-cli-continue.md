---
'@ctxo/cli': patch
---

`ctxo init` now supports **Gemini CLI** and **Continue** as installable AI tool targets, bringing the supported tool list to nine.

- **Gemini CLI**: appends a marked rules block to `GEMINI.md` at the repo root and registers the ctxo MCP server at `.gemini/settings.json` (`mcpServers` key, same schema as Claude Code / Cursor).
- **Continue**: writes `.continue/rules/ctxo.md` and registers the MCP server as a standalone file at `.continue/mcpServers/ctxo.json` (Continue picks up each file in that directory separately).

Run `ctxo init` and pick `gemini-cli` and/or `continue` from the interactive list, or use `ctxo init --tools gemini-cli,continue --yes` for a non-interactive install. No existing platform behavior changes.
