# @ctxo/lang-java

## 0.8.1

### Patch Changes

- a91cadd: Pin tree-sitter grammar deps to exact versions to close the lockfile-regen landmine

  The caret ranges on `tree-sitter-c-sharp` (`^0.23.1`), `tree-sitter-go` (`^0.23.4`),
  and `tree-sitter-java` (`^0.23.5`) permitted newer grammar releases whose peer
  `tree-sitter ^0.25.0` is not satisfied by the pinned `tree-sitter@^0.22.4` core.
  Any lockfile regeneration (Dependabot rebase, `pnpm install`, `pnpm update`) could
  silently pull in e.g. `tree-sitter-c-sharp@0.23.5`, which pnpm placed under a
  peer-specific virtual path and skipped its native build script, breaking the DTS
  build with `TS2307: Cannot find module 'tree-sitter-c-sharp'`. Pinning to exact
  versions closes the landmine. A coordinated `tree-sitter@^0.25.0` ecosystem upgrade
  is tracked separately (#106 Option 2).

## 0.8.0

### Minor Changes

- a1dfd9b: Add the Java language plugin (`@ctxo/lang-java`). Ships a tree-sitter syntax tier (symbols, `imports`/`extends`/`implements` edges, cyclomatic complexity) as the always-present baseline, plus an Eclipse JDT Core full tier that adds resolved `calls`/`uses` edges, cross-file symbol IDs, generics, and partial bindings on broken builds. Single runtime tier (JRE 17 base; analyzes Java 8 to 21).

  The full-tier JDT analyzer ships as the companion `@ctxo/lang-java-analyzer` package whose tarball carries the prebuilt uber-JAR; the plugin resolves it from `node_modules` (integrity + provenance via npm — no download, no manual SHA pin). It is acquired opt-in via `ctxo install java --full-tier`, a smart default that installs the analyzer when a JRE 17+ is detected. The plugin degrades cleanly to the syntax tier when no JRE 17+ or analyzer package is present, and the active tier is surfaced by `ctxo index`, `ctxo doctor`, and MCP `_meta`. See [ADR-014](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md).
