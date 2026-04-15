---
title: "What is Ctxo?"
description: "Ctxo is an MCP server that gives AI coding agents dependency-aware, history-enriched context in under 500ms."
---

# What is Ctxo?

Ctxo is a **Model Context Protocol (MCP) server** that turns your repository into
a queryable knowledge base for AI coding assistants. Instead of letting an agent
grep its way through files one at a time, Ctxo serves **Logic-Slices**: a symbol
plus all transitive dependencies, git commit intent, anti-pattern warnings, and
change-health scores, all in a single sub-500ms call.

## What Ctxo is

- An **MCP server** over stdio, compatible with Claude Code, Cursor, Copilot,
  Windsurf, Cline, and any raw MCP client.
- A **CLI** (`@ctxo/cli`) that builds and maintains a committed, deterministic
  index of your code at `.ctxo/`.
- **14 semantic tools** spanning impact analysis (`get_blast_radius`,
  `get_pr_impact`), retrieval (`get_ranked_context`, `search_symbols`),
  navigation (`find_importers`, `get_class_hierarchy`), and health
  (`find_dead_code`, `get_change_intelligence`).
- **Language-pluggable**: TypeScript/JavaScript (ts-morph), Go (tree-sitter),
  and C# (Roslyn + tree-sitter) ship today; more plugins via the v1 protocol.

## What Ctxo is NOT

- **Not a code search engine.** Grep finds text; Ctxo traces call graphs,
  inheritance trees, and reverse dependencies.
- **Not a linter.** Ctxo surfaces anti-patterns from *git history* (reverts,
  hotfix chains), not from static rules.
- **Not an LSP replacement.** Ctxo is built for agent-sized context windows,
  not IDE cursor completions.
- **Not cloud-hosted.** Everything runs locally. Your code never leaves your
  machine.
- **Not a memory layer.** Ctxo does not remember your chats, prompts, or
  agent state. It answers fresh from the committed index every call.
- **Not a context compressor.** Ctxo does not summarise or shrink existing
  context. It precomputes the *right* context — dependency-aware slices,
  sized to a token budget — so the agent never has to read the whole file.

## How it fits together

```
  +-------------------+     MCP/stdio     +-------------------+
  | Claude Code /     | <---------------> | @ctxo/cli         |
  | Cursor / Copilot  |   JSON-RPC        | (MCP server)      |
  +-------------------+                   +---------+---------+
                                                    |
                                                    v
                                    +---------------+---------------+
                                    | .ctxo/                        |
                                    |   index/   (committed JSON)   |
                                    |   .cache/  (local SQLite)     |
                                    +---------------+---------------+
                                                    ^
                                                    | Ctxo indexer
                                                    |
                                            +-------+--------+
                                            | Your codebase  |
                                            +----------------+
```

The agent never reads raw files to orient itself. It calls an MCP tool, Ctxo
resolves the query against the pre-built index, and the agent gets a
structured, token-budgeted answer.

## Why sub-500ms matters

Agents think in tool-call loops. Every second of latency on a navigation call
compounds across a task. Ctxo's SQLite cache and deterministic symbol IDs mean
a `get_blast_radius` on a symbol with 200 downstream dependents returns before
your agent finishes thinking about the next step.

## Next steps

- [Why Ctxo?](/introduction/why-ctxo) - the problem it solves, with numbers
- [Installation](/introduction/installation) - get the CLI installed
- [Quick Start](/introduction/quick-start) - index a repo and make your first
  MCP call in under 5 minutes
- [MCP Tools Overview](/mcp-tools/overview) - the full tool catalog
