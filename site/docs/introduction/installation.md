---
title: "Installation"
description: "One-liner install: npx @ctxo/cli init, then verify with ctxo doctor."
---

# Installation

## Prerequisites

- **Node.js** >= 20
- **git** (any recent version)
- A supported language: **TypeScript / JavaScript**, **Go**, or **C#**

## 1. Initialize

From the root of the repo you want to index:

```bash
npx @ctxo/cli init
```

This detects your languages, installs the right `@ctxo/lang-*` plugins, adds
git hooks, and creates a starter `.ctxo/config.yaml`.

## 2. Verify

```bash
npx ctxo doctor
```

All green? You are done.

If anything is red or yellow:

```bash
npx ctxo doctor --fix
```

This runs a dependency-ordered remediation pass (missing plugins, stale
cache, broken hooks). Add `--dry-run` first if you want to preview.

## Add a language later

`@ctxo/cli init` auto-detects what your repo uses. To add more languages after
the fact, install the plugin package directly:

::: code-group

```bash [pnpm]
pnpm add -D @ctxo/lang-typescript
# or: @ctxo/lang-go, @ctxo/lang-csharp
```

```bash [npm]
npm install -D @ctxo/lang-typescript
```

```bash [yarn]
yarn add -D @ctxo/lang-typescript
```

:::

Available plugins on npm:
[`@ctxo/lang-typescript`](https://www.npmjs.com/package/@ctxo/lang-typescript),
[`@ctxo/lang-go`](https://www.npmjs.com/package/@ctxo/lang-go),
[`@ctxo/lang-csharp`](https://www.npmjs.com/package/@ctxo/lang-csharp).

After install, re-index so the plugin takes effect:

```bash
npx ctxo index
```

## Next steps

- [Quick Start](/introduction/quick-start) - index your repo and make the
  first MCP call
- [MCP Client Setup](/introduction/mcp-client-setup) - wire Ctxo into your
  editor
