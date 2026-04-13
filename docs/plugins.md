# Ctxo language plugins

## Official plugins (Tier 1)

Maintained by the Ctxo core team. Guaranteed to track `@ctxo/plugin-api` ≥ 12 months per ADR-012.

| Plugin | npm | Tier | Extensions | Notes |
|---|---|---|---|---|
| `@ctxo/lang-typescript` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-typescript)](https://www.npmjs.com/package/@ctxo/lang-typescript) | full | `.ts .tsx .js .jsx` | ts-morph; type-aware cross-file resolution |
| `@ctxo/lang-go` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-go)](https://www.npmjs.com/package/@ctxo/lang-go) | syntax | `.go` | tree-sitter; exported-symbol analysis |
| `@ctxo/lang-csharp` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-csharp)](https://www.npmjs.com/package/@ctxo/lang-csharp) | full | `.cs` | Roslyn full-tier; tree-sitter syntax fallback |

Install:

```bash
npm i -D @ctxo/lang-typescript @ctxo/lang-go @ctxo/lang-csharp
```

Or via the cli shortcut:

```bash
npx @ctxo/cli install typescript go csharp
```

## Community plugins

None yet listed. If you publish a plugin following the
[community-plugin-template](../examples/community-plugin-template/), open a
PR adding a row here.

Suggested naming: `ctxo-lang-<id>` (unscoped) or `@<scope>/lang-<id>` (scoped).

## How discovery works

`@ctxo/cli` scans the consumer project's `package.json` dependencies,
devDependencies, and peerDependencies for packages matching:

- `@ctxo/lang-*`
- `ctxo-lang-*`

Each match is `import()`'d at startup, validated against the
`CtxoLanguagePlugin` contract (apiVersion, id, extensions, tier, createAdapter),
and registered with the adapter registry. Failed loads emit a warning but do
not stop the cli.

See `docs/architecture/ADR/adr-012-plugin-architecture-and-monorepo.md` for
the full protocol rationale.

## Plugin API contract

Plugins declare `apiVersion: '1'`. The contract in `@ctxo/plugin-api` covers:

- `CtxoLanguagePlugin` — manifest with id / name / version / extensions / tier / createAdapter
- `ILanguageAdapter` — extractSymbols / extractEdges / extractComplexity / isSupported + optional lifecycle hooks (initialize, dispose, setSymbolRegistry)
- `PluginContext` — logger + projectRoot + workspace + per-plugin config passed to createAdapter
- `IWorkspace` — single-package in v0.7; monorepo-ready shape for a later PR

## Getting listed

1. Build your plugin from `examples/community-plugin-template/`
2. Publish to npm under the `ctxo-lang-*` or `@<scope>/lang-*` naming convention
3. Confirm it passes `ctxo doctor` in a project using it
4. Open a PR against this file adding a row under **Community plugins**:
   ```markdown
   | `<npm-name>` | [![npm](https://img.shields.io/npm/v/<npm-name>)](https://www.npmjs.com/package/<npm-name>) | syntax | `.ext` | one-line summary |
   ```

The Ctxo team reviews for: valid apiVersion, signed-off maintainer contact, passing install in a sample project. Inclusion does not imply endorsement of the plugin code.
