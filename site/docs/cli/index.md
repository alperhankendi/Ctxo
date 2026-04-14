---
title: "ctxo index"
description: "Build the full codebase index."
---

# ctxo index

Builds the full codebase index. For every source file tracked by git (and not
filtered by [`index.ignore`](./config-yaml.md)), ctxo extracts symbols and
edges via the registered language plugins, aggregates git history for intent
and anti-pattern detection, and writes:

- `.ctxo/index/<path>.json` — one JSON document per source file (committed).
- `.ctxo/.cache/symbols.db` — local SQLite cache (gitignored, rebuilt from JSON).

Supports monorepos: if `package.json` declares `workspaces`, each workspace is
discovered and indexed.

## Synopsis

```shell
npx ctxo index [options]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--check` | `false` | CI gate. Does not write anything. Exits `1` if any file is stale, missing, or deleted |
| `--file <path>` | | Incremental re-index of a single file. Used by the `post-commit` hook |
| `--skip-history` | `false` | Skip git history collection. Produces an index without intent or anti-patterns, but runs faster |
| `--max-history <N>` | `20` | Limit the number of commits collected per file |
| `--install-missing` | `false` | Before indexing, detect languages in the repo and install any missing plugins |

## Examples

::: code-group
```shell [full index]
npx ctxo index
```

```shell [CI gate]
# Fail the build if the committed index has drifted from source.
npx ctxo index --check
```

```shell [fast re-index]
# Skip git history. Useful on a fresh clone, or in hot-path benchmarks.
npx ctxo index --skip-history
```

```shell [bounded history]
npx ctxo index --max-history 5
```

```shell [bootstrap]
# Install detected plugins, then index in one command.
npx ctxo index --install-missing
```

```shell [single file]
# Invoked by the post-commit hook; runs in milliseconds.
npx ctxo index --file packages/cli/src/core/logger.ts
```
:::

## Staleness detection (`--check`)

`--check` iterates every git-tracked source file and compares it to the
committed index:

1. **Fast path** — if the file mtime is at or below `lastModified` in the
   index, the file is considered fresh.
2. **Slow path** — if mtime has changed but the content hash matches the
   stored `contentHash`, the file is still considered fresh. This avoids
   false positives after `git checkout`, `cp -p`, and CI clone.

Any file missing from the index, present in the index but deleted from disk,
or with a mismatched content hash is reported as stale.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Index written, or `--check` found no drift |
| `1` | `--check` found stale/missing files, or a flag validation error |

## See also

- [`ctxo watch`](./watch.md) — keep the index fresh during development.
- [`ctxo status`](./status.md) — inspect the existing index.
- [`ctxo sync`](./sync.md) — rebuild the SQLite cache without re-parsing sources.
- [.ctxo/config.yaml](./config-yaml.md) — `index.ignore` and `index.ignoreProjects`
  globs are honored by `ctxo index`.
