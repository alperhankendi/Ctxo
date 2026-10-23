# ADR-016: Co-change Engine, Incremental Indexing, and Snapshot Policy

| Field | Value |
|---|---|
| **Status** | Accepted (`@ctxo/cli`, PR 0 of the domain knowledge layer) |
| **Date** | 2026-10-21 |
| **Deciders** | Alper Hankendi |
| **Decision** | Build co-change from one `git log` pass with its own window (independent of `--max-history`), re-index one commit at a time with `ctxo index --commit HEAD` from a versioned post-commit hook, keep one community snapshot per commit, count drift and boundary confidence in distinct commits, and give every blast-radius caller the same co-change matrix. |
| **Relates to** | [#157](https://github.com/alperhankendi/Ctxo/issues/157), [#156](https://github.com/alperhankendi/Ctxo/issues/156) (addendum), [ADR-001](adr-001-storage-split-json-index-sqlite-cache.md), [ADR-012](adr-012-plugin-architecture-and-monorepo.md), [ADR-015](adr-015-safe-edit-guard.md) |

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

---

## Addendum: Contexts view defaults (PR 1A)

Date: 2026-10-22. Relates to [#156](https://github.com/alperhankendi/Ctxo/issues/156) (Phase 1 of the domain knowledge layer). PR 1A builds the **contexts view** on top of this ADR's co-change matrix: file-level candidate contexts written to `.ctxo/index/contexts-view.json` by `ctxo index`, read through `get_architectural_overlay({ mode: "contexts" })` and `ctxo contexts`. This addendum records the defaults, the rulings made while building it, the evidence, and one measured experiment that was left out.

### Defaults (K4)

| Setting | Default | Notes |
|---|---|---|
| `contextsView.weights.dependency` / `.coChange` | 1.0 / 1.0 | edge weight `w = dependency * dep + coChange * co` |
| `contextsView.hubs.auto` | `true` | fan-in hubs and god nodes |
| `contextsView.hubs.topPercent` | 1 | a fan-in hub is in the top 1% of files by distinct dependent files |
| `contextsView.hubs.minDependents` | 10 | and has at least this many dependent files |
| `contextsView.resolution` | 1.0 | file-graph Louvain |
| `contextsView.minCandidateFiles` | 3 | smaller groups fold into a neighbour |
| `communities.resolution` / `godNodeMinBridged` / `godNodeMaxResults` | 1.0 / 3 / 25 | symbol-level Louvain, now configurable |
| `index.tests` | `[]` | extra test globs on top of the shared default list |

- **Nodes** are indexed non-test files (minus `index.ignore` and `contextsView.exclude`) plus co-change-only files brought in by `cochange.include`. Files missing from the working tree are never nodes.
- **Dependency weight** counts distinct symbol edges between a file pair in both directions (1.0 for `calls`, `extends`, `implements`, `uses`; 0.5 for `imports`) and normalises as `log2(1 + count) / log2(1 + maxCount)`. **Co-change weight** is the pair's `frequency`.
- **Hub damping** multiplies every edge touching a hub by `1 / log2(2 + dependents)`. Files matching `hubs.paths` lose all their edges.
- **Clustering** is Louvain with the same determinism measures as the symbol-level detector, then `splitDisconnectedCommunities`, then folding of groups below `minCandidateFiles`.

### Designer calls

The spec left these open; they are decided as follows and the owner may override them.

1. Co-change-only files are nodes, which gives the co-change-only view on repositories without a language plugin.
2. File-level PageRank is the sum of the file's symbol PageRank scores from the run that feeds community detection.
3. The fan-in cut is `max(1, ceil(nodes * topPercent / 100))` files and includes every file tied with the last; an edge between two hubs takes both factors; a configured hub has damping 0; a hub's candidate comes from its strongest neighbour that sits in a candidate.
4. Folding takes the smallest small group first into the neighbour with the largest total weight, and repeats until no small group has a neighbour.
5. Candidate IDs start at 1 and are ordered by size, then label, then first member. The label (K34) is the longest common directory of the members; at the repo root it is the directory of the member with the highest file-level PageRank, and `.` if that is the root too. When two or more candidates share a label, each takes its own top-PageRank member's directory, in one pass, so labels may still repeat. The `fingerprint` is the first 16 hex characters of SHA-256 over the sorted members.
6. The artifact keeps full member lists. Edge weights are rounded to 6 decimals before Louvain (cross-machine stability); `cohesion`, `ratio`, `damping` and `minJaccard` are rounded to 3. There is no timestamp, only `commitSha`, so the bytes depend only on the input.
7. `crossEdges` count outgoing distinct symbol edges by kind; `coChangePairs` keep the top 10 per candidate.
8. Terms are type names, enum members and their tokens; the technical-word list (`contextsView.technicalTerms`) replaces the default and drops a word anywhere in a name. A collision is the same case-insensitive type name in two candidates whose member sets have Jaccard similarity below 0.5.

### Further rulings

- **Cohesion excludes hub edges.** Cohesion is internal weight over internal plus boundary weight, counted without the edges that touch hubs, so one popular file cannot decide a candidate's score.
- **`crossEdges` and `coChangePairs` count only candidate members.** Hub files assigned to a candidate do not add to its cross-candidate edges or pairs.
- **Exact damping.** The graph uses exactly `1 / log2(2 + dependents)`. The displayed `damping` is that value rounded to 3 decimals and the weights are rounded to 6, so the file shows a rounded number while the graph uses the exact one.
- **Symbols are sorted per file** before they enter the file graph, so the output does not depend on the order in which a plugin returns symbols.
- **K32: hub damping stays on by default.** On the fixture it is neutral for the hub case, and agreement with the oracle's units is 0.794 with damping against 0.833 without. The synthetic acceptance case still needs it (two areas that share only a hub land in different candidates with damping and merge without it), and the fixture's own co-change blend already keeps the hub from merging the areas.
- **K30: the strict reading is not met.** The acceptance wording "the shared hub no longer merges the four unrelated areas" passes: the four areas' majorities land in 3 distinct candidates, no candidate holds the majority of more than 2 areas, and cutting or damping the hub does not change their placement. The stricter reading "four areas, four candidates" is not met, because two areas share a candidate through their own direct links and cross-cutting technical co-change, not through the hub. A deferred roadmap item covers filtering cross-cutting technical change sets from the co-change signal.
- **K35: the default test globs stay.** One default name-based test glob matched a production file on the fixture. No test folder escaped the defaults. Revisit in PR 1B with test-annotation detection; teams can already add globs with `index.tests`.
- **Surfaces.** `get_architectural_overlay({ mode: "contexts" })` is summary-first (K33): all candidates in brief, hubs and collisions capped at 50 with totals. `candidate: <id>` returns one candidate in full, with its files capped at 15, its hubs (50) and its collisions (10, each with at most 5 of its own occurrences and the first 5 members of each). `ctxo contexts --json` prints the full artifact. Only `candidates` is truncatable in the response envelope; hubs and collisions are capped at the source.
- **Refresh cadence.** The view is recomputed on every full or incremental `ctxo index` run that re-indexes files and on every post-commit hook run, and skipped by `--skip-community`. `ctxo watch` does not refresh it.

### Evidence

Validated on a private production repository (826 indexed files, 318 of them tests; full history, 976 co-change commits used, 1431 pairs), with the dev build of this branch and no `contextsView` section in the config, so every default applied. Aggregate numbers only.

| Measure | Value |
|---|---|
| Candidates | 12 (sizes 67 down to 4) |
| `coverage.ratio` | 510 / 515 = 0.990 (0.922 over the oracle's whole universe of 553 files, which includes 37 script files that are not nodes) |
| Hubs | 17 (7 fan-in plus god node, 10 god node only), all assigned to a candidate; damping 0.154 to 0.387 |
| Unclustered | 5 (each has no edge at all) |
| Collisions | 5 (minimum Jaccard 0 to 0.111, each across 2 candidates) |
| Cohesion | 0.624 to 0.838 |
| Determinism | `contexts-view.json` byte-identical across 4 default index runs |
| Contexts-view step in `ctxo index` | about 0.85 s of a 31 s warm index (76 s cold); the file-graph build is over 95% of the step |

- **Hub case.** Before, in the symbol-level communities of the same run, the largest community (621 symbols, 124 files) held the shared factory interface and spanned all four areas. After, that interface is a hub (88 dependents, damping 0.154). The four areas' majorities land in 3 distinct candidates. Cutting the hub completely, or turning damping off, leaves the placement of all 83 area files unchanged: the remaining co-location of two areas (13 and 7 files) comes from 35 direct file pairs (co-change weight 12.3 against dependency weight 0.24).
- **Against the oracle's 81 units** (folders or single endpoint files, 553 files): 53 units sit in one candidate and 25 are split; 0.794 of the covered files sit in their unit's majority candidate (homogeneity 0.541, completeness 0.794, V-measure 0.644). Most splits are shared or platform units scattered by design (12) and large features split along an internal seam (7); 3 are split by cross-cutting co-change through a shared base and 3 lose one file to its only dependency partner. Eleven of 12 candidates merge two or more units (6.75 on average), which is expected because the oracle's unit is small.
- **Labels.** 9 of 12 labels were the project's source root: the longest common directory of a nested single project is that project folder, and the PageRank fallback only applied at the repo root. K34's refinement pass handles this case.
- **Tuning** (one setting at a time, about 30 trials): coverage stayed at 0.977 or higher and collisions at 4 to 6 in every trial. Only `resolution` 2.5 or higher gives four distinct majorities, and only by a majority flip with 30 split units and 0.716 agreement. Lowering `weights.coChange` makes the hub case worse. Resolution 1.25, `weights.coChange` 0.5 and `weights.dependency` 2 each reach 0.822 to 0.825 agreement with the same hub outcome. No default changed.

### Alternatives rejected

- **Symbol-level contexts.** Louvain over symbols puts a shared interface and hundreds of symbols into one community; the file level, with co-change as a second signal, is what a context map reasons about.
- **Leiden.** Still deferred (see the roadmap); the same file graph can feed it later without changing the artifact.
- **A data-access weight before PR 1B.** Tables and views are not nodes until the plugin protocol v2 work; adding a placeholder signal now would be tuned against nothing.

### K20 experiment: change-set unit for co-change (measured, left out)

Spec section 7.4a proposed `cochange.unit: commit | merge`, where `merge` treats a merge commit and its first-parent diff as one change set. It was implemented with a default of `commit`, measured on both repositories, and **removed from PR 1A (K29)**. It is tracked in [#165](https://github.com/alperhankendi/Ctxo/issues/165).

| Measure | Fixture, commit | Fixture, merge | Ctxo repo, commit | Ctxo repo, merge |
|---|---|---|---|---|
| Co-change pairs | 1431 | 1090 | 669 | 632 |
| Change sets used | 976 | 517 | 273 | 233 |
| Mass-skipped (more than 30 files) | 4 | 11 | 3 | 3 |
| Candidates | 12 | 11 | 12 | 12 |
| Files in their unit's majority candidate | 0.794 | 0.780 | 0.741 | 0.793 |
| V-measure | 0.644 | 0.606 | 0.597 | 0.594 |
| Hub case, area files in a candidate shared with another area | 27/83 | 64/83 | n/a | n/a |
| Co-change pass (budget 3 s) | 0.42 s | 0.61 s | 0.30 s | 0.48 s |

- On the fixture, `merge` moves the hub case the wrong way: the areas change together through cross-cutting technical PRs, and one PR becomes one shared change set for every pair of areas it touches, so the co-change grows instead of shrinking (three of four areas share a candidate).
- On the Ctxo repo the effect is small, because most PRs land as squash or direct commits (32 of 479 first-parent records are merges). Agreement with a proxy unit rule improves (0.741 to 0.793) but V-measure is flat.
- `merge` costs a second git pass (0.19 s on both repositories) and lost one file's pre-rename history on the fixture.
- **Decision:** not shipped in PR 1A. If the goal is to weaken the cross-cutting co-change itself, filtering technical change sets is a different signal from the change-set unit and is on the roadmap.

### Release size

The measured CLI tarball is 1564.51 KB, and the e2e tarball limit was raised from 1450 KB to 1600 KB, per the established practice of raising it with the measured size when a PR crosses it.
