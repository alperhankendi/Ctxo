# Ctxo — Roadmap

> Single source of truth for **what's next** and **what we've explicitly decided not to do**.
>
> - **Shipped work** — see [CHANGELOG.md](../CHANGELOG.md) and [prd.md § Delivered Phases](artifacts/prd.md#delivered-phases-post-v1)
> - **Per-story delivery status** — see [epics.md § Delivery Status](artifacts/epics.md#delivery-status-as-of-2026-04-13)
> - **Architectural decisions behind deferrals/rejections** — see [ADRs](architecture/ADR/)
>
> Consolidated 2026-04-13 from `todo.md` (competitive analysis) + `docs/todo-visibility.md` + epic audit remaining items. Originals archived in [archive/todo/](archive/todo/).

---

## Active Development (next candidates)

Items on deck for v0.7.x / v0.8. No strict ordering — picked by impact + readiness.

### Code intelligence

- **Community detection / graph clustering** — _shipped in v0.8 (see [CHANGELOG](../CHANGELOG.md))_. Louvain over the symbol graph powers `get_architectural_overlay` data-driven clusters, god nodes, cluster-scoped blast radius, drift signals in `get_why_context`, and boundary violations in `get_pr_impact`. Leiden remains deferred (see below).

- **Safe-edit guard + ctxo skills** - _shipped in v0.8_. PreToolUse hook (Claude Code) blocks edits to high-impact symbols until blast radius is checked; three model-invoked skills (`ctxo-understand`, `ctxo-safe-edit`, `ctxo-review-pr`) installed by `ctxo init`; new `ctxo blast-radius <symbolId> --json` and `ctxo gate --preview` commands; `gate:` config with `sensitivity` dial (strict/balanced/lenient). Cursor and other tools get skills + rules; Claude Code gets full hook enforcement. See [ADR-015](architecture/ADR/adr-015-safe-edit-guard.md).

- **Co-change engine, incremental indexing, one snapshot per commit (#157)** - _shipped_. Co-change comes from one git pass with its own window (`cochange:` config, `--cochange-commits`, `--cochange-since`), independent of `--max-history`; `ctxo index --files` and `--commit` re-index part of the index; the v2 post-commit hook runs `ctxo index --commit HEAD` once per commit and is upgraded in place by `ctxo init` and `ctxo doctor --fix` (new `git_hooks` check); history keeps one snapshot per commit and drift and boundary confidence count distinct commits; every blast-radius path (tools, CLI, gate) uses co-change and `get_blast_radius` adds `coChangedFiles`. See [ADR-016](architecture/ADR/adr-016-co-change-engine-and-snapshot-policy.md).

- **Contexts view: candidate bounded contexts (#156 Phase 1)** - _shipped_. `ctxo index` writes `.ctxo/index/contexts-view.json`: file-level Louvain over a blend of dependency and co-change edges, hub files damped, each candidate with a suggested label, fingerprint, cohesion, top terms, cross-candidate edges, co-change pairs and name collisions. Read it with `get_architectural_overlay({ mode: "contexts" })` (summary first, `candidate: <id>` for one in full) or `ctxo contexts [--json]`. New config: `communities:`, `contextsView:` and `index.tests`; `mode`, `searchMode` and `search_symbols` `mode` are now registered so clients can send them. See [architectural intelligence](features/architectural-intelligence.md) and the [ADR-016 addendum](architecture/ADR/adr-016-co-change-engine-and-snapshot-policy.md).

- **Plugin protocol v2, data coupling and `@ctxo/lang-sql` (#156 Phase 1)** - _shipped_. `@ctxo/plugin-api` adds the data kinds (`table`, `view`, `procedure`; `reads`, `writes`, `executes`), typed symbol annotations, facts on request (`index.facts`) and host capabilities, with `SUPPORTED_API_VERSIONS = ['1', '2']`. `@ctxo/lang-sql` (on the zero-dependency `@ctxo/sql-extract`, `ctxo install sql`) indexes T-SQL definitions and body accesses; the C# plugin reports attribute annotations and, with lang-sql installed, adds SQL edges at known ADO.NET, Dapper (including `CommandDefinition`), `SqlBulkCopy` and EF Core call sites (ScriptDom, constants only), falling back to tree-sitter when its helper cannot restore (new `csharp_tier` doctor check). Data edges are confirmed blast-radius dependents and stay out of symbol-level communities; every copy of a multi-defined table or procedure, and its 2-part ID, gives the same impact answer; the contexts view reports shared tables, ownership and external resources (`contextsView.weights.data`, default 0); test files are recognised by test-framework annotations. A shared corpus keeps the TypeScript and ScriptDom parsers in agreement. See [domain knowledge](features/domain-knowledge.md) and [ADR-017](architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md).

- **Tiered agent rules (#159)** - _shipped_. Claude Code gets a compact ctxo block when the safe-edit guard, the skills and an enabled gate back it up, every other client the full block, both inside versioned markers that are replaced in place without touching user content; `ctxo init --only`, `--skip` and `--no-guard` pick the parts and `--dry-run` lists every file; `ctxo doctor` gains `ai_rules`, `skills` and `claude_guard_hook`, and `--fix` installs the skills and the guard before re-rendering the rules; `ctxo-understand` carries the tool-selection guide. Blocks and skills are formatter-stable and compared with formatting ignored, linked rules files get the full block, skills carry a version marker, and one hold rule keeps init and `--fix` from recording an opt-out the user never made. See the [ADR-015 amendment](architecture/ADR/adr-015-safe-edit-guard.md#amendment-tiered-rules-159).

- **Domain knowledge layer: `@ctxo/domain` (#156, PR 2B)** - _shipped_. The opt-in package adds a context registry, `ctxo contexts-touched`, the session-scoped fold guard with the `Domain-Unchanged` trailer, `ctxo verify-domain` (eleven checks, the CI gate), generated loader rules (`ctxo domain rules`), convention discovery (`ctxo domain discover`), `ctxo init --domain`, boundaries and drift by named context, the additive `context`, `contextBoundaryViolations` and `contextDrift` fields, three doctor checks and global installs with the `install_copies` check. Feature doc: [domain-knowledge.md](features/domain-knowledge.md); design record: [ADR-018](architecture/ADR/adr-018-domain-knowledge-layer.md).

- **Domain graph, `get_domain_context`, `get_rule` and the domain search scope (#156, PR 3)** - _shipped_. `ctxo index` builds `.ctxo/index/domain/graph.json` from the cards and the glossary: rules linked to tests (framework annotations, the K6 text scan with test titles, `rule:` comments, card `Tests:` lines) and to code (card `Code:` lines, `rule:` comments above declarations), decisions linked to provenance, terms linked to identifiers. `get_blast_radius` gains `rulesAffected` and `cardsToUpdate`, `get_why_context` `decisions`, `get_context_for_task` a `cardExcerpt` within its budget, `get_pr_impact` `contextsTouched`, `cardsChanged` and `rulesWithoutTests`; two new tools (14 core tools, 16 with `@ctxo/domain`) and `get_ranked_context({ scope: "domain" })` over card sections, glossary entries and provenance files through the core BM25 engine. Feature doc: [the domain graph](features/domain-knowledge.md#the-domain-graph); internal API: [ADR-018 addendum](architecture/ADR/adr-018-domain-knowledge-layer.md#addendum-pr-3-additions-to-the-internal-api-156).

- **Fact detectors, the Deletion Test loop and the context map (#156, PR 4)** - _shipped_. The TypeScript, C#, Java and Go plugins detect `literal-comparison`, `normalization`, `retry-timeout` and `endpoint` facts in every tier they have (the primary and tree-sitter tiers of C#, Java and Go; ts-morph for TypeScript) with one shared rule set and conformance vectors, and `@ctxo/domain` scans the text of files no fact-capable plugin covers. Two new tools (14 core tools, 18 with `@ctxo/domain`): `find_shadow_specs` lists business-looking code no rule pins yet, with line-independent fingerprints and resolutions from rule links, `Untested:` lines and `<context>/shadow-specs.yaml`; `get_context_map` reports per-context metrics and a suggested rung (pinned, named, bounded, boring) with the status of each criterion. CLI faces `ctxo domain shadow-specs <context>` and `ctxo domain map`; `verify-domain` check 12 warns about stale resolutions. New config: `domain.facts`, `domain.tests.characterization`, `domain.tests.contract`, `domain.rungs`. Feature doc: [facts](features/domain-knowledge.md#facts), [the Deletion Test loop](features/domain-knowledge.md#the-deletion-test-loop), [the context map](features/domain-knowledge.md#the-context-map-and-rungs); addenda to [ADR-017](architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md#addendum-fact-detectors-pr-4) and [ADR-018](architecture/ADR/adr-018-domain-knowledge-layer.md#addendum-pr-4-additions-156).

- **`ctxo domain discover` that agents find (#191)** - _implemented, unreleased_. The rules block `ctxo init` writes names the command in one line once the domain layer is set up, the `ctxo-domain-fold` skill names it for adopting or tuning the domain config, and `get_context_map` hints at it while the conventions are at their defaults and the last index found something to propose (so do the "no registry" and "no domain graph" hints). Discovery reports external ID families (CWE, ISO and more), GitHub `#N` issues and lowercase `name-NN` branch families as evidence only, and proposes characterization and contract markers from Trait or Category values, custom test attributes and `*ContractTests` file names. Open: re-run the comparison on the comparison repository for the comparison page; a `domain.discovery.ignore` list so a removed wrong value is not proposed again. Feature doc: [discovery](features/domain-knowledge.md#discovery-and-the-id-safeguards).

- **Language parity for TypeScript, Java and Go (#156, PR 1C)** - _shipped_. `@ctxo/lang-typescript`, `@ctxo/lang-java` (with `@ctxo/lang-java-analyzer`) and `@ctxo/lang-go` report annotations (TypeScript decorators, Java annotations in both tiers, Go struct tags, with `named.member` for TypeScript properties and Go fields), index tests as symbols with edges (TypeScript test blocks named by title path, Go `_test.go` files in the full tier, Java test methods with their annotations) and, with `@ctxo/lang-sql` installed, add data edges for constant SQL at known call sites: pg, mysql2, mssql, `knex.raw`, Prisma raw, TypeORM, Sequelize and better-sqlite3; JDBC, Spring `JdbcTemplate`, JPA native queries, native `@Query` and MyBatis (JDT full tier); `database/sql`, sqlx, pgx and gorm raw SQL (analyzer full tier). All parse SQL with `@ctxo/sql-extract`, and host-language corpus cases (with a placeholder case for `?`, `$1`, `:name`, `#{x}`, `@p0` and `{0}`) keep them in agreement. `find_dead_code` recognises test files with the shared classifier, so Go functions called only from tests are no longer reported. A `plugin-tests` CI job runs the three plugin suites, JUnit and `go test`. See [language parity](features/domain-knowledge.md#language-parity-typescript-java-and-go) and the [ADR-017 addendum](architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md#addendum-language-parity-pr-1c).

### Platform & transport

- **`CTXO_HTTP_PORT` shadows CLI commands** - _fixed (see [CHANGELOG](../CHANGELOG.md))_. `CTXO_HTTP_PORT` used to take the HTTP server path before the CLI router, so with the variable exported `ctxo <command>` (including `ctxo <command> --help` and the post-commit hook's `ctxo index --commit HEAD`, which made `git commit` hang) started a server. The variable now counts only when `ctxo` runs without arguments; with arguments the CLI router runs. `--http [--port <n>]` still selects HTTP mode.

- **Streamable HTTP transport** — for remote/cloud MCP usage. Today Ctxo is stdio-only. Needed for hosted scenarios and non-local clients.

### Ecosystem

- **Monorepo workspace support (Phase 1)** — pnpm-workspace.yaml auto-detection + per-package plugin aggregation. Forward-compat hooks landed in v0.7.0 (`IWorkspace`, parameterized plugin discovery); full implementation pending user demand. See [prd.md § Phase 3](artifacts/prd.md#phase-3-monorepo-workspace-support).

---

## Quality & verification backlog

Open loops from the Epic 6 audit (2026-04-13). Small-to-medium tasks; clearing these closes the "Cross-Client Compat & Release" epic cleanly.

- **Cross-client smoke-test matrix** — Auto-registration works (v0.5.1) but no captured smoke-test record. Run all 14 MCP tools against Claude Code / Cursor / VS Code Copilot / Windsurf against a reference fixture; commit the result into `docs/runbook/mcp-validation/test-sessions/`.
- **Published p95 baseline per MCP tool** — Benchmark harness exists (`pnpm --filter @ctxo/cli bench`); no baseline numbers in docs. Run once on a reference machine, publish table under [architecture.md](artifacts/architecture.md) NFR-1 budgets.

---

## Deferred (not started, scope clarified)

Work that's been scoped and explicitly parked. Each has a known trigger to reactivate.

| Item | Source | Trigger to reactivate |
|---|---|---|
| **Layer-3 UserPromptSubmit nudge** | Safe-edit guard v0.8 | Prompt-level reminder when the guard has been active but the agent skips skills. Deferred: PreToolUse hook already enforces; adding a nudge risks prompt noise before measuring adoption impact. |
| **Cursor reactive `stop`-hook gate** | Safe-edit guard v0.8 | Cursor has no blocking pre-edit hook (confirmed through v3.6 changelog). Revisit if Cursor ships a pre-edit extension point. |
| **Coordinated `tree-sitter@^0.25.0` ecosystem upgrade** | #106 (Option 2) | Grammar plugins are pinned to exact versions against the `tree-sitter@^0.22.4` core (closing the lockfile-regen landmine). Bumping core to `^0.25.0` unblocks `tree-sitter-go@0.25` (#77) and newer `tree-sitter-c-sharp` (#78). Trigger: user demand for newer grammars; requires validating the 0.25 core API against each tree-sitter adapter. |
| **Tier-3 platform enforcement** | Safe-edit guard v0.8 | Enforcement for platforms beyond Claude Code (Windsurf, Copilot, etc.). Depends on each platform shipping a blocking pre-tool hook. |
| **Gate adoption telemetry** | Safe-edit guard v0.8 | Track how often the guard fires and is satisfied vs bypassed. Gate on confirmed user demand for the signal. |
| **#159 Grep hint** | #159 item 7 | A non-blocking hint on `Grep` calls whose pattern looks like a symbol name, suggesting `search_symbols`, never denying. The issue asks to measure first. Trigger: gate adoption telemetry (spec section 17). |
| **Co-change log cache** (`.ctxo/.cache/cochange-log.json`, keyed by SHA) | ADR-016 | The single git pass costs a fraction of a second on a repository with a long history. Add the cache and parse only `lastHead..HEAD` if a repository's pass exceeds 2 s. |
| **`--topo-order` for the co-change rename map** | ADR-016 | The rename map walks the log newest first and relies on git's default order. Adopt `--topo-order` if a repository with clock-skewed committer dates resolves renames to a stale name. |
| **Extensionless `extends` / `implements` ids in single-file runs** | #157 follow-up | With only the changed file loaded, `@ctxo/lang-typescript` can resolve an `extends` or `implements` edge to an extensionless import as `src/base::Base::class` instead of `src/base.ts::Base::class` (a full run gives the second). Affects `--file`, `--files` and `--commit` runs; fix in the adapter's symbol-reference fallback. |
| **Contexts view refresh in `ctxo watch`** | #156 / PR 1A | The view is recomputed by `ctxo index` (and the post-commit hook) but `ctxo watch` does not refresh it. Add it if users read the view during long watch sessions. |
| **`cochange.unit: merge` (change sets from merge commits)** | #165, ADR-016 addendum | Measured in PR 1A and left out: it strengthened cross-cutting co-change on the fixture and was flat on this repo. Reopen if a target emerges that the change-set unit serves better than filtering. |
| **Filter cross-cutting technical change sets from co-change** | #156 / PR 1A (K30) | Two areas of the fixture share a candidate through cross-cutting technical co-change, so the strict "four areas, four candidates" reading is not met. Trigger: a repository where such change sets visibly merge unrelated contexts. |
| **More test signals: other test attributes and bare `Tests/` folders** | #156 / PR 1B (K35, K38) | Annotation-based test detection shipped in PR 1B (11 xUnit, NUnit and MSTest names; name-only `*Test.cs` / `*Tests.cs` matches need an annotation once C# annotations exist). Still missed: test classes that use only other attributes (for example FsCheck `[Property]`; attributes derived from `Fact` or `Theory` have their own row) and unannotated `*Tests.cs` files in a bare capital `Tests/` or `Test/` folder (`**/tests/**` is case-sensitive). Workaround: an `index.tests` glob. Trigger: user evidence that the workaround is not enough. |
| **NoSQL data resources** | ADR-017 (K3b) | A `collection` kind with virtual resource nodes (for example `@data/mongodb::loans::collection`), host-plugin recognizers for driver calls, EF Core `ToTable` / `[Table]` through the same mechanism, and own language plugins for schema languages (CQL, Cypher, Prisma). Trigger: the first user whose contexts share a document store. |
| **Messaging coupling** | ADR-017 (K3b) | `topic` and `queue` kinds with `publishes` and `subscribes` edges; type-based buses point at the message class, named channels get virtual nodes (for example `@msg/kafka::loan-events::topic`); AsyncAPI as a future language plugin. Trigger: the first user whose contexts couple through a message bus. |
| **SQL dialects beyond T-SQL, configurable default schema** | #156 / PR 1B | Dialect (`tsql`) and default schema (`dbo`) are constants in v1. Trigger: fixture or user evidence of missed edges, or the first non-T-SQL consumer. |
| **Top-level DML as edges** | #156 / PR 1B | `INSERT`, `UPDATE` or `SELECT` outside any definition (migration and seed scripts) produce no edges; co-change still links those scripts. Trigger: fixture or user evidence of missed edges. |
| **`ALTER TABLE ... ADD` columns across files** | #156 / PR 1B | Added columns count only in the file that defines the table. Trigger: fixture or user evidence of missed columns or collisions. |
| **ORM and query-builder data access** | #156 / PR 1B | EF Core LINQ, `ToTable` / `[Table]` mappings and query builders produce no data edges; only constant raw SQL at known call sites does. Trigger: fixture or user evidence of missed edges. |
| **Non-constant SQL and project helper methods** | #156 / PR 1B | Dapper `CommandDefinition` became a known call site in PR 1B on fixture evidence. Still missed: SQL built at runtime (interpolation, `StringBuilder`, non-const variables and collections, `switch` expressions, table names from a registry) or kept in `static readonly` fields, and SQL that a project's own helper methods receive as arguments. On the PR 1B fixture these were 33 and 20 of the 75 real table accesses Ctxo missed (recall 59% of real pairs, precision 109 of 111). Trigger: a cheap recognizer for a common helper or builder pattern, or user evidence. |
| **Coverage of edgeless `.sql` files in the contexts view** | #156 / PR 1B (R3) | At `contextsView.weights.data` 0, `.sql` files with no co-change partner stay unclustered and lower `coverage` (noticeably on the fixture, candidates unchanged). Options: leave edgeless `.sql` files out of the coverage denominator, or give data edges a default weight. Workaround: `contextsView.exclude`. Trigger: a second SQL-heavy repository, or users reading the lower ratio as a regression. |
| **Test attributes by base type** | #156 / PR 1B (R5) | Test detection matches the 11 attribute names exactly, so a project's own attributes derived from `Fact` or `Theory` are not recognised. Resolve attribute base types in the Roslyn tier. No effect on the fixture (its folder globs caught every such file). Workaround: `index.tests`. Trigger: a name-only `*Tests.cs` file that this demotes to production. |
| **Data resource as one logical node** | #156 / PR 1B final review | Same-name definitions of a table or procedure resolve to one winner (production before docs before test, then codepoint-smallest path), and every copy shares the winner's dependents. The winner is not necessarily the newest migration, and the contexts view separately takes the union of the production copies' procedure bodies. Consider modelling a resource as one node keyed by canonical name, with the definitions as evidence, before NoSQL and messaging add virtual nodes. Trigger: PR 1C or 2 design work. |
| **C# keep-alive request timeout** | #156 / PR 1B final review | In `ctxo watch`, a single request that times out while the Roslyn keep-alive is still alive falls back to the batch cache, which can be stale for that file. A dead keep-alive is restarted, or the file falls back to tree-sitter; only the live-but-slow case remains. Fix: treat a request timeout like a failed restart for that file. Trigger: user evidence of stale C# symbols in watch. |
| **`get_why_context` miss cost** | #156 / PR 1B final review | A miss now reads every JSON index and builds the graph before it answers `found: false`, so that 2-part data ids resolve. Fine on the repositories measured; consider a cheap symbol-id lookup first. Trigger: slow misses on a large repository. |
| **Several `.csproj` files without a solution** | #156 / PR 1B | Without a `.sln` / `.slnx`, the Roslyn helper opens the first `.csproj` it finds, so only that project's files get Roslyn symbols. Trigger: user evidence. |
| **Contexts view honours `index.ignoreProjects` on incremental runs** | #156 / PR 1A | The view's `isIgnored` does not apply `ignoreProjects` to `--files` and `--commit` runs. Fix when a workspace relies on it. |
| **Warn on `!` negation in `index.tests`, `contextsView.exclude` and `hubs.paths`** | #156 / PR 1A | The globs are matched without negation; `ctxo doctor` could warn instead of silently ignoring a `!` pattern. |
| **`_meta.snapshotStaleness` in contexts mode uses `view.commitSha`** | #156 / PR 1A | The envelope compares the community snapshot's commit; in `mode: "contexts"` the view's own `commitSha` is the accurate reference. |
| **`foldSmallGroups` is quadratic in small groups** | #156 / PR 1A | Fine at the measured scale (18 groups, 0.2 ms). Optimise if a repository produces thousands of small groups. |
| **Library type information for TypeScript receivers** | #156 / PR 1C | The in-memory ts-morph project has no `node_modules` types, so a SQL receiver counts only when an 8-step provenance walk ties it to a listed module; union-typed receivers (`Pool \| null`), getters or methods returning a pool, dependency-injection containers and namespace imports of a relative module are missed. Trigger: evidence of missed edges on a real repository. |
| **JDT `calls` / `uses` edges from methods instead of types** | #156 / PR 1C | JDT code edges start at the enclosing type, so a Java test method's own dependencies show at its class (data edges already start at the method). Changing it rewrites every Java file's edges and blast radius. Trigger: an owner request. |
| **Count test dependents separately in the safe-edit gate** | #156 / PR 1C | TypeScript test blocks and Go test functions now count as blast-radius dependents, so the gate may fire more often on well-tested symbols (as for C#). Trigger: owner feedback after the upgrade. |
| **Go `t.Run` subtests as symbols** | #156 / PR 1C | Go test functions are symbols; their `t.Run` subtests are not, while TypeScript `it` blocks are. Trigger: demand, for example once subtest titles reach the K6 rule scan. |
| **Per-file Go syntax-tier fallback** | #156 / PR 1C | The Go full tier loads packages without build tags, so files excluded by a build constraint (for example `//go:build integration` tests) get no symbols and no edges; `GoCompositeAdapter` has no per-file fallback. A fix would check `analyzer.hasFile(path)` after the batch and use tree-sitter for the rest, and it needs an ID-compatibility check between the tiers for methods first. Trigger: a user reports missing build-tagged files. |
| **TypeScript property symbols** | #156 / PR 1C | Property decorators ride on the class with `named.member`; properties are not symbols, so dead code and communities do not grow. Trigger: a consumer that needs property-level symbols. |
| **"New violations only" boundary mode** | #156 / PR 2B (spec 17) | `domain.boundaries.enforce` has `by-rung` and `report`. Gating only the violations a branch adds needs a comparison with the base index. Trigger: teams asking to gate named rungs incrementally. |
| **Domain isolation and bounded-context visualization** | #156 / PR 2B (spec 17) | Showing contexts and their crossings on the dependency graph, and isolating a context for an agent. The owner will evaluate it in separate sessions. |
| **Cursor stop-hook reminder** | #156 / PR 2B (spec 17) | Cursor gets the `ctxo-domain-fold` skill, the loader rules and the CI gate, but no fold guard: its `stop` hook cannot block, and a follow-up message is intrusive. Trigger: Cursor ships a blocking hook, or demand. |
| **Route prefixes from Express mounts, gin groups and `MapGroup`** | #156 / PR 4 | Endpoint facts take the route of the call or annotation only: `app.use('/api', router)`, gin `Group()` and ASP.NET `MapGroup` prefixes are not joined, and a C# `Route` inherited from a base class is missed. Trigger: evidence of missed or mis-routed endpoints. |
| **Endpoint frameworks beyond the list** | #156 / PR 4 | chi, echo, Koa, Hono and Flask (in a native plugin) give no endpoint facts; Flask-style decorators reach only the text scan. Trigger: user demand. |
| **HTTP-level reachability from characterization tests** | #156 / PR 4 | `pinned` counts only graph edges, so tests that call an endpoint through an HTTP client or an in-process test server reach nothing. Trigger: owners reporting contexts under-detected as not pinned. |
| **Configurable retry and timeout name fragments** | #156 / PR 4 | The fragments (`retry`, `retries`, `attempt`, `timeout`, `delay`, `backoff`, `ttl`, `expir`) are fixed in the shared rules. Trigger: fixture or user noise reports. |
| **Multi-line text-scan heuristics** | #156 / PR 4 | The text fallback reads one line at a time, so comparisons and calls split over lines are missed. Trigger: precision or recall reports on the fallback. |
| **Loop artifacts refresh in `ctxo watch`** | #156 / PR 4 | `shadow-candidates.json` and `maturity.json` refresh only on `ctxo index` (as `graph.json`). Trigger: users running the Deletion Test during long watch sessions. |
| **Newline index for TypeScript symbol extraction** | #156 / PR 4 final review | The fact collector builds a newline offset index once per file, but symbol extraction still asks ts-morph for each symbol's line numbers, which counts from the file start every time: `extractFacts` on a file with 4,000 methods takes about 1.8 s, the collector itself about 0.15 s. Use the same index in `collectSymbols`; the facts-off output must stay byte-identical. Trigger: large generated TypeScript files in a real repository. |
| **Linear test-case classification** | #156 / PR 4 final review | `classifyTests` is quadratic in the test cases of one file, so a generated test file with thousands of cases slows the domain pass. An exact O(n log n) version needs a leaf-callable sweep, an interval pass for annotation holders and line-bucketed titles. Trigger: a slow domain pass on such a file. |
| **Link only the published parts of `@ctxo/domain` in the e2e SampleWorkspace** | #156 / PR 4 final review | The e2e `SampleWorkspace` links the whole `packages/domain` folder (test fixtures included) into `node_modules/@ctxo/domain`, so the C# Roslyn tier resolves some sample edges into `test-fixtures/library-lending/csharp`. Harness only: the published package ships `dist`, `skills`, `schema` and `README.md`. Link only those parts and `package.json`. Trigger: a C# e2e assertion that depends on one of those edges. |
| **Multi-repo domain links (a frontend repo linking backend cards)** | #156 / PR 3 | Cards, rules and links live in one repository; a repository cannot link its code or tests to rules whose cards live in another. Trigger: first consumer with cards in another repository. |
| **Unknown IDs in `rule:` comments: tests vs production** | #156 / PR 3 | In a test file, `// rule: E501` with an unknown ID is a check 6 error (PR 2B); in production code it is silent unless its prefix is a rule prefix, so linter comments stay quiet. Consider the same prefix gate for test files. Trigger: a team whose test files carry `rule:` comments of another tool. |
| **Domain graph refresh in `ctxo watch`** | #156 / PR 3 | `ctxo watch` runs no module pass, so `graph.json` follows card edits at the next `ctxo index` or commit; until then the tools answer with `stale: true` and a hint. Trigger: users editing cards during long watch sessions. |
| **Leiden community detection** | v0.8 Architectural Intelligence work | Monorepos/codebases where Louvain cluster quality is insufficient (~100K+ symbols, high modularity resolution needs). Swap is additive — same `CommunitySnapshot` output shape. |
| **Historical graph reconstruction for drift (`--since=30d`)** | v0.8 drift design | User demand for deep temporal drift analysis over re-parse cost. Snapshot-based chain is default. |
| **GHA workflow template in `ctxo init`** | v0.8 init UX | Shipped as plain docs guidance in v0.8; wrap as interactive template when users ask. |
| **HEAD staleness hint in MCP `_meta`** | v0.8 init UX | Snapshot freshness is observable via `commitSha` inside `communities.json`; promote into response envelope if users report drift signal confusion. |
| **Phase 1 Tier 3 — FTS5 search** | todo.md Phase 1 Tier 3 | Monorepos or codebases with 25K+ symbols where in-memory BM25 degrades. See [ADR-003](architecture/ADR/adr-003-fts5-search-deferred.md). |
| **Python plugin** (Phase B) | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | User demand post-v0.7; plugin protocol v1 already stable. Java shipped (see ADR-014). |
| **Framework-aware analysis** (Spring / Django ORM) | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | Requires plugin protocol v2 (semantic hooks); out of scope until multiple plugins exist. |
| **Community plugin registry** | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | v0.8+; gate on first third-party plugin request. |
| **Automated release pipeline** | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | Currently using changesets + manual tag; automate when release cadence exceeds ~monthly. |
| **C# beyond current full-tier** | prd.md Language Matrix | Roslyn + tree-sitter composite covers v0.8 needs; revisit if users request features Roslyn does not already expose. |

---

## Rejected (ADR-backed)

| Item | Decision | Reason |
|---|---|---|
| **Session continuity** (pre-compaction snapshots, SessionDB) | Rejected | Stateless tools make session state unnecessary. See [ADR-002](architecture/ADR/adr-002-reject-session-continuity.md). |
| **External docs integration** (URL fetch + index) | Rejected | LLMs + client-side WebFetch already solve this; misaligned with code intelligence mission. See [ADR-004](architecture/ADR/adr-004-reject-external-docs-integration.md). |
| **Webhook HTTP listener** (Epic 8) | Rejected | CI gate (`ctxo index --check`) + `post-commit` git hook deliver the same guarantee with zero server overhead. See [epics.md § Epic 8](artifacts/epics.md#epic-8-event-driven-index-updates-github--gitlab-integration). |

---

## Visibility & ecosystem (marketing / outreach)

Not product work, but tracked here so it doesn't get lost.

### MCP directory listings

- [ ] **awesome-mcp-servers** — open PR: [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) (Developer Tools section)
- [ ] **glama.ai** — submit: <https://glama.ai/mcp>
- [ ] **smithery.ai** — submit: <https://smithery.ai>
- [ ] **mcp.so** — submit: <https://mcp.so>
- [ ] **pulsemcp.com** — submit: <https://pulsemcp.com>
- [ ] **mcpservers.org** — submit: <https://mcpservers.org>
- [ ] **mcpmarket.com** — submit: <https://mcpmarket.com>
- [ ] **modelcontextprotocol/servers** — open PR: [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)

### GitHub repo polish

- [x] Topics (13 topics added)
- [x] Discussions enabled
- [x] Social preview uploaded
- [x] CONTRIBUTING.md
- [ ] Demo GIF / video embedded in README
- [ ] npm README badges (downloads, stars, license)
- [ ] Issue templates (bug report, feature request)
- [ ] PR template
- [ ] SECURITY.md
- [ ] FUNDING.yml (GitHub Sponsors)

### External

- [ ] "How I built Ctxo" post on Dev.to / Hashnode
- [ ] Reddit post (r/programming, r/MachineLearning)

---

## How this document is used

- **Adding work:** append under the right section with enough context that a cold reader knows why. Link to ADRs / epics / PRDs rather than re-explaining rationale.
- **Finishing work:** move the bullet out of this file into [CHANGELOG.md](../CHANGELOG.md); if it was a phase, also update [prd.md § Delivered Phases](artifacts/prd.md#delivered-phases-post-v1).
- **Rejecting or deferring work:** require an ADR or epic note before moving to "Deferred" / "Rejected". No silent deletions — history goes in archive.
