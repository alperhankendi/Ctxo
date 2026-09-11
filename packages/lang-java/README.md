# @ctxo/lang-java

Java language plugin for [Ctxo](https://github.com/alperhankendi/Ctxo). Gives AI coding
assistants dependency-aware context for Java codebases via two tiers.

## Tiers

| Tier | Engine | Emits | When active |
|---|---|---|---|
| **Syntax** (baseline) | `tree-sitter-java` | symbols, `imports`/`extends`/`implements` edges, cyclomatic complexity | always |
| **Full** | Eclipse JDT Core (`ctxo-jdt-analyzer` JAR) | resolved `calls`/`uses` edges, cross-file symbol IDs, generics, partial bindings | JRE 11+ present **and** analyzer JAR acquired (opt-in) |

The syntax tier ships in the package and needs zero setup. The full tier requires a Java
runtime (JRE 11+) and the analyzer JAR; without them the plugin degrades cleanly to the
syntax tier — the index never blocks.

## Install

```bash
ctxo install java          # adds @ctxo/lang-java to your project
```

Detection is automatic: a `pom.xml`, `build.gradle`, `build.gradle.kts`, or `.java` files
flag the project as Java.

## Full tier

The full tier uses Eclipse JDT Core, packaged as prebuilt JAR variants inside the
`@ctxo/lang-java-analyzer` companion package (~15 MB total).
Per [ADR-014](../../docs/architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md):

### Automatic JAR selection — no configuration needed

The plugin detects your JRE version at runtime and selects the matching JAR automatically:

| JRE on PATH | JAR selected | JDT Core | Analyzes source levels |
|---|---|---|---|
| **11 – 16** | `ctxo-jdt-analyzer-11.jar` | 3.33.0 (JavaSE-11) | Java 8 – 19 |
| **17+** | `ctxo-jdt-analyzer-17.jar` | 3.39.0 (JavaSE-17) | Java 8 – 21 |
| < 11 or absent | — | — | syntax tier only |

The analyzed **source level** is always independent of the running JRE — both JARs can parse
Java source files written in any version within their supported range.

- **Distribution:** JARs are **prebuilt artifacts**, not built on your machine. Acquired
  **opt-in** (never a silent download) and verified by SHA-256.
- **Local override:** point the plugin at a specific JAR with
  `CTXO_JDT_ANALYZER_JAR` (absolute path). Useful for development, air-gapped setups, and CI.
- **Java location:** the plugin resolves `java` via `CTXO_JAVA_HOME` → `JAVA_HOME` → `PATH`.

To switch between Java 11 and Java 17 full tier, set `CTXO_JAVA_HOME` to the desired JRE:

```bash
CTXO_JAVA_HOME=/path/to/jre11 ctxo index   # → java11 JAR selected
CTXO_JAVA_HOME=/path/to/jre17 ctxo index   # → java17 JAR selected
```

### Classpath resolution

For accurate binding resolution the analyzer locates dependency JARs in order: explicit
override -> IDE metadata (`.classpath`, `.idea/libraries`) -> local repository scan
(`~/.m2`, Gradle cache, parsed from `pom.xml` / `build.gradle`) -> empty (intra-file
bindings only). Build tools (`mvn`/`gradle`) are **never executed** by default.

## Symbol & edge mapping

Java constructs map onto Ctxo's symbol/edge kinds without extending the plugin API:
`enum` -> `type`, `record` -> `class`, `@interface` -> `interface`, constructors -> `method`,
fields -> `variable`.

## License

MIT
