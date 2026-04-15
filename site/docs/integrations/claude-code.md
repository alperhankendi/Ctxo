---
title: "Claude Code"
description: "Wire Ctxo into Claude Code stdio transport."
---

# Claude Code

[Claude Code](https://docs.anthropic.com/claude/claude-code) is Anthropic's
official CLI coding agent. It speaks MCP natively and auto-discovers servers
listed in `.mcp.json` at the repo root.

See [MCP Client Setup](/introduction/mcp-client-setup) for the one-page overview
of every client.

## Config file

Claude Code reads MCP servers from two locations:

| Scope       | Path                      | Committed? |
| ----------- | ------------------------- | ---------- |
| Per-project | `.mcp.json` (repo root)   | yes (share with team) |
| Per-user    | `~/.claude.json`          | no         |

Per-project config wins and is the recommended default - every teammate gets
Ctxo for free when they clone the repo.

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

With debug logging to stderr:

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

::: tip Pin the binary in CI
`npx` does a network resolve on every spawn. For hermetic environments,
install `@ctxo/cli` as a devDependency and point at
`./node_modules/@ctxo/cli/dist/index.js` instead.
:::

## Verify

Inside a Claude Code session:

```text
/mcp
```

You should see `ctxo` listed as **connected** with 14 tools and 1 resource
(`ctxo://status`). If it is missing, run `claude --mcp-debug` to see the spawn
error.

A quick smoke test prompt:

> Call the `ctxo://status` resource and show me the index manifest.

## Using Ctxo tools

Once connected, Claude Code will call Ctxo tools on its own when the prompt
warrants it. Example:

> I want to rename `SqliteStorageAdapter.save`. What breaks?

Claude Code picks `get_blast_radius` automatically:

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "detail": "L2"
}
```

and replies with the confirmed + likely + potential call sites before offering
to edit anything.

## Tips

- **Build the index first.** Claude Code has no way to trigger `ctxo index`
  for you. Run it once after install and let `ctxo watch` keep it fresh.
- **Hook-based refresh.** Add a `PostToolUse` hook in `.claude/settings.json`
  that runs `npx ctxo index --skip-history` after `Edit`/`Write` to keep the
  graph fresh between turns.
- **Team config lives in git.** `.mcp.json` is meant to be committed. Use
  `~/.claude.json` only for personal overrides (e.g., `DEBUG=ctxo:*`).
- **HTTP transport.** Set `CTXO_HTTP_PORT=7337` in `env` if you need Ctxo
  reachable over HTTP (e.g., sharing one index between several agents on the
  same box). Stdio remains the default.

::: warning Stale index = stale answers
Claude Code will happily quote a symbol that no longer exists. Either run
`ctxo watch` in a background terminal or wire the `PostToolUse` hook above.
:::

## Next steps

- [Claude Agent SDK integration](https://github.com/alperhankendi/Ctxo/blob/master/docs/agentic-ai-integration.md)
- [MCP Tools Overview](/mcp-tools/overview)
- [Quick Start](/introduction/quick-start)
