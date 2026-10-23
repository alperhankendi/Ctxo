# Architectural Intelligence

> **Ctxo sees how your codebase is actually shaped, and how it's changing — not just what's in it.**
>
> Introduced in v0.8. Adds four new signals derived from one idea: **community detection over the symbol graph**, combined with git intent and PageRank we already had.

## The problem this solves

AI agents don't fail because they can't code. They fail because they code blind.

Before v0.8, `get_architectural_overlay` classified files by **file path regex**:

```
src/core/foo.ts        → Domain
src/adapters/bar.ts    → Adapter
src/utils/helper.ts    → Unknown
```

That's a file-naming convention, not architecture. It missed:

- **Legacy or non-conformant codebases** where folder names don't follow a rule → everything returns `Unknown`.
- **Hidden coupling** where two files sit in different folders but depend on the same cluster.
- **Architectural drift** — a symbol quietly migrating from one concern to another over multiple commits.
- **Boundary violations** — a PR that wires the first-ever edge between two historically isolated modules.

## What Ctxo now does

A dependency graph has a natural structure: tightly-coupled symbols form **communities**. Community detection ([Louvain algorithm](https://en.wikipedia.org/wiki/Louvain_method) via [graphology-communities-louvain](https://www.npmjs.com/package/graphology-communities-louvain)) finds those clusters **from the edges themselves**, not from filenames.

On every `ctxo index`:

1. Build the symbol graph.
2. Run Louvain → assign each symbol a `communityId` + human-readable `label`.
3. Detect **god nodes** (symbols bridging 3+ clusters).
4. Write `.ctxo/index/communities.json` (current) + rotating history snapshot.

Snapshots unlock two more signals: **drift** (symbols changing cluster) and **boundary violations** (new edges between historically isolated clusters).

## Four new signals surfaced through existing tools

No new MCP tool count — all additive fields on the 14 tools we already ship.

### 1. Data-driven clusters — `get_architectural_overlay`

```jsonc
// Before (regex only):
{ "layers": { "Domain": ["..."], "Adapter": ["..."] } }

// After (mode: "both" — default):
{
  "layers": { ... },
  "communities": {
    "modularity": 0.735,
    "edgeQuality": "mixed",
    "crossClusterEdges": 191,
    "commitSha": "78ccc33",
    "clusters": [
      {
        "id": 0,
        "label": "packages/cli/src/adapters/storage",
        "memberCount": 24,
        "members": [ "...JsonIndexReader::class", "..." ],
        "godNodes": [ "...JsonIndexReader::class" ]
      }
    ]
  }
}
```

**What's new:**
- Clusters come from **actual dependencies**, not file paths. A `utils.ts` sitting in `src/` gets grouped with the code that actually depends on it.
- `godNodes` surface symbols you shouldn't casually refactor — they hold multiple clusters together.
- `modularity` (0..1) tells you how separable the architecture is. 0.3+ is a recognisable cluster structure; Ctxo itself scores ~0.73.
- `edgeQuality` flags when part of your graph is syntax-only (tree-sitter fallback) vs. fully semantic — so you know how much to trust the clustering.

### 2. Cluster-scoped blast radius — `get_blast_radius`

A change to one symbol used to look like a single number: `impactScore: 18`.

Now the AI agent sees **which teams are affected**:

```jsonc
{
  "impactScore": 18,
  "byCluster": {
    "packages/cli/src/core/graph": 3,
    "packages/cli/src/adapters/storage": 12,
    "packages/cli/src/adapters/mcp": 3
  },
  "crossClusterEdges": 2,
  "multiClusterHint": "Change impacts 3 clusters — multi-team review recommended."
}
```

**Why this matters:** A 10-symbol blast is very different if it all lives in one cluster vs. scatters across three. AI agents (and PR reviewers) can now catch the scattering without reading every file.

The same response also carries co-change evidence: `likely` dependents include symbols whose file co-changes with the target's file, `coChangeFrequency` is filled on impacted symbols, and `coChangedFiles` lists files that change together with the target but have no dependency path to it. See [Co-change](#co-change-the-signal-behind-likely) below.

### 3. Drift signals — `get_why_context`

Snapshots are compared with Jaccard overlap to track where symbols move over time:

```jsonc
{
  "commitHistory": [ /* existing */ ],
  "antiPatternWarnings": [ /* existing */ ],
  "driftSignals": {
    "confidence": "medium",
    "snapshotsAvailable": 5,
    "distinctCommits": 5,
    "events": [
      {
        "symbolId": "packages/.../AuthService::class",
        "movedFrom": { "id": 3, "label": "Auth" },
        "movedTo": { "id": 1, "label": "Infrastructure" },
        "firstSeenInNewCluster": "2026-04-16T10:00:00.000Z"
      }
    ]
  }
}
```

**Example scenario:** `AuthService` used to cluster with session/token code. Over the last 3 commits it started importing AWS SDK helpers and its dependency profile shifted so Louvain now places it in Infrastructure. That's architectural drift — no test or typecheck catches it, but the next person who tries to extract auth as a separate service will have a very bad week.

**Confidence counts distinct commits, not snapshot files.** `distinctCommits` is the number of different commits in the snapshot history, other than the current one. History keeps at most one snapshot per commit, so a busy commit (many `ctxo index` runs at the same HEAD) adds nothing. `snapshotsAvailable` stays in the payload for compatibility; it is the number of history entries passed to the detector, not a measure of confidence.
- `< 3` distinct commits → `low`, with a hint to install the post-commit hook (`ctxo init`) or run `ctxo index` after commits. `ctxo index --check` records no snapshot, so it is not part of that advice
- `3-6` → `medium`
- `7+` → `high`

Drift compares the current snapshot with the newest history entry from a **different** commit, so re-running the index on the same commit never reports drift against itself.

### 4. Boundary violations — `get_pr_impact`

A PR review signal that catches **new cross-cluster edges**:

```jsonc
{
  "changedFiles": 2,
  "riskLevel": "high",
  "boundaryViolations": {
    "confidence": "medium",
    "snapshotsAvailable": 4,
    "distinctCommits": 4,
    "violations": [
      {
        "from": { "symbolId": ".../CheckoutFlow::class", "communityId": 1, "label": "Billing" },
        "to":   { "symbolId": ".../UserPermissions::class", "communityId": 3, "label": "Auth" },
        "edgeKind": "calls",
        "historicalEdgesBetweenClusters": 0,
        "severity": "high"
      }
    ]
  },
  "clustersAffected": [
    { "id": 1, "label": "Billing", "symbolCount": 5 },
    { "id": 3, "label": "Auth", "symbolCount": 1 }
  ]
}
```

**Example scenario:** Someone opens a PR that adds a direct call from `CheckoutFlow` to `UserPermissions`. These clusters have never shared an edge in the last 10 snapshotted commits. `severity: "high"` with `historicalEdgesBetweenClusters: 0` is the "you just punched a hole through a layer boundary for the first time in the repo's history" signal. An AI reviewer can call this out before a human ever sees the PR.

## Differentiation

| Tool | Community detection | Git intent per symbol | Drift over time | Boundary violations |
|---|---|---|---|---|
| **Ctxo (v0.8)** | ✅ | ✅ | ✅ | ✅ |
| jCodeMunch | — (PageRank only) | — | — | — |
| Sourcegraph Cody | — | — | — | — |
| Knip / tsr | — | — | — | — |
| Fossil MCP | — | ✅ | — | — |
| Graph DBs (Neo4j, Kuzu) | ✅ (built-in algos) | — | — | — |

Community detection exists in graph DBs. Git intent exists in history tools. **Nobody else has both feeding into the same MCP surface.** That's the Ctxo wedge.

## Co-change: the signal behind `likely`

Files that keep changing in the same commits are coupled even when no import edge shows it. Ctxo builds a co-change matrix (`.ctxo/index/co-changes.json`, committed) from git history and feeds it to every blast-radius path: `get_blast_radius`, `get_pr_impact`, `get_context_for_task`, `ctxo blast-radius`, the safe-edit gate hook and `ctxo gate --preview`. A `potential` dependent whose file co-changes with the target's file at a frequency above 0.5 is promoted to `likely`.

**How it is built.** One `git log --no-merges -M --name-status` pass over the commits reachable from HEAD, newest first. The same pass fills each file's `intent[]`, and both follow renames through one shared rename map. The window is independent of `ctxo index --max-history` (which only controls how many commits each file keeps in `intent[]`).

- Only files Ctxo indexes count, plus tracked files matched by `cochange.include`. `cochange.exclude` removes files, and it also vetoes files that `include` added.
- Merge commits are left out of the log. A commit that touches more than `maxFilesPerCommit` analysed files is skipped as a mass change and counted in `massSkipped`.
- A pair becomes an entry after `minShared` shared commits and `frequency = shared / min(countA, countB) >= 0.1`.
- The applied window is recorded in `co-changes.json` (`window`), and the file is only rewritten when its entries or window change.

```yaml
# .ctxo/config.yaml - every field is optional; these are the defaults
cochange:
  maxCommits: 2000        # last N non-merge commits from HEAD, or "all"
  # since: 12m            # also limit by age; d, w, m, y; counted back from HEAD's committer date
  maxFilesPerCommit: 30
  minShared: 2
  include: []             # extra tracked, non-indexed files to analyse (globs, for example scripts)
  exclude: []             # indexed files to leave out (globs)
```

`ctxo index --cochange-commits <n|all>` and `--cochange-since <duration>` override the window for one run. The window is anchored to HEAD, never to the wall clock, so the same HEAD and config always give the same matrix. `commitsScanned` counts every non-merge commit of the repository, so in a monorepo a numeric `maxCommits` covers fewer relevant commits than its value suggests.

**What readers see.**

- `get_blast_radius` and `ctxo blast-radius` add `coChangedFiles`: up to 10 files that co-change with the target's file at `frequency >= 0.5` but have no graph path to it. It is informational: it is not counted in the tiers, the risk scores or the gate, and it is omitted when empty or when no matrix exists.
- `coChangeFrequency` is filled on every impacted symbol whose file has a co-change entry with the target's file, whether or not that entry upgraded the tier.
- `get_context_for_task` entries that depend on the symbol carry an optional `confidence` tier (`confirmed`, `likely` or `potential`).
- The safe-edit gate counts `confirmed + likely` dependents, so a co-change-upgraded dependent counts. The gate may fire somewhat more often than before; run `ctxo gate --preview` to see the effect.

**Limits.** In a sparse checkout, files outside the cone are absent from the matrix, and their committed index entries are never pruned. A missing `co-changes.json` is ignored silently and an invalid one is ignored with one warning; blast radius then falls back to the graph alone.

## How to feed it: snapshot cadence matters

Drift and boundary signals work by **comparing snapshots of different commits**. History keeps **one snapshot per commit**: a second run on the same commit replaces the current snapshot instead of adding an entry, and `ctxo watch` re-snapshots at the same HEAD the same way. Confidence therefore scales with the number of distinct commits that have a snapshot, not with how often `ctxo index` ran. In order of recommendation:

1. **`ctxo init` with the post-commit hook** (recommended default) - every commit produces one snapshot. Hook v2 runs `ctxo index --commit HEAD` **once per commit**, re-indexes only the files that commit changed, and refreshes the co-change matrix, the snapshot and the drift and boundary artifacts from the merged index.
2. **`ctxo watch`** during development - debounced 5 s refresh on file save. It keeps the current snapshot fresh; it does not add history entries for the same commit.
3. **Manual `ctxo index`** after commits - works but drift fidelity depends on how often you remember.

`ctxo index --check` is a CI freshness gate (it exits non-zero when the committed index is stale). It writes nothing and **records no snapshot**, so it does not build history.

The v2 hook block is marked `# ctxo-start v2` and guarded by `[ -d .ctxo ]`, so it does nothing in a repository that does not use ctxo. `ctxo init` and `ctxo doctor --fix` upgrade an older block in place (keeping your own lines around it), collapse duplicate blocks into one, and follow `core.hooksPath`. When `core.hooksPath` comes from the global or system git config, the hooks directory is shared by every repository on the machine: ctxo then writes nothing and prints the blocks to add by hand (or tells you to give the repository its own path with `git config --local core.hooksPath <dir>`). The check for that scope needs git 2.26 or newer. `ctxo doctor` reports a missing, outdated or duplicated block as the `git_hooks` check.

If `ctxo init` is declined, a warning prints explaining which features degrade and how to recover. Nothing silently fails - `confidence: "low"` is always reported when history is thin.

**Upgrading:** the first index write after upgrading removes older same-commit duplicates from `.ctxo/index/communities.history/` (this repository went from 11 files to 5). No information is lost; the removed files were copies of the same commit.

## Mission alignment

What we explicitly **did not** do:

- **Did not migrate to a graph DB.** Ctxo stays local-first, zero-daemon. SQLite + JSON index remain the source of truth. Graphology runs in-process.
- **Did not add a new MCP tool.** All new signals are additive fields on the 14 existing tools. No client-side adaptation needed.
- **Did not break compatibility.** Old indexes without `communities.json` degrade silently — every tool falls back to pre-v0.8 behaviour.
- **Did not replace the regex overlay.** `mode: "regex"`, `mode: "communities"`, or `mode: "both"` (default) — the caller chooses.

## Try it on this repo

```bash
pnpm --filter @ctxo/cli build
node packages/cli/dist/index.js index
cat .ctxo/index/communities.json | jq '{ modularity, edgeQuality, clusters: (.communities | map(.communityId) | unique | length), godNodes: (.godNodes | length) }'
```

Expected on a healthy repo: `modularity >= 0.3`, `edgeQuality: "full" | "mixed"`, clusters matching your module boundaries, god nodes pointing at the classes everyone depends on.

## Configuration

| Flag | Effect |
|---|---|
| `ctxo index --skip-community` | Opt out of community detection for faster indexing |
| `ctxo index --files <path...>` / `--file <path>` | Re-index only these files; co-change, communities and artifacts are still computed from the whole index |
| `ctxo index --commit <rev>` | Re-index the files one commit changed (what the post-commit hook runs: `ctxo index --commit HEAD`) |
| `ctxo index --cochange-commits <n\|all>` | Co-change window in commits (default 2000) |
| `ctxo index --cochange-since <duration>` | Co-change window by age, counted back from HEAD (`30d`, `2w`, `12m`, `1y`) |
| `cochange:` in `.ctxo/config.yaml` | Window, thresholds, `include` and `exclude` globs (see above) |
| `CTXO_RESPONSE_LIMIT=16384 ctxo ...` | Raise truncation threshold for verbose cluster payloads |

## See also

- [roadmap.md](../roadmap.md) — deferred items (Leiden opt-in, historical graph reconstruction, GHA template)
- [CHANGELOG.md](../../CHANGELOG.md) — full diff
- [Issue #54](https://github.com/alperhankendi/Ctxo/issues/54) — original proposal
