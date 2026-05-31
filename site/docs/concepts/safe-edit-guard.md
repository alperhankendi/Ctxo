---
title: "Safe-Edit Guard"
description: "A layered defense that stops coding agents from editing high-impact symbols without first checking blast radius."
---

# Safe-Edit Guard

AI agents don't fail because they can't code. They fail because they code blind. Ctxo gives them the full picture before they write a single line.

The safe-edit guard is a layered defense that makes coding agents reliably check
blast radius before touching a high-impact symbol. It addresses a real
failure mode: an agent locates a function, makes a seemingly targeted edit,
and walks away. It never checked what called that function. Downstream callers
silently break. Tests pass because the agent only ran the tests in the same file.

The guard closes this loop deterministically - without relying on the agent
remembering to do the right thing.

## Layered defense

Three layers work together:

| Layer | Mechanism | Enforces? | Platforms |
| --- | --- | --- | --- |
| **Rules** | AI tool rule files (`CLAUDE.md`, `.cursor/rules/ctxo.mdc`, etc.) | No - guidance only | All platforms |
| **Skills** | Model-invoked skill files the agent reads at task start and before edits | No - instructions only | Claude Code, Cursor |
| **Hook** | PreToolUse hook in `.claude/settings.json` that intercepts Edit calls | Yes - blocks the edit | Claude Code only |

Each layer compensates for the weaknesses of the one above. Rules are read
only when the agent consults them. Skills are passive instructions. The hook
fires on every Edit call, regardless of whether the agent followed the rules.

## How the hook works

When the agent tries to call the Edit tool on a high-impact symbol:

1. `ctxo gate-hook` runs as a PreToolUse hook before the Edit is executed.
2. It checks whether `get_blast_radius` has already been called for that symbol in the current session.
3. If not, the hook blocks the edit and returns a message telling the agent what to run.
4. The agent calls `get_blast_radius`, then re-issues the Edit.
5. The hook passes it through - the symbol is marked as checked for the rest of the session.

**Fail-open:** if the gate-hook process errors, crashes, or times out, the edit
is allowed through. The guard is a safety net, not a hard dependency.

**Block-once:** the hook only fires the first time per symbol per session. If
the agent has already checked blast radius for `buildGraph` earlier in the same
session, the next edit to `buildGraph` goes through without interruption.

## What makes a symbol "high-impact"

Two signals, both must exceed the threshold:

- **Blast radius** - confirmed + likely dependents (counted from the index graph)
- **PageRank percentile** - how central the symbol is in the import graph

The `sensitivity` setting in `.ctxo/config.yaml` controls both thresholds:

| Sensitivity | PageRank percentile | Min dependents floor |
| --- | --- | --- |
| `strict` | top 30% | 2 |
| `balanced` (default) | top 15% | 3 |
| `lenient` | top 5% | 5 |

The thresholds are **repo-relative**, not fixed numbers. A symbol must clear
both the percentile cut and the dependents floor to be flagged. This keeps the
guard meaningful across projects of different sizes.

## Skills

Three model-invoked skills are installed by `ctxo init`:

| Skill | When to use | What it does |
| --- | --- | --- |
| `ctxo-understand` | Start of any task | Run `get_context_for_task` before reading source files |
| `ctxo-safe-edit` | Before any edit, rename, or delete | Run `get_blast_radius` and `get_why_context` first |
| `ctxo-review-pr` | When reviewing a diff or PR | Run `get_pr_impact` for full risk assessment |

Skills live in `.claude/skills/<name>/SKILL.md` (Claude Code) and
`.cursor/rules/<name>.mdc` (Cursor). They are passive markdown files - the
agent reads them but they do not execute code. The PreToolUse hook is what
actually blocks edits.

## Platform capability matrix

| Platform | Hook enforcement | Skills | Rules |
| --- | --- | --- | --- |
| **Claude Code** | Yes - PreToolUse blocks the edit | Yes | Yes |
| **Cursor** | No - Cursor has no blocking pre-edit hook (confirmed through v3.6) | Yes | Yes |
| **GitHub Copilot, Windsurf, Cline, others** | No | Where supported | Yes |

Cursor gets meaningful protection through skills (the model reads `ctxo-safe-edit`
before editing) and rules, but the edit cannot be blocked deterministically the
way it can in Claude Code.

## Setup

```shell
# Run init - answer yes to the safe-edit guard prompt
ctxo init

# Preview which symbols would be flagged at current sensitivity
ctxo gate --preview

# Check blast radius for a specific symbol (scripting / CI)
ctxo blast-radius "src/core/graph.ts::buildGraph::function" --json
```

## Configuration

```yaml
# .ctxo/config.yaml
gate:
  enabled: true
  sensitivity: balanced   # strict | balanced | lenient
```

Set `gate.enabled: false` to disable the hook entirely while keeping skills and rules.

## See also

- [`ctxo gate --preview`](/cli/gate) - preview the flagged symbol set
- [`ctxo blast-radius`](/cli/blast-radius) - CLI blast radius lookup
- [`ctxo init`](/cli/init) - installs the hook and skills
- [Config schema](/reference/config-schema) - `gate:` field reference
- [ADR-013 - Safe-Edit Guard](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-013-safe-edit-guard.md) - architectural decision record
