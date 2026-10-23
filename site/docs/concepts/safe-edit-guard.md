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
| **Rules** | AI tool rule files (`CLAUDE.md`, `.cursor/rules/ctxo.mdc`, etc.): compact for Claude Code with the guard and skills, full elsewhere | No - guidance only | All platforms |
| **Skills** | Model-invoked skill files the agent reads at task start and before edits | No - instructions only | Claude Code, Cursor |
| **Hook** | PreToolUse hook in `.claude/settings.json` that intercepts Edit calls | Yes - blocks the edit | Claude Code only |

Each layer compensates for the weaknesses of the one above. Rules are read
only when the agent consults them. Skills are passive instructions. The hook
fires on every Edit call, regardless of whether the agent followed the rules.

## Tiered rules

The rules file is loaded into every session, so on Claude Code ctxo keeps it
short when the other two layers back it up. With the guard hook registered, all
three skills installed and `gate.enabled` not `false`, `ctxo init` writes this
compact block into `CLAUDE.md`:

```markdown
<!-- ctxo-rules-start v0.13 -->

## ctxo

This repo has a ctxo index: dependency graph, git intent, change health. For structural questions (who depends on X, what breaks if X changes, why X looks like this), use the ctxo MCP tools before grepping.
A pre-edit guard blocks the first edit to a high-impact symbol until `get_blast_radius` has been called for it.
Skills: `ctxo-understand` (orient at task start), `ctxo-safe-edit` (before changing a symbol), `ctxo-review-pr` (before reviewing a diff).

<!-- ctxo-rules-end -->
```

The number after `v` is the rules template version. The blank lines are the
layout Prettier prints, so a repo that formats its markdown leaves the block
alone; ctxo also compares blocks with formatting ignored. The compact block is
at most 8 non-blank lines including the markers (6 today).

Every other tool, Claude Code without one of those three, and a `CLAUDE.md`
that another tool reads too (an `AGENTS.md` or `GEMINI.md` linked to it) get the
full block with the complete tool guide. Its first rule reads: "For structural
questions (dependencies, impact, history), use ctxo tools first; reading a file
to see its contents needs no index call."

The block sits between versioned markers, so re-running `ctxo init` or
`ctxo doctor --fix` replaces it in place and keeps the rest of the file. A
block that expects the guard and the skills is never turned into a full block
while they are missing and you did not decline them: init and `--fix` leave it
unchanged and say why. See [`ctxo init`](/cli/init#the-rules-block) for the
details.

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

**Session state on disk:** `ctxo gate-hook` runs as a new process for each Edit
call. It records the symbols it already warned about in
`.ctxo/.cache/gate/<session_id>.json` and also accepts a `get_blast_radius`
call found in the session transcript, so the state survives an MCP server
restart.

**Edit only:** the hook is registered with matcher `Edit`. `Write` (new files
and whole-file rewrites) and `NotebookEdit` are not gated.

## What makes a symbol "high-impact"

Two signals, both must exceed the threshold:

- **Blast radius** - confirmed + likely dependents (counted from the index graph). `likely` includes dependents upgraded by co-change history, so the guard can fire somewhat more often than it would on the graph alone; `ctxo gate --preview` shows the effect
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
| `ctxo-understand` | Start of any task, or a structural question | Run `get_context_for_task`, and pick the right tool from a question-to-tool table that covers all 14 tools. Reading a file to see its contents needs no index call |
| `ctxo-safe-edit` | Before any edit, rename, or delete | Run `get_blast_radius` and `get_why_context` first |
| `ctxo-review-pr` | When reviewing a diff or PR | Run `get_pr_impact` for full risk assessment |

Skills live in `.claude/skills/<name>/SKILL.md` (Claude Code) and
`.cursor/rules/<name>.mdc` (Cursor). They are passive markdown files - the
agent reads them but they do not execute code. The PreToolUse hook is what
actually blocks edits.

Each skill ends with a version marker such as `<!-- ctxo-skill v0.13 -->`. A
skill written by a newer ctxo is left alone by an older one, so teammates on
different versions do not rewrite each other's skills.

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
# Run init - answer yes to the safe-edit guard prompt (asked when Claude Code is selected)
ctxo init

# Add the guard and the skills to an existing setup; the rules block follows
ctxo init --only rules,skills,guard --tools claude-code -y

# Set up without the guard; CLAUDE.md then gets the full rules block (unless a guard is already registered)
ctxo init --no-guard

# Preview which symbols would be flagged at current sensitivity
ctxo gate --preview

# Check blast radius for a specific symbol (scripting / CI)
ctxo blast-radius "src/core/graph.ts::buildGraph::function" --json
```

`--no-guard` skips the guard and its question; it does not remove a guard that
is already registered.

## Doctor checks

`ctxo doctor` watches all three layers and reports drift as a warning:

| Check | Warns when |
| --- | --- |
| `ai_rules` | A rules block is outdated, duplicated, damaged (a start marker without an end marker, or the reverse) or in the wrong tier, or `CLAUDE.md` expects the guard and it is missing |
| `skills` | A ctxo skill is missing or differs from the bundled copy (formatting aside), where the skills are expected; a skill from a newer ctxo is not reported |
| `claude_guard_hook` | `.claude/settings.json` cannot be read safely, or the guard is missing while `CLAUDE.md` expects it |

`ctxo doctor --fix` installs the skills and the guard, then re-renders the rules
blocks in the tier that now applies. Like `ctxo init`, it keeps the `CLAUDE.md`
block unchanged until the guard and the skills are actually in place, and it never installs
what you declined: a versioned full block (written without the guard) and
`gate.enabled: false` count as opt-outs. An edited ctxo skill is replaced with
the bundled copy, so put a customised skill under another name. See
[`ctxo doctor`](/cli/doctor) for the order of the fixes.

## Configuration

```yaml
# .ctxo/config.yaml
gate:
  enabled: true
  sensitivity: balanced   # strict | balanced | lenient
```

Set `gate.enabled: false` to disable the hook entirely while keeping skills and rules. `ctxo init` then writes the full rules block for Claude Code, and `ctxo doctor` stops expecting the guard.

## See also

- [`ctxo gate --preview`](/cli/gate) - preview the flagged symbol set
- [`ctxo blast-radius`](/cli/blast-radius) - CLI blast radius lookup
- [`ctxo init`](/cli/init) - installs the hook, the skills and the rules
- [`ctxo doctor`](/cli/doctor) - reports and fixes drift in all three layers
- [Config schema](/reference/config-schema) - `gate:` field reference
- [ADR-015 - Safe-Edit Guard](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-015-safe-edit-guard.md) - architectural decision record, with the tiered rules amendment
