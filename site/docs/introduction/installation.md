---
title: "Installation"
description: "Install @ctxo/cli and language plugins via npx, pnpm, or npm. Prerequisites, auto-detection, and troubleshooting."
---

# Installation

Ctxo ships as an npm package (`@ctxo/cli`) plus one or more language plugins
(`@ctxo/lang-typescript`, `@ctxo/lang-go`, `@ctxo/lang-csharp`). The fastest
path is `npx ctxo init`, which auto-detects your languages and installs the
right plugins.

## Prerequisites

| Requirement | Version      | Why                                           |
| ----------- | ------------ | --------------------------------------------- |
| Node.js     | >= 20        | ESM, `node --import`, modern `fs` APIs        |
| git         | any recent   | commit-intent and anti-pattern detection      |
| A supported language | TS/JS, Go, or C# | at least one language plugin must match |

::: tip Check your setup
Run `node --version && git --version` before installing. If either is missing,
Ctxo will surface a clear error via `ctxo doctor` after install.
:::

## Recommended: one-liner init

From the root of the repo you want to index:

```bash
npx ctxo init
```

This will:

1. Detect languages by scanning your repo (`.ts`, `.go`, `.cs`, etc.).
2. Offer to install the matching `@ctxo/lang-*` plugins as devDependencies.
3. Install git hooks (`post-commit`, `post-merge`, `post-checkout`) so the
   index stays fresh without manual re-runs.
4. Create a starter `.ctxo/config.yaml`.

Skip the plugin prompt if you want to wire languages manually:

```bash
npx ctxo init --no-install
```

## Manual install

### pnpm

```bash
pnpm add -D @ctxo/cli @ctxo/lang-typescript
# or: @ctxo/lang-go, @ctxo/lang-csharp
```

### npm

```bash
npm install --save-dev @ctxo/cli @ctxo/lang-typescript
```

### yarn

```bash
yarn add -D @ctxo/cli @ctxo/lang-typescript
```

Then initialize:

```bash
npx ctxo init --no-install
npx ctxo index
```

## Non-interactive install

For CI or scripted setups:

```bash
npx ctxo install typescript go --yes
npx ctxo install --dry-run --pm pnpm   # preview the plan
```

## What gets installed

- **`@ctxo/cli`** - the CLI binary (`ctxo`) and the MCP server entrypoint.
- **One or more `@ctxo/lang-*` packages** - per-language parsers. Ship only
  the ones your repo uses; they are pure devDependencies.
- **Git hooks** (via `ctxo init`) - keep the committed `.ctxo/index/` in sync
  with your working tree. Disable with `--no-hooks`.
- **`.ctxo/` directory** - `config.yaml` and `index/` are committed;
  `.cache/` is gitignored and regenerated from `index/`.

## Verify the install

```bash
npx ctxo --version --verbose
npx ctxo doctor
```

`ctxo doctor` runs health checks across the CLI, storage, git, and each
installed language plugin. On a fresh repo you should see all green.

## Troubleshooting

| Symptom                                 | Fix                                         |
| --------------------------------------- | ------------------------------------------- |
| `Cannot find module @ctxo/lang-*`       | `npx ctxo install --yes` or add the plugin manually |
| `ctxo index` skips all files            | Check `.gitignore` (Ctxo uses `git ls-files`) and `.ctxo/config.yaml` globs |
| SQLite errors on first run              | Delete `.ctxo/.cache/` and re-run `ctxo index` |
| Hooks not firing                        | `npx ctxo init --force` to reinstall them   |
| C# indexing is slow / falls back to tree-sitter | Ensure the Roslyn helper (`tools/ctxo-roslyn`) is present, or accept the degraded tier |

For a dependency-ordered remediation pass:

```bash
npx ctxo doctor --fix --dry-run   # preview
npx ctxo doctor --fix --yes       # apply
```

## Next steps

- [Quick Start](/introduction/quick-start) - index your repo and make the
  first MCP call
- [MCP Client Setup](/introduction/mcp-client-setup) - wire Ctxo into your
  editor
