---
"@ctxo/cli": minor
"@ctxo/domain": minor
---

`ctxo watch` now refreshes the domain artifacts. With `@ctxo/domain` installed, watch runs the domain index pass (the one `ctxo index` runs) after the re-index of the changed files, so `graph.json`, `maturity.json`, `shadow-candidates.json`, `contexts.json` and `boundaries.json` follow your edits and the domain tools stop answering `stale: true`. A registry, card, glossary or `shadow-specs.yaml` edit runs the pass 1 s after the last such event; changed source files run it once `watch.snapshotMinFileChanges` of them are pending, 5 s after the last event. Passes never overlap, a failing pass is logged and watch goes on, and without `@ctxo/domain` watch behaves as before. The stale hints now name the watch refresh. Module API: `CtxoModuleRegistration.classifyWatchPath(path, indexed)` tells watch which changed paths a module's index pass depends on.
