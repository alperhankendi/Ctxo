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
```

The `cochange:` block sets the window and thresholds of the co-change matrix that `ctxo index` builds from git history. It is independent of `ctxo index --max-history`, which only controls how many commits each file keeps in its `intent[]`. `exclude` also removes files that `include` added.

The `gate:` block controls the safe-edit guard. `sensitivity` sets how aggressively the guard flags high-impact symbols:

| Level | PageRank percentile | Min dependents floor |
| --- | --- | --- |
| `strict` | top 30% | 2 |
| `balanced` | top 15% | 3 |
| `lenient` | top 5% | 5 |

Set `gate.enabled: false` to turn the guard off entirely.

Full schema reference: [Config schema](/reference/config-schema).
