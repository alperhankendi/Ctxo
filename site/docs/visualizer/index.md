---
title: Visualizer
description: Explore your codebase index interactively — dependency graph, dead code, blast radius.
---

# Ctxo Visualizer

A self-contained single-page web app that lets you explore the Ctxo index
visually — the same graph the MCP tools query, but rendered for humans.

<div style="display:flex;gap:12px;flex-wrap:wrap;margin:24px 0;">
  <a href="/Ctxo/ctxo-visualizer.html" target="_self"
     style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;
            background:linear-gradient(135deg,#14b8a6,#0284c7);color:#fff;
            border-radius:8px;text-decoration:none;font-weight:700;
            font-family:'JetBrains Mono',monospace;font-size:13px;
            box-shadow:0 4px 14px rgba(13,148,136,0.25);">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
    Codebase Dashboard →
  </a>
  <a href="/Ctxo/visualize.html" target="_self"
     style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;
            background:linear-gradient(135deg,#0284c7,#7c3aed);color:#fff;
            border-radius:8px;text-decoration:none;font-weight:700;
            font-family:'JetBrains Mono',monospace;font-size:13px;
            box-shadow:0 4px 14px rgba(2,132,199,0.25);">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/><path d="M2 12h20"/>
    </svg>
    Dependency Graph →
  </a>
  <a href="/cli/visualize" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;
            background:transparent;border:1px solid var(--vp-c-border);
            border-radius:8px;text-decoration:none;font-weight:700;
            font-family:'JetBrains Mono',monospace;font-size:13px;">
    Build from CLI
  </a>
</div>

::: tip How to get here
Run <code>npx ctxo visualize</code> in any indexed project. The CLI generates a
static HTML file and opens it in your browser.
:::

## What you see

![Visualizer full view](/img/visualize-00-light.png)

The graph layout is force-directed: symbols cluster by connectivity, edges show
imports / calls / extends / implements / uses. Node size scales with PageRank
(centrality), colour encodes dead-code status.

## Dashboard

![Dashboard](/img/ui-dashboard.png)

The left panel summarises your codebase at a glance:

- **Symbol count** broken down by kind (function / class / interface / ...)
- **Dead code percentage** and scaffolding markers (TODO / FIXME / HACK)
- **Change intelligence bands** — which files carry the most complexity × churn
- **Anti-pattern counts** — reverted code and hot-revert hotspots

## Search

![Search](/img/ui-search.png)

The search bar runs the same two-phase ranker as
[`get_ranked_context`](/mcp-tools/get-ranked-context):

1. **BM25** lexical pass (camelCase-aware, trigram fallback for typos)
2. **PageRank re-rank** within the matching candidate set

Query-free browsing (blank box) is also supported — the list falls back to
global PageRank order.

## Detail panel

![UI detail](/img/ui.png)

Click any node to see:

- Its **Logic-Slice** (symbol + transitive dependencies, what the MCP agent
  would receive)
- **Blast radius** tiers (confirmed / likely / potential) with impact score
- **Git intent** — recent commits touching the symbol + anti-pattern warnings
- Incoming / outgoing edges with their kinds

## Features

| Feature | What it does | MCP equivalent |
| --- | --- | --- |
| Force-directed graph | Visual cluster discovery | [`get_architectural_overlay`](/mcp-tools/get-architectural-overlay) |
| Node sizing | PageRank centrality | [`get_symbol_importance`](/mcp-tools/get-symbol-importance) |
| Dead-code highlighting | Flags unreachable + unused-export symbols | [`find_dead_code`](/mcp-tools/find-dead-code) |
| Click = detail panel | Logic-Slice + blast + history | [`get_logic_slice`](/mcp-tools/get-logic-slice) + [`get_blast_radius`](/mcp-tools/get-blast-radius) + [`get_why_context`](/mcp-tools/get-why-context) |
| Top-N filter | Zoom into PageRank top symbols | `--max-nodes` flag on [`ctxo visualize`](/cli/visualize) |
| Full-text search | Find symbols without knowing the exact name | [`get_ranked_context`](/mcp-tools/get-ranked-context) |

## Related

- [`ctxo visualize` CLI command](/cli/visualize) — flags, output location, browser behaviour
- [Dependency graph concept](/concepts/dependency-graph) — the underlying data model
- [PageRank importance](/concepts/pagerank) — how nodes are sized
- [Dead code detection](/mcp-tools/find-dead-code) — how dead-code tagging works
