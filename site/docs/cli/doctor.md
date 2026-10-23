---
title: "ctxo doctor"
description: "Health check every subsystem."
---

# ctxo doctor

Runs a series of independent health checks against your project and
environment, then reports each result as `pass`, `warn`, or `fail`. With
`--fix`, it applies remediation in dependency order (config first, plugins and
index last).

## Synopsis

```shell
ctxo doctor [options]
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--json` | `false` | Emit the full report as JSON on stdout |
| `--quiet` | `false` | Only print failures and warnings |
| `--fix` | `false` | Apply remediation for auto-fixable failures |
| `--dry-run` | `false` | Only with `--fix`. Print planned actions, do not execute |
| `--yes`, `-y` | `false` | Only with `--fix`. Required in CI (`CI=true`) to apply changes |

## Checks run

| Check | What it verifies |
| --- | --- |
| Versions | Core vs. plugin API compatibility |
| Node version | Node >= 20 |
| Git binary | `git` is on `PATH` |
| Git repo | cwd is inside a git working tree |
| Git hooks | The `post-commit` hook has exactly one current ctxo block (v2). Warns when it is missing, outdated (v1) or duplicated. In a shared global or system `core.hooksPath` directory, which ctxo will not write to, the warning says so and the fix is to add the block by hand; a current block added by hand passes. Passes outside a git repository |
| AI rules (`ai_rules`) | Each AI rules file that exists (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/ctxo.mdc` and the rest) has no ctxo block, or one current block. Warns on an outdated block (unversioned, an older template version, or the current version with an edited body), on a `CLAUDE.md` block that expects the safe-edit guard while it is missing, on a current block in the wrong tier, on several ctxo blocks in one file, on a start marker without an end marker, and on an end marker without a start marker. A block written by a newer ctxo passes. A block that differs only in formatting (line endings, a BOM, trailing whitespace, blank lines, table padding, line wrapping) is current. A compact block expects every skill readable and current. Files linked to each other (an `AGENTS.md` that is a hard link or a symlink to `CLAUDE.md`) are one file, reported once under its first name and expected in the full tier |
| Agent skills (`skills`) | The three ctxo skills are installed and match the bundled copies, for Claude Code (`.claude/skills/`) and Cursor (`.cursor/rules/`). Checked only where the skills are expected: one ctxo skill is already installed, or the tool's rules block is pre-tier or compact. Warns on missing or outdated skills (no `<!-- ctxo-skill v<version> -->` marker, an older one, or changed text). A copy that differs only in formatting is current, and a skill from a newer ctxo (a newer marker) is not reported |
| Claude guard hook (`claude_guard_hook`) | The safe-edit guard (`ctxo gate-hook`) is registered in `.claude/settings.json` or `.claude/settings.local.json`. Warns when `.claude/settings.json` cannot be read safely (invalid JSON, JSONC comments, or an unexpected shape; repair it by hand, ctxo never overwrites it), and when the guard is missing while the `CLAUDE.md` block expects it (pre-tier or compact) and the gate is enabled |
| Index directory | `.ctxo/index/` exists and is readable |
| Index freshness | JSON index matches source hashes |
| SQLite cache | `.ctxo/.cache/symbols.db` present and usable |
| Config file | `.ctxo/config.yaml` is valid YAML and conforms to the schema; invalid `index.*` and `cochange.include` / `cochange.exclude` globs are warned about |
| ts-morph, tree-sitter | Runtime parsers load |
| Language coverage | Every detected language has a registered plugin (at least 5 `.sql` files that are also at least 2% of all files suggest `@ctxo/lang-sql`) |
| Java analysis tier (`java_tier`) | Which Java tier is active |
| C# analysis tier (`csharp_tier`) | Which C# tier is active, and whether the Roslyn helper can restore its NuGet packages. See [below](#c-analysis-tier) |
| Disk usage | Free space sufficient for the index |
| Symbol / Edge count | Sanity bounds |
| Orphaned files | No stale entries in `.ctxo/index/` |
| Co-changes cache | Present and readable |
| Schema version | Matches the current core |

The AI rules, Agent skills and Claude guard hook checks report drift as `warn`,
never `fail`. A deliberate opt-out passes: a versioned full rules block in
`CLAUDE.md` (the guard and the skills declined) or `gate.enabled: false` (the
guard declined). See [`ctxo init`](./init.md#the-rules-block) for the tiers.

### C# analysis tier

The `csharp_tier` check runs `dotnet restore` on the `ctxo-roslyn` helper of the
`@ctxo/lang-csharp` your project resolves (120 s timeout), but only when the
first three outcomes below do not apply. It has five outcomes:

| Situation | Status | Message |
| --- | --- | --- |
| No C# sources (no `.sln` or `.csproj` in the root, no `.cs` file within four levels) | `pass` | `no C# sources detected` |
| No .NET 8+ SDK | `pass` | `syntax tier (install the .NET 8+ SDK for the full tier)` |
| `@ctxo/lang-csharp` not resolvable from the project | `pass` | `syntax tier (@ctxo/lang-csharp not installed)` |
| The helper restores | `pass` | `full tier (.NET SDK <version>, Roslyn helper restores)` |
| The restore fails or times out | `warn` | `syntax tier: the Roslyn helper could not restore (<first error line>)` |

The warning's fix hint: make `Microsoft.SqlServer.TransactSql.ScriptDom` and the
`Microsoft.CodeAnalysis` packages reachable from your NuGet sources (nuget.org
or a mirror), then run `ctxo index`. Until then the C# plugin falls back to
tree-sitter: symbols and attribute annotations (literal arguments only) are
kept, the Roslyn-only annotation details and the SQL call-site edges are lost.
The language coverage check already reports a missing plugin, so the third row
passes.

## Remediation order (`--fix`)

`--fix` applies attempts in dependency order, skipping later steps when an
earlier one fails:

1. **Config** - write a default `.ctxo/config.yaml` if missing or invalid.
2. **Git hooks** - install or upgrade the `post-commit` and `post-merge` hooks in place (an outdated v1 post-commit block becomes v2, duplicate blocks are collapsed). A shared global or system `core.hooksPath` is skipped, not failed: the hook files are left untouched and the blocks to add by hand are printed.
3. **Skills** - install missing or outdated ctxo skills for each tool that expects them. An edited copy of a ctxo skill is replaced with the bundled one; to customise a skill, copy it under another name. A skill from a newer ctxo is left alone and reported as a warning line. A tool that fails does not stop the next one; the step then fails, naming each failure, including a skill path ctxo cannot write (such as a directory).
4. **Claude guard hook** - register `ctxo gate-hook` in `.claude/settings.json` when the `CLAUDE.md` block expects it and the gate is enabled. A `.claude/settings.json` that cannot be read safely is never written: the step fails with a message to repair it. When no guard is expected (an opt-out, `gate.enabled: false`, or no ctxo block), the step is skipped, readable file or not.
5. **AI rules** - re-render each ctxo rules block in the tier the disk now supports. Runs whenever any of the AI rules, Agent skills or Claude guard hook checks warned, after steps 3 and 4, so the tier follows what this run installed. A block from a newer ctxo is left alone. A damaged block (a start marker without an end marker, or an end marker without a start marker) is left unchanged and fails the step with the reason; repair it by hand.
6. **Language coverage** - run [`ctxo install`](./install.md) for missing plugins.
7. **Index** - run [`ctxo index`](./index.md) (requires step 6 to have succeeded).
8. **SQLite cache** - run [`ctxo sync`](./sync.md).

A failure in steps 3 to 5 is reported, and the later steps still run.

Steps 3 to 5 never install what you declined. A versioned full rules block in
`CLAUDE.md` (what `ctxo init` writes without the guard, for example with
`--no-guard`) records that you opted out of the guard and the skills, and
`gate.enabled: false` that you opted out of the guard.

Step 5 holds the `CLAUDE.md` block (and Cursor's, for its skills) unchanged
while the guard or the skills it expects are still not in place, whatever
stopped them: an unreadable `.claude/settings.json`, or a failed install.
Rendering it then would write a full block, which reads as an opt-out you never
made. A rules file linked to a held one is held with it. The step reports the
hold, and `ctxo doctor` keeps reporting the missing pieces until they are
fixed; the next `--fix` after the repair renders the block. `ctxo init` holds
blocks by the same rule (see [Held blocks](./init.md#held-blocks)).

Every attempt is appended to `.ctxo/doctor-fix.log` for forensics.

::: warning CI safety
`--fix` refuses to mutate anything under `CI=true` unless you pass `--yes`.
This keeps the command safe to expose in shared scripts.
:::

## Examples

::: code-group
```shell [human report]
ctxo doctor
```

```shell [quiet]
# Only print non-passing checks — good for shell prompts.
ctxo doctor --quiet
```

```shell [machine readable]
# Pipe to jq for dashboards.
ctxo doctor --json | jq '.checks | map(select(.status != "pass"))'
```

```shell [dry-run fix]
ctxo doctor --fix --dry-run
```

```shell [apply fixes in CI]
ctxo doctor --fix --yes
```
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | All checks passed |
| `1` | One or more checks failed |
| `2` | `--fix` halted before completing (a dependency step failed) |

## See also

- [`ctxo install`](./install.md), [`ctxo index`](./index.md),
  [`ctxo sync`](./sync.md) — the individual commands `--fix` orchestrates.
- [.ctxo/config.yaml reference](./config-yaml.md).
