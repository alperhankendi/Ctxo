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
```

The `gate:` block controls the safe-edit guard. `sensitivity` sets how aggressively the guard flags high-impact symbols:

| Level | PageRank percentile | Min dependents floor |
| --- | --- | --- |
| `strict` | top 30% | 2 |
| `balanced` | top 15% | 3 |
| `lenient` | top 5% | 5 |

Set `gate.enabled: false` to turn the guard off entirely.

Full schema reference: [Config schema](/reference/config-schema).
