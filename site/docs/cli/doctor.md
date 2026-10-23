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

1. **Config** — write a default `.ctxo/config.yaml` if missing or invalid.
2. **Git hooks** - install or upgrade the `post-commit` and `post-merge` hooks in place (an outdated v1 post-commit block becomes v2, duplicate blocks are collapsed). A shared global or system `core.hooksPath` is skipped, not failed: the hook files are left untouched and the blocks to add by hand are printed.
3. **Language coverage** — run [`ctxo install`](./install.md) for missing plugins.
4. **Index** — run [`ctxo index`](./index.md) (requires step 3 to have succeeded).
5. **SQLite cache** — run [`ctxo sync`](./sync.md).

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
