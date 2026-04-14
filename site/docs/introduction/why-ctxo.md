---
title: "Why Ctxo?"
description: "Agents code blind without a dependency graph. Ctxo replaces 10-20 grep/read calls with one semantic query."
---

# Why Ctxo?

> AI agents don't fail because they can't code. They fail because they code blind.

## The problem: agents code blind

Drop a modern coding agent into a real repo and watch it work. It will:

1. **Ripgrep for a symbol name** - and get 47 hits across tests, docs, and
   generated code.
2. **Read five files** to figure out which hit is the definition.
3. **Read five more** to find the callers.
4. **Miss the class that extends it** entirely, because inheritance doesn't
   show up in a text search.
5. **Never check git history** - so it confidently reintroduces a bug that was
   reverted three weeks ago.
6. **Run out of context** halfway through the task and start hallucinating.

This isn't a skill gap. It's a **sensory gap**. The agent has no map. It
navigates your codebase the way you would navigate a city with your eyes closed
and a phone book.

## The solution: a pre-built index and semantic tools

Ctxo indexes your repo once (and keeps it fresh via file watchers and git
hooks) into a deterministic graph:

- Every **symbol** (function, class, method, interface, type)
- Every **edge** (imports, calls, extends, implements, uses)
- Every relevant **git commit** that touched each file, with intent classified
- Every **anti-pattern** (reverts, repeated hotfixes, thrash)

Then it exposes that graph through 14 semantic MCP tools. One
`get_blast_radius` call replaces a whole ripgrep/read spiral. One
`get_pr_impact` replaces an entire PR review session of "wait, what calls
this?"

## Without Ctxo vs with Ctxo

Measured on a typical "rename a widely-used function" task across a mid-sized
TypeScript repo:

| Metric                            | Without Ctxo         | With Ctxo           |
| --------------------------------- | -------------------- | ------------------- |
| Tool calls to map impact          | 10-20 (grep + read)  | 1 (`get_blast_radius`) |
| Tokens burned on orientation      | 40k-80k              | 2k-4k               |
| Context window free for actual work | ~20%               | ~85%                |
| Reverted-bug reintroduction risk  | High (no history)    | Low (`get_why_context`) |
| Missed downstream dependent       | Common               | Rare (full transitive graph) |
| Time to first useful edit         | Minutes              | Seconds             |

## See it in action

Two interactive comparisons show Ctxo against a naive agent loop:

- <a href="/Ctxo/blast-radius-comparison.html" target="_self">Blast Radius Comparison</a>
  - grep-and-pray versus one `get_blast_radius` call
- <a href="/Ctxo/dead-code-comparison.html" target="_self">Dead Code Comparison</a>
  - manual tracing versus `find_dead_code`

And the <a href="/Ctxo/ctxo-visualizer.html" target="_self">Ctxo Visualizer</a>
lets you explore the dependency graph of a real indexed repo.

## Proactive, not reactive

The core shift Ctxo enables: your agent stops *reacting* to files it stumbles
into and starts *planning* from a complete map. Blast radius before the edit.
Git intent before the bug fix. Importer list before the rename. The agent
still writes the code. It just stops writing it blind.

## Next steps

- [Installation](/introduction/installation)
- [Quick Start](/introduction/quick-start)
- [MCP Tools Overview](/mcp-tools/overview) - the 14 tools in detail
