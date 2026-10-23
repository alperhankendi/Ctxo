---
"@ctxo/cli": minor
---

`ctxo index` now writes `.ctxo/index/contexts-view.json`, candidate bounded contexts clustered from dependencies and co-change with hub files damped, readable through `get_architectural_overlay({ mode: "contexts" })` (summary first, `candidate: <id>` for one in full) and the new `ctxo contexts [--json]`, with new `communities:`, `contextsView:` and `index.tests` config (#156 Phase 1). The overlay `mode`, `get_ranked_context` `searchMode` and `search_symbols` `mode` parameters are now registered so clients can send them, and the unused `fuzzy` parameter is removed.
