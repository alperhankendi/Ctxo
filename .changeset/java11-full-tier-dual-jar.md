---
"@ctxo/lang-java": minor
---

Support Java 11+ full tier via dual-JAR strategy.

The full tier now activates with JRE 11+ (previously required JRE 17+). The
`@ctxo/lang-java-analyzer` companion package ships two prebuilt JARs; the
correct variant is selected automatically at runtime based on the detected JRE:

- JRE 11–16 → `ctxo-jdt-analyzer-11.jar` (JDT Core 3.33.0, analyzes Java 8–19)
- JRE 17+  → `ctxo-jdt-analyzer-17.jar` (JDT Core 3.39.0, analyzes Java 8–21)

No configuration required. Falls back to syntax tier silently when JRE is
absent or below 11.
