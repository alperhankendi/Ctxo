---
"@ctxo/lang-java-analyzer": minor
---

Ship dual JARs for the Java 11+ full tier.

The package now carries two prebuilt uber-JARs instead of one, and `@ctxo/lang-java`
picks the right one at runtime from the detected JRE:

- `ctxo-jdt-analyzer-11.jar` (JDT Core 3.33.0, JRE 11-16, analyzes Java 8-19)
- `ctxo-jdt-analyzer-17.jar` (JDT Core 3.39.0, JRE 17+, analyzes Java 8-21)

This replaces the single `ctxo-jdt-analyzer.jar` shipped through 0.8.0. The plugin
resolves the variant by filename, so both packages must be published together:
`@ctxo/lang-java` 0.9.0 looks only for the two new names and silently falls back to
the syntax tier when neither is present. See [ADR-014](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md).
