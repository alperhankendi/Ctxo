# @ctxo/lang-java-analyzer

## 0.13.0

### Minor Changes

- e838b4d: Normalization facts are business normalization (FC-4b). Many `normalization` facts were not. Every tier of the C#, TypeScript, Java and Go plugins now reports the nearest call that receives a normalized value (its consumer, up to the statement and never past a lambda), with its receiver and declaring types in the full tiers, and the shared finisher drops the fact when that consumer is a message sink: a logging method on a known logger type (Microsoft.Extensions.Logging, Serilog, NLog, log4net, `System.Diagnostics.Debug`/`Trace`, java.util.logging, SLF4J, log4j, commons-logging, Go `log`, `log/slog`, logrus, zap, zerolog, and in TypeScript `Console`, pino, winston, NestJS `Logger`/`LoggerService`, bunyan, log4js, tslog), the same methods on a logger-named receiver in every tier whenever no known logger type resolves, or an exception or error construction (`new ...Exception`, `new Error`, `errors.New`, `fmt.Errorf`). `auth.LogIn` or `writer.WriteLine` are no sinks, and `log.info("saved", repo.upsert(email.toLowerCase()))` keeps its fact. Display text (an interpolation hole or `+` operand next to text with whitespace) is dropped only when it goes to a sink or a formatting API (`StringBuilder.Append*`, `string.Format`, `fmt.Sprintf`, `Console.Write*`); SQL templates and space-joined keys keep their facts. Calls on formats (`Path` and character calls, hex or base64 output, file extensions, separator-only trims) give none, and a chain is one fact, the outermost call, also across lines. `ctxo index` and `ctxo watch` drop `normalization` facts in test files, as they drop `retry-timeout` facts; the `@ctxo/domain` text scan applies the sink rule to the call enclosing a normalization on its line. The `call` evidence gains `consumer`, `consumerTypes` and `inProse`, with new conformance vectors `isMessageSink`, `isDisplayCall`, `isTechnicalNormalization` and `feedsNormalization`. The Java full tier needs `@ctxo/lang-java-analyzer` at this release (run `ctxo update`); an older JAR reports no consumers, so only the format, chain and test-file rules apply there. A `shadow-specs.yaml` resolution recorded for a dropped call, such as the inner `email.Trim()` of a chain, turns stale (check 12 warns) and can be removed.

## 0.12.0

### Minor Changes

- 663f7ea: Business rules that live only in code are invisible to the cards an agent reads, so it can break them without breaking a test; this release finds them (#156 Phase 4). The TypeScript, C#, Java and Go plugins now detect literal comparisons, string normalization, retry and timeout values and public endpoints in every tier they have with one shared rule set (the analyzers collect evidence behind `--facts=`), and with `@ctxo/domain` and its registry file (`domain.registry`), or with `index.facts: true`, every indexed file of these languages gets a `facts` array (possibly empty) in its index JSON on the next re-index, so run a full `ctxo index` once after upgrading and again after adding the registry. Without a registry `@ctxo/domain` requests no facts, and the index is byte-identical to a run without the package. A fact extraction failure in any of the four plugins warns on stderr and gives `facts: []` for that file; TypeScript `typeof` guards give no facts; in `ctxo watch` a saved Go file takes its facts from the tree-sitter tier and a saved Java file reads the keep-alive analyzer's result without starting a second JVM. `@ctxo/domain` adds a text-scan fallback, `find_shadow_specs` and `get_context_map` (14 core tools, 18 with the package), `ctxo domain shadow-specs <context>`, `ctxo domain map`, `shadow-specs.yaml` resolutions and `ctxo verify-domain` check 12, plus the `domain.facts`, `domain.tests.characterization`, `domain.tests.contract` and `domain.rungs` config keys. Fingerprints go into `shadow-specs.yaml` as YAML single-quoted scalars (`- fingerprint: '...'`), the form `ctxo domain shadow-specs` prints. When `ctxo index` builds the domain graph but not the candidates or the maturity facts, it removes both loop artifacts, so the tools ask for a new `ctxo index` instead of serving old data. The `ctxo-domain-fold` skill marker moved to v0.16: run `ctxo init --domain` or `ctxo doctor --fix` after upgrading to refresh copies installed by 0.15.

### Patch Changes

- 1269853: The Java syntax tier (tree-sitter) now indexes the members the JDT full tier indexes, with the same symbol ids: methods and fields after the constants of an enum, interface and annotation constants, record compact constructors, and the members of anonymous class and enum constant bodies. Existing ids are unchanged; a re-index only adds symbols. Every fact owner is now a symbol in both tiers.

  The JDT full tier (`@ctxo/lang-java-analyzer`) now also walks the class bodies of enum constants (`GOLD { void q() {} }`). Their methods and fields become symbols with the ids the syntax tier uses, and the calls, uses and SQL call sites inside them are reported like those of any other member. The constants' arguments are still not walked.

  The `named.method` value of an annotation now keeps enum constants as written, such as `RequestMethod.POST`, so both tiers read the same HTTP verbs. Spring repositories that use `method = RequestMethod.X` see a one-time annotation diff on the next re-index.

## 0.11.0

### Minor Changes

- 663cfae: Language parity for TypeScript, Java and Go (#156 Phase 1): the three plugins now report TypeScript decorators, Java annotations (JDT and tree-sitter tiers) and Go struct tags as symbol annotations, index TypeScript test blocks and Go `_test.go` files as symbols with edges, and, when `@ctxo/lang-sql` is installed, add `reads`, `writes` and `executes` edges for constant SQL at known call sites (pg, mysql2, mssql, knex, Prisma, TypeORM, Sequelize and better-sqlite3 raw SQL; JDBC, Spring `JdbcTemplate`, JPA native queries and MyBatis; `database/sql`, sqlx, pgx and gorm raw SQL). They parse that SQL with `@ctxo/sql-extract`, the zero-dependency library that the ADR-017 dependency exception allows, and stay on protocol `'1'`, so older CLIs keep loading them, ignore the annotations and never request SQL edges. The first re-index after upgrading changes the committed index JSON of TypeScript, Java and Go files, tests now count as blast-radius dependents (so the safe-edit gate may fire more often on well-tested symbols), and the `ctxo install sql` help line names the new host languages.

  The Java analyzer (`@ctxo/lang-java-analyzer`) now reads sources as UTF-8 and escapes non-ASCII output, so Windows users get intact non-ASCII names. The Go full tier no longer stores an empty result when the analyzer run fails, crashes or times out: those files fall back to the tree-sitter syntax tier with a warning. `ctxo visualize` escapes symbol names in the page it embeds, which matters now that test titles are symbol names.

## 0.10.1

### Patch Changes

- cacea40: Plugin protocol v2 and data coupling (#156 Phase 1): `@ctxo/plugin-api` adds the data kinds (`table`, `view`, `procedure` with `reads`, `writes` and `executes` edges), typed symbol annotations, an opt-in facts channel and host capabilities, and the new `@ctxo/lang-sql` plugin (built on the zero-dependency `@ctxo/sql-extract` library, installed with `ctxo install sql`) indexes T-SQL definitions and the tables their bodies read and write. `@ctxo/lang-csharp` reports attribute annotations, adds SQL edges at known ADO.NET, Dapper, `SqlBulkCopy` and EF Core call sites when `@ctxo/lang-sql` is installed, and falls back to tree-sitter when its Roslyn helper cannot restore or build. The CLI puts data edges in the confirmed blast-radius tier, reports shared tables, ownership and external resources in the contexts view, recognises test files by test-framework annotations and adds the `csharp_tier` doctor check, and the other official plugins widen their `@ctxo/plugin-api` peer range.

## 0.10.0

### Minor Changes

- 5e7d482: Minor release: bump all packages to a new minor version line.

## 0.9.1

### Patch Changes

- 8db20d8: Patch release: dependency maintenance (zod 4.6.7) and CI action updates (setup-node 7.1.0, upload-artifact 7.0.2, test-reporter 3.2.0).

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
