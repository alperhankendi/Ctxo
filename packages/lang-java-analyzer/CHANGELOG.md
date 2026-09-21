# @ctxo/lang-java-analyzer

## 0.9.0

### Minor Changes

- 12e7094: Ship dual JARs for the Java 11+ full tier.

  The package now carries two prebuilt uber-JARs instead of one, and `@ctxo/lang-java`
  picks the right one at runtime from the detected JRE:

  - `ctxo-jdt-analyzer-11.jar` (JDT Core 3.33.0, JRE 11-16, analyzes Java 8-19)
  - `ctxo-jdt-analyzer-17.jar` (JDT Core 3.39.0, JRE 17+, analyzes Java 8-21)

  This replaces the single `ctxo-jdt-analyzer.jar` shipped through 0.8.0. The plugin
  resolves the variant by filename, so both packages must be published together:
  `@ctxo/lang-java` 0.9.0 looks only for the two new names and silently falls back to
  the syntax tier when neither is present. See [ADR-014](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md).

## 0.8.0

### Minor Changes

- a1dfd9b: Add the Java language plugin (`@ctxo/lang-java`). Ships a tree-sitter syntax tier (symbols, `imports`/`extends`/`implements` edges, cyclomatic complexity) as the always-present baseline, plus an Eclipse JDT Core full tier that adds resolved `calls`/`uses` edges, cross-file symbol IDs, generics, and partial bindings on broken builds. Single runtime tier (JRE 17 base; analyzes Java 8 to 21).

  The full-tier JDT analyzer ships as the companion `@ctxo/lang-java-analyzer` package whose tarball carries the prebuilt uber-JAR; the plugin resolves it from `node_modules` (integrity + provenance via npm — no download, no manual SHA pin). It is acquired opt-in via `ctxo install java --full-tier`, a smart default that installs the analyzer when a JRE 17+ is detected. The plugin degrades cleanly to the syntax tier when no JRE 17+ or analyzer package is present, and the active tier is surfaced by `ctxo index`, `ctxo doctor`, and MCP `_meta`. See [ADR-014](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md).
