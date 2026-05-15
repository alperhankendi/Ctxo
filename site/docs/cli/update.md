---
title: "ctxo update"
description: "Check the npm registry for newer ctxo releases and apply them."
---

# ctxo update

Checks `registry.npmjs.org` for newer versions of `@ctxo/cli` plus every
installed `@ctxo/lang-*` (and community `ctxo-lang-*`) plugin, prints a table
of what is current versus available, and either runs the install or prints
the exact command the user should run.

Per-package channel detection means an alpha install stays on alpha and a
stable install stays on stable. When the chosen channel is not published for
a given package, `update` falls back to the `latest` dist-tag and labels the
row `(latest)` so the channel switch is visible.

## Synopsis

```shell
npx @ctxo/cli update [options]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--check` | `false` | Check only. Print the table + suggested command, never install. Always exits `0` |
| `--print` | `false` | Build the install plan and print the command, never execute it |
| `--global` | `false` | Build a global install (`npm install -g …` and equivalents). Forces execute |
| `--json` | `false` | Emit a single JSON document instead of the text table |
| `--pm <manager>` | auto | Force a package manager. One of `npm`, `pnpm`, `yarn`, `bun` |
| `--force` | `false` | Override the CI lockfile guard. Required when `CI=true` with a frozen lockfile |

## Install strategy

`ctxo update` decides whether to execute or print based on the project layout
so it never mutates an unrelated workspace:

| Situation | Action |
| --- | --- |
| `--check` passed | Print the table + the suggested command. Never execute |
| `--print` passed | Same as above, regardless of project layout |
| `--global` passed | Build a global install and execute it |
| Project has `@ctxo/*` in `dependencies` / `devDependencies` | Local install via the resolved package manager, executed in the project root |
| No `package.json`, or `package.json` does not list any `@ctxo/*` | Build a global install command and **print** it (do not execute) |

## Channel detection

Each package's channel is detected from its currently installed version:

- `0.7.0` → `latest`
- `0.7.0-alpha.0` → `alpha`
- `0.7.0-beta.3` → `beta`
- `0.7.0-rc.1` → `rc`
- `0.7.0-next.4` → `next`

For each package the registry is queried for the matching dist-tag. If the
chosen channel is not published, the row falls back to `latest` and the
status column reads `update (latest)`.

## Output

### Text (default)

```text
ctxo update — checking registry for updates...

PACKAGE                CURRENT        LATEST (latest)  STATUS
@ctxo/cli              0.8.2          0.8.2            up to date
@ctxo/lang-csharp      0.7.0-alpha.0  0.7.2            update
@ctxo/lang-go          0.8.0-alpha.0  0.8.0            update
@ctxo/lang-typescript  0.7.0-alpha.0  0.7.1            update

To update, run:
  pnpm add -D @ctxo/lang-csharp@0.7.2 @ctxo/lang-go@0.8.0 @ctxo/lang-typescript@0.7.1
```

When the strategy is `execute`, the closing block becomes `Plan: …` plus a
`Running...` line instead of `To update, run:`.

### JSON (`--json`)

Always a single document:

```json
{
  "ctxo": "0.7.0-alpha.0",
  "channel": "alpha",
  "packages": [
    { "name": "@ctxo/cli", "current": "0.7.0-alpha.0", "latest": "0.7.0-alpha.3", "channel": "alpha", "status": "update" },
    { "name": "ctxo-lang-kotlin", "current": "0.1.0", "latest": null, "channel": "latest", "status": "unknown", "reason": "registry-404" }
  ],
  "plan": {
    "manager": "pnpm",
    "managerSource": "lockfile",
    "managerDetail": "pnpm-lock.yaml",
    "global": false,
    "command": "pnpm",
    "args": ["add", "-D", "@ctxo/cli@0.7.0-alpha.3"]
  },
  "executed": true,
  "exitCode": 0
}
```

`executed` is `false` and `exitCode` is omitted in `--check` and `--print`
modes.

## Examples

::: code-group
```shell [check]
# Print the table + suggested command. Always exits 0.
npx @ctxo/cli update --check
```

```shell [apply]
# Default: run the install when the project has @ctxo/* in package.json,
# otherwise print the global command for the user to run.
npx @ctxo/cli update
```

```shell [print only]
# Useful for CI dashboards or pasting into a chat.
npx @ctxo/cli update --print
```

```shell [global]
# Force a global install regardless of project layout.
npx @ctxo/cli update --global
```

```shell [JSON]
npx @ctxo/cli update --check --json
```

```shell [override pm]
npx @ctxo/cli update --check --pm pnpm
```
:::

## Error handling

| Condition | Behavior |
| --- | --- |
| Every registry request fails (DNS, refused, all timing out) | Prints an error to stderr, exits `1` |
| A single package returns 404 (private fork, unpublished plugin) | Row renders as `skipped`, exit stays `0`, plan excludes that package |
| A package's `dist-tag` value contains shell metacharacters | Package is excluded from the install plan (defence-in-depth against a hostile registry response) |

Per-request timeout: **5 seconds**. Requests run in parallel via `Promise.all`,
so the slowest package bounds the total command time.

## CI behavior

::: warning Frozen lockfiles
When `CI=true` or `CI=1`, `ctxo update` refuses to mutate dependencies. The
report is still printed in the print-style block so users see exactly what
would be installed, and the command exits `1`. Override with `--force` or
switch to `--global`.
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Report printed; or `--check` / `--print` completed; or install succeeded |
| `1` | All registry fetches failed, CI guard refused, invalid `--pm` value, or the install command itself failed |
| other | Propagated from the underlying package manager |

## See also

- [`ctxo install`](./install.md) — initial plugin install (re-uses the same package-manager resolution).
- [`ctxo doctor`](./doctor.md) — diagnoses outdated plugin/API combinations.
- [`ctxo version`](./overview.md#command-summary) — print the installed core + plugin versions.
- [Environment variables](./env-vars.md) — `CTXO_PM` overrides manager detection.
