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

gate:
  enabled: true
  sensitivity: balanced

cochange:
  maxCommits: 2000        # number or "all"
  # since: 12m            # optional; d, w, m, y
  maxFilesPerCommit: 30
  minShared: 2
  include: []
  exclude: []
```

## Fields

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `version` | string or number | `"1.0"` | Schema version marker. Forward-compatible; unknown values are accepted. |
| `stats.enabled` | boolean | `true` | Session recording opt-out. Set `false` to disable local stats capture. |
| `index.ignore` | string[] | `[]` | Picomatch globs applied to file paths **after** `git ls-files`. |
| `index.ignoreProjects` | string[] | `[]` | Picomatch globs applied to workspace roots. Skipped workspaces are never enumerated. |
| `gate.enabled` | boolean | `true` | Enable or disable the safe-edit guard PreToolUse hook. |
| `gate.sensitivity` | `strict` \| `balanced` \| `lenient` | `balanced` | How aggressively the guard flags high-impact symbols. |
| `cochange.maxCommits` | positive integer or `"all"` | `2000` | Co-change window: the last N non-merge commits from HEAD. Independent of `ctxo index --max-history`. |
| `cochange.since` | string (`30d`, `2w`, `12m`, `1y`) | unset | Also limit the window by age, counted back from HEAD's committer date (never the wall clock). Applies together with `maxCommits`. |
| `cochange.maxFilesPerCommit` | positive integer | `30` | A commit touching more analysed files than this is skipped as a mass change and counted in `massSkipped`. |
| `cochange.minShared` | positive integer | `2` | A file pair becomes an entry only after this many shared commits. |
| `cochange.include` | string[] | `[]` | Picomatch globs for extra **tracked** files that no language plugin indexes (for example scripts) to analyse for co-change. |
| `cochange.exclude` | string[] | `[]` | Picomatch globs for indexed files to leave out of co-change. Also removes files that `include` added. |

### cochange

The `cochange` section controls the co-change matrix (`.ctxo/index/co-changes.json`) that `ctxo index` builds from one `git log` pass. The matrix feeds `get_blast_radius`, `get_pr_impact`, `get_context_for_task`, `ctxo blast-radius` and the safe-edit guard.

- **Window.** `maxCommits` takes the newest N non-merge commits from HEAD (`"all"` takes every one). `since` narrows that to commits made within the duration before HEAD's committer date: `d` days, `w` weeks, `m` calendar months, `y` calendar years. When both are set, both apply. The same HEAD and config always give the same matrix. `commitsScanned` counts every non-merge commit of the repository, so in a monorepo a numeric `maxCommits` covers fewer relevant commits than its value suggests.
- **Which files count.** The files Ctxo indexes, plus tracked files matching `include`, minus files matching `exclude`. `exclude` is applied last, so it also vetoes files that `include` added. Deleted files drop out, and renames are followed.
- **Which commits count.** Merge commits are left out of the log. A commit whose remaining file count exceeds `maxFilesPerCommit` is skipped and counted in `massSkipped`. A pair needs `minShared` shared commits and `shared / min(countA, countB) >= 0.1`.
- **Overrides.** `ctxo index --cochange-commits <n|all>` and `--cochange-since <duration>` override `maxCommits` and `since` for one run. An invalid value exits with an error instead of running a different window.
- **Recorded.** The applied window is written to `co-changes.json` under `window` (`maxCommits`, `since`, `head`, `commitsScanned`, `commitsUsed`, `massSkipped`, `maxFilesPerCommit`, `minShared`).
- **Sparse checkout.** Files outside the cone are absent from the matrix, and their committed index entries are never pruned.

`ctxo index --max-history` still controls how many commits each file keeps in `intent[]`, and nothing else.

### gate.sensitivity levels

| Level | PageRank percentile | Min dependents floor | Use case |
| --- | --- | --- | --- |
| `strict` | top 30% | 2 | Large shared codebases; flag nearly anything with dependents |
| `balanced` | top 15% | 3 | Default - catches genuinely high-impact symbols without too much noise |
| `lenient` | top 5% | 5 | Only block edits to truly critical symbols (god nodes, public APIs) |

Run `ctxo gate --preview` after changing `sensitivity` to see which symbols would be flagged.

Unknown fields at the root are ignored for forward compatibility. Unknown fields **inside** the `stats`, `index`, `gate`, or `cochange` sections are rejected as schema violations (typos surface immediately).

## Glob matching rules

`index.ignore`, `index.ignoreProjects`, `cochange.include` and `cochange.exclude` all use [picomatch](https://github.com/micromatch/picomatch) with `{ dot: true }`.

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
cochange:
  maxCommits: 2000
  maxFilesPerCommit: 30
  minShared: 2
  include: []
  exclude: []
```

## Error handling

| Condition | Behaviour |
| --- | --- |
| File missing | Silent; defaults used. |
| YAML parse error | `ctxo doctor` emits a **warning**; defaults used. |
| Schema violation (unknown field in `stats`/`index`/`gate`/`cochange`, wrong type, `maxCommits` that is not a positive integer or `"all"`, a `since` that is not a duration) | `ctxo doctor` emits a **fail**; defaults used. |
| Invalid glob pattern (`index.*` or `cochange.include`/`exclude`) | `ctxo doctor` emits a **warning**; the bad pattern is dropped, valid siblings still apply. |

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
- [`ctxo index`](/cli/index) - consumer of the `index.ignore` list and the `cochange` window
