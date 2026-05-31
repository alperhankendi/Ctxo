---
name: ctxo-understand
description: Use at the START of any code task (fix, extend, refactor, understand) before reading source files, to orient with ctxo and avoid going in the wrong direction.
---

# Orient with ctxo before diving in

Do this BEFORE reading source files for a new task:

1. `get_context_for_task` with the matching taskType (fix | extend | refactor | understand).
2. For unfamiliar areas: `get_architectural_overlay` (layer map) and `get_symbol_importance` (critical symbols).
3. Don't know the symbol name? `search_symbols` (name/regex) or `get_ranked_context` (natural language). Do NOT grep or browse directories first.

Only after orientation, read the specific files ctxo points you to.
