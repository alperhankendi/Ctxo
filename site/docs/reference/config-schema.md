---
title: "Config Schema"
description: ".ctxo/config.yaml full reference."
---

# Config Schema

`.ctxo/config.yaml` is the committed team-level configuration for Ctxo. It is optional; every field has a default and the file itself can be absent. When invalid, the loader warns and falls back to defaults (warn-and-continue). Field-level problems surface through [`ctxo doctor`](/cli/doctor).

## File location

```
<repo-root>/.ctxo/config.yaml
```

The `.ctxo/` directory also holds the committed `index/` tree and the gitignored `.cache/` SQLite. See [`ctxo config.yaml`](/cli/config-yaml) for the CLI-facing view of this file.

## Full schema

```yaml
version: "1.0"

stats:
  enabled: true

index:
  ignore:
    - "packages/**/fixtures/**"
    - "tools/legacy-*/**"
  ignoreProjects:
    - "packages/experimental-*"
    - "examples/*"
```

## Fields

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `version` | string or number | `"1.0"` | Schema version marker. Forward-compatible; unknown values are accepted. |
| `stats.enabled` | boolean | `true` | Session recording opt-out. Set `false` to disable local stats capture. |
| `index.ignore` | string[] | `[]` | Picomatch globs applied to file paths **after** `git ls-files`. |
| `index.ignoreProjects` | string[] | `[]` | Picomatch globs applied to workspace roots. Skipped workspaces are never enumerated. |

Unknown fields at the root are ignored for forward compatibility. Unknown fields **inside** the `stats` or `index` sections are rejected as schema violations (typos surface immediately).

## Glob matching rules

`index.ignore` and `index.ignoreProjects` both use [picomatch](https://github.com/micromatch/picomatch) with `{ dot: true }`.

- Patterns are matched against **repo-relative, forward-slash paths**. Backslashes are normalised before matching.
- `index.ignore` runs per file, after the git-tracked file list is produced.
- `index.ignoreProjects` runs against workspace roots during discovery. A matched workspace is never visited, and its plugin dependencies are never imported.

```yaml
index:
  ignore:
    - "**/*.generated.ts"      # extension match anywhere
    - "packages/**/dist/**"    # nested directories
    - "!packages/core/dist/**" # negation also supported
```

## Defaults

When `config.yaml` is missing, unreadable, or invalid, Ctxo uses:

```yaml
version: "1.0"
stats:
  enabled: true
index:
  ignore: []
  ignoreProjects: []
```

## Error handling

| Condition | Behaviour |
| --- | --- |
| File missing | Silent; defaults used. |
| YAML parse error | `ctxo doctor` emits a **warning**; defaults used. |
| Schema violation (unknown field in `stats`/`index`, wrong type) | `ctxo doctor` emits a **fail**; defaults used. |
| Invalid glob pattern | `ctxo doctor` emits a **warning**; the bad pattern is dropped, valid siblings still apply. |

All failure modes follow the warn-and-continue rule: indexing never aborts because of a config problem. The loaded config is available to core code as a `LoadedConfig` record with `errors` and `invalidGlobs` arrays for diagnostic consumers.

::: tip
Run `ctxo doctor` after editing `config.yaml` to surface every warning and fail in one report.
:::

::: warning
Do not use `index.ignore` to exclude files from a language plugin's parser. Plugins operate on the files Ctxo hands them; filtering happens at the index layer, not at the parser.
:::

## See also

- [`ctxo config.yaml`](/cli/config-yaml) - CLI-facing summary
- [`ctxo doctor`](/cli/doctor) - surfaces config warnings and schema fails
- [`ctxo index`](/cli/index) - consumer of the `index.ignore` list
