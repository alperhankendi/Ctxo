---
title: "Installation"
description: "Install @ctxo/cli, then run ctxo init and ctxo doctor."
---

# Installation

## Prerequisites

- **Node.js** >= 20
- **git** (any recent version)
- A supported language: **TypeScript / JavaScript**, **Go**, or **C#**

## Install

The npm package is **`@ctxo/cli`** (scoped, so it sits in a namespace alongside
the language plugins like `@ctxo/lang-typescript`). The binary it installs is
named **`ctxo`** — that is what you run.

::: tip Recommended for most users
Install once globally, then call `ctxo` from any project:

```bash
npm install -g @ctxo/cli
```

Verify with `ctxo --version`. To upgrade later: `ctxo update --global`.
:::

State always lives in each project's `<repo>/.ctxo/` directory — there is no
user-level or system-level config. The install method only changes how the
binary is reached, not where data goes.

### Other install paths

| Path | When to use |
| --- | --- |
| **Global** — `npm install -g @ctxo/cli` (Recommended) | You work in multiple repos and want `ctxo …` available everywhere. |
| **Project devDependency** — `npm install -D @ctxo/cli` (or run `npx @ctxo/cli init`, which adds it for you) | You want the version pinned per-project in `package.json`. Call via `pnpm ctxo …`, `npm exec ctxo …`, or use the bare `ctxo` from a project script. |
| **No install, ad-hoc** — `npx @ctxo/cli <subcommand>` | CI, one-off experiments, or a repo where you do not want to touch dependencies. |

## 1. Initialize

From the root of the repo you want to index:

```bash
ctxo init
```

This detects your languages, installs the right `@ctxo/lang-*` plugins, adds
git hooks, and creates a starter `.ctxo/config.yaml`.

(If you have not installed globally and not yet added `@ctxo/cli` as a project
dependency, use `npx @ctxo/cli init` here — it does the same thing.)

## 2. Verify

```bash
ctxo doctor
```

All green? You are done.

If anything is red or yellow:

```bash
ctxo doctor --fix
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
ctxo index
```

## Next steps

- [Quick Start](/introduction/quick-start) - index your repo and make the
  first MCP call
- [MCP Client Setup](/introduction/mcp-client-setup) - wire Ctxo into your
  editor
