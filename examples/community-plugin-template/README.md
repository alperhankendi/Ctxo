# ctxo-lang-example — community plugin template

Starter scaffold for building a Ctxo language plugin. Copy this folder into its
own repository, rename the package, and replace the stub parser logic with your
language's real AST extraction.

## What a Ctxo plugin actually is

A tiny npm package that exports a default object conforming to the
`CtxoLanguagePlugin` shape from [`@ctxo/plugin-api`](https://www.npmjs.com/package/@ctxo/plugin-api).
When a user installs your plugin in their project, the `@ctxo/cli` discovers it
via `package.json` dependencies and hands every matching file to your adapter.

```
User project
└── package.json
    devDependencies:
      @ctxo/cli: ^0.7.0
      ctxo-lang-yourlang: ^1.0.0   ← your plugin
```

## Quick start

1. **Clone + rename**

   ```bash
   cp -r path/to/ctxo/examples/community-plugin-template ./ctxo-lang-yourlang
   cd ctxo-lang-yourlang
   # Edit package.json: name, description, extensions, id
   ```

2. **Implement the parser**

   - Replace `src/adapter.ts` with real parsing. The three methods that matter:
     - `extractSymbols(filePath, source)` — list every exported function/class/etc. Use the `"<file>::<name>::<kind>"` symbolId format.
     - `extractEdges(filePath, source)` — list `imports`/`calls`/`extends`/`implements`/`uses` relationships between symbols.
     - `extractComplexity(filePath, source)` — cyclomatic complexity per symbol (optional, return `[]` to skip).

3. **Install + build**

   ```bash
   npm install
   npm run build
   npm test
   ```

4. **Test against a real project**

   ```bash
   cd /path/to/test-project
   npm install /path/to/ctxo-lang-yourlang   # local link
   npm install @ctxo/cli@next
   npx ctxo index
   npx ctxo doctor --quiet
   ```

   Your plugin should appear in `ctxo doctor`'s Versions section. Indexing should produce symbols in `.ctxo/index/`.

5. **Publish**

   ```bash
   npm publish --access public
   ```

   Scoped packages (`@scope/lang-yourlang`) or unscoped (`ctxo-lang-yourlang`) both work. The cli's auto-discovery accepts either pattern.

## Symbol kinds — normalization rules

Ctxo normalizes every language to six kinds. Map your language's native concepts:

| Your language feature | Ctxo `kind` |
|---|---|
| Free-standing function / procedure | `function` |
| Class / struct / record | `class` |
| Interface / protocol / trait | `interface` |
| Method on a class / receiver function | `method` |
| Module-level binding / field | `variable` |
| Type alias / newtype | `type` |

If your language has something that truly doesn't map (e.g. Rust enums with
variants, Haskell type classes) — pick the closest fit and carry the extra
detail in the symbol's name. Richer schemas may land in a future `apiVersion`.

## Edge kinds

| Edge | Meaning |
|---|---|
| `imports` | A declares a dependency on B via an import/use/include statement |
| `calls` | A calls B at runtime |
| `extends` | A inherits from B (single inheritance) |
| `implements` | A implements interface/protocol B |
| `uses` | A structurally references B (type annotations, generics) |

Emit whichever are meaningful for your language. Ctxo's `find_importers` and
`get_blast_radius` tools let users filter by `edgeKinds`.

## Checklist before publishing

- [ ] `plugin.apiVersion === '1'`
- [ ] `plugin.id` is a short, lowercase, hyphen-free string
- [ ] `plugin.extensions` are lowercase, dot-prefixed (`['.go']` not `['go']`)
- [ ] `plugin.tier` is either `'syntax'` (AST-only) or `'full'` (type-aware)
- [ ] `createAdapter` returns a fresh instance each call (no hidden singletons)
- [ ] Tests cover at least: empty file, single symbol, multiple kinds
- [ ] `package.json` has `peerDependencies["@ctxo/plugin-api"]: ^0.7.0`
- [ ] No direct dependency on `@ctxo/cli` — plugins are decoupled from core

## Reference implementations

See `packages/lang-typescript`, `packages/lang-go`, `packages/lang-csharp` in
the Ctxo repo for production adapters covering TypeScript, Go, and C#.

## Getting help

- Plugin protocol questions: ADR-012 in `docs/architecture/ADR/`
- Graph semantics: `docs/artifacts/architecture.md`
- Bugs or feature requests: https://github.com/alperhankendi/Ctxo/issues
