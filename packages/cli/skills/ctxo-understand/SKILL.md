---
name: ctxo-understand
description: Use at the START of any code task (fix, extend, refactor, understand), and whenever you need the right ctxo tool for a structural question, to orient with ctxo instead of going in the wrong direction.
---

# Orient with ctxo before diving in

At the start of a new task:

1. `get_context_for_task` with the matching taskType (fix | extend | refactor | understand).
2. For unfamiliar areas: `get_architectural_overlay` (layer map) and `get_symbol_importance` (critical symbols).
3. Don't know the symbol name? `search_symbols` (name/regex) or `get_ranked_context` (natural language) before grepping or browsing directories.

Then read the files ctxo points you to. Reading a file to see its contents needs no index call.

## Which tool for which question

| Question                                        | Tool                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Reviewing a PR or recent changes                | `get_pr_impact` (one call: changed symbols, blast radius, co-change)                               |
| What breaks if I change this symbol?            | `get_blast_radius`, then `get_why_context`                                                         |
| Why does this code look like this? Any reverts? | `get_why_context`                                                                                  |
| What does this symbol do and depend on?         | `get_context_for_task(taskType: "understand")` or `get_logic_slice` (L2 overview, L3 full closure) |
| Fixing a bug                                    | `get_context_for_task(taskType: "fix")`                                                            |
| Adding or extending a feature                   | `get_context_for_task(taskType: "extend")`                                                         |
| Refactoring                                     | `get_context_for_task(taskType: "refactor")`                                                       |
| Who uses this? Is it safe to delete or rename?  | `find_importers`, then `get_blast_radius`                                                          |
| Class inheritance (extends, implements)         | `get_class_hierarchy`                                                                              |
| Unused symbols and files                        | `find_dead_code`                                                                                   |
| Complexity and churn hotspots                   | `get_change_intelligence`                                                                          |
| Symbols in recently changed files               | `get_changed_symbols`                                                                              |
| Find a symbol by name or regex                  | `search_symbols`                                                                                   |
| Find code for a natural-language question       | `get_ranked_context`                                                                               |
| Layer map of the project                        | `get_architectural_overlay`                                                                        |
| Most central symbols                            | `get_symbol_importance`                                                                            |

<!-- ctxo-skill v0.13 -->
