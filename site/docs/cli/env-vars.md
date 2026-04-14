---
title: "Environment variables"
description: "DEBUG namespaces, CTXO_RESPONSE_LIMIT, and other env knobs."
---

# Environment variables

Runtime knobs accepted by `ctxo` and the MCP server. All are optional.

## Debug logging

`ctxo` uses the standard `debug` package. Every subsystem has a namespace
under `ctxo:*`.

| Variable | Example | Effect |
| --- | --- | --- |
| `DEBUG` | `ctxo:*` | Enable every ctxo namespace |
| `DEBUG` | `ctxo:git,ctxo:storage` | Enable a subset |
| `DEBUG` | `ctxo:*,-ctxo:stats` | Enable all ctxo output except stats |

### Known namespaces

| Namespace | Source |
| --- | --- |
| `ctxo:config` | `.ctxo/config.yaml` loader |
| `ctxo:doctor` | Health checker |
| `ctxo:git` | simple-git adapter |
| `ctxo:http` | HTTP transport (optional) |
| `ctxo:plugin-discovery` | Scanning `package.json` for `@ctxo/lang-*` plugins |
| `ctxo:plugin-loader` | Dynamic imports of discovered plugins |
| `ctxo:search` | BM25 and ranked-context search |
| `ctxo:stats` | Local MCP session recorder |
| `ctxo:storage` | SQLite and JSON adapters |

::: warning Never write to stdout
ctxo's MCP stdio transport uses stdout for JSON-RPC. Debug output goes to
stderr, which is safe to read without corrupting the protocol.
:::

## MCP response size

| Variable | Default | Effect |
| --- | --- | --- |
| `CTXO_RESPONSE_LIMIT` | `8192` | Byte budget for a single MCP tool response. Responses above this threshold are truncated and flagged via the response envelope's `_meta.truncated` field |

Invalid values (non-numeric, zero, negative) fall back to the default.

```shell
# Give large tool responses more room at the cost of token usage.
CTXO_RESPONSE_LIMIT=16384 npx ctxo
```

## Package manager override

| Variable | Accepted values | Effect |
| --- | --- | --- |
| `CTXO_PM` | `npm`, `pnpm`, `yarn`, `bun` | Forces [`ctxo install`](./install.md) to use the given manager, overriding detection from `packageManager`, lockfile, and auto-detection |

```shell
CTXO_PM=pnpm npx ctxo install typescript go
```

## HTTP transport (optional)

The default MCP transport is stdio. An HTTP transport is available for
integrations that require it.

| Variable | Default | Effect |
| --- | --- | --- |
| `CTXO_HTTP_PORT` | unset | When set, the MCP server listens on the given HTTP port instead of stdio |

```shell
CTXO_HTTP_PORT=3001 npx ctxo
```

## CI detection

| Variable | Effect |
| --- | --- |
| `CI=true` or `CI=1` | [`ctxo install`](./install.md) refuses to mutate dependencies unless `--force` or `--global` is passed. [`ctxo doctor --fix`](./doctor.md) requires `--yes` before applying remediation |

## Examples

```shell
# Full visibility while debugging a flaky index run.
DEBUG=ctxo:* npx ctxo index
```

```shell
# Narrow to plugin and storage subsystems.
DEBUG=ctxo:plugin-loader,ctxo:plugin-discovery,ctxo:storage npx ctxo index
```

```shell
# Raise response budget for large Logic-Slice queries.
CTXO_RESPONSE_LIMIT=16384 DEBUG=ctxo:search npx ctxo
```

## See also

- [CLI Overview](./overview.md) — command summary.
- [`ctxo install`](./install.md) — consumes `CTXO_PM`.
- [.ctxo/config.yaml reference](./config-yaml.md) — the opt-out flag for
  session stats lives in `config.yaml`, not in an environment variable.
