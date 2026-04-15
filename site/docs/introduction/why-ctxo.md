---
title: "Why Ctxo?"
description: "Agents code blind without a dependency graph. Ctxo replaces 10-20 grep/read calls with one semantic query."
---

# Why Ctxo?

> AI agents don't fail because they can't code. They fail because they code blind.

<div style="margin:28px 0 8px;padding:20px 24px;border-radius:14px;background:linear-gradient(135deg,rgba(20,184,166,0.08),rgba(2,132,199,0.08));border:1px solid rgba(20,184,166,0.25);">
  <h2 id="proactive-not-reactive" style="display:flex;align-items:center;gap:12px;margin:0 0 12px;padding:0;border:0;font-size:26px;letter-spacing:-0.02em;">
    <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#14b8a6,#0284c7);box-shadow:0 6px 20px rgba(13,148,136,0.3);flex-shrink:0;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    </span>
    <span style="background:linear-gradient(135deg,#14b8a6,#0284c7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">Proactive, not reactive</span>
  </h2>
  <p style="margin:0 0 10px;color:var(--vp-c-text-2);font-size:16px;line-height:1.65;">
    The core shift: your agent stops <em>reacting</em> to files it stumbles into and starts <em>planning</em> from a complete map. Blast radius before the edit. Git intent before the bug fix. Importer list before the rename.
  </p>
  <p style="margin:0;color:var(--vp-c-text-2);font-size:15px;line-height:1.6;">
    The agent still writes the code. It just stops writing it blind — so the bug never has to be caught by the compiler, the tests, CI, or a user.
  </p>
</div>

Modern AI agents are fluent at writing code. They are not fluent at
understanding what it touches. Every unseen dependency, every reverted
pattern, every subclass that nobody warned them about becomes a bug that
surfaces **later** - where fixing it is exponentially more expensive:

| Stage where a blind edit is caught | Cost to fix |
| --- | --- |
| **Compile / type-check** | Minutes. One more iteration. |
| **Unit tests** | Tens of minutes. Re-run, re-diagnose, re-edit. |
| **Integration / CI** | Hours. Someone else is blocked. |
| **Runtime / production** | Days. Users hit it. A revert is on the table. |

Each stage is **reactive**. The agent writes, something breaks, the agent
patches, something else breaks. Token budgets balloon, latency compounds,
dev time drags, trust in the agent erodes.

Ctxo flips this. Before the agent writes a single line, [`get_blast_radius`](/mcp-tools/get-blast-radius)
tells it every caller and subclass that will be affected; [`get_why_context`](/mcp-tools/get-why-context)
surfaces the revert from three weeks ago; [`get_logic_slice`](/mcp-tools/get-logic-slice) delivers
exactly the deps it needs inside the token budget. The problem never
happens - it is resolved **at authoring time**, not caught downstream.

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

## Next steps

- [Installation](/introduction/installation)
- [Quick Start](/introduction/quick-start)
- [MCP Tools Overview](/mcp-tools/overview) - the 14 tools in detail
