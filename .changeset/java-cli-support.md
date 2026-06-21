---
"@ctxo/cli": minor
"@ctxo/plugin-api": patch
"@ctxo/lang-csharp": patch
---

Ship the CLI-side Java support that pairs with `@ctxo/lang-java` and `@ctxo/lang-java-analyzer` 0.8.0. Without this release the published Java plugins do not work end to end, because the CLI half was missing.

- `ctxo install java --full-tier` / `--syntax-only` with a JRE-aware smart default (installs the analyzer companion package when a JRE 17+ is detected).
- `ctxo doctor` Java tier check (runtime + analyzer presence + actionable hint); `ctxo index` surfaces the active Java tier.
- core: accept name-reference edge targets (`EdgeTargetSchema`) plus a resilient index read, and resolve those targets by unambiguous name+kind in the symbol graph. Without these, Java `extends`/`implements`/`uses`/`calls` edges are dropped on read or left unresolved, so blast-radius, find-importers, and class-hierarchy return nothing for Java.
- watch: a generic `IIncrementalReindex` keep-alive capability (new in `@ctxo/plugin-api`) replaces the C#-hardcoded path. `@ctxo/lang-csharp` now exposes `getIncrementalReindex()` so C# watch keep-alive keeps working with the generalized watch command.
