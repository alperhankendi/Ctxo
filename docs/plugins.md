# Ctxo language plugins

## Official plugins (Tier 1)

Maintained by the Ctxo core team. Guaranteed to track `@ctxo/plugin-api` ≥ 12 months per ADR-012.

| Plugin | npm | Tier | Extensions | Notes |
|---|---|---|---|---|
| `@ctxo/lang-typescript` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-typescript)](https://www.npmjs.com/package/@ctxo/lang-typescript) | full | `.ts .tsx .js .jsx` | ts-morph; type-aware cross-file resolution |
| `@ctxo/lang-go` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-go)](https://www.npmjs.com/package/@ctxo/lang-go) | syntax | `.go` | tree-sitter; exported-symbol analysis |
| `@ctxo/lang-csharp` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-csharp)](https://www.npmjs.com/package/@ctxo/lang-csharp) | full | `.cs` | Roslyn full-tier; tree-sitter syntax fallback |
| `@ctxo/lang-java` | [![npm](https://img.shields.io/npm/v/@ctxo/lang-java)](https://www.npmjs.com/package/@ctxo/lang-java) | syntax / full | `.java` | tree-sitter syntax tier built-in; full tier via `@ctxo/lang-java-analyzer` companion (JRE 11+ required, covers Java 8-21); detected by `pom.xml` / `build.gradle` / `build.gradle.kts` |

Install:

```bash
npm i -D @ctxo/lang-typescript @ctxo/lang-go @ctxo/lang-csharp @ctxo/lang-java
```

Or via the cli shortcut:

```bash
ctxo install typescript go csharp
ctxo install java              # syntax tier + full-tier analyzer when JRE 11+ detected
ctxo install java --full-tier  # force full-tier analyzer install
ctxo install java --syntax-only  # skip analyzer, syntax tier only
```

### Java full-tier notes

The `@ctxo/lang-java` plugin ships the tree-sitter syntax tier with zero setup. Full tier (resolved `calls`/`uses`/`extends`/`implements` edges, cross-file symbol IDs, generics) requires:

1. **JRE 11+** on PATH
2. **`@ctxo/lang-java-analyzer`** companion package (prebuilt JAR, integrity/provenance via npm)

#### JAR variant selection — automatic, based on detected JRE

The plugin selects the correct analyzer JAR **at runtime** based on the JRE version found on PATH (or `CTXO_JAVA_HOME` / `JAVA_HOME`):

| JRE on PATH | JAR used | JDT Core | Analyzes source levels |
|---|---|---|---|
| **11 – 16** | `ctxo-jdt-analyzer-11.jar` | 3.33.0 (JavaSE-11) | Java 8 – 19 |
| **17+** | `ctxo-jdt-analyzer-17.jar` | 3.39.0 (JavaSE-17) | Java 8 – 21 |
| < 11 or absent | — | — | syntax tier only |

No configuration needed — detection and selection are fully automatic. The active JAR variant is logged at `DEBUG=ctxo:lang-java` level and shown in `ctxo doctor`.

#### Switching between Java 11 and Java 17

Point `CTXO_JAVA_HOME` or `JAVA_HOME` at the desired JRE; ctxo picks the matching JAR:

```bash
# Use Java 11 full tier
CTXO_JAVA_HOME=/path/to/jre11 ctxo index

# Use Java 17 full tier
CTXO_JAVA_HOME=/path/to/jre17 ctxo index

# Override with a specific JAR regardless of JRE version
CTXO_JDT_ANALYZER_JAR=/path/to/custom.jar ctxo index
```

#### Debug output

```bash
DEBUG=ctxo:lang-java ctxo index
# → Java 11.0.21 detected — using java11 analyzer JAR
# → Java analyzer ready: JRE 11.0.21, jar .../ctxo-jdt-analyzer-11.jar
# → Java plugin: JDT full-tier active
```

`ctxo install java` installs both packages automatically when JRE 11+ is detected. Use `--full-tier` to force or `--syntax-only` to skip the analyzer. The active tier is shown in `ctxo index` output, `ctxo doctor`, and MCP `_meta`. Degrades to syntax tier silently when JRE or analyzer is absent. See [ADR-014](architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md).

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
