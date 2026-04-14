---
title: Ctxo Documentation
description: Dependency-aware, history-enriched context for AI coding assistants
---

# Ctxo Documentation

> AI agents don't fail because they can't code. They fail because they code
> blind. Ctxo gives them the full picture before they write a single line.

Ctxo is a **Model Context Protocol (MCP) server** that delivers Logic-Slices to
AI coding assistants: a symbol plus its transitive dependencies, git intent,
anti-pattern warnings, and change health scores in under 500ms.

## Getting Started

- [Quick Start](/quick-start) — install and index in under 2 minutes

## MCP Tools

All 14 tools exposed over MCP stdio:

- [get_logic_slice](/mcp-tools/get-logic-slice) — symbol + transitive deps

## Comparisons

Real-world side-by-side evidence:

- [Blast Radius Analysis](/comparisons/blast-radius) — ctxo vs manual dependency tracing
- [Dead Code Analysis](/comparisons/dead-code) — ctxo vs knip / tsr / deadcode

## External

- [Landing page](/Ctxo/) — the Ctxo pitch
- [Visualizer](/Ctxo/ctxo-visualizer.html) — interactive dependency graph
- [GitHub](https://github.com/alperhankendi/Ctxo) — source code
