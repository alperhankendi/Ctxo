---
title: "Languages Overview"
description: "Language support tiers and plugin architecture."
---

# Languages Overview

Ctxo ships language support as separate plugin packages. The CLI has no built-in
parsers: it discovers plugins at runtime by scanning the consumer project's
`package.json` for names matching `@ctxo/lang-*` (official) or `ctxo-lang-*`
(community). Each plugin implements the Plugin API v1 contract exported by
[`@ctxo/plugin-api`](/languages/writing-a-plugin), a stable surface with zero
runtime dependencies on `@ctxo/cli`.

## Support matrix

| Language              | Plugin                 | Parser                                           | Tier     | Extensions                 |
| --------------------- | ---------------------- | ------------------------------------------------ | -------- | -------------------------- |
| TypeScript/JavaScript | `@ctxo/lang-typescript` | ts-morph                                         | `full`   | `.ts .tsx .js .jsx`        |
| Go                    | `@ctxo/lang-go`         | `ctxo-go-analyzer` (Go 1.22+) + tree-sitter-go   | `full`   | `.go`                      |
| C#                    | `@ctxo/lang-csharp`     | `ctxo-roslyn` (.NET SDK 8+) + tree-sitter-c-sharp | `full`  | `.cs`                      |
| Java                  | `@ctxo/lang-java` + `@ctxo/lang-java-analyzer` | Eclipse JDT Core (JRE 17+) + tree-sitter-java | `full` | `.java` |

Two tiers are defined by the plugin contract:

- **`full`** — the plugin has access to a real semantic analyzer (ts-morph,
  Roslyn, or the Go analyzer binary). Produces resolved edges (`calls`,
  `extends`, `implements`, `uses`) plus rich complexity.
- **`syntax`** — tree-sitter or equivalent syntax-level parser. Produces
  symbols, `imports`, and approximate edges. Used as a graceful fallback.

The Go, C#, and Java plugins advertise `tier: 'full'` and auto-downgrade to
syntax at runtime when the required toolchain or analyzer package is missing.
For Java, full tier requires the `@ctxo/lang-java-analyzer` companion package
and a JRE 17+ on PATH - not a build toolchain. You can see the active tier in
`ctxo doctor --json` under the language coverage check.

## What gets extracted

Every plugin returns the same shapes, defined in `@ctxo/plugin-api`: symbols,
edges, and a per-symbol cyclomatic complexity count. See
[Symbol IDs](/reference/symbol-ids) and [Edge kinds](/reference/edge-kinds) for
the canonical enums and format.

## Detection

`ctxo init` and `ctxo doctor` use `detectLanguages()` to figure out which
plugins a project needs. Detection combines two signals:

1. **Manifest markers** in the project root:
   - `tsconfig.json` → typescript
   - `go.mod` / `go.work` → go
   - `*.csproj` / `*.sln` → csharp
   - `pom.xml` / `build.gradle` / `build.gradle.kts` → java
   - `pyproject.toml`, `Cargo.toml`, `Gemfile`, ... (reserved)
2. **Extension counts** from `git ls-files`, mapped through a canonical
   extension table (e.g. `.ts` and `.tsx` both map to `typescript`).

The result drives the auto-install flow.

## Auto-install

`ctxo init` prompts to install detected plugins. `ctxo index --install-missing`
installs them non-interactively before indexing. Both paths use the detected
package manager (pnpm / npm / yarn) and add packages to `devDependencies`:

::: code-group
```bash [pnpm]
pnpm add -D @ctxo/lang-typescript @ctxo/lang-go @ctxo/lang-csharp @ctxo/lang-java
```
```bash [npm]
npm install --save-dev @ctxo/lang-typescript @ctxo/lang-go @ctxo/lang-csharp @ctxo/lang-java
```
```bash [yarn]
yarn add -D @ctxo/lang-typescript @ctxo/lang-go @ctxo/lang-csharp @ctxo/lang-java
```
:::

You can also run `ctxo install <id>...` directly, or `ctxo install --dry-run`
to preview the plan without touching `package.json`.

## Per-language pages

- [TypeScript / JavaScript](/languages/typescript)
- [Go](/languages/go)
- [C#](/languages/csharp)
- [Java](/languages/java)
- [Writing a plugin](/languages/writing-a-plugin)

## Related

- [Dependency graph](/concepts/dependency-graph)
- [Symbol IDs](/reference/symbol-ids)
- [Edge kinds](/reference/edge-kinds)
