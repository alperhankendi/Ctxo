# Ctxo language plugins

## Official plugins (Tier 1)

Maintained by the Ctxo core team. Guaranteed to track `@ctxo/plugin-api` ≥ 12 months per ADR-012.

| Plugin | npm | Tier | Extensions | Notes |
|---|---|---|---|---|
| `@ctxo/lang-typescript` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-typescript)](https://www.npmjs.com/package/@ctxo/lang-typescript) | full | `.ts .tsx .js .jsx` | ts-morph; type-aware cross-file resolution |
| `@ctxo/lang-go` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-go)](https://www.npmjs.com/package/@ctxo/lang-go) | syntax | `.go` | tree-sitter; exported-symbol analysis |
| `@ctxo/lang-csharp` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-csharp)](https://www.npmjs.com/package/@ctxo/lang-csharp) | full | `.cs` | Roslyn full-tier; tree-sitter syntax fallback |
| `@ctxo/lang-java` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-java)](https://www.npmjs.com/package/@ctxo/lang-java) | syntax / full | `.java` | tree-sitter syntax tier built-in; full tier via `@ctxo/lang-java-analyzer` companion (JRE 17+ required, covers Java 8-21); detected by `pom.xml` / `build.gradle` / `build.gradle.kts` |

Install:

```bash
npm i -D @ctxo/lang-typescript @ctxo/lang-go @ctxo/lang-csharp @ctxo/lang-java
```

Or via the cli shortcut:

```bash
ctxo install typescript go csharp
ctxo install java              # syntax tier + full-tier analyzer when JRE 17+ detected
ctxo install java --full-tier  # force full-tier analyzer install
ctxo install java --syntax-only  # skip analyzer, syntax tier only
```

### Java full-tier notes

The `@ctxo/lang-java` plugin ships the tree-sitter syntax tier with zero setup. Full tier (resolved `calls`/`uses`/`extends`/`implements` edges, cross-file symbol IDs, generics) requires:

1. **JRE 17+** on PATH (one Eclipse JDT build covers Java 8 through 21)
2. **`@ctxo/lang-java-analyzer`** companion package (prebuilt ~15 MB JAR, integrity/provenance via npm)

`ctxo install java` installs both automatically when JRE 17+ is detected. Use `--full-tier` to force or `--syntax-only` to skip the analyzer. The active tier is shown in `ctxo index` output, `ctxo doctor`, and MCP `_meta`. Downgrades to syntax tier silently when JRE or analyzer is absent. See ADR-014.

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
