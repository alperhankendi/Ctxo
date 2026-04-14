---
title: "CLI Overview"
description: "All ctxo commands at a glance."
---

# CLI Overview

`ctxo` is both a Model Context Protocol (MCP) server and a CLI. Running `ctxo`
with no arguments starts the stdio MCP server; any other argument dispatches to
a subcommand.

## Command summary

| Command | Purpose |
| --- | --- |
| [`ctxo install`](./install.md) | Install language plugins (auto-detects if omitted) |
| [`ctxo init`](./init.md) | Interactive setup: AI tool rules, git hooks, plugin install |
| [`ctxo index`](./index.md) | Build the codebase index (symbols, edges, history) |
| [`ctxo watch`](./watch.md) | File watcher for incremental re-indexing |
| [`ctxo sync`](./sync.md) | Rebuild the SQLite cache from committed JSON |
| [`ctxo status`](./status.md) | Show index manifest, symbol counts, per-file freshness |
| [`ctxo doctor`](./doctor.md) | Health check every subsystem (with optional `--fix`) |
| [`ctxo visualize`](./visualize.md) | Generate an interactive dependency graph HTML |
| `ctxo verify-index` | CI gate: fail if index drifts from source |
| `ctxo stats` | Show MCP usage statistics (`--json`, `--days N`, `--clear`) |
| `ctxo version` | Verbose version report (`--json`, `--short`) |
| `ctxo --help` | Print compact help |

## Global flags

| Flag | Meaning |
| --- | --- |
| `--version`, `-v`, `-V` | Print core version. Combine with `--verbose` or `--json` |
| `--help`, `-h` | Print the bundled help block |

## Related references

- [.ctxo/config.yaml reference](./config-yaml.md) — project config for index
  ignore globs and opt-out flags.
- [Environment variables](./env-vars.md) — `DEBUG=ctxo:*` namespaces,
  `CTXO_RESPONSE_LIMIT`, and more.

::: tip Debug output
Every subcommand honors `DEBUG=ctxo:*`. Narrow the namespace (for example
`DEBUG=ctxo:git,ctxo:storage`) when you only want to see one subsystem.
:::

## Exit codes

Most commands exit `0` on success and `1` on failure. Two commands have richer
semantics:

| Command | Exit | Meaning |
| --- | --- | --- |
| `ctxo index --check` | `0` | Index up to date |
| `ctxo index --check` | `1` | Stale or missing files — run `ctxo index` |
| `ctxo doctor` | `0` | All checks passed |
| `ctxo doctor` | `1` | One or more checks failed |
| `ctxo doctor --fix` | `2` | Remediation halted before completing |
