---
title: "Product Brief: Ctxo"
status: "complete"
created: "2026-03-28"
updated: "2026-03-28"
inputs:
  - Project-Brief.md
  - artifacts/brainstorming/brainstorming-session-2026-03-28-1400.md
  - artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md
  - artifacts/architecture.md
---

# Product Brief: Ctxo

> *"Other tools get the code. Ctxo gets the context."*

## Executive Summary

AI coding assistants have a context problem. They see your code — but not your codebase. Ask Claude or Copilot to modify `processPayment`, and it works in isolation: blind to the eight downstream services that depend on it, the three interfaces it must satisfy, and the race condition fix from last Tuesday. The hallucinations that follow aren't a failure of AI intelligence — they're a failure of context.

**Ctxo** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI coding assistants the situational awareness of a well-onboarded senior developer. It assembles a *Logic-Slice* — the requested symbol plus all transitive dependencies, git-sourced intent, anti-pattern warnings, and change health scores — and delivers it in under 500ms on a warm index. Less noise. Fewer turns. Fewer broken builds.

Ctxo runs entirely on the developer's machine. Its index is committed alongside source code as per-file JSON — diffable in GitHub PRs, mergeable without conflicts, and shared across the team via `git pull`. A fresh `git clone` is immediately context-rich. CI keeps the index current automatically. The AI gets the codebase's institutional memory, not just its current state.

Getting started takes 30 seconds:
```bash
npx ctxo index         # builds the index for the first time (~10–30s for 1,000 files)
```
```json
{ "command": "npx", "args": ["-y", "ctxo"] }
```
That's the MCP client config line. One entry. Works with Claude Code, Cursor, VS Code Copilot, and any MCP-compatible client.

## The Problem

Modern codebases are dependency graphs. AI assistants treat them as flat text.

**Missing dependencies.** The AI modifies `processPayment` without knowing it implements `IPaymentService`, is consumed by `OrderController`, and is validated by `PaymentValidator` — all in separate files. The change compiles. It breaks runtime. The developer finds out in the next PR review, or in production.

**Missing history.** The AI rewrites a recursive mutex to an iterative one — cleaner, it thinks. What it can't know: that version was reverted three months ago because it caused deadlocks under load. The git history records this. The AI never saw it.

**Missing risk signal.** Before touching `AuthTokenValidator` — called by 34 other symbols — the AI has no signal that this is the most load-bearing function in the codebase. Blast radius is invisible until something breaks.

The tools that exist today operate at file or symbol level. They return code. They miss the rest.

## The Solution

Ctxo exposes five MCP tools. Each addresses a specific failure mode:

| Tool | Problem it solves | What it delivers |
|---|---|---|
| `get_logic_slice` | Missing dependencies | Symbol + all transitive deps (types, interfaces, helpers); L1→L4 progressive detail to manage context window size |
| `get_blast_radius` | Missing risk signal | Impact score: how many symbols break if this one changes, ranked by depth |
| `get_architectural_overlay` | Missing structure | Project layer map (Domain, Infrastructure, Adapters) — the bird's-eye view before editing |
| `get_why_context` | Missing history | Git commit intent per symbol; anti-pattern warnings surfaced from revert commits |
| `get_change_intelligence` | Missing health signal | Composite score: cyclomatic complexity × change frequency — surfaces hotspot code before the AI touches it |

All responses pass through a **privacy masking pipeline** — API keys, credentials, private IPs, and sensitive variable names are stripped before context reaches the model. Sensitive data never leaves the local machine.

The index lives in your repository as `.ctxo/index/` — one JSON file per source file, ~2–5MB for a 1,000-file codebase. Text-based. Diffable. Merge conflicts are scoped to individual files. The local SQLite query cache is gitignored and rebuilt in milliseconds from the committed JSON on any fresh clone.

## Anti-Pattern Memory

One capability deserves its own mention.

When a codebase goes through a bad decision — an approach that gets implemented, breaks something, and gets reverted — that knowledge is usually lost when the author leaves the team. It lives in a commit message, in a PR comment, in someone's memory.

Ctxo surfaces it. By detecting revert commits and attaching them to the affected symbols, `get_why_context` tells the AI: *"This approach was tried and abandoned — here's why."* It's the institutional memory that survives team turnover. It ships in every `git clone`.

## What Makes This Different

**Logic-Slice, not file-slice.** Competitors return the symbol you asked for. Ctxo returns the dependency graph rooted at that symbol — automatically resolved, no configuration required. The AI gets exactly what it needs to reason correctly, nothing more.

**Intent as first-class context.** Git history is structured data, not an afterthought. Ctxo turns commit messages into queryable context. The AI learns not just *what* the code does, but *why* it was written that way and *what was tried and abandoned*.

**Team memory, not personal memory.** The committed index is a shared team asset. Every developer, every AI assistant, and every CI run works from the same context graph. New team members get the full history on day one.

**Change intelligence before action.** No existing MCP tool identifies high-risk symbols before the AI starts editing. Ctxo's complexity×churn score gives the AI a pre-flight signal: this code is both hard to understand and frequently changed — proceed carefully.

**Nothing leaves the machine.** The entire pipeline runs locally. No cloud service, no telemetry, no account. For teams with security or compliance requirements, this is an architecture guarantee, not a policy choice.

## Who This Serves

**Primary — developers on AI-assisted complex codebases.**
Senior and mid-level developers who have adopted Claude Code or Cursor and are running into the ceiling of what those tools can do without deeper context. They've experienced the "missing type" error, the broken refactor, the AI that confidently does the wrong thing. They want the AI to behave like a capable colleague who's read the codebase — not a capable stranger who's seen one file.

**Secondary — engineering teams managing knowledge continuity.**
Teams onboarding new developers onto complex codebases, or teams that have lost institutional knowledge through attrition. The architectural overlay and anti-pattern memory serve human readers as much as AI assistants — Ctxo makes implicit knowledge explicit and persistent.

## Success Criteria

- **Performance:** Context delivery < 500ms on a warm index (1,000-file TypeScript codebase, measured at p95). MCP server startup < 100ms.
- **Adoption:** Index committed and shared by the majority of multi-developer teams using Ctxo. CI indexing pattern adopted by early enterprise users.
- **Quality:** Reduction in AI-generated changes that require immediate revert, measured via git history analysis with willing early adopter teams.
- **Ecosystem:** Verified compatibility with Claude Code, Cursor, and VS Code Copilot at V1 launch.

## Scope

**V1 — TypeScript / JavaScript (full feature set):**
Logic-Slice, Blast Radius, Architectural Overlay, Why-Context + Anti-Pattern Memory, Change Intelligence, Privacy Masking, Progressive Detail Levels (L1–L4), Monorepo auto-discovery, CI indexing gate, incremental file watching, `npx ctxo` install.

**V1.5 — Multi-language syntax tier:**
Go + C# via tree-sitter. Same five tools, AST-level analysis (no type inference). Addresses the backend and enterprise polyglot developer segment.

**V2 — Deep language analysis:**
Go: standalone `ctxo-go-analyzer` Go binary bundled inside `@ctxo/lang-go` (go/packages + types + SSA + CHA); delivered v0.8. C#: `ctxo-roslyn` .NET host bundled inside `@ctxo/lang-csharp`; delivered v0.6. Both require their respective toolchains on PATH; graceful tree-sitter fallback otherwise.

**Explicitly out of scope for V1:** Python support, cloud sync, SaaS model, standalone IDE plugin, remote index hosting, telemetry.

## Vision

Ctxo becomes the standard context layer for AI-assisted development — the package installed in every repository the way ESLint or Prettier is installed today.

In two years, the `.ctxo/index/` directory is as unremarkable as `.github/workflows/`. The committed index accumulates institutional memory — every architectural decision, every revert, every pattern that was tried and abandoned — queryable by any AI agent, readable by any developer.

The teams that adopt Ctxo earliest build the deepest context graphs. Their AI assistants get compoundingly better over time. The moat isn't the software — it's the institutional memory that grows with every commit.
