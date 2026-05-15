---
title: "Installation"
description: "One-liner install: npx @ctxo/cli init, then verify with ctxo doctor."
---

# Installation

## Prerequisites

- **Node.js** >= 20
- **git** (any recent version)
- A supported language: **TypeScript / JavaScript**, **Go**, or **C#**

## Install paths

`@ctxo/cli` is a scoped npm package, so there is no unscoped `ctxo` on the
registry. Pick whichever invocation form fits your workflow:

1. **No install, ad-hoc** — run `npx @ctxo/cli …` from any directory. npx pulls
   and runs the package on every call. Best for first-time use, CI, and one-off
   experiments.
2. **Project devDependency** — `npm install -D @ctxo/cli` (or just run
   `npx @ctxo/cli init`, which adds it for you). After that, `npx ctxo …` and
   `pnpm ctxo …` resolve to the local binary in `node_modules/.bin/ctxo`.
3. **Global install** — `npm install -g @ctxo/cli` gives you a plain `ctxo`
   command from any directory. State still lives in each project's `.ctxo/`
   folder — there is no user-level or system-level config.

The steps below use the no-install form so they work for every reader.
Substitute `ctxo …` or `npx ctxo …` once you have option 2 or 3 in place.

## 1. Initialize

From the root of the repo you want to index:

```bash
npx @ctxo/cli init
```

This detects your languages, installs the right `@ctxo/lang-*` plugins, adds
git hooks, and creates a starter `.ctxo/config.yaml`.

## 2. Verify

```bash
npx @ctxo/cli doctor
```

All green? You are done.

If anything is red or yellow:

```bash
npx @ctxo/cli doctor --fix
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
npx @ctxo/cli index
```

## Next steps

- [Quick Start](/introduction/quick-start) - index your repo and make the
  first MCP call
- [MCP Client Setup](/introduction/mcp-client-setup) - wire Ctxo into your
  editor
