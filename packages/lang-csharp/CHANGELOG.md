# @ctxo/lang-csharp

## 0.11.0

### Minor Changes

- 3b2a20d: C# route prefixes and test attributes by base type (Roslyn tier).

  - Minimal API endpoint facts join their `MapGroup` prefixes: `var g = app.MapGroup("/api"); g.MapGet("/x", ...)` gives `GET /api/x`, nested and inline groups compose, and a group passed to a method or an extension method's `this` parameter (`app.MapGroup("/users").MapUsers()`) takes the prefix its call sites in the project agree on; ASP.NET conventions that return their receiver (`WithTags`, `RequireAuthorization`, `WithOpenApi`, `AddEndpointFilter`) keep it. Anything that does not resolve (a local written again in any form, a group returned by a method, a non-constant prefix, a type-parameter receiver, call sites that disagree or none, a method, of any accessibility, that code in a dependent project also references) keeps the call's own route.
  - A controller without its own `[Route]` inherits the class route of its nearest base class with one, one or more levels up, in any file or a referenced project (abstract and `[NonController]` classes inherit nothing), with `[controller]` and `[action]` from the derived class and method. The helper reports it as a facts-only `inheritedRoute` on the class symbol, never as an annotation; the output without facts is unchanged.
  - A project's own test attribute derived from one of the 11 known xUnit, NUnit and MSTest attributes (`[RetryFact]` from `Xunit.FactAttribute`, at any depth) is followed by an annotation of the nearest known base, for example `{ name: "Fact", named: { type: "Xunit.FactAttribute", via: "MyTests.RetryFactAttribute" } }`, so the host's name-based test detection recognises it without knowing the derived name. Look-alike names that derive from no test attribute get nothing.

  The tree-sitter tier is unchanged (name-based, no prefixes). These endpoint facts depend on other files, and incremental runs (`--files`, the post-commit hook, `ctxo watch`) re-index only the changed file: run a full `ctxo index` after changing a group call site or a base controller's `[Route]`, and after upgrading, so every C# file picks up the new annotations and endpoint facts.

- e838b4d: Normalization facts are business normalization (FC-4b). Many `normalization` facts were not. Every tier of the C#, TypeScript, Java and Go plugins now reports the nearest call that receives a normalized value (its consumer, up to the statement and never past a lambda), with its receiver and declaring types in the full tiers, and the shared finisher drops the fact when that consumer is a message sink: a logging method on a known logger type (Microsoft.Extensions.Logging, Serilog, NLog, log4net, `System.Diagnostics.Debug`/`Trace`, java.util.logging, SLF4J, log4j, commons-logging, Go `log`, `log/slog`, logrus, zap, zerolog, and in TypeScript `Console`, pino, winston, NestJS `Logger`/`LoggerService`, bunyan, log4js, tslog), the same methods on a logger-named receiver in every tier whenever no known logger type resolves, or an exception or error construction (`new ...Exception`, `new Error`, `errors.New`, `fmt.Errorf`). `auth.LogIn` or `writer.WriteLine` are no sinks, and `log.info("saved", repo.upsert(email.toLowerCase()))` keeps its fact. Display text (an interpolation hole or `+` operand next to text with whitespace) is dropped only when it goes to a sink or a formatting API (`StringBuilder.Append*`, `string.Format`, `fmt.Sprintf`, `Console.Write*`); SQL templates and space-joined keys keep their facts. Calls on formats (`Path` and character calls, hex or base64 output, file extensions, separator-only trims) give none, and a chain is one fact, the outermost call, also across lines. `ctxo index` and `ctxo watch` drop `normalization` facts in test files, as they drop `retry-timeout` facts; the `@ctxo/domain` text scan applies the sink rule to the call enclosing a normalization on its line. The `call` evidence gains `consumer`, `consumerTypes` and `inProse`, with new conformance vectors `isMessageSink`, `isDisplayCall`, `isTechnicalNormalization` and `feedsNormalization`. The Java full tier needs `@ctxo/lang-java-analyzer` at this release (run `ctxo update`); an older JAR reports no consumers, so only the format, chain and test-file rules apply there. A `shadow-specs.yaml` resolution recorded for a dropped call, such as the inner `email.Trim()` of a chain, turns stale (check 12 warns) and can be removed.

## 0.10.1

### Patch Changes

- c8ead4b: Fix `ctxo update` reporting an update forever after a successful install.

  - `ctxo update` now reads CURRENT from the installed `package.json` in the project's `node_modules` instead of the running binary (often a stale global) or the plugin's self-reported version. `--global` still compares the running binary.
  - When the running `ctxo` differs from the project's `@ctxo/cli`, `ctxo update` prints a hint to run `ctxo update --global` or use `npx ctxo`.
  - `@ctxo/lang-typescript`, `@ctxo/lang-go`, `@ctxo/lang-java` and `@ctxo/lang-csharp` now read `plugin.version` from their own `package.json`. They previously reported a hardcoded `0.7.0-alpha.0` / `0.8.0-alpha.0` in `ctxo update`, `ctxo doctor` and `ctxo --version --verbose`.

## 0.10.0

### Minor Changes

- 663f7ea: Business rules that live only in code are invisible to the cards an agent reads, so it can break them without breaking a test; this release finds them (#156 Phase 4). The TypeScript, C#, Java and Go plugins now detect literal comparisons, string normalization, retry and timeout values and public endpoints in every tier they have with one shared rule set (the analyzers collect evidence behind `--facts=`), and with `@ctxo/domain` and its registry file (`domain.registry`), or with `index.facts: true`, every indexed file of these languages gets a `facts` array (possibly empty) in its index JSON on the next re-index, so run a full `ctxo index` once after upgrading and again after adding the registry. Without a registry `@ctxo/domain` requests no facts, and the index is byte-identical to a run without the package. A fact extraction failure in any of the four plugins warns on stderr and gives `facts: []` for that file; TypeScript `typeof` guards give no facts; in `ctxo watch` a saved Go file takes its facts from the tree-sitter tier and a saved Java file reads the keep-alive analyzer's result without starting a second JVM. `@ctxo/domain` adds a text-scan fallback, `find_shadow_specs` and `get_context_map` (14 core tools, 18 with the package), `ctxo domain shadow-specs <context>`, `ctxo domain map`, `shadow-specs.yaml` resolutions and `ctxo verify-domain` check 12, plus the `domain.facts`, `domain.tests.characterization`, `domain.tests.contract` and `domain.rungs` config keys. Fingerprints go into `shadow-specs.yaml` as YAML single-quoted scalars (`- fingerprint: '...'`), the form `ctxo domain shadow-specs` prints. When `ctxo index` builds the domain graph but not the candidates or the maturity facts, it removes both loop artifacts, so the tools ask for a new `ctxo index` instead of serving old data. The `ctxo-domain-fold` skill marker moved to v0.16: run `ctxo init --domain` or `ctxo doctor --fix` after upgrading to refresh copies installed by 0.15.

### Patch Changes

- d25191b: C# syntax tier (tree-sitter): a file-scoped namespace (`namespace Lending.Loans;`) now applies to every type after it, as it does in the Roslyn tier. Symbol, edge and complexity IDs of such files gain the namespace, for example `Loans/LoanService.cs::Lending.Loans.LoanService::class` instead of `Loans/LoanService.cs::LoanService::class`, and base types are resolved through the file's namespace, its `using` directives, the global namespace, then a unique C# class or interface whose name ends in `.<Base>` (properties, methods and other languages' symbols never match). The lookups are built once per symbol registry, so large solutions do not rescan it for every unresolved base.

  Who is affected: projects indexed in the syntax tier, that is, machines without a .NET 8+ SDK, and runs where the Roslyn helper fails and C# falls back to tree-sitter. Their IDs for file-scoped namespace files change once, on the next `ctxo index`. Files with block namespaces (`namespace X { ... }`) and runs in the Roslyn tier are unchanged.

## 0.9.0

### Minor Changes

- cacea40: Plugin protocol v2 and data coupling (#156 Phase 1): `@ctxo/plugin-api` adds the data kinds (`table`, `view`, `procedure` with `reads`, `writes` and `executes` edges), typed symbol annotations, an opt-in facts channel and host capabilities, and the new `@ctxo/lang-sql` plugin (built on the zero-dependency `@ctxo/sql-extract` library, installed with `ctxo install sql`) indexes T-SQL definitions and the tables their bodies read and write. `@ctxo/lang-csharp` reports attribute annotations, adds SQL edges at known ADO.NET, Dapper, `SqlBulkCopy` and EF Core call sites when `@ctxo/lang-sql` is installed, and falls back to tree-sitter when its Roslyn helper cannot restore or build. The CLI puts data edges in the confirmed blast-radius tier, reports shared tables, ownership and external resources in the contexts view, recognises test files by test-framework annotations and adds the `csharp_tier` doctor check, and the other official plugins widen their `@ctxo/plugin-api` peer range.

## 0.8.0

### Minor Changes

- 5e7d482: Minor release: bump all packages to a new minor version line.

## 0.7.5

### Patch Changes

- 8db20d8: Patch release: dependency maintenance (zod 4.6.7) and CI action updates (setup-node 7.1.0, upload-artifact 7.0.2, test-reporter 3.2.0).
- Updated dependencies [8db20d8]
  - @ctxo/plugin-api@0.7.3

## 0.7.4

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
