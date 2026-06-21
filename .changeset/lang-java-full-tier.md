---
"@ctxo/lang-java": minor
"@ctxo/lang-java-analyzer": minor
---

Add the Java language plugin (`@ctxo/lang-java`). Ships a tree-sitter syntax tier (symbols, `imports`/`extends`/`implements` edges, cyclomatic complexity) as the always-present baseline, plus an Eclipse JDT Core full tier (`ctxo-jdt-analyzer` uber-JAR) that adds resolved `calls`/`uses` edges, cross-file symbol IDs, generics, and partial bindings on broken builds. Single runtime tier (JRE 17 base; analyzes Java 8 to 21). The full-tier JAR is acquired opt-in (env override or verified cache, SHA-256), never silently downloaded; the plugin degrades cleanly to the syntax tier when no JRE 17+ or analyzer JAR is present. See ADR-014. The full-tier JDT analyzer JAR ships as the companion `@ctxo/lang-java-analyzer` package, resolved from node_modules (integrity + provenance via npm), installed opt-in by `ctxo install java --full-tier` (smart default when a JRE 17+ is detected).
