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
```

Full schema reference: [Config schema](/reference/config-schema).
