---
title: "ctxo install"
description: "Install detected or selected language plugins."
---

# ctxo install

Convenience wrapper that installs the official `@ctxo/lang-*` plugin
packages for one or more languages. It auto-detects your project's package
manager (`pnpm`, `npm`, `yarn`, `bun`) and runs the equivalent of
`<pm> add -D @ctxo/lang-typescript @ctxo/lang-go ...` for you.

::: tip Direct alternative
If you prefer to stay with plain npm/pnpm, install the plugin packages
directly:

```bash
pnpm add -D @ctxo/lang-typescript   # or @ctxo/lang-go, @ctxo/lang-csharp
```

Published packages: [`@ctxo/lang-typescript`](https://www.npmjs.com/package/@ctxo/lang-typescript),
[`@ctxo/lang-go`](https://www.npmjs.com/package/@ctxo/lang-go),
[`@ctxo/lang-csharp`](https://www.npmjs.com/package/@ctxo/lang-csharp).
:::

When called with no arguments, `ctxo install` auto-detects languages used in
the repo (via file extensions and common manifest files) and installs the
plugins that are not yet present.

## Synopsis

```shell
npx ctxo install [languages...] [options]
```

## Flags

| Flag | Short | Default | Description |
| --- | --- | --- | --- |
| `--yes` | `-y` | `false` | Do not prompt. Assume yes for all decisions |
| `--global` | `-g` | `false` | Install plugins globally rather than into the project's `package.json` |
| `--dry-run` | | `false` | Print the plan (manager, packages, command) and exit without running it |
| `--pm <manager>` | | auto | Force a package manager. One of `npm`, `pnpm`, `yarn`, `bun` |
| `--version <spec>` | | latest | Pin plugins to a specific npm version or tag (for example `0.7.0-alpha.0` or `next`) |
| `--force` | | `false` | Override the CI lockfile guard. Required when `CI=true` with a frozen lockfile |

## Supported languages

Pass one or more of:

`typescript`, `javascript`, `go`, `csharp`, `python`, `java`, `kotlin`, `ruby`,
`rust`, `php`, `swift`.

Common aliases are accepted and normalized: `ts`, `js`, `py`, `c#`, `cs`,
`net`, `golang`, `kt`, `rb`, `rs`.

## Package manager detection

The manager is resolved in this order:

1. `--pm` flag
2. `CTXO_PM` environment variable
3. `packageManager` field in the project's `package.json`
4. Lockfile sniff (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `package-lock.json`)
5. Fallback to `npm`

## Examples

::: code-group
```shell [auto-detect]
# Detect languages in the repo and install anything missing.
npx ctxo install
```

```shell [explicit]
# Install TypeScript and Go plugins, no prompts.
npx ctxo install typescript go --yes
```

```shell [dry run]
# Preview the plan without running the package manager.
npx ctxo install python --dry-run --pm pnpm
```

```shell [pinned version]
# Pin to an npm dist-tag.
npx ctxo install typescript --version next --yes
```

```shell [global]
# Install globally (useful for ad-hoc CLI usage without a package.json).
npx ctxo install typescript --global
```
:::

## CI behavior

::: warning Frozen lockfiles
When `CI=true` or `CI=1`, `ctxo install` refuses to mutate dependencies to
protect frozen lockfiles. Override with `--force` or switch to `--global`.
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Install succeeded, or nothing to do |
| `1` | Unknown language, no `package.json`, blocked by CI guard, or manager failure |
| other | Propagated from the underlying package manager |

## See also

- [`ctxo init`](./init.md) — runs `install` as part of interactive setup.
- [`ctxo doctor`](./doctor.md) — `doctor --fix` will invoke `install` for any
  missing plugins.
- [Environment variables](./env-vars.md) — `CTXO_PM` overrides manager detection.
