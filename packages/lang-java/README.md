# @ctxo/lang-java

Java language plugin for [Ctxo](https://github.com/alperhankendi/Ctxo). Gives AI coding
assistants dependency-aware context for Java codebases via two tiers.

## Tiers

| Tier | Engine | Emits | When active |
|---|---|---|---|
| **Syntax** (baseline) | `tree-sitter-java` | symbols, `imports`/`extends`/`implements` edges, cyclomatic complexity | always |
| **Full** | Eclipse JDT Core (`ctxo-jdt-analyzer` JAR) | resolved `calls`/`uses` edges, cross-file symbol IDs, generics, partial bindings | JRE 17+ present **and** analyzer JAR acquired (opt-in) |

The syntax tier ships in the package and needs zero setup. The full tier requires a Java
runtime (JRE 17+) and the analyzer JAR; without them the plugin degrades cleanly to the
syntax tier — the index never blocks.

## Install

```bash
ctxo install java          # adds @ctxo/lang-java to your project
```

Detection is automatic: a `pom.xml`, `build.gradle`, `build.gradle.kts`, or `.java` files
flag the project as Java.

## Full tier

The full tier uses Eclipse JDT Core, packaged as a standalone `ctxo-jdt-analyzer.jar`
(~15 MB). Per [ADR-014](../../docs/architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md):

- **Runtime:** a single JDT build that runs on **JRE 17** and analyzes source levels Java 8
  through 21 (source level is independent of the running JRE). JRE 21 is detected and used
  if present; a dedicated JRE-21 tier is deferred for future re-evaluation.
- **Distribution:** the JAR is a **prebuilt artifact**, not built on your machine. It is
  acquired **opt-in** (never a silent download) and verified by SHA-256.
- **Local override:** point the plugin at a specific JAR with the
  `CTXO_JDT_ANALYZER_JAR` environment variable (absolute path). Useful for development,
  air-gapped setups, and CI.
- **Java location:** the plugin resolves `java` via `CTXO_JAVA_HOME` -> `JAVA_HOME` -> `PATH`.

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
