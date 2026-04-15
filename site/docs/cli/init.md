---
title: "ctxo init"
description: "Bootstrap a project: git hooks + plugin install prompt."
---

# ctxo init

Bootstraps a project for ctxo. Runs three steps:

1. Ensures `.ctxo/index/` and `.ctxo/config.yaml` exist.
2. Generates MCP usage rules for the AI tools you use (Claude Code, Cursor,
   Windsurf, etc.) and registers the ctxo MCP server in their config files.
3. Offers to install missing language plugins and to install git hooks that
   re-index on commit and rebuild the SQLite cache on merge.

Requires a git repository (run `git init` first).

## Synopsis

```shell
npx @ctxo/init [options]
```

## Flags

| Flag | Short | Default | Description |
| --- | --- | --- | --- |
| `--yes` | `-y` | `false` | Non-interactive. Install everything, skip prompts. Combine with `--tools` to pick tools |
| `--tools <list>` | | | Comma-separated list of AI tool ids (for example `claude-code,cursor`). Implies non-interactive |
| `--rules` | | `false` | Only regenerate AI tool rule files. Skips index dir, plugins, and git hooks |
| `--no-install` | | `false` | Skip the language-plugin detection prompt (and the implicit install under `--yes`) |
| `--dry-run` | | `false` | Print the files that would be created or modified and exit |

## What it writes

| Path | Notes |
| --- | --- |
| `.ctxo/index/` | Created if missing (holds per-file JSON indices) |
| `.ctxo/config.yaml` | Default config is dropped if absent. See [config reference](./config-yaml.md) |
| `.gitignore` | `.ctxo/.cache/` appended if not already present |
| AI rule files | For example `.claude/claude.md`, `.cursor/rules/*.mdc`, depending on what you select |
| AI MCP configs | For example `.mcp.json`, registering `npx -y @ctxo/cli` as a server |
| `.git/hooks/post-commit` | Incremental re-index of changed files (idempotent block, marked `# ctxo-start` / `# ctxo-end`) |
| `.git/hooks/post-merge` | Runs `ctxo sync` after `git pull` |

::: tip Hooks are safe to re-run
The hook installer detects the `# ctxo-start` marker and leaves existing hooks
untouched. You can safely re-run `ctxo init` to pick up new AI tool rules.
:::

## Examples

::: code-group
```shell [interactive]
npx @ctxo/init
```

```shell [non-interactive]
# Pick tools explicitly and install everything without prompts.
npx @ctxo/init --tools claude-code,cursor --yes
```

```shell [rules only]
# Refresh AI tool rules after a ctxo upgrade. Don't touch plugins or hooks.
npx @ctxo/init --rules
```

```shell [no plugin install]
# Set everything up but defer plugin installation to a later step.
npx @ctxo/init --no-install --yes --tools claude-code
```

```shell [preview]
npx @ctxo/init --dry-run
```
:::

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Setup completed (or dry-run printed successfully) |
| `1` | Not a git repository, or unknown tool id passed to `--tools` |

## See also

- [`ctxo install`](./install.md) — the plugin installer invoked by `init`.
- [`ctxo index`](./index.md) — the next command to run after setup.
- [.ctxo/config.yaml reference](./config-yaml.md) — customize ignore globs and
  opt out of stats.
