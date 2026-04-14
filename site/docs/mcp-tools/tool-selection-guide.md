---
title: "Tool Selection Guide"
description: "Decision tree mapping common tasks (review, fix, refactor, explore) to the right Ctxo MCP tool."
---

# Tool Selection Guide

Pick the right tool for the question you're actually asking. Ctxo tools are cheap (sub-500ms, local), so **call more, read less** — the index knows things that source files don't (git intent, anti-patterns, blast radius, PageRank).

## Quick decision tree

```text
Reviewing a PR or recent changes?
  -> get_pr_impact (single call, full risk assessment)

About to modify a function or class?
  -> get_blast_radius  (what breaks if I change this?)
  -> get_why_context   (any history of problems / reverts?)
  -> then edit

Need to understand what a symbol does?
  -> get_context_for_task(taskType: "understand")
  -> or get_logic_slice (L2 overview, L3 full closure)

Fixing a bug?
  -> get_context_for_task(taskType: "fix")
     (history + anti-patterns + deps)

Adding a feature / extending code?
  -> get_context_for_task(taskType: "extend")
     (deps + blast radius)

Refactoring?
  -> get_context_for_task(taskType: "refactor")
     (importers + complexity + churn)

Don't know the symbol name?
  -> search_symbols    (name / regex)
  -> get_ranked_context (natural language query)

Onboarding a new codebase?
  -> get_architectural_overlay (layer map)
  -> get_symbol_importance     (most critical symbols)

Cleaning up code?
  -> find_dead_code          (unused symbols / files)
  -> get_change_intelligence (complexity x churn hotspots)

Checking if safe to delete or rename?
  -> find_importers   (who depends on this?)
  -> get_blast_radius (full impact)

Working with inheritance?
  -> get_class_hierarchy (extends / implements tree)
```

## By task type

### Reviewing a PR or diff

Start with [`get_pr_impact`](/mcp-tools/get-pr-impact) — it combines changed-symbol detection, blast-radius analysis, and co-change history into one response. Follow up with [`get_why_context`](/mcp-tools/get-why-context) on any changed symbol that has high blast radius.

### Modifying existing code

::: warning Mandatory sequence
1. [`get_blast_radius`](/mcp-tools/get-blast-radius) — see what breaks
2. [`get_why_context`](/mcp-tools/get-why-context) — check for prior reverts / anti-patterns
3. Then read and edit the source file
:::

### Starting a task

| Task type | Required first call |
| --- | --- |
| Fixing a bug | [`get_context_for_task`](/mcp-tools/get-context-for-task) with `taskType: "fix"` |
| Adding / extending a feature | [`get_context_for_task`](/mcp-tools/get-context-for-task) with `taskType: "extend"` |
| Refactoring | [`get_context_for_task`](/mcp-tools/get-context-for-task) with `taskType: "refactor"` |
| Understanding code | [`get_context_for_task`](/mcp-tools/get-context-for-task) with `taskType: "understand"` |

### Exploring unfamiliar code

- Don't know the name? Use [`get_ranked_context`](/mcp-tools/get-ranked-context) with a natural language query.
- Know the pattern? Use [`search_symbols`](/mcp-tools/search-symbols) with a name or regex.
- Need the big picture? [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay) + [`get_symbol_importance`](/mcp-tools/get-symbol-importance).

### Checking safety before a delete or rename

Combine [`find_importers`](/mcp-tools/find-importers) (direct reverse deps) with [`get_blast_radius`](/mcp-tools/get-blast-radius) (transitive impact) before removing a public symbol.

### Hunting dead code and hotspots

- [`find_dead_code`](/mcp-tools/find-dead-code) for unreachable symbols and orphan files.
- [`get_change_intelligence`](/mcp-tools/get-change-intelligence) for high-churn high-complexity files that deserve attention.

### Class hierarchies

[`get_class_hierarchy`](/mcp-tools/get-class-hierarchy) resolves both ancestors and descendants in one call — much faster than walking `extends` / `implements` edges by hand.

## Anti-patterns — NEVER do these

::: danger Common mistakes
- **NEVER** edit a function without first calling [`get_blast_radius`](/mcp-tools/get-blast-radius) on it.
- **NEVER** skip [`get_why_context`](/mcp-tools/get-why-context) — reverted code and anti-patterns are invisible from source alone.
- **NEVER** grep source files to find symbols when [`search_symbols`](/mcp-tools/search-symbols) exists.
- **NEVER** manually trace imports when [`find_importers`](/mcp-tools/find-importers) returns the full reverse dependency graph.
- **NEVER** guess layer boundaries — call [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay).
:::

## See also

- [MCP Tools Overview](/mcp-tools/overview) — all 14 tools grouped by category
- [Response Format](/mcp-tools/response-format) — `_meta`, truncation, intent filtering
