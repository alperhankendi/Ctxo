---
title: "ctxo init"
description: "Bootstrap a project: git hooks, safe-edit guard, skills, and plugin install."
---

# ctxo init

Bootstraps a project for ctxo. Runs four steps:

1. Ensures `.ctxo/index/` and `.ctxo/config.yaml` exist.
2. Generates MCP usage rules for the AI tools you use and registers the ctxo
   MCP server in their config files. Supported tool ids: `claude-code`,
   `cursor`, `github-copilot`, `windsurf`, `antigravity`, `augment`, `amazonq`,
   `gemini-cli`, `continue`.
3. Installs the safe-edit guard hook and model-invoked skills (Claude Code and Cursor).
4. Offers to install missing language plugins and to install git hooks that
   re-index each commit (`ctxo index --commit HEAD`, once per commit) and
   rebuild the SQLite cache on merge.

Requires a git repository (run `git init` first).

## Synopsis

```shell
ctxo init [options]
```

## Flags

| Flag | Short | Default | Description |
| --- | --- | --- | --- |
| `--yes` | `-y` | `false` | Non-interactive. Install everything, skip prompts. Combine with `--tools` to pick tools |
| `--tools <list>` | | | Comma-separated list of AI tool ids (for example `claude-code,cursor`). Implies non-interactive |
| `--rules` | | `false` | Only regenerate AI tool rule files. Skips index dir, plugins, and git hooks |
| `--no-install` | | `false` | Skip the language-plugin detection prompt (and the implicit install under `--yes`) |
| `--dry-run` | | `false` | Print the files that would be created or modified and exit. The hook lines name the hooks directory git resolves (so `core.hooksPath` shows up), or a skipped shared directory |

## What it writes

| Path | Notes |
| --- | --- |
| `.ctxo/index/` | Created if missing (holds per-file JSON indices) |
| `.ctxo/config.yaml` | Default config is dropped if absent. See [config reference](./config-yaml.md) |
| `.gitignore` | `.ctxo/.cache/` appended if not already present |
| AI rule files | Per selected tool: `CLAUDE.md`, `.cursor/rules/ctxo.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, `AGENTS.md`, `augment-guidelines.md`, `.amazonq/rules/ctxo.md`, `GEMINI.md`, `.continue/rules/ctxo.md` |
| AI MCP configs | Per selected tool: `.mcp.json` (Claude Code / Cursor / Windsurf / Antigravity / Augment), `.vscode/mcp.json` (Copilot), `.amazonq/mcp.json`, `.gemini/settings.json`, `.continue/mcpServers/ctxo.json` |
| `.claude/settings.json` | Registers the `ctxo gate-hook` PreToolUse hook (Claude Code only) |
| `.claude/skills/ctxo-understand/SKILL.md` | Model-invoked skill: orient at task start (Claude Code) |
| `.claude/skills/ctxo-safe-edit/SKILL.md` | Model-invoked skill: blast radius + why-context before edits (Claude Code) |
| `.claude/skills/ctxo-review-pr/SKILL.md` | Model-invoked skill: PR risk via `get_pr_impact` (Claude Code) |
| `.cursor/rules/ctxo-understand.mdc` | Same skill for Cursor |
| `.cursor/rules/ctxo-safe-edit.mdc` | Same skill for Cursor |
| `.cursor/rules/ctxo-review-pr.mdc` | Same skill for Cursor |
| `post-commit` hook | Re-indexes the files the commit changed with `ctxo index --commit HEAD` (versioned block, marked `# ctxo-start v2` / `# ctxo-end`) |
| `post-merge` hook | Runs `ctxo sync` after `git pull` (block marked `# ctxo-start` / `# ctxo-end`) |

The hooks live in the directory git resolves for the repository (`git rev-parse --git-path hooks`): `.git/hooks`, or the directory `core.hooksPath` names. See [Git hooks](#git-hooks) below.

## Safe-edit guard prompt

When `ctxo init` detects Claude Code or Cursor, it asks whether to install the safe-edit guard. Answering yes writes the hook entry to `.claude/settings.json` and copies the three skills. The guard is enabled by default at `balanced` sensitivity; tune it via `gate:` in `.ctxo/config.yaml`:

```yaml
gate:
  enabled: true
  sensitivity: balanced   # strict | balanced | lenient
```

Use `ctxo gate --preview` to see which symbols the current sensitivity level would flag before committing to it. See the [Safe-Edit Guard guide](/concepts/safe-edit-guard) for the full explanation.

::: tip Skills are passive instructions
Skills are markdown files the model reads - they do not execute code. The PreToolUse hook in `.claude/settings.json` is the only thing that actually blocks an edit. Skills guide the agent toward running `get_blast_radius` proactively.
:::

::: tip Hooks are safe to re-run
The hook installer finds the `# ctxo-start` / `# ctxo-end` block, replaces it
in place when it is outdated, and leaves the rest of the hook file as it was.
You can safely re-run `ctxo init` to pick up new AI tool rules or a newer hook.
:::

## Git hooks

The post-commit block (version 2) is:

```sh
# ctxo-start v2
# Incremental re-index of the files changed by this commit (one run per commit)
if [ -d .ctxo ] && command -v ctxo >/dev/null 2>&1; then
  ctxo index --commit HEAD >/dev/null 2>&1 || true
fi
# ctxo-end
```

- **One run per commit.** Version 1 ran `ctxo index --file <path>` once per changed file, which re-parsed the project for every file and wrote one community snapshot per run. Version 2 re-indexes the commit once, refreshes the co-change matrix from git, and records one snapshot for the commit. See [`ctxo index`](./index.md#incremental-runs-files-commit).
- **Guarded.** The block does nothing unless the repository has a `.ctxo` directory and `ctxo` is on `PATH`, and it never fails a commit. The post-merge block has the same guard.
- **Upgrades in place.** `ctxo init` and [`ctxo doctor --fix`](./doctor.md) replace an older block (including the unversioned v1 block) with the current one, keep the lines you wrote before and after it, and collapse duplicate ctxo blocks into one.
- **Shared hooks directories are not written to.** When `core.hooksPath` is set in your global or system git config, the hooks directory is shared by every repository on the machine. `ctxo init` and `ctxo doctor --fix` then write nothing, print the two blocks to add by hand, and suggest giving this repository its own path with `git config --local core.hooksPath <dir>`. A local `core.hooksPath` is honoured. Detecting the scope needs git 2.26 or newer; on an older git the directory is treated as not shared.
- If you decline the hooks, `ctxo init` prints which signals degrade and suggests running `ctxo index --commit HEAD` after commits. `ctxo index --check` verifies freshness only and records no snapshot.

## Examples

::: code-group
```shell [interactive]
ctxo init
```

```shell [non-interactive]
# Pick tools explicitly and install everything without prompts.
ctxo init --tools claude-code,cursor --yes
```

```shell [rules only]
# Refresh AI tool rules after a ctxo upgrade. Don't touch plugins or hooks.
ctxo init --rules
```

```shell [no plugin install]
# Set everything up but defer plugin installation to a later step.
ctxo init --no-install --yes --tools claude-code
```

```shell [preview]
ctxo init --dry-run
```
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Setup completed (or dry-run printed successfully) |
| `1` | Not a git repository, or unknown tool id passed to `--tools` |

## See also

- [`ctxo install`](./install.md) - the plugin installer invoked by `init`.
- [`ctxo index`](./index.md) - the next command to run after setup.
- [.ctxo/config.yaml reference](./config-yaml.md) - customize ignore globs and
  opt out of stats.
