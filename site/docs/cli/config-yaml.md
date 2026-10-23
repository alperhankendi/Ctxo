---
title: "config.yaml reference"
description: "The .ctxo/config.yaml schema: ignore globs, stats, defaults."
---

# .ctxo/config.yaml reference

The project configuration file. Lives at `.ctxo/config.yaml` and is committed to git so the whole team shares the same settings. Every field is optional and has a sensible default, so this file can be omitted entirely. `ctxo init` drops a default with commented-out examples.

```yaml
version: "1.0"
stats:
  enabled: true
index:
  ignore:
    - "packages/**/fixtures/**"
  ignoreProjects:
    - "examples/*"
  tests: []               # extra test-file globs
  facts: false            # true asks plugins for code facts (protocol v2)
gate:
  enabled: true
  sensitivity: balanced   # strict | balanced (DEFAULT) | lenient
cochange:
  maxCommits: 2000        # number or "all"
  # since: 12m            # optional; d, w, m, y; counted back from HEAD's committer date
  maxFilesPerCommit: 30
  minShared: 2
  include: []             # extra tracked, non-indexed files to analyse (globs)
  exclude: []             # indexed files to leave out of co-change (globs)
communities:              # symbol-level Louvain
  resolution: 1.0
  godNodeMinBridged: 3
  godNodeMaxResults: 25
contextsView:             # candidate contexts, see `ctxo contexts`
  weights: { dependency: 1.0, coChange: 1.0, data: 0 }
  exclude: []
  hubs: { auto: true, topPercent: 1, minDependents: 10, paths: [] }
  resolution: 1.0
  minCandidateFiles: 3
  technicalTerms: []
```

The `cochange:` block sets the window and thresholds of the co-change matrix that `ctxo index` builds from git history. It is independent of `ctxo index --max-history`, which only controls how many commits each file keeps in its `intent[]`. `exclude` also removes files that `include` added.

The `communities:` block tunes symbol-level Louvain community detection. The `contextsView:` block tunes the candidate contexts that `ctxo index` writes to `contexts-view.json` and [`ctxo contexts`](/cli/contexts) shows: the dependency, co-change and data `weights` (`data` defaults to `0`, so shared tables are reported but never merge candidates), files to `exclude`, `hubs` (automatic detection and configured `paths`), the Louvain `resolution`, `minCandidateFiles` and the `technicalTerms` dropped from candidate terms. `index.tests` adds test-file globs to the shared defaults; test files are never nodes of the contexts view, and test-framework annotations (`Fact`, `Test`, `TestMethod` and the rest) also mark them (see [Test files](/reference/config-schema#test-files)). `index.facts: true` asks plugins for code facts, written to the index JSON only. Defaults and bounds are in the [Config schema](/reference/config-schema#contextsview).

The `gate:` block controls the safe-edit guard. `sensitivity` sets how aggressively the guard flags high-impact symbols:

| Level | PageRank percentile | Min dependents floor |
| --- | --- | --- |
| `strict` | top 30% | 2 |
| `balanced` | top 15% | 3 |
| `lenient` | top 5% | 5 |

Set `gate.enabled: false` to turn the guard off entirely.

Full schema reference: [Config schema](/reference/config-schema).
