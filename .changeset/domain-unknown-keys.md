---
"@ctxo/domain": patch
---

`ctxo doctor` (`domain_registry`) now warns about every unknown key under `domain:` in `.ctxo/config.yaml`, named by dotted path (nested sections included) with a "did you mean" suggestion for a near miss, for example `domain.boundaires (did you mean domain.boundaries?)`. The loader is unchanged: it ignores the unknown key, so the key you meant to set keeps its default value.
