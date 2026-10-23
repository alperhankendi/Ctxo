---
title: "ctxo index"
description: "Build the full codebase index."
---

# ctxo index

Builds the full codebase index. For every source file tracked by git (and not
filtered by [`index.ignore`](./config-yaml.md)), ctxo extracts symbols and
edges via the registered language plugins, reads git history once for intent,
anti-pattern detection and the co-change matrix, and writes:

- `.ctxo/index/<path>.json` - one JSON document per source file (committed).
- `.ctxo/index/co-changes.json` - files that change together, from a window of recent commits (committed).
- `.ctxo/index/communities.json` plus `communities.history/` - the current community snapshot and one snapshot per earlier commit (committed).
- `.ctxo/index/contexts-view.json` - candidate bounded contexts, computed from the merged index, the co-change matrix and the community snapshot (committed). Skipped by `--skip-community`. Read it with [`ctxo contexts`](./contexts.md).
- `.ctxo/.cache/symbols.db` - local SQLite cache (gitignored, rebuilt from JSON).

Supports monorepos: if `package.json` declares `workspaces`, each workspace is
discovered and indexed.

## Synopsis

```shell
ctxo index [options]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--check` | `false` | CI gate. Does not write anything and records no community snapshot. Exits `1` if any file is stale, missing, or deleted |
| `--files <path...>` | | Incremental re-index of these repo-relative files; takes every value up to the next flag and can be repeated. The rest of the index is kept |
| `--file <path>` | | Older spelling of `--files` with one path |
| `--commit <rev>` | | Incremental re-index of the files the commit changed (for example `HEAD`, the commit just made). Files it deleted or renamed away are removed from the index. Used by the `post-commit` hook |
| `--skip-history` | `false` | Skip git history collection. Produces an index without intent or anti-patterns and leaves `co-changes.json` as it is, but runs faster |
| `--max-history <N>` | `20` | Limit the number of commits kept per file in `intent[]`. Controls intent depth only; it does not change the co-change window |
| `--cochange-commits <n\|all>` | `2000` | Co-change window in commits (the last N non-merge commits from HEAD), or `all`. Overrides `cochange.maxCommits` |
| `--cochange-since <duration>` | | Also limit the co-change window by age, counted back from HEAD's committer date: `30d`, `2w`, `12m`, `1y`. Overrides `cochange.since` |
| `--skip-community` | `false` | Skip community detection (no new snapshot for this run) and the contexts view (`contexts-view.json` is left as it is) |
| `--install-missing` | `false` | Before indexing, detect languages in the repo and install any missing plugins |

## Examples

::: code-group
```shell [full index]
ctxo index
```

```shell [CI gate]
# Fail the build if the committed index has drifted from source.
ctxo index --check
```

```shell [fast re-index]
# Skip git history. Useful on a fresh clone, or in hot-path benchmarks.
ctxo index --skip-history
```

```shell [bounded history]
ctxo index --max-history 5
```

```shell [bootstrap]
# Install detected plugins, then index in one command.
ctxo index --install-missing
```

```shell [some files]
# Re-index only these files; everything global is still recomputed from the whole index.
ctxo index --files packages/cli/src/core/logger.ts packages/cli/src/core/types.ts
```

```shell [one commit]
# What the v2 post-commit hook runs, once per commit.
ctxo index --commit HEAD
```

```shell [co-change window]
# Look at the last 500 commits, and only those from the last 12 months before HEAD.
ctxo index --cochange-commits 500 --cochange-since 12m
```
:::

## Incremental runs (`--files`, `--commit`)

`--files` and `--commit` re-index only the files they name (or the commit
changed) and keep every other entry of the committed index. They still compute
everything global from the **merged** index (the untouched committed entries
plus the fresh ones), never from the touched files alone:

- Cross-file edges resolve against the symbol registry of the committed index.
- The SQLite cache is rebuilt from the merged index.
- The co-change matrix is recomputed from git for the whole repository.
- Communities, the snapshot, the drift and boundary artifacts and the contexts
  view come from the full graph.

A path is indexed only if a full run would index it: a registered language
plugin handles it, `index.ignore` and `index.ignoreProjects` do not exclude it,
and it lies inside a discovered workspace. `--commit` reads the commit's file
list itself (`git diff-tree`), so spaces, deletions, renames and the first
commit work; a merge commit lists no files, so nothing is re-indexed but the
co-change matrix and the snapshot still follow the new HEAD. An unknown
revision exits `1` before any plugin loads.

A full `ctxo index` uses only the files it discovers. It also removes the index
entries of sources that were deleted or are now ignored, but never the entries
of paths git marks skip-worktree (sparse checkout), and nothing is removed when
that query fails.

## Co-change window

`co-changes.json` is built from one `git log` pass, with its own window
(`cochange` in [config.yaml](./config-yaml.md), `--cochange-commits`,
`--cochange-since`). The window is independent of `--max-history`, is anchored
to HEAD (never the wall clock), and is recorded in the file under `window`.
Merge commits are left out of the log. Commits that touch more than
`maxFilesPerCommit` (default 30) analysed files are skipped and counted in
`massSkipped`. The file is rewritten only when its entries or
window change. In a sparse checkout, files outside the cone are absent from the
matrix. See the [`cochange` reference](/reference/config-schema#cochange).

History follows renames: after a rename, a file keeps its `intent[]` and its
co-change pairs. Because `intent[]` changed, `ctxo verify-index` (which compares
the committed index with a fresh one) reports files with a rename in their
history as `STALE` until the next `ctxo index` after upgrading.

## Snapshots

Each run records at most one community snapshot per commit. Running `ctxo index`
twice on the same commit replaces the current snapshot instead of adding a
history entry, so drift and boundary confidence count distinct commits. The
first write after upgrading removes older same-commit duplicates from
`communities.history/` (no information is lost). `--check` records no snapshot.

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
- [`ctxo contexts`](./contexts.md) - show the candidate contexts `ctxo index` computed.
- [`ctxo status`](./status.md) — inspect the existing index.
- [`ctxo sync`](./sync.md) — rebuild the SQLite cache without re-parsing sources.
- [.ctxo/config.yaml](./config-yaml.md) — `index.ignore` and `index.ignoreProjects`
  globs are honored by `ctxo index`.
