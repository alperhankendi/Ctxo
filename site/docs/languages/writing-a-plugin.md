---
title: "Writing a Plugin"
description: "Implement the Plugin API v1 contract for a new language."
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
  readonly apiVersion: '1';
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
  isSupported(filePath: string): boolean;
  setSymbolRegistry?(registry: Map<string, SymbolKind>): void;
  initialize?(rootDir: string): Promise<void>;
  dispose?(): Promise<void>;
}
```

The two-pass indexer calls `setSymbolRegistry` between pass 1 (symbols) and
pass 2 (edges), so you can resolve cross-file references.

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
- Valid symbol kinds: `function | class | interface | method | variable | type`
- Valid edge kinds: `imports | calls | extends | implements | uses`
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
2. Keep `@ctxo/plugin-api` as a `peerDependency` on the same major
   (currently `^0.7.1`).
3. Publish to npm with `provenance: true` if you can.
4. Optionally open a PR to add your plugin to the CLI's `KNOWN_LANGUAGES`
   detection table so `ctxo init` can prompt for it automatically.

## Related

- [Languages overview](/languages/overview)
- [Dependency graph](/concepts/dependency-graph)
- [Symbol IDs](/reference/symbol-ids)
- [Edge kinds](/reference/edge-kinds)
