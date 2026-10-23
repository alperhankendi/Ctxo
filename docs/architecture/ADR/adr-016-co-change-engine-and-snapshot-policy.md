# ADR-016: Co-change Engine, Incremental Indexing, and Snapshot Policy

| Field | Value |
|---|---|
| **Status** | Accepted (`@ctxo/cli`, PR 0 of the domain knowledge layer) |
| **Date** | 2026-10-21 |
| **Deciders** | Alper Hankendi |
| **Decision** | Build co-change from one `git log` pass with its own window (independent of `--max-history`), re-index one commit at a time with `ctxo index --commit HEAD` from a versioned post-commit hook, keep one community snapshot per commit, count drift and boundary confidence in distinct commits, and give every blast-radius caller the same co-change matrix. |
| **Relates to** | [#157](https://github.com/alperhankendi/Ctxo/issues/157), [ADR-001](adr-001-storage-split-json-index-sqlite-cache.md), [ADR-012](adr-012-plugin-architecture-and-monorepo.md), [ADR-015](adr-015-safe-edit-guard.md) |

---

## Context

Co-change (files that change together in git history) is the cheapest signal Ctxo has for coupling that no import edge shows. Reading the code for issue #157 showed that the signal was broken at every step, and that the repair touches the index, the hook, the snapshots and the blast radius at once, so the decisions belong in one record.

What was wrong (each point verified in code or on this repository):

1. **The post-commit hook emptied the matrix.** The v1 hook ran `ctxo index --file <path>` once per changed file. `--file` aggregated co-change over that one file and overwrote `co-changes.json` with `[]`. Ctxo's own committed matrix went from 1126 entries to 0.
2. **Co-change depth was a side effect of `--max-history`.** The matrix was derived from `intent[]` (20 commits per file out of the newest 1000 repository commits). There was no `--follow`, no cap on the files per commit and no way to widen the window without also changing the per-file history.
3. **`--file` damaged more than the matrix.** It emptied the SQLite cache (`initEmpty` plus `bulkWrite([X])`), built `boundary-violations.json` from a one-file graph, and read the commit SHA through a Promise used as a string.
4. **One commit filled the snapshot history.** `writeSnapshot` archived the previous snapshot on every run with no same-SHA check. On commits of this branch the v1 hook wrote up to 10 snapshots for a single SHA in about 11 s and evicted the 11 older history files. Drift and boundary confidence counted snapshot files, so one busy commit made the confidence read `high`.
5. **Only `get_pr_impact` loaded co-change.** `get_blast_radius`, `ctxo blast-radius`, `gate-hook`, `gate --preview` and `get_context_for_task` called the calculator without it, although the tool description promised "likely (co-changed)".
6. **Hooks could not be upgraded and ignored `core.hooksPath`.** `installHook` returned early when the marker existed, so a changed hook never reached existing installs.
7. **The docs claimed `ctxo index --check` builds snapshot history.** It writes nothing.

---

## Decision

### 1. One git pass for intent and co-change

A new git port method, `getChangeLog(maxCommits)`, runs one `git log --no-merges -M --name-status -z` over the commits reachable from HEAD, newest first. HEAD is read first in its own call (the log skips merge commits and HEAD may be one), so a commit that lands between the two calls can only make the recorded `head` look stale, never current. The result feeds both the per-file `intent[]` and the co-change matrix. The analyzer stays pure: it receives a parsed change log and never touches git.

### 2. A window that is independent of `--max-history` (K5)

The co-change window has its own settings (`cochange` in `.ctxo/config.yaml`, `--cochange-commits`, `--cochange-since`):

- `maxCommits`: the last N non-merge commits from HEAD (default 2000) or `all`.
- `since`: a duration (`30d`, `2w`, `12m`, `1y`) counted back from **HEAD's committer date**, never from the wall clock. Both limits apply when both are set.
- `maxFilesPerCommit` (default 30), `minShared` (default 2), and the unchanged entry rule `frequency = shared / min(countA, countB) >= 0.1`.
- `include` adds tracked files that no language plugin indexes (for example scripts); `exclude` leaves indexed files out. `exclude` wins when both match, so it also vetoes files that `include` added.
- `--max-history` keeps controlling `intent[]` depth only. The fetch size is `max(window, maxHistory * 50)`, or `all`.

`co-changes.json` records the applied window (`maxCommits`, `since?`, `head`, `commitsScanned`, `commitsUsed`, `massSkipped`, `maxFilesPerCommit`, `minShared`). The file is rewritten only when its entries or window change; the timestamp alone never causes a write.

`commitsScanned` counts every non-merge commit of the repository, so in a monorepo a numeric `maxCommits` covers fewer relevant commits than its value suggests.

### 3. Merge commits are excluded; mass commits are skipped and counted

Merge commits never list files and are left out of the log altogether (`--no-merges`), so they appear in neither `commitsScanned` nor any other count. A commit whose remaining file count (after filtering to indexed and included files) exceeds `maxFilesPerCommit` is skipped and counted in `massSkipped`. A commit with no remaining file is ignored.

### 4. The rename map is shared with `intent[]`

Processing runs newest first and keeps a canonical rename map: a path renamed later maps to its newest name. Co-change and `intent[]` both use it, so history follows a file across renames. Consequence for users: `ctxo verify-index` compares the committed index with a fresh one, so after an upgrade it reports files with a rename in their history as STALE until the next index, because their `intent[]` changed.

### 5. Incremental indexing and the `--commit` hook

- `ctxo index --files <path...>` re-indexes an explicit list; `--file` stays as an alias; `--commit <rev>` re-indexes the files one commit changed (deleted files and old rename names are removed). Candidates pass the same filters as a full run (plugin, `index.ignore`, workspaces, `index.ignoreProjects`).
- An incremental run loads the symbol registry from the committed JSON of all other files, writes only the touched files' JSON, and computes everything global (co-change, communities, snapshot, drift and boundary artifacts) from the **merged** index.
- SQLite is **rebuilt from the merged index** (`initEmpty` plus `bulkWrite(merged)`) and never from the touched files alone. That fixes the empty cache after `--file`.
- A full run uses only the files it discovered. It prunes the JSON of deleted or newly ignored sources, never of skip-worktree paths (sparse checkout), and prunes nothing when the skip-worktree query fails.
- The post-commit block is versioned (`# ctxo-start v2`) and runs `ctxo index --commit HEAD` **once per commit**, guarded by `[ -d .ctxo ]` and `command -v ctxo`. `ctxo init` and `ctxo doctor --fix` replace an existing block in place (old unversioned blocks included), collapse duplicate blocks into one, and resolve the hooks directory with `git rev-parse --git-path hooks`, so `core.hooksPath` works.
- **Owner decision K23: refuse shared hooks directories.** When `core.hooksPath` is set in the global or system git config, the directory is shared by every repository on the machine. ctxo then writes nothing, prints the two blocks to add by hand and the `git config --local core.hooksPath` alternative, and continues. The `[ -d .ctxo ]` guard makes a hand-added block harmless in repositories that do not use ctxo. Scope detection (`git config --show-scope`) needs git 2.26 or newer; on an older git the directory is treated as not shared.
- A new `git_hooks` doctor check warns on a missing, outdated or duplicated block (this also revives the dead `git_hooks` fix mapping).

### 6. One snapshot per commit

- When the current `communities.json` has the same `commitSha` as the new snapshot, the new one replaces it without archiving. History holds at most one snapshot per commit; `nocommit` handling is unchanged.
- `listHistory` de-duplicates by `commitSha` at read time (newest file wins) and rotation removes older copies, so existing repositories get correct numbers without a migration. The first write after an upgrade physically removes the older same-commit duplicates from `communities.history/` (this repository went from 11 files to 5). No information is lost: the copies were of the same commit.
- Drift compares against the newest history entry whose `commitSha` differs from the current one.

### 7. Confidence counts distinct commits

Drift and boundary results keep `snapshotsAvailable` (the number of history entries passed in, for compatibility) and add `distinctCommits` (distinct SHAs other than the current commit). Confidence uses `distinctCommits` with the existing thresholds: fewer than 3 is `low`, 3 to 6 is `medium`, 7 or more is `high`. Boundary violations need at least 2 distinct commits before a missing historical edge counts as evidence. The hints no longer suggest `ctxo index --check`, which records no snapshot.

### 8. Every blast-radius caller uses co-change; `coChangedFiles` is informational

One adapter-level reader (`CoChangeReader`) validates `co-changes.json` with a zod schema, caches it by mtime and size, and hands out a frozen `Map<file, CoChangeEntry[]>`. `get_blast_radius`, `get_pr_impact`, `get_context_for_task`, `ctxo blast-radius`, `gate-hook` and `gate --preview` all pass it to `BlastRadiusCalculator`. The tiering rule is unchanged: a `potential` dependent whose file co-changes with the root symbol's file at `frequency > 0.5` becomes `likely`. `coChangeFrequency` is therefore filled on impacted symbols.

`get_blast_radius` and `ctxo blast-radius` add `coChangedFiles`: up to 10 files that co-change with the root's file at `frequency >= 0.5` but have no graph path to it. It is informational: not counted in tiers, risk scores or the gate. `get_context_for_task` entries that depend on the symbol carry an optional `confidence` tier.

The safe-edit gate counts `confirmed + likely` dependents ([ADR-015](adr-015-safe-edit-guard.md)), so co-change-upgraded dependents count and the gate may fire somewhat more often. That is the intent of #156.

---

## Alternatives considered

### Incremental matrix merge

Keep the stored matrix and add only the new commit's pairs on each `--commit` run. Rejected: the window slides (the oldest commit leaves it), a rename re-keys the pairs of earlier commits, a config change needs a full recompute anyway, and a stale or hand-edited file would be trusted. Recomputing from git gives one rule: the same HEAD and the same config always give the same matrix. The recompute is cheap (see the evidence), so the saving did not justify the risk.

### Time windows anchored to the wall clock

`--since "12 months ago"` relative to now. Rejected: the same commit would produce a different matrix next week, which breaks the determinism rule and makes `co-changes.json` churn in git. The duration is counted back from HEAD's committer date instead.

### A per-file `git log --follow`

Rejected: it starts one git process per indexed file (thousands on a real repository), `--follow` is a single-path heuristic, and the renames it finds for one file cannot be shared with other files or with the pair counting. One pass with one rename map is faster, consistent with `intent[]`, and reproduces the oracle exactly where the oracle can see (evidence below).

### `--topo-order` hardening (considered, not adopted)

The canonical rename map walks the log newest first and relies on git's default order, in which a child normally comes before its parent. Clock skew can break that guarantee, and `--topo-order` would restore it at the price of a full graph walk before the first line is printed. Not adopted: the default order reproduced the oracle exactly on the fixture (the positive control below). Revisit if a repository shows renames resolved to a stale name.

---

## Evidence

Validated against a private production repository (826 indexed source files plus 44 script files brought in through `cochange.include`, 1643 non-merge commits on the main line), with the dev build of this branch. The oracle is an independent script with the same filter rules, run on the same set of 553 files. Aggregate numbers only.

### Co-change matrix against the oracle

| | Ctxo | Oracle |
|---|---|---|
| Commits scanned | 1643 (whole history from HEAD) | 1077 (pathspec-limited log) |
| Commits used | 976 | 970 |
| Mass commits skipped (more than 30 files) | 4 | 3 |
| File pairs | 1431 | 1431 (same set) |
| Unit pairs (the oracle's grouping) | 948 | 948 (same set) |

- 1418 of 1431 file pairs have the same shared count and frequency. The 13 that differ are 2 with a shared count one higher and 11 with the same shared count but a different frequency, because a file's commit count changed. 947 of 948 unit pairs have the same shared count.
- Every difference comes from 7 commits that only Ctxo sees: 6 touch only paths outside the oracle's pathspec (from before a folder restructure; their files were renamed into scope later, and Ctxo follows those renames) and 1 side-branch commit that git's default history simplification drops from the pathspec log.
- Positive control: the oracle's logic with the old root added to its pathspec and `--full-history` reproduces Ctxo exactly (976 used, 4 skipped, the same 1431 entries with the same values).

### The post-commit hook (v2) and `--commit`

- A commit that changed 3 source files re-indexed exactly 3 per-file entries, never the other 823. `co-changes.json` changed only in pairs that involve the commit's files: 47 of 1431 entries (3 pairs inside the commit gained one shared commit, 44 changed only their frequency), and the window moved from 976 to 977 used commits. A second and third run at the same commit left the file byte-identical.
- One history entry per commit: the first run at the new commit archived the previous commit's snapshot as the one new entry, and six further runs at the same commit (a manual run, the hook script, three `--file` runs and one debug run) archived nothing. `distinctCommits` went from 0 to 1 after the new commit, equal to the number of distinct SHAs in `communities.history/` other than the current commit. Before the fix, history held 2 snapshots of HEAD and the artifacts reported `snapshotsAvailable: 2`; an earlier build had once reported 163 drift events against a snapshot of the same commit.

### Timings (dev build, Windows)

| Measurement | Time |
|---|---|
| Full `ctxo index` | 25.5 s cold, 19.4 s warm |
| Co-change git calls alone (change log of all commits, HEAD read, `ls-files`) | 0.25 s |
| Co-change phase inside a `--commit` run | at most 0.35 s |
| `ctxo index --commit HEAD`, 3 changed files | 18.1 to 18.5 s |
| Old per-file loop (`--file` once per changed file) | 55.2 s |

The commit run is **3.0x faster** than the per-file loop. The gain does not come from the co-change pass; it comes from paying the full-tier analyzer's whole-project batch (about 16 s) **once per commit** instead of once per file. The co-change pass costs well under the 2 s budget that would have justified a `.ctxo/.cache/cochange-log.json` cache, so no cache was built.

---

## Consequences

### Positive

- The hook no longer erases the matrix, the cache or the boundary artifact, and costs one analyzer batch per commit.
- Co-change depth is configurable and recorded; the same HEAD and config always give the same matrix.
- History follows renames, in `intent[]` and in co-change.
- Confidence means what it says: a busy commit cannot manufacture `high`.
- Every blast-radius path (tools, CLI, gate) sees the same co-change data.
- Existing installs upgrade in place (`ctxo init`, `ctxo doctor --fix`), and a machine-wide hooks directory is never written to.

### Negative / accepted trade-offs

- **Sparse checkout:** files outside the cone are absent from the co-change matrix. Their committed index entries are never pruned.
- **The gate may fire somewhat more often**, because co-change-upgraded dependents count toward `confirmed + likely`. `ctxo gate --preview` shows the effect before it matters.
- **History healing on upgrade:** the first write after upgrading removes older same-commit duplicates from `communities.history/`.
- **`verify-index` reports files with a rename in their history as STALE** after an upgrade, until the next index, because `intent[]` now follows renames.
- **Scope detection needs git 2.26 or newer**; older git treats the hooks directory as not shared.
- **Single-file runs can mis-resolve some TypeScript edges.** With only the changed file loaded, an `extends` or `implements` edge to an extensionless import can resolve to `src/base::Base::class` where a full run gives `src/base.ts::Base::class`. This already affected `--file`, now also affects `--files` and `--commit`, and is tracked in the roadmap as an adapter follow-up. A periodic full `ctxo index` corrects it.
- The CLI tarball size limit was raised from 1350 KB to 1450 KB on this branch (final measured size 1420.70 KB), per the established practice of raising it with the measured size when a PR crosses it. Sourcemaps keep shipping.

### Deferred

- A co-change log cache keyed by SHA. Not needed at 0.25 s; add it if a repository's pass exceeds 2 s.
