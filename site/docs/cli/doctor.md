---
title: "ctxo doctor"
description: "Health check every subsystem."
---

# ctxo doctor

Runs a series of independent health checks against your project and
environment, then reports each result as `pass`, `warn`, or `fail`. With
`--fix`, it applies remediation in dependency order (config first, plugins and
index last).

## Synopsis

```shell
npx ctxo doctor [options]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--json` | `false` | Emit the full report as JSON on stdout |
| `--quiet` | `false` | Only print failures and warnings |
| `--fix` | `false` | Apply remediation for auto-fixable failures |
| `--dry-run` | `false` | Only with `--fix`. Print planned actions, do not execute |
| `--yes`, `-y` | `false` | Only with `--fix`. Required in CI (`CI=true`) to apply changes |

## Checks run

| Check | What it verifies |
| --- | --- |
| Versions | Core vs. plugin API compatibility |
| Node version | Node >= 20 |
| Git binary | `git` is on `PATH` |
| Git repo | cwd is inside a git working tree |
| Index directory | `.ctxo/index/` exists and is readable |
| Index freshness | JSON index matches source hashes |
| SQLite cache | `.ctxo/.cache/symbols.db` present and usable |
| Config file | `.ctxo/config.yaml` is valid YAML and conforms to the schema |
| ts-morph, tree-sitter | Runtime parsers load |
| Language coverage | Every detected language has a registered plugin |
| Disk usage | Free space sufficient for the index |
| Symbol / Edge count | Sanity bounds |
| Orphaned files | No stale entries in `.ctxo/index/` |
| Co-changes cache | Present and readable |
| Schema version | Matches the current core |

## Remediation order (`--fix`)

`--fix` applies attempts in dependency order, skipping later steps when an
earlier one fails:

1. **Config** — write a default `.ctxo/config.yaml` if missing or invalid.
2. **Git hooks** — install `post-commit` and `post-merge` hooks.
3. **Language coverage** — run [`ctxo install`](./install.md) for missing plugins.
4. **Index** — run [`ctxo index`](./index.md) (requires step 3 to have succeeded).
5. **SQLite cache** — run [`ctxo sync`](./sync.md).

Every attempt is appended to `.ctxo/doctor-fix.log` for forensics.

::: warning CI safety
`--fix` refuses to mutate anything under `CI=true` unless you pass `--yes`.
This keeps the command safe to expose in shared scripts.
:::

## Examples

::: code-group
```shell [human report]
npx ctxo doctor
```

```shell [quiet]
# Only print non-passing checks — good for shell prompts.
npx ctxo doctor --quiet
```

```shell [machine readable]
# Pipe to jq for dashboards.
npx ctxo doctor --json | jq '.checks | map(select(.status != "pass"))'
```

```shell [dry-run fix]
npx ctxo doctor --fix --dry-run
```

```shell [apply fixes in CI]
npx ctxo doctor --fix --yes
```
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | All checks passed |
| `1` | One or more checks failed |
| `2` | `--fix` halted before completing (a dependency step failed) |

## See also

- [`ctxo install`](./install.md), [`ctxo index`](./index.md),
  [`ctxo sync`](./sync.md) — the individual commands `--fix` orchestrates.
- [.ctxo/config.yaml reference](./config-yaml.md).
