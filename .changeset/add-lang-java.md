---
"@ctxo/lang-java": minor
---

Add `@ctxo/lang-java` — Java language plugin (syntax tier).

Built on `tree-sitter-java`. Implements Plugin API v1.

- **Symbols**: classes, interfaces, enums, records, methods, constructors. Nested types are qualified `Outer.Inner`. Methods are qualified `Outer.method`.
- **Edges**: `imports` (with wildcard skip and static-import normalization), `extends`, `implements`. Edge targets are name-keyed and resolved against the cross-file symbol registry, matching the convention used by `@ctxo/lang-csharp`.
- **Cyclomatic complexity**: counts `if`, `for`, `enhanced_for`, `while`, `do`, `switch_label`, `catch_clause`, `ternary_expression`, and `&&`/`||` short-circuits.
- **Detection**: already wired in `@ctxo/cli` (`pom.xml`, `build.gradle`, `build.gradle.kts`, `.java`).

Known limitations (out of scope for this release): sealed `permits` clauses, enum constants with bodies, instance/static initializer blocks, and anonymous inner classes are not surfaced. These require new `SymbolKind`/`EdgeKind` values in `@ctxo/plugin-api`.
