---
title: "config.yaml reference"
description: "The .ctxo/config.yaml schema: ignore globs, stats, defaults."
---

# .ctxo/config.yaml reference

The project configuration file. Lives at `.ctxo/config.yaml` and is committed
to git so the whole team shares the same settings. Every field is optional and
has a sensible default, so this file can be omitted entirely.

`ctxo init` drops a default file with commented-out examples. Invalid YAML,
schema violations, or unreadable files fall back to the built-in defaults and
emit a warning via `ctxo doctor` (warn-and-continue — ctxo never refuses to
run because of config).

## Schema

```yaml
version: "1.0"

stats:
  # Opt out of local MCP session recording. Default: true (recording on).
  enabled: true

index:
  # Per-file filter applied AFTER `git ls-files`. Matching files are
  # tracked by git but never indexed. Forward-slash paths relative to repo root.
  ignore:
    - "packages/**/fixtures/**"
    - "tools/legacy-*/**"

  # Workspace filter applied to monorepo workspace roots. Matching workspaces
  # are skipped entirely — their plugin deps are never imported and no files
  # are enumerated.
  ignoreProjects:
    - "packages/experimental-*"
    - "examples/*"
```

## Fields

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `version` | string | `"1.0"` | Schema version. Reserved for forward compatibility |
| `stats.enabled` | boolean | `true` | When `false`, disables local MCP session recording |
| `index.ignore` | string[] | `[]` | picomatch globs. Per-file filter applied after `git ls-files` |
| `index.ignoreProjects` | string[] | `[]` | picomatch globs. Applied to workspace roots in monorepos. Skipped workspaces are never enumerated and their plugin deps are never imported |

## Glob examples

```yaml
index:
  ignore:
    # Skip a single directory anywhere in the tree
    - "**/__snapshots__/**"

    # Skip a single file
    - "packages/cli/src/generated/types.d.ts"

    # Skip everything under a top-level folder
    - "vendor/**"

  ignoreProjects:
    # Skip all workspaces under examples/
    - "examples/*"

    # Skip any workspace whose name starts with "experimental-"
    - "packages/experimental-*"
```

All patterns use picomatch syntax and are matched against forward-slash paths
relative to the repo root. Windows backslashes are normalized automatically.

## Validation and fallback

| Failure | Behavior |
| --- | --- |
| File missing | Use defaults silently |
| File unreadable or not valid YAML | Warn, use defaults |
| Schema violation (for example `index.ignore: "x"` instead of a list) | Warn, use defaults |
| A single glob is invalid | Drop that pattern, keep the rest, warn |

`ctxo doctor` surfaces every warning with a `Config` check so invalid files do
not fail silently over time.

## Location and gitignore

| Path | Committed? | Purpose |
| --- | --- | --- |
| `.ctxo/config.yaml` | yes | This file — team settings |
| `.ctxo/index/` | yes | Per-file JSON index |
| `.ctxo/.cache/` | no (gitignored) | SQLite cache, rebuilt from `index/` |

::: tip Keep it committed
`config.yaml` is per-project, not per-user. Commit it so every contributor and
CI job sees the same ignore set.
:::

## See also

- [`ctxo init`](./init.md) — creates the default file.
- [`ctxo index`](./index.md) — consumes `index.ignore` and `index.ignoreProjects`.
- [`ctxo doctor`](./doctor.md) — surfaces invalid-glob and schema warnings.
