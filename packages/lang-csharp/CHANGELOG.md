# @ctxo/lang-csharp

## 0.7.3

### Patch Changes

- c8165d8: Ship the CLI-side Java support that pairs with `@ctxo/lang-java` and `@ctxo/lang-java-analyzer` 0.8.0. Without this release the published Java plugins do not work end to end, because the CLI half was missing.

  - `ctxo install java --full-tier` / `--syntax-only` with a JRE-aware smart default (installs the analyzer companion package when a JRE 17+ is detected).
  - `ctxo doctor` Java tier check (runtime + analyzer presence + actionable hint); `ctxo index` surfaces the active Java tier.
  - core: accept name-reference edge targets (`EdgeTargetSchema`) plus a resilient index read, and resolve those targets by unambiguous name+kind in the symbol graph. Without these, Java `extends`/`implements`/`uses`/`calls` edges are dropped on read or left unresolved, so blast-radius, find-importers, and class-hierarchy return nothing for Java.
  - watch: a generic `IIncrementalReindex` keep-alive capability (new in `@ctxo/plugin-api`) replaces the C#-hardcoded path. `@ctxo/lang-csharp` now exposes `getIncrementalReindex()` so C# watch keep-alive keeps working with the generalized watch command.

- Updated dependencies [c8165d8]
  - @ctxo/plugin-api@0.7.2

## 0.7.2

### Patch Changes

- 5b1ea92: Release pipeline hardening:

  - Release workflow now runs `pnpm -r typecheck` and `pnpm -r test` before publishing, so broken builds cannot ship to npm.
  - Verifies `NPM_TOKEN` secret is present before doing any work (fast fail with actionable message).
  - After publish, automatically fixes npm dist-tags so prerelease versions (`-alpha`, `-beta`, `-rc`, `-next`) move to the matching channel tag and `latest` stays pinned to the highest stable version.
  - All public packages now declare `publishConfig.access: public` and `publishConfig.provenance: true` so per-package npm publishes (manual or automated) keep provenance and visibility consistent.
  - New `dist-tag-repair` workflow available from the Actions tab to manually re-align dist-tags for any package, with a `dry_run` switch.

- Updated dependencies [5b1ea92]
  - @ctxo/plugin-api@0.7.1

## 0.7.1

### Patch Changes

- 35c8b76: Bump tree-sitter and its grammars to 0.25 (tree-sitter, tree-sitter-go, tree-sitter-c-sharp). The shared TreeSitterAdapter Language type is widened so future grammar major bumps don't require a coordinated tsc fix.
