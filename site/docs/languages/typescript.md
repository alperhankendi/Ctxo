---
title: "TypeScript"
description: "@ctxo/lang-typescript: ts-morph, full tier."
---

# TypeScript

Plugin: **`@ctxo/lang-typescript`** ([npm](https://www.npmjs.com/package/@ctxo/lang-typescript))
Parser: **ts-morph** (TypeScript Compiler API wrapper)
Tier: **`full`**
Extensions: `.ts`, `.tsx`, `.js`, `.jsx`

## What this plugin does

The TypeScript plugin runs ts-morph against an in-memory `Project` configured
for ES2022 + JSX + `allowJs`, then walks the syntax tree to emit symbols,
edges, and per-symbol cyclomatic complexity. Because it has full access to the
TypeScript type checker it can resolve calls, inheritance, and interface
implementations across files, not just within a single source.

The plugin ID is `typescript` and the same plugin handles `.js`/`.jsx` files,
so a single install covers both languages.

## Install

::: code-group
```bash [pnpm]
pnpm add -D @ctxo/lang-typescript
```
```bash [npm]
npm install --save-dev @ctxo/lang-typescript
```
```bash [yarn]
yarn add -D @ctxo/lang-typescript
```
:::

Or via the CLI:

```bash
npx ctxo install typescript --yes
```

After installing, run `npx ctxo index` to populate `.ctxo/index/`.

## What it extracts

### Symbols

| Kind        | Sources                                                              |
| ----------- | -------------------------------------------------------------------- |
| `function`  | `function` declarations, exported arrow functions, function expressions |
| `class`     | `class` declarations                                                 |
| `interface` | `interface` declarations                                             |
| `method`    | Class and object methods (instance + static)                         |
| `variable`  | Top-level `const` / `let` / `var` declarations                       |
| `type`      | `type` aliases and `enum` declarations                               |

Symbol IDs follow the canonical
`<relativeFile>::<name>::<kind>` form, e.g.
`packages/cli/src/foo.ts::myFn::function`.

### Edges

| Kind         | Notes                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| `imports`    | `import` / `export ... from` statements; supports `typeOnly` flag for type imports |
| `calls`      | Function and method invocations resolved via the type checker                      |
| `extends`    | Class `extends` and interface `extends` clauses                                    |
| `implements` | Class `implements` clauses                                                         |
| `uses`       | Type references, generic arguments, decorators                                     |

Edges are produced in a two-pass run: pass 1 builds a cross-file symbol
registry via `setSymbolRegistry()`, pass 2 resolves call/import targets to
the file that owns each symbol.

## Monorepo handling

`ctxo index` scans every workspace package independently and the TypeScript
plugin operates per-file, so most monorepo layouts work without extra config.
The in-memory `Project` is preloaded with all source files in the indexing
session, which lets ts-morph follow cross-package references through
`tsconfig.json` `paths` and `references` resolution.

For monorepos with isolated `tsconfig.json` files, run `ctxo index` from the
repo root rather than from a package subdirectory so all sources are seen in
the same pass.

## Limitations

- **Declaration files (`.d.ts`)** are loaded by ts-morph for type resolution
  but are not indexed as standalone source files.
- **Dynamic `import()` calls** are recorded as `imports` edges only when the
  target is a static string literal.
- **Re-exports** (`export * from './x'`) generate `imports` edges but do not
  duplicate downstream symbols into the re-exporting file.
- **JSX intrinsic elements** (`<div>`) are not emitted as `uses` edges; only
  user-defined components are.
- **Decorators** are surfaced as `uses` edges but parameter decorators on
  constructor arguments are best-effort.

## Related

- [Dependency graph](/concepts/dependency-graph)
- [Symbol IDs](/reference/symbol-ids)
- [Edge kinds](/reference/edge-kinds)
- [Languages overview](/languages/overview)
