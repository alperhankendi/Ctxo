<div align="center">

[![npm version](https://img.shields.io/npm/v/@ctxo/cli.svg)](https://www.npmjs.com/package/@ctxo/cli)
[![CI](https://github.com/alperhankendi/Ctxo/actions/workflows/ci.yml/badge.svg)](https://github.com/alperhankendi/Ctxo/actions/workflows/ci.yml)
[![Release](https://github.com/alperhankendi/Ctxo/actions/workflows/release.yml/badge.svg)](https://github.com/alperhankendi/Ctxo/actions/workflows/release.yml)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/hero-svg.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/img/hero-svg.svg">
  <img alt="Ctxo — Code intelligence for AI agents" src="docs/img/hero-svg.svg" width="100%">
</picture>

```Shell
npx @ctxo/cli init
npx @ctxo/cli index
```

<a href="https://alperhankendi.github.io/Ctxo/docs/">
  <img src="https://img.shields.io/badge/Get%20Started-%E2%86%92-06b6d4?style=for-the-badge&labelColor=0f172a" alt="Get Started →">
</a>

<sub>Detects your languages, installs the right plugins, wires Ctxo into your AI client, installs git hooks, and builds the first index  one command.</sub>

</div>

***

## The Problem: agents code blind

Drop a modern coding agent into a real repo. It ripgreps a symbol, gets 47 hits, reads five files to find the definition, five more for callers  **misses the subclass entirely** (inheritance doesn't show up in text search), **never checks git history** (and confidently reintroduces a bug that was reverted three weeks ago), then runs out of context and starts hallucinating.

It's not a skill gap. It's a **sensory gap**. The agent is navigating your codebase with its eyes closed and a phone book.

## The Solution: proactive, not reactive

The core shift: your agent stops reacting to files it stumbles into and starts planning from a complete map. **Blast radius before the edit. Git intent before the bug fix. Importer list before the rename.**

Ctxo indexes your repo once kept fresh by file watchers and git hooks into a deterministic graph: every symbol, every edge (imports, calls, extends, implements), every relevant git commit with intent classified, every anti-pattern. All exposed through 14 semantic MCP tools.

One `get_blast_radius` call replaces an entire ripgrep/read spiral. One `get_pr_impact` replaces a full review session of "wait, what calls this?"

The agent still writes the code. It just stops writing it **blind** so the bug never has to be caught by the compiler, the tests, CI, or a user.

## Codebase Dashboard

Full-stack analytics UI with eight views: File Tree, Heatmap, Co-Changes, Timeline, Architecture, MCP Explorer, and Diff. Deployed to GitHub Pages on every push.

![Codebase Dashboard](docs/img/ui.png)

[Open Dashboard](https://alperhankendi.github.io/Ctxo/ctxo-visualizer.html)

## Dependency Graph

`ctxo visualize` generates a self-contained HTML from your `.ctxo/` index. Interactive force-directed graph with PageRank sizing, layer coloring, blast radius on click, and dark/light theme.

![Dependency Graph](docs/img/visualize-00-light.png)

[Open Dependency Graph](https://alperhankendi.github.io/Ctxo/visualize.html)

## Links

* [Docs](https://alperhankendi.github.io/Ctxo/docs/)  quick start, MCP tools, CLI reference, integrations
* [npm](https://www.npmjs.com/package/@ctxo/cli)
* [Changelog](CHANGELOG.md)
* [LLM Reference](llms-full.txt)

## License

MIT
