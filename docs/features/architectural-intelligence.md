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

### 3. Drift signals — `get_why_context`

Snapshots are compared with Jaccard overlap to track where symbols move over time:

```jsonc
{
  "commitHistory": [ /* existing */ ],
  "antiPatternWarnings": [ /* existing */ ],
  "driftSignals": {
    "confidence": "medium",
    "snapshotsAvailable": 5,
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

**Confidence degrades gracefully:**
- `< 3 snapshots` → `low` with an actionable hint to install hooks or run `ctxo watch`
- `3-6` → `medium`
- `7+` → `high`

### 4. Boundary violations — `get_pr_impact`

A PR review signal that catches **new cross-cluster edges**:

```jsonc
{
  "changedFiles": 2,
  "riskLevel": "high",
  "boundaryViolations": {
    "confidence": "medium",
    "snapshotsAvailable": 4,
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

**Example scenario:** Someone opens a PR that adds a direct call from `CheckoutFlow` to `UserPermissions`. These clusters have never shared an edge in the last 10 snapshots. `severity: "high"` with `historicalEdgesBetweenClusters: 0` is the "you just punched a hole through a layer boundary for the first time in the repo's history" signal. An AI reviewer can call this out before a human ever sees the PR.

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

## How to feed it: snapshot cadence matters

Drift and boundary signals work by **comparing snapshots over time**. Quality scales with cadence. In order of recommendation:

1. **`ctxo init` with post-commit hook** (recommended default) — every commit produces a snapshot.
2. **`ctxo watch`** during development — debounced 5 s refresh on file save.
3. **CI gate `ctxo index --check`** — at least every PR gets a snapshot.
4. **Manual `ctxo index`** — works but drift fidelity depends on how often you remember.

If `ctxo init` is declined, a warning prints explaining which features degrade and how to recover. Nothing silently fails — `confidence: "low"` is always reported when history is thin.

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
| `CTXO_RESPONSE_LIMIT=16384 ctxo ...` | Raise truncation threshold for verbose cluster payloads |

## See also

- [roadmap.md](../roadmap.md) — deferred items (Leiden opt-in, historical graph reconstruction, GHA template)
- [CHANGELOG.md](../../CHANGELOG.md) — full diff
- [Issue #54](https://github.com/alperhankendi/Ctxo/issues/54) — original proposal
