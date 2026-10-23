---
title: "Writing a Plugin"
description: "Implement the Plugin API contract (protocol v1 or v2) for a new language."
---

# Writing a Plugin

A ctxo language plugin is a regular npm package that exports a
`CtxoLanguagePlugin` object. The only runtime dependency you need is
[`@ctxo/plugin-api`](https://www.npmjs.com/package/@ctxo/plugin-api), a type
package with zero runtime deps on `@ctxo/cli`. The CLI discovers your plugin
by scanning the consumer project's `package.json` for names matching these
patterns:

- **`@ctxo/lang-<id>`** for official plugins
- **`ctxo-lang-<id>`** for community plugins

Both are loaded identically. Pick a name that reflects the language id you
set in the plugin's `id` field (for example `id: 'python'` pairs with
`ctxo-lang-python`).

## Install the contract

::: code-group
```bash [pnpm]
pnpm add -D @ctxo/plugin-api
```
```bash [npm]
npm install --save-dev @ctxo/plugin-api
```
```bash [yarn]
yarn add -D @ctxo/plugin-api
```
:::

## The contract

The plugin package must export a default (or named `plugin`) object
satisfying `CtxoLanguagePlugin`:

```ts
import type {
  CtxoLanguagePlugin,
  PluginContext,
  ILanguageAdapter,
} from '@ctxo/plugin-api';

export interface CtxoLanguagePlugin {
  readonly apiVersion: '1' | '2';       // the lowest protocol version the plugin works on
  readonly id: string;                  // 'python'
  readonly name: string;                // 'Python (tree-sitter)'
  readonly version: string;             // mirror package.json
  readonly extensions: readonly string[]; // ['.py', '.pyi']
  readonly tier: 'syntax' | 'full';
  createAdapter(ctx: PluginContext): ILanguageAdapter;
}
```

`createAdapter` is called once per indexing session. Return an object
implementing `ILanguageAdapter`:

```ts
export interface ILanguageAdapter {
  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]>;
  extractEdges(filePath: string, source: string): Promise<GraphEdge[]>;
  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]>;
  extractFacts?(filePath: string, source: string): Promise<CodeFact[]>; // v2, only on request
  isSupported(filePath: string): boolean;
  setSymbolRegistry?(registry: Map<string, SymbolKind>): void;
  initialize?(rootDir: string): Promise<void>;
  dispose?(): Promise<void>;
}
```

The two-pass indexer calls `setSymbolRegistry` between pass 1 (symbols) and
pass 2 (edges), so you can resolve cross-file references.

## Protocol versions

The CLI accepts `apiVersion` `'1'` and `'2'` (`SUPPORTED_API_VERSIONS`) and
handles the output of both identically: the version gates loading only.
Declare the **lowest** version your plugin works on. A plugin that emits only
v1 kinds and fields should stay on `'1'`, so it keeps loading on older CLIs;
v1 cores simply ignore annotations and never set capabilities. Declare `'2'`
only when the plugin cannot work without a v2 core, as `@ctxo/lang-sql` does
(its symbols are `table`, `view` and `procedure`). `'1'` stays accepted for at
least 12 months after `'2'` ships. The old `SUPPORTED_API_VERSION` export stays
`'1'` and is deprecated.

## The v2 surface

Everything in v2 is additive; a v1 plugin needs no change.

**Data kinds.** `SYMBOL_KINDS` adds `table`, `view` and `procedure`;
`EDGE_KINDS` adds `reads`, `writes` and `executes`; `DATA_RESOURCE_KINDS` is
`['table', 'view']`. A data edge from a host language points at a canonical
2-part name reference such as `dbo.loans::table` or
`dbo.usp_closeloan::procedure` (lowercase ASCII, delimiters stripped, default
schema `dbo`), and the graph resolves it to the defining symbol.

**Annotations.** `SymbolNode.annotations` carries host-language attributes,
annotations and decorators:

```ts
export interface SymbolAnnotation {
  readonly name: string;                              // as written, no namespace, no "Attribute" suffix
  readonly args?: readonly string[];                  // constant positional arguments
  readonly named?: Readonly<Record<string, string>>;  // constant named arguments; named.type is reserved
}
```

Cap them yourself: 20 per symbol, 10 positional entries and 10 named entries
plus the reserved `type` each, 200 characters per value (truncate longer
values), and omit `args` and `named` when empty. `named.type` is reserved for
the fully qualified type name when you know it: never copy a source argument
that is itself named `type` into `named`. The CLI checks shape only, and keeps
a symbol whose annotations are malformed by dropping them.

**Facts.** Implement `extractFacts` only if you can report `CodeFact`s
(`FACT_KINDS`: `literal-comparison`, `normalization`, `retry-timeout`,
`endpoint`; `line` is 0-based; `text` is one trimmed line of at most 200
characters). The CLI calls it only when the host asked for facts.

**Capabilities.** `createAdapter` receives `ctx.capabilities` on v2 cores:

```ts
export interface PluginCapabilities {
  readonly facts?: boolean;         // index.facts: true, so extractFacts is called
  readonly sqlCallSites?: boolean;  // a plugin for .sql is installed
}
```

They are computed before any `createAdapter` call and offered to every plugin;
ignore the ones you do not use. Absent fields mean `false`, and on a v1 core
`capabilities` is absent. Emit SQL call-site edges only when `sqlCallSites` is
set, so a repository without a SQL plugin gets no edges to resources that
cannot exist.

**Dependencies.** Import only from `@ctxo/plugin-api`. The one exception is a
Ctxo-owned utility package with zero runtime dependencies, today only
`@ctxo/sql-extract` (the T-SQL tokenizer and recognizers).

## Minimal plugin skeleton

```ts
// src/index.ts
import type {
  CtxoLanguagePlugin,
  PluginContext,
  ILanguageAdapter,
  SymbolNode,
  GraphEdge,
  ComplexityMetrics,
} from '@ctxo/plugin-api';

class PythonAdapter implements ILanguageAdapter {
  isSupported(filePath: string): boolean {
    return filePath.endsWith('.py') || filePath.endsWith('.pyi');
  }

  async extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    // parse source, walk tree, emit SymbolNode[]
    return [];
  }

  async extractEdges(_filePath: string, _source: string): Promise<GraphEdge[]> {
    return [];
  }

  async extractComplexity(_filePath: string, _source: string): Promise<ComplexityMetrics[]> {
    return [];
  }
}

const plugin: CtxoLanguagePlugin = {
  apiVersion: '1',
  id: 'python',
  name: 'Python (example)',
  version: '0.1.0',
  extensions: ['.py', '.pyi'],
  tier: 'syntax',
  createAdapter(_ctx: PluginContext): ILanguageAdapter {
    return new PythonAdapter();
  },
};

export default plugin;
export { plugin };
```

## Symbol and edge conventions

- **Symbol IDs** must follow `<relativeFile>::<name>::<kind>` where
  `relativeFile` uses forward slashes and is relative to the ctxo project
  root. See [Symbol IDs](/reference/symbol-ids).
- Valid symbol kinds: `function | class | interface | method | variable | type`,
  plus the v2 data kinds `table | view | procedure`
- Valid edge kinds: `imports | calls | extends | implements | uses`, plus the
  v2 data kinds `reads | writes | executes`
- Set `typeOnly: true` on edges that represent type-only references (the
  graph can filter them out for runtime-only queries).

## Logging

Plugins receive a `PluginLogger` via `ctx.logger`. You should also bundle
your own minimal `debug`-style logger so the plugin has no runtime import
of `@ctxo/cli`. Both `@ctxo/lang-go` and `@ctxo/lang-csharp` ship a
single-file `logger.ts`; copy that pattern.

```ts
// src/logger.ts
import debug from 'debug';
export const createLogger = (ns: string) => ({
  debug: debug(`${ns}:debug`),
  info: debug(`${ns}:info`),
  warn: debug(`${ns}:warn`),
  error: debug(`${ns}:error`),
});
```

## Testing

Use `vitest` with fixture files on disk or inline source strings. Assert
against concrete `SymbolNode` and `GraphEdge` arrays. The reference plugins
keep tests co-located in `src/__tests__/` following the main codebase
convention.

A useful integration test is to run `ctxo index --install-missing` in a
fixture project that only depends on your plugin, then inspect
`.ctxo/index/*.json`.

## Publishing

1. Name the package `@ctxo/lang-<id>` (for official plugins) or
   `ctxo-lang-<id>` (community).
2. Keep `@ctxo/plugin-api` as a `peerDependency`. The official v1 plugins
   accept `^0.7.3 || ^0.8.0 || ^0.9.0`; a v2 plugin needs the release that
   carries protocol v2 (`@ctxo/lang-sql` accepts `^0.8.0 || ^0.9.0`).
3. Publish to npm with `provenance: true` if you can.
4. Optionally open a PR to add your plugin to the CLI's `KNOWN_LANGUAGES`
   detection table so `ctxo init` can prompt for it automatically.

## Related

- [Languages overview](/languages/overview)
- [Dependency graph](/concepts/dependency-graph)
- [Symbol IDs](/reference/symbol-ids)
- [Edge kinds](/reference/edge-kinds)
