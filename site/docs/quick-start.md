---
title: Quick Start
description: Install Ctxo and index your codebase in under 2 minutes
---

# Quick Start

## Install

```bash
npx ctxo install
```

This installs the Ctxo CLI plus the language plugins detected in your project
(`@ctxo/lang-typescript`, `@ctxo/lang-go`, `@ctxo/lang-csharp`).

## Index

```bash
npx ctxo index
```

Builds the dependency graph, enriches with git history, persists to
`.ctxo/index/` (committed JSON) and `.ctxo/.cache/` (local SQLite).

## Use

Add the MCP server to your AI coding assistant (Claude Code, Cursor, Copilot,
etc.) and it will have access to all 14 MCP tools.
