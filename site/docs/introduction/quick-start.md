---
title: "Quick Start"
description: "From zero to your first MCP tool call in five steps and under five minutes."
---

# Quick Start

Five steps, five minutes. At the end you will have a committed index of your
repo and an agent making dependency-aware queries against it.

::: info Prerequisites
Node.js >= 20, git, and a repo with TypeScript, Go, or C# code. See
[Installation](/introduction/installation) for details.
:::

## 1. Install and initialize

From the root of your repo:

```bash
npx @ctxo/cli init
```

Expected output (abridged):

```
[ctxo] Detected languages: typescript
[ctxo] Installing @ctxo/lang-typescript@^0.7.0-alpha.0 (devDependency)...
[ctxo] Wrote .ctxo/config.yaml
[ctxo] Installed git hooks: post-commit, post-merge, post-checkout
[ctxo] Done. Run `npx ctxo index` next.
```

## 2. Build the index

```bash
npx ctxo index
```

This walks every file tracked by git, parses symbols and edges, and enriches
with git commit intent. Expect a few seconds on small repos, a minute or two
on large ones.

```
[ctxo] Indexing 342 files across 1 workspace...
[ctxo] typescript: 312 files, 4,812 symbols, 11,507 edges
[ctxo] Wrote .ctxo/index/ (312 JSON files)
[ctxo] Rebuilt .ctxo/.cache/ctxo.sqlite
[ctxo] Done in 8.2s
```

::: tip Fast re-index
Use `ctxo index --skip-history` during iterative work to skip the git-history
pass. Run a full `ctxo index` before committing.
:::

## 3. Check status

```bash
npx ctxo status
```

```
[ctxo] Index: .ctxo/index/ (312 files, last built 12s ago)
[ctxo] Cache: .ctxo/.cache/ctxo.sqlite (4.2 MB)
[ctxo] Plugins: @ctxo/lang-typescript v0.7.0-alpha.0
[ctxo] Health: OK
```

If anything looks off, run `npx ctxo doctor` for a detailed health report.

## 4. Wire up an MCP client

Add Ctxo to your client's MCP config. For Claude Code, create or edit
`.mcp.json` in your repo root:

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

Full config blocks for Cursor, Copilot, Windsurf, and Cline are in
[MCP Client Setup](/introduction/mcp-client-setup).

Restart your client. You should see `ctxo` listed as a connected MCP server
with 14 tools and 1 resource (`ctxo://status`).

## 5. Make your first tool call

In your agent, try this prompt:

> "Use `get_ranked_context` to find code related to 'index storage'. Then
> call `get_blast_radius` on the top result."

Or call directly via your client's MCP tool UI. Example `get_logic_slice`
request:

```json
{
  "symbolId": "packages/cli/src/adapters/storage/sqlite.ts::SqliteStorageAdapter::class",
  "detail": "L2"
}
```

Expected response shape:

```json
{
  "symbol": { "name": "SqliteStorageAdapter", "kind": "class" },
  "dependencies": [ /* transitive deps */ ],
  "_meta": { "totalItems": 42, "returnedItems": 42, "truncated": false }
}
```

## What's next

- [MCP Tools Overview](/mcp-tools/overview) - all 14 tools with examples
- [MCP Client Setup](/introduction/mcp-client-setup) - per-client config
- <a href="/Ctxo/ctxo-visualizer.html" target="_self">Visualize your index</a>
  - interactive graph of the repo you just indexed

::: tip Keep it fresh
The git hooks installed by `ctxo init` re-index on commit, merge, and
checkout. For active editing sessions, run `npx ctxo watch` in a spare
terminal for incremental re-indexing on save.
:::
