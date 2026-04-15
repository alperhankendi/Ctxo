---
title: "Architectural Intelligence"
description: "Community detection, drift, boundary violations, cluster-scoped blast radius — data-driven architecture signals Ctxo alone provides."
---

# Architectural Intelligence

> AI agents don't fail because they can't code. They fail because they code blind.
> Ctxo gives them the full picture **before** they write a single line.

Architectural Intelligence is Ctxo's v0.8 release. It adds four signals derived from a single idea: **community detection over the symbol graph**, combined with the git intent and PageRank data Ctxo already indexes. No other MCP server combines these three pillars.

## The problem with folder-based layer detection

Before v0.8, `get_architectural_overlay` classified files by **path regex**:

```
src/core/foo.ts        → Domain
src/adapters/bar.ts    → Adapter
src/utils/helper.ts    → Unknown
```

That's naming convention, not architecture. It misses:

- **Non-conformant codebases** — Python / Go / C# / legacy repos where folder names do not encode layers → every file returns `Unknown`.
- **Hidden coupling** — two files in different folders that actually depend on the same cluster of symbols.
- **Architectural drift** — a symbol quietly migrating from one concern into another across multiple commits. Tests and typecheck do not catch this.
- **Boundary violations** — a PR that wires the first-ever edge between two previously isolated modules.

## What Ctxo does now

On every `ctxo index`, Ctxo runs the [Louvain community detection algorithm](https://en.wikipedia.org/wiki/Louvain_method) ([graphology-communities-louvain](https://www.npmjs.com/package/graphology-communities-louvain)) over the symbol graph.

The output is a `CommunitySnapshot` persisted to `.ctxo/index/communities.json` plus a rotating `.ctxo/index/communities.history/` directory. Successive snapshots unlock temporal signals — drift and boundary violations — that no single-shot analysis can produce.

## The four signals

All surfaced as **additive fields on existing MCP tools** — the 14 tool count never changes, and old indexes gracefully degrade to pre-v0.8 behaviour.

### 1. Data-driven clusters — `get_architectural_overlay`

```json
{
  "layers": { "Domain": ["..."], "Adapter": ["..."] },
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
        "members": ["...JsonIndexReader::class", "..."],
        "godNodes": ["...JsonIndexReader::class"]
      }
    ]
  }
}
```

**What this buys you:**

- Clusters come from **actual dependencies**, not filenames. A misplaced `utils.ts` in `src/` gets grouped with the code that really depends on it.
- `godNodes` surface the symbols you must not casually refactor — they hold multiple clusters together.
- `modularity` (0..1) is a single number telling you how separable the architecture is. `0.3+` is a recognisable cluster structure; Ctxo itself scores ~0.73.
- `edgeQuality` flags when part of the graph ran on syntax-only tree-sitter fallback vs. full semantic analysis — so you know how much to trust the result.

Mode filter:

- `{ mode: "both" }` (default) — regex layers + communities
- `{ mode: "regex" }` — pre-v0.8 behaviour
- `{ mode: "communities" }` — data-driven only

### 2. Cluster-scoped blast radius — `get_blast_radius`

A change to one symbol used to look like a single number: `impactScore: 18`.

Now the agent sees **which teams are affected**:

```json
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

A 10-symbol blast that stays in one cluster is a different beast from a 10-symbol blast that scatters across three. AI agents and PR reviewers can now catch the scattering without reading every file.

### 3. Architectural drift — `get_why_context`

Drift compares the current `CommunitySnapshot` against previous ones using Jaccard overlap on cluster membership. When a symbol's cluster *label* changes (not merely its numeric id), it's drifting.

```json
{
  "commitHistory": ["..."],
  "antiPatternWarnings": ["..."],
  "driftSignals": {
    "confidence": "medium",
    "snapshotsAvailable": 5,
    "events": [
      {
        "symbolId": "packages/.../AuthService::class",
        "movedFrom": { "id": 3, "label": "Auth" },
        "movedTo":   { "id": 1, "label": "Infrastructure" },
        "firstSeenInNewCluster": "2026-04-16T10:00:00.000Z"
      }
    ]
  }
}
```

**Concrete example.** `AuthService` used to cluster with session/token code. Over the last 3 commits it started importing AWS SDK helpers; its dependency profile shifted until Louvain moved it into Infrastructure. No test fails. No typecheck complains. But the next engineer who tries to extract auth as a standalone service discovers it is tangled with cloud SDK code.

That is exactly the kind of silent decay an AI reviewer can now flag before it compounds.

**Confidence degrades gracefully:**

| Snapshots available | Confidence | Hint surfaced? |
| :--- | :--- | :--- |
| `< 3` | `low` | Yes — install hooks, run `ctxo watch`, or add `ctxo index --check` to CI |
| `3–6` | `medium` | No |
| `7+` | `high` | No |

### 4. Boundary violations — `get_pr_impact`

A PR review signal that catches **new cross-cluster edges**:

```json
{
  "changedFiles": 2,
  "riskLevel": "high",
  "boundaryViolations": {
    "confidence": "medium",
    "snapshotsAvailable": 4,
    "violations": [
      {
        "from": { "symbolId": ".../CheckoutFlow::class", "label": "Billing" },
        "to":   { "symbolId": ".../UserPermissions::class", "label": "Auth" },
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

**Concrete example.** A PR adds a direct call from `CheckoutFlow` to `UserPermissions`. These clusters have never shared an edge in the last 10 snapshots. `severity: "high"` with `historicalEdgesBetweenClusters: 0` is the *"you just punched a hole through a layer boundary for the first time in the repo's history"* signal. A senior reviewer would notice this — and Ctxo hands it to the AI reviewer before any human reads the PR.

## What makes this a killer differentiator

| Capability | Ctxo v0.8 | jCodeMunch | Sourcegraph Cody | Knip / tsr | Fossil MCP | Neo4j / Kuzu |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Community detection | ✅ | — | — | — | — | ✅ (built-in algos) |
| PageRank importance | ✅ | ✅ | — | — | — | ✅ |
| Git intent per symbol | ✅ | — | — | — | ✅ | — |
| Anti-pattern / revert detection | ✅ | — | — | — | partial | — |
| Drift over time | ✅ | — | — | — | — | — |
| Boundary violation warnings | ✅ | — | — | — | — | — |
| Local-first, zero daemon | ✅ | ✅ | — | ✅ | ✅ | — |

Community detection exists in graph databases. Git intent exists in history tools. **Nobody else feeds both into the same MCP surface.** That intersection is the Ctxo wedge.

## Cadence matters: feeding the signal

Drift and boundary signals depend on snapshots accumulating over time. Quality scales with cadence. Recommended order:

1. **`ctxo init` with post-commit hook** — one snapshot per commit. Default in the init flow.
2. **`ctxo watch`** during development — debounced 5 s refresh on file save (dev machines yield rich local snapshot chains).
3. **CI gate `ctxo index --check`** — every PR adds a snapshot that the whole team shares via git.
4. **Manual `ctxo index`** — works but drift fidelity is your responsibility.

If you decline hooks during `ctxo init`, a warning prints explaining which signals degrade and how to recover. Nothing silently fails — `confidence: "low"` always flags a thin history.

## Mission alignment

What we explicitly **did not** do:

- **No graph DB.** Ctxo stays local-first, zero-daemon. SQLite + JSON index remain the source of truth. `graphology` runs in-process.
- **No new MCP tool.** Additive fields on existing tools. Zero client-side changes needed.
- **No breaking change.** Indexes without `communities.json` degrade silently to pre-v0.8 behaviour for every tool.
- **Regex overlay kept.** `mode: "regex" | "communities" | "both"` — the caller chooses.

## Try it on your repo

```bash
ctxo index
cat .ctxo/index/communities.json | jq '{
  modularity,
  edgeQuality,
  clusters: (.communities | map(.communityId) | unique | length),
  godNodes: (.godNodes | length)
}'
```

A healthy modern repo reports `modularity >= 0.3`, `edgeQuality: "full"` or `"mixed"`, clusters matching module boundaries, and god nodes pointing at the classes everyone depends on.

## Related

- [Dependency Graph](./dependency-graph.md) — the underlying structure community detection runs on.
- [PageRank Importance](./pagerank.md) — complements clusters; centrality within the whole graph.
- [Blast Radius](./blast-radius.md) — now cluster-aware in v0.8.
- [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay) — surfaces the clusters.
- [`get_blast_radius`](/mcp-tools/get-blast-radius) — cluster breakdown.
- [`get_why_context`](/mcp-tools/get-why-context) — drift signals.
- [`get_pr_impact`](/mcp-tools/get-pr-impact) — boundary violations.
