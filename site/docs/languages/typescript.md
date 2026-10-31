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
ctxo install typescript --yes
```

After installing, run `ctxo index` to populate `.ctxo/index/`.

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
| `uses`       | Type references, generic arguments and other imported names a symbol mentions      |
| `reads`, `writes`, `executes` | Constant SQL at known call sites, only with `@ctxo/lang-sql` installed ([below](#sql-at-call-sites)) |

Edges are produced in a two-pass run: pass 1 builds a cross-file symbol
registry via `setSymbolRegistry()`, pass 2 resolves call/import targets to
the file that owns each symbol.

## Annotations

Decorators on classes and methods become symbol annotations (always on):

- `name` is the rightmost identifier of the decorator expression:
  `@nest.Injectable()` gives `Injectable`.
- `args` are the string-literal and plain-template arguments; `named` holds the
  string-valued properties of object-literal arguments, the first occurrence
  winning. A property named `type` is dropped (`named.type` is reserved).
- Property decorators go on the class, after the class's own decorators, with
  the property name in `named.member`. Properties do not become symbols.
- Caps: 20 per symbol, 10 positional and 10 named entries, 200 characters per
  value.

```ts
@Entity('loans')
export class Loan {
  @Column({ name: 'member_id' }) memberId!: string;
}
// Loan: [{ name: 'Entity', args: ['loans'] },
//        { name: 'Column', named: { member: 'memberId', name: 'member_id' } }]
```

## Test symbols

In a test file (`**/__tests__/**`, `**/*.test.*`, `**/*.spec.*`, `**/test/**`,
`**/tests/**`, or an [`index.tests`](/reference/config-schema#fields) glob), every `describe`, `it` or `test` block becomes a `function`
symbol named by its title path and annotated `{ name: 'test' }`. `suite`,
`context`, `specify`, the `f` and `x` variants and modifiers such as `.only`,
`.skip`, `.each` and `.skipIf` count too; a block without a callback
(`it.todo`) does not.

```text
src/loans/loan-policy.test.ts::LoanPolicy > renewal > extends by seven days::function
```

- Each block's `calls` and `uses` edges come from its own callback minus nested
  blocks, so an `it` owns its edges and a `describe` keeps its hooks. Tests are
  therefore blast-radius dependents of the code they exercise.
- Titles: a non-literal title keeps its source text; whitespace runs become one
  space, runs of `:` become one and a trailing `:` is dropped; an empty title
  becomes `(untitled)`; titles are cut at 200 characters. A repeated path gets
  ` #2`, ` #3` in source order.
- Test files are decided by the globs the CLI hands the plugin
  (`PluginContext.testGlobs`: the default test globs plus `index.tests`), so
  `index.tests: ["spec/**/*.check.ts"]` makes the blocks of
  `spec/loans/policy.check.ts` test symbols. The CLI's defaults also hold
  `**/*.Tests/**` and `**/*.Test/**`, so TypeScript files in such folders get
  test blocks too. With a CLI that predates the field only the defaults above
  count. A negated (`!`) glob is skipped. Re-index (`ctxo index`) after
  changing `index.tests`.

## SQL at call sites

With [`@ctxo/lang-sql`](/languages/sql) installed, the plugin adds `reads`,
`writes` and `executes` edges for constant SQL at known call sites, parsed by
`@ctxo/sql-extract`, to the same `dbo.loans::table` targets the SQL and C#
plugins use. Without `@ctxo/lang-sql` it emits none.

| Module | Members | SQL text |
| --- | --- | --- |
| `pg` | `query` | first argument, or `{ text }` |
| `mysql2` | `query`, `execute` | first argument, or `{ sql }` |
| `mssql` | `query`; `execute` | first argument or tagged template; `execute` takes a procedure name |
| `knex` | `raw` | first argument |
| `@prisma/client` | `$queryRaw`, `$executeRaw`; `$queryRawUnsafe`, `$executeRawUnsafe` | tagged template; first argument |
| `typeorm`, `sequelize` | `query` | first argument |
| `better-sqlite3` | `prepare`, `exec` | first argument |

- **Constants only:** string literals, templates without substitutions, `+`
  and templates whose parts are all constant, and `const` bindings in the same
  file or behind a relative import. Tagged-template interpolations become the
  placeholders `@p0`, `@p1` and so on.
- **Receiver provenance:** without library types, a call counts only when a
  walk of at most 8 steps ties its receiver to the module: imports, `require`,
  type annotations and initializers, destructuring, constructor parameter
  properties and `this` members (also through `extends`), return types,
  `import('pg').Pool`, `export *` barrels and dynamic `import()`. A
  `bus.execute('CloseLoan')` on some other object gives nothing.
- **Incremental runs:** relative modules missing from the in-memory project are
  read from disk (`.ts`, `.tsx`, `.js`, `.jsx`, inside the project root), so
  the post-commit hook, `--files` and `ctxo watch` give the same edges as a full
  `ctxo index`.
- **Scope:** edges start at the innermost exported function, method of an
  exported class, exported variable or test block.
- ORM and query-builder calls (knex chains, Prisma model calls, TypeORM
  repositories) are not covered.

## Facts

When the host requests facts (`@ctxo/domain` installed with a registry file, or `index.facts: true`), the plugin reports
`literal-comparison`, `normalization`, `retry-timeout` and `endpoint` facts into each file's index JSON
(`facts: []` when it finds none), with the rules every official plugin shares (see [facts](https://github.com/alperhankendi/Ctxo/blob/master/docs/features/domain-knowledge.md#facts)). They
feed [`find_shadow_specs`](/mcp-tools/find-shadow-specs). At most 500 facts per file, text at most 200 code
points, and no `retry-timeout` facts in test files.

| Kind | TypeScript and JavaScript |
| --- | --- |
| `literal-comparison` | `if`, `while`, `do`, `for` conditions, ternaries and `switch` case clauses with a non-trivial literal (`loans.length >= 5`, `tier === 'gold'`) |
| `normalization` | `trim`, `toLowerCase`, `toUpperCase` and the other `domain.facts.normalizationMethods` |
| `retry-timeout` | A numeric constant bound to a retry or timeout name (`const HOLD_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000` gives `HOLD_TIMEOUT_MS = 604800000`), and `setTimeout(fn, n)` |
| `endpoint` | Nest `@Get`, `@Post`, ..., `@All` in an exported class decorated `@Controller` (prefix from its path); Express and Fastify `get`, `post`, ..., `all` with a string path and a handler, on a receiver traced to `express` or `fastify`; Fastify `route({ method, url })` |

Single-quoted strings and templates without substitutions are decoded for the trivial-literal check. ts-morph is
the only tier, in process. Type guards give no fact: `typeof x === 'string'` and the labels of `switch (typeof x)`
are skipped. A fact extraction failure warns on stderr (`ctxo:lang-typescript`) and gives `facts: []`. Limits: a Nest
controller must be exported; `app.use('/api', router)` prefixes are not joined; a route registered in top-level code
belongs to the module symbol; constructor parameter defaults (`constructor(private retries = 3)`) give no
`retry-timeout` fact.

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
- **Decorators** become [annotations](#annotations), not edges of their own; a
  decorator imported from another file still gives a `uses` edge like any
  imported name. Accessor and parameter decorators are ignored.
- **SQL receivers** that the provenance walk cannot tie to a listed module are
  missed: union-typed receivers (`Pool | null`), getters or methods that return
  a pool, clients from an untyped factory or a dependency-injection container,
  namespace imports of a relative module, and anything more than 8 steps away.
  Numeric constants in a template make it non-constant.

## Related

- [Dependency graph](/concepts/dependency-graph)
- [Symbol IDs](/reference/symbol-ids)
- [Edge kinds](/reference/edge-kinds)
- [Languages overview](/languages/overview)
