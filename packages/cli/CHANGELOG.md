# @ctxo/cli

## 0.18.0

### Minor Changes

- 0d185f3: Cursor gets a fold reminder. Cursor's `stop` hook cannot block, so with `@ctxo/domain` `ctxo init --domain` (Cursor selected) now registers `ctxo domain-cursor-hook` in `.cursor/hooks.json` for `beforeSubmitPrompt` and `stop`, merged into the hooks already there. The first prompt of a conversation records where it starts; every prompt gets exactly `{"continue":true}` (also without `@ctxo/domain` and on any error), and a repeat prompt answers without loading the module or running git. On a `stop` with `status: "completed"` the reminder runs the Claude Code fold guard's own decision and, when the guard would block, prints `{"followup_message":"ctxo domain reminder: ..."}` with the guard's reason. At most once per conversation (else per generation, else per 10 minutes), quiet while a follow-up runs, with `domain.guard.enabled: false` and on any error; it never blocks and always exits 0; an aborted or errored stop prints nothing. `domain.guard.enabled: false` also keeps init and doctor from adding the entries. `ctxo doctor` reports a missing, duplicated or unreadable reminder entry under `domain_agent_setup` when `.cursor/` exists, and `ctxo doctor --fix` now repairs the domain agent setup (loader rules, the Claude Code guard hooks, the Cursor reminder, the `ctxo-domain-fold` skill), keeping other hooks and never writing an unreadable file. Module API: `CtxoModuleRegistration.doctorFixes` (`ModuleDoctorFix`, `DoctorFixContext`).
- 5d47390: `index.tests` globs now reach the language plugins. `@ctxo/plugin-api` adds an optional `PluginContext.testGlobs` (type-only and additive, so the plugin peer ranges are unchanged); `@ctxo/cli` sets it in `ctxo index` and `ctxo watch` to the default test globs followed by the valid `index.tests` globs, each once. `@ctxo/lang-typescript` decides test blocks (`describe`, `it`, `test`), their edges, SQL call-site scopes and fact owners with those globs, so `index.tests: ["spec/**/*.check.ts"]` makes the blocks of `spec/loans/policy.check.ts` test symbols. With a CLI that predates the field, the TypeScript plugin keeps its built-in default rule. Behaviour change: a current CLI sends all its default test globs, including `**/*.Tests/**` and `**/*.Test/**`, so TypeScript files under such folders now get test blocks. `index.tests` does not support negation: a `!` entry is skipped (it no longer turns every other file into a test file in the contexts view), the TypeScript plugin skips one too, and `ctxo doctor` warns and names it (use `index.ignore` to leave files out). Re-run `ctxo index` after upgrading or changing `index.tests`.
- 49a000f: `ctxo watch` now refreshes the domain artifacts. With `@ctxo/domain` installed, watch runs the domain index pass (the one `ctxo index` runs) after the re-index of the changed files, so `graph.json`, `maturity.json`, `shadow-candidates.json`, `contexts.json` and `boundaries.json` follow your edits and the domain tools stop answering `stale: true`. A registry, card or glossary edit runs the pass after a quiet period of 1 s, or twice the last pass when that is longer; changed source files run it once `watch.snapshotMinFileChanges` of them are pending, 5 s after the last event; a due pass is never postponed more than 30 s; at start, one pass runs only when the graph is stale. For the same index at the same commit the pass writes the bytes `ctxo index` writes; the change-log fields (moved files, discovery, history) keep the values of the last `ctxo index`. A registry created while watch runs gets no pass (no facts were requested), with a warning on each skipped pass until watch is restarted. Passes never overlap, a failing pass is logged and watch goes on, and without `@ctxo/domain` watch behaves as before. The stale hints now name the watch refresh. `shadow-candidates.json` now writes fact `detail` keys in codepoint order, so a full and an incremental run give the same bytes. Module API: `classifyWatchPath(path, indexed)`, `watchArtifactsStale()` and `IndexPassContext.factsRequested`.

### Patch Changes

- e838b4d: Normalization facts are business normalization (FC-4b). Many `normalization` facts were not. Every tier of the C#, TypeScript, Java and Go plugins now reports the nearest call that receives a normalized value (its consumer, up to the statement and never past a lambda), with its receiver and declaring types in the full tiers, and the shared finisher drops the fact when that consumer is a message sink: a logging method on a known logger type (Microsoft.Extensions.Logging, Serilog, NLog, log4net, `System.Diagnostics.Debug`/`Trace`, java.util.logging, SLF4J, log4j, commons-logging, Go `log`, `log/slog`, logrus, zap, zerolog, and in TypeScript `Console`, pino, winston, NestJS `Logger`/`LoggerService`, bunyan, log4js, tslog), the same methods on a logger-named receiver in every tier whenever no known logger type resolves, or an exception or error construction (`new ...Exception`, `new Error`, `errors.New`, `fmt.Errorf`). `auth.LogIn` or `writer.WriteLine` are no sinks, and `log.info("saved", repo.upsert(email.toLowerCase()))` keeps its fact. Display text (an interpolation hole or `+` operand next to text with whitespace) is dropped only when it goes to a sink or a formatting API (`StringBuilder.Append*`, `string.Format`, `fmt.Sprintf`, `Console.Write*`); SQL templates and space-joined keys keep their facts. Calls on formats (`Path` and character calls, hex or base64 output, file extensions, separator-only trims) give none, and a chain is one fact, the outermost call, also across lines. `ctxo index` and `ctxo watch` drop `normalization` facts in test files, as they drop `retry-timeout` facts; the `@ctxo/domain` text scan applies the sink rule to the call enclosing a normalization on its line. The `call` evidence gains `consumer`, `consumerTypes` and `inProse`, with new conformance vectors `isMessageSink`, `isDisplayCall`, `isTechnicalNormalization` and `feedsNormalization`. The Java full tier needs `@ctxo/lang-java-analyzer` at this release (run `ctxo update`); an older JAR reports no consumers, so only the format, chain and test-file rules apply there. A `shadow-specs.yaml` resolution recorded for a dropped call, such as the inner `email.Trim()` of a chain, turns stale (check 12 warns) and can be removed.
- Updated dependencies [5d47390]
- Updated dependencies [e838b4d]
  - @ctxo/plugin-api@0.9.2

## 0.17.2

## 0.17.1

### Patch Changes

- 9fae84f: fix(blast-radius): `overallRiskScore` no longer saturates at 1.0

  The previous formula divided the depth-weighted risk sum by the number of direct dependents. Since every direct dependent contributes exactly 1.0, the result was always >= 1 and got capped, so the score was effectively binary (0 or 1). `get_pr_impact` therefore reported `riskLevel: "high"` for any changed symbol with at least one dependent and the `medium` band was unreachable.

  The score is now `sum(riskScore) / (sum(riskScore) + 5)`: one direct dependent scores 0.167, three 0.375 (medium, matching the balanced gate floor), twelve 0.706 (high). Heavily-depended-on symbols stay distinguishable instead of all pinning at 1.0, and wide blast still outranks deep blast.

  **Behaviour change:** the bands (`low` < 0.3, `medium` 0.3 to 0.7, `high` > 0.7) are unchanged, but the scale under them is not. `get_pr_impact` now reports `high` much less often (it needs about 12 or more direct dependents, or the equivalent depth-weighted mass, where it used to fire for any symbol with one), and CI scripts that threshold `overallRiskScore` (for example `> 0.75` on `ctxo blast-radius` output) will pass where they used to fail. Review such thresholds; the docs list rough anchors for each band.

## 0.17.0

### Minor Changes

- 301f045: Agents adopting the domain layer never found `ctxo domain discover`, and its proposal turned security IDs into tracker keys, missed the GitHub issue tracker and missed contract tests marked by attributes or file names. Now:

  - `@ctxo/cli`: when the domain layer is set up (a `domain` key in `.ctxo/config.yaml` or the default registry `docs/domain/contexts.yaml`, both committed; otherwise a loaded `@ctxo/domain`), the rules block `ctxo init` writes (compact and full) adds one line: "Adopting or tuning the domain layer? Run `ctxo domain discover` first (`--json` for the evidence, `--write` to merge the proposal)." Committed state decides first, so teammates with and without the package render the same block. Otherwise the block is unchanged under the same template version (a ctxo released before this treats the line as an edit and removes it). `ctxo doctor` (`ai_rules`) reports a block whose line does not match that state, and `ctxo doctor --fix` re-renders it.
  - The `ctxo-domain-fold` skill tells agents to run `ctxo domain discover` first when adopting or tuning the domain config. The `get_context_map` description names it, the "no registry" and "no domain graph" hints name it, and `get_context_map` and `ctxo domain map` add a hint while the conventions are all at their defaults and the last `ctxo index` found that discovery would add something (recorded in `maturity.json`).
  - Well-known external ID families (CWE, CVE, ADR, RFC, ISO, GHSA, OWASP and more) are reported as "external IDs: references, not rule IDs; no config needed" and never proposed. A plain mention of them never linked as a rule ID, since only IDs that exist in a card link; a family that equals a card rule prefix is flagged.
  - GitHub issue references (subjects, `(#N)` squash suffixes, `N-slug` branches) are reported with their share and named as the issue tracker when they are the largest family; lowercase `name-NN` branch families are reported as lowercase identifiers, marked as possible tracker keys when their upper case is a known prefix. Both are evidence only.
  - Characterization and contract tests are proposed from Trait or Category values that name the kind (`Trait:Category=StorageContract`), custom test attributes (`StorageContractFact`) and test file names (`**/*ContractTests.cs` as a path glob), not only from folders. A file named after a non-test class (`LoanContractTests.cs` next to `LoanContract`) and a value that only contains the word (`ContractRenewal`) are not proposed. `--write` still adds values and removes none; remove a wrong value by hand.
  - `--json`: external ID families no longer appear in `evidence.trackerKeys`. The evidence gains `externalIds`, `githubIssues`, `otherIdentifiers` and `testKindMarkers`, the proposal `characterizationAnnotations` and `contractAnnotations`; other fields are unchanged.

## 0.16.1

### Patch Changes

- c8ead4b: Fix `ctxo update` reporting an update forever after a successful install.

  - `ctxo update` now reads CURRENT from the installed `package.json` in the project's `node_modules` instead of the running binary (often a stale global) or the plugin's self-reported version. `--global` still compares the running binary.
  - When the running `ctxo` differs from the project's `@ctxo/cli`, `ctxo update` prints a hint to run `ctxo update --global` or use `npx ctxo`.
  - `@ctxo/lang-typescript`, `@ctxo/lang-go`, `@ctxo/lang-java` and `@ctxo/lang-csharp` now read `plugin.version` from their own `package.json`. They previously reported a hardcoded `0.7.0-alpha.0` / `0.8.0-alpha.0` in `ctxo update`, `ctxo doctor` and `ctxo --version --verbose`.

## 0.16.0

### Minor Changes

- 663f7ea: Business rules that live only in code are invisible to the cards an agent reads, so it can break them without breaking a test; this release finds them (#156 Phase 4). The TypeScript, C#, Java and Go plugins now detect literal comparisons, string normalization, retry and timeout values and public endpoints in every tier they have with one shared rule set (the analyzers collect evidence behind `--facts=`), and with `@ctxo/domain` and its registry file (`domain.registry`), or with `index.facts: true`, every indexed file of these languages gets a `facts` array (possibly empty) in its index JSON on the next re-index, so run a full `ctxo index` once after upgrading and again after adding the registry. Without a registry `@ctxo/domain` requests no facts, and the index is byte-identical to a run without the package. A fact extraction failure in any of the four plugins warns on stderr and gives `facts: []` for that file; TypeScript `typeof` guards give no facts; in `ctxo watch` a saved Go file takes its facts from the tree-sitter tier and a saved Java file reads the keep-alive analyzer's result without starting a second JVM. `@ctxo/domain` adds a text-scan fallback, `find_shadow_specs` and `get_context_map` (14 core tools, 18 with the package), `ctxo domain shadow-specs <context>`, `ctxo domain map`, `shadow-specs.yaml` resolutions and `ctxo verify-domain` check 12, plus the `domain.facts`, `domain.tests.characterization`, `domain.tests.contract` and `domain.rungs` config keys. Fingerprints go into `shadow-specs.yaml` as YAML single-quoted scalars (`- fingerprint: '...'`), the form `ctxo domain shadow-specs` prints. When `ctxo index` builds the domain graph but not the candidates or the maturity facts, it removes both loop artifacts, so the tools ask for a new `ctxo index` instead of serving old data. The `ctxo-domain-fold` skill marker moved to v0.16: run `ctxo init --domain` or `ctxo doctor --fix` after upgrading to refresh copies installed by 0.15.

### Patch Changes

- Updated dependencies [0353c01]
  - @ctxo/plugin-api@0.9.1

## 0.15.0

### Minor Changes

- 2054a25: `@ctxo/domain` builds a domain graph from cards (rules, terms, decisions) linked to tests, code and provenance, adds `get_domain_context`, `get_rule` and a domain scope for `get_ranked_context`, and adds rule and card fields to `get_blast_radius`, `get_context_for_task`, `get_why_context` and `get_pr_impact` (#156). `@ctxo/cli` adds document search to its BM25 engine and three module seams (async enrichers, a token reservation for `get_context_for_task`, ranked-context scopes).

  Behaviour changes: `@ctxo/cli` no longer ships source maps in its npm package (about 2.1 MB to about 0.8 MB unpacked); `get_pr_impact` with an empty diff now carries `_meta` and goes through masking; `verify-domain` check 6 now errors on a `Code:` file that does not exist and on a `Tests:` or `Code:` value that names a directory, warns on a symbol ID the index does not hold (use `file#Name` for a plain test name, since `::` now marks a symbol ID) and on an unknown rule ID of a rule prefix in a production `rule:` comment; a `rule:` comment above a declaration links to that declaration; an H1 heading now ends a card's "Rules and invariants" section; and the `ctxo-domain-fold` skill marker moves to v0.15, so `ctxo doctor` reports older installed copies as outdated until `ctxo init --only domain` reinstalls them.

## 0.14.0

### Minor Changes

- 979bed8: The opt-in `@ctxo/domain` package adds a context registry, `contexts-touched`, a fold guard, `verify-domain`, loader rules and boundary checks by named context (#156). `@ctxo/cli` loads it through an internal API and supports one global install for MCP, hooks and CLI.

## 0.13.1

### Patch Changes

- 663cfae: `find_dead_code` recognises test files with the shared test-file classifier (the default test globs plus every file in which a test-framework annotation such as `@Test` marks a symbol) instead of its own path patterns, which missed `_test.go`, `src/test/java`, `*.test.js` and `*.test.tsx` files (#156). Unless `includeTests` is set, test symbols are never reported dead, even without outgoing edges, and production code called only from tests is not dead, so Go functions whose only callers are tests are no longer reported. As a deliberate consequence, production code under a folder named `test/` or `src/test/`, and any file with a test-annotated symbol, is now left out of the analysis as well.
- 663cfae: Language parity for TypeScript, Java and Go (#156 Phase 1): the three plugins now report TypeScript decorators, Java annotations (JDT and tree-sitter tiers) and Go struct tags as symbol annotations, index TypeScript test blocks and Go `_test.go` files as symbols with edges, and, when `@ctxo/lang-sql` is installed, add `reads`, `writes` and `executes` edges for constant SQL at known call sites (pg, mysql2, mssql, knex, Prisma, TypeORM, Sequelize and better-sqlite3 raw SQL; JDBC, Spring `JdbcTemplate`, JPA native queries and MyBatis; `database/sql`, sqlx, pgx and gorm raw SQL). They parse that SQL with `@ctxo/sql-extract`, the zero-dependency library that the ADR-017 dependency exception allows, and stay on protocol `'1'`, so older CLIs keep loading them, ignore the annotations and never request SQL edges. The first re-index after upgrading changes the committed index JSON of TypeScript, Java and Go files, tests now count as blast-radius dependents (so the safe-edit gate may fire more often on well-tested symbols), and the `ctxo install sql` help line names the new host languages.

  The Java analyzer (`@ctxo/lang-java-analyzer`) now reads sources as UTF-8 and escapes non-ASCII output, so Windows users get intact non-ASCII names. The Go full tier no longer stores an empty result when the analyzer run fails, crashes or times out: those files fall back to the tree-sitter syntax tier with a warning. `ctxo visualize` escapes symbol names in the page it embeds, which matters now that test titles are symbol names.

## 0.13.0

### Minor Changes

- d85177e: Co-change now comes from one git pass with its own window (`cochange` config, `--cochange-commits`, `--cochange-since`), `ctxo index --files` and `--commit` re-index incrementally, the v2 post-commit hook runs `ctxo index --commit HEAD` once per commit (upgraded in place by `ctxo init` and `ctxo doctor --fix`, never written into a global or system `core.hooksPath`), history keeps one snapshot per commit with confidence counted in distinct commits, and every blast-radius caller uses co-change with a new `coChangedFiles` field on `get_blast_radius` (#157). On upgrade, the first index write removes older same-commit duplicates from `communities.history/` (no information is lost), and `ctxo verify-index` reports files with a rename in their history as stale until the next `ctxo index`.
- a7d8357: `ctxo index` now writes `.ctxo/index/contexts-view.json`, candidate bounded contexts clustered from dependencies and co-change with hub files damped, readable through `get_architectural_overlay({ mode: "contexts" })` (summary first, `candidate: <id>` for one in full) and the new `ctxo contexts [--json]`, with new `communities:`, `contextsView:` and `index.tests` config (#156 Phase 1). The overlay `mode`, `get_ranked_context` `searchMode` and `search_symbols` `mode` parameters are now registered so clients can send them, and the unused `fuzzy` parameter is removed.
- cacea40: Plugin protocol v2 and data coupling (#156 Phase 1): `@ctxo/plugin-api` adds the data kinds (`table`, `view`, `procedure` with `reads`, `writes` and `executes` edges), typed symbol annotations, an opt-in facts channel and host capabilities, and the new `@ctxo/lang-sql` plugin (built on the zero-dependency `@ctxo/sql-extract` library, installed with `ctxo install sql`) indexes T-SQL definitions and the tables their bodies read and write. `@ctxo/lang-csharp` reports attribute annotations, adds SQL edges at known ADO.NET, Dapper, `SqlBulkCopy` and EF Core call sites when `@ctxo/lang-sql` is installed, and falls back to tree-sitter when its Roslyn helper cannot restore or build. The CLI puts data edges in the confirmed blast-radius tier, reports shared tables, ownership and external resources in the contexts view, recognises test files by test-framework annotations and adds the `csharp_tier` doctor check, and the other official plugins widen their `@ctxo/plugin-api` peer range.
- c7ace77: Claude Code now gets a compact ctxo block in `CLAUDE.md` when the safe-edit guard and the skills are installed, and every other client gets the full block, inside versioned markers that are replaced in place without touching the rest of the file (#159). `ctxo init` gains `--only`, `--skip` and `--no-guard`, and `ctxo doctor` gains the `ai_rules`, `skills` and `claude_guard_hook` checks, which `ctxo doctor --fix` repairs. The blocks and skills are formatter-stable, a rules file linked to another client's gets the full block, skills carry a version marker so an older ctxo leaves a newer skill alone, and a block that expects the guard and the skills is left unchanged until they are installed. Upgrade a team together: a ctxo from before this release does not read the versioned markers.

### Patch Changes

- Updated dependencies [cacea40]
  - @ctxo/plugin-api@0.9.0

## 0.12.0

### Minor Changes

- 5e7d482: Minor release: bump all packages to a new minor version line.

### Patch Changes

- Updated dependencies [5e7d482]
  - @ctxo/plugin-api@0.8.0

## 0.11.5

### Patch Changes

- 8db20d8: Patch release: dependency maintenance (zod 4.6.7) and CI action updates (setup-node 7.1.0, upload-artifact 7.0.2, test-reporter 3.2.0).
- Updated dependencies [8db20d8]
  - @ctxo/plugin-api@0.7.3

## 0.11.4

### Patch Changes

- 4e10c22: Fix `ctxo init`/`install` trying to install a non-existent `@ctxo/lang-javascript` package (npm 404). JavaScript files are handled by `@ctxo/lang-typescript`, so `javascript` now resolves to that plugin. Install specifiers are also deduped so a project surfacing both TypeScript and JavaScript no longer requests `@ctxo/lang-typescript` twice.

## 0.11.3

### Patch Changes

- 3e0f0bb: Stop masking git commit hashes as AWS secrets. The AWS secret-access-key detector used a `(?=.*[/+])` lookahead to require a `/` or `+` inside the key, but `.*` reached past the 40-char token into the surrounding text, so any later `/` (for example a file path in a JSON response) satisfied it and a 40-char hex git SHA was redacted as `[REDACTED:AWS_SECRET]`. This corrupted the commit hashes returned by `get_why_context`. The lookahead is now scoped to the token itself (`[A-Za-z0-9=]*[/+]`), so hex-only SHAs are preserved while real base64 secret keys still redact.

## 0.11.2

### Patch Changes

- e05f62f: Discover the Java plugin in global installs. `@ctxo/lang-java` was missing from the CLI's plugin manifest (its `devDependencies`), which is the registry that global-mode plugin discovery walks when a project has no `@ctxo/lang-*` of its own. As a result `ctxo install java --global` installed the plugin but `ctxo index` never loaded it, silently skipping every Java file (only other detected languages were indexed). Adding `@ctxo/lang-java` to that list puts it on par with the Go, C#, and TypeScript plugins, so a globally installed Java plugin is found and the full tier engages.

## 0.11.1

### Patch Changes

- f3210c6: Fix `spawn EINVAL` on Windows during `ctxo install` / `ctxo update` / `ctxo init` plugin installs. Node's CVE-2024-27980 hardening (>=18.20.2 / >=20.12.2 / all 21+) refuses to spawn the `.cmd` package-manager shims (npm, pnpm, yarn) without a shell, so the install aborted with `[ctxo] ERROR Fatal: spawn EINVAL`. The package-manager runner now spawns a single shell command string on Windows so the shell resolves the shim, while POSIX keeps the direct argv + `shell:false` path. This avoids both the EINVAL crash and the DEP0190 deprecation that a `shell:true` + argv-array combination would raise on Node 22.

## 0.11.0

### Minor Changes

- c8165d8: Ship the CLI-side Java support that pairs with `@ctxo/lang-java` and `@ctxo/lang-java-analyzer` 0.8.0. Without this release the published Java plugins do not work end to end, because the CLI half was missing.

  - `ctxo install java --full-tier` / `--syntax-only` with a JRE-aware smart default (installs the analyzer companion package when a JRE 17+ is detected).
  - `ctxo doctor` Java tier check (runtime + analyzer presence + actionable hint); `ctxo index` surfaces the active Java tier.
  - core: accept name-reference edge targets (`EdgeTargetSchema`) plus a resilient index read, and resolve those targets by unambiguous name+kind in the symbol graph. Without these, Java `extends`/`implements`/`uses`/`calls` edges are dropped on read or left unresolved, so blast-radius, find-importers, and class-hierarchy return nothing for Java.
  - watch: a generic `IIncrementalReindex` keep-alive capability (new in `@ctxo/plugin-api`) replaces the C#-hardcoded path. `@ctxo/lang-csharp` now exposes `getIncrementalReindex()` so C# watch keep-alive keeps working with the generalized watch command.

### Patch Changes

- Updated dependencies [c8165d8]
  - @ctxo/plugin-api@0.7.2

## 0.10.0

### Minor Changes

- 487f994: Safe-edit guard + ctxo skills: a PreToolUse hook (Claude Code) blocks edits to high-impact symbols until blast radius is checked, plus model-invoked skills and new `ctxo blast-radius` / `ctxo gate --preview` commands. Cursor and other tools get skills + rules.

## 0.9.3

### Patch Changes

- 4a9f353: **Fix: `ctxo update` no longer tries to "upgrade" workspace-linked plugins.**

  When the project's `package.json` declares a dep as `workspace:*` (or `workspace:^`, `workspace:~`, etc), the package's source lives locally and is intentionally not consumed from the registry. Previously, `ctxo update` would compare the workspace-link's discovered version to the npm registry's latest and propose a "fix" — installing a pinned registry version, which silently unlinks the workspace and downgrades to whatever npm has published.

  Now those rows show up as `workspace link` with `(local)` in the LATEST column, and the install plan excludes them. Example in the Ctxo monorepo itself:

  ```
  PACKAGE                CURRENT        LATEST (latest)  STATUS
  @ctxo/cli              0.9.1          0.9.2            update
  @ctxo/lang-csharp      0.7.0-alpha.0  (local)          workspace link
  @ctxo/lang-go          0.8.0-alpha.0  (local)          workspace link
  @ctxo/lang-typescript  0.7.0-alpha.0  (local)          workspace link

  To update, run:
    pnpm add -D -w @ctxo/cli@0.9.2
  ```

  Adds `readWorkspaceLinks(projectRoot)` to `core/install/package-manager.ts` and `markWorkspaceLinks(states, names)` plus a new `'workspace'` value in `PackageStatus` to `core/update/update-plan.ts`.

## 0.9.2

### Patch Changes

- 3fbf124: **Fix: `ctxo install` / `ctxo update` now work inside pnpm workspaces.**

  Two bugs surfaced when running these commands inside a pnpm monorepo:

  - **`ERR_PNPM_ADDING_TO_ROOT`** — pnpm 8+ requires `-w` for `pnpm add -D` at a workspace root. ctxo never appended the flag, so installs failed with the pnpm safety check. Fix: detect workspace root (`pnpm-workspace.yaml` or `package.json.workspaces`) and append `-w` to the pnpm command when applicable. Global installs and non-workspace projects are unaffected. Other package managers (npm / yarn / bun) need no equivalent flag.
  - **`DEP0190` deprecation warning** on Node 22+ — `spawn(cmd, args, { shell: true })` is now deprecated because args are concatenated unescaped. Fix: drop `shell: true`; on Windows, append the right extension manually (`.cmd` for npm/pnpm/yarn, `.exe` for bun). No security regression — `isSafeVersionSpecifier` already filters shell metacharacters upstream.

  Exposes a new `isWorkspaceRoot(projectRoot)` helper in `core/install/package-manager.ts` and extends `buildInstallCommand` with a `workspaceRoot` option (defaults to `false`).

## 0.9.1

### Patch Changes

- a7d839a: **`ctxo init` next-steps now use bare `ctxo` commands.** After `ctxo init` completes, the "Next steps" box shown to the user now prints `ctxo index` and `ctxo doctor` instead of `npx ctxo …`. This matches the recommended setup (global install via `npm install -g @ctxo/cli`) and the rest of the documentation. The shorter form also works for users who installed `@ctxo/cli` as a devDependency, since pnpm/npm expose the `ctxo` bin in `node_modules/.bin/` on PATH for shell sessions inside the project.

  Internal: `http-server-transport.ts` JSDoc examples switched to the bare `ctxo` form for consistency (no runtime effect).

## 0.9.0

### Minor Changes

- 08e1cbb: **`ctxo update` — self-update mechanism.** Checks `registry.npmjs.org` for newer versions of `@ctxo/cli` and every installed `@ctxo/lang-*` / `ctxo-lang-*` plugin, then either runs the install or prints the install command for the user to run.

  - Flags: `--check`, `--print`, `--global`, `--json`, `--pm <npm|pnpm|yarn|bun>`, `--force`.
  - Per-package channel detection (alpha stays on alpha, stable stays on stable) with explicit `(latest)` annotation when the chosen channel is not published.
  - Auto-execute when the project lists `@ctxo/*` in `package.json`; otherwise prints the global install command without mutating an unrelated workspace.
  - Single JSON document in `--json` mode.
  - Defence-in-depth: rejects npm version specifiers containing shell metacharacters before passing them to the package manager.
  - Internal: extracted shared `runPackageManager` helper from `install-command.ts`; both `install` and `update` now route through `core/install/run-package-manager.ts`.

  Spec: `docs/superpowers/specs/2026-05-15-ctxo-update-design.md`. User docs: [`site/docs/cli/update.md`](https://ctxo.dev/cli/update.html).

## 0.8.2

### Patch Changes

- 55abc5e: `ctxo init` now supports **Gemini CLI** and **Continue** as installable AI tool targets, bringing the supported tool list to nine.

  - **Gemini CLI**: appends a marked rules block to `GEMINI.md` at the repo root and registers the ctxo MCP server at `.gemini/settings.json` (`mcpServers` key, same schema as Claude Code / Cursor).
  - **Continue**: writes `.continue/rules/ctxo.md` and registers the MCP server as a standalone file at `.continue/mcpServers/ctxo.json` (Continue picks up each file in that directory separately).

  Run `ctxo init` and pick `gemini-cli` and/or `continue` from the interactive list, or use `ctxo init --tools gemini-cli,continue --yes` for a non-interactive install. No existing platform behavior changes.

## 0.8.1

### Patch Changes

- e040bde: Fix plugin discovery failing under `npx @ctxo/cli` when language plugins are installed in the consumer project. Bare specifiers like `@ctxo/lang-csharp` were resolved relative to the CLI bundle's location (inside the npm `_npx` cache), not the user's project, so installed plugins reported `Cannot find package`. Discovery now anchors resolution at the consumer's `package.json` via `createRequire`, so plugins load regardless of where the CLI itself is executing.

## 0.8.0

### Minor Changes

- 35847bf: **Architectural intelligence, surfaced.** `ctxo visualize` now shows Layer vs Community side-by-side — node fill encodes the designed layer (Domain / Adapter / Test / ...), node border encodes the Louvain community, and boundary-violation edges render red. A first-load modal explains the distinction and the view now defaults to light theme.

  `pages/ctxo-visualizer.html` gains a new **Architecture** tab with four sub-views:

  - **Overview** — KPI cards for modularity, violations, drift events, and community count; modularity trend line across snapshot history; top god nodes.
  - **Drift** — community-migration event table sourced from the persisted drift artifact.
  - **Violations** — sortable boundary-violation table by severity.
  - **Hotspots** — complexity × churn top symbols.

  `ctxo index` persists two new artifacts next to `communities.json` so the browser reads them directly without re-running detectors:

  - `.ctxo/index/drift-events.json`
  - `.ctxo/index/boundary-violations.json`

  Other improvements:

  - `JsonIndexReader` skips the two new top-level artifacts.
  - `discoverFilesIn` filters stale `git ls-files --cached` entries for files deleted from the working tree — no more ENOENT spam during indexing.
  - Drops the short-lived `ctxo report` command, its template, build script, and cytoscape / d3-sankey / esbuild devDeps.
  - `core/overlay/snapshot-staleness.ts` no longer imports from `ports/`, restoring the hexagonal boundary.
  - Golden-snapshot test is CRLF-safe on Windows.
  - Three pre-existing test failures resolved — full suite now 1044 / 1044.

  Site nav is unified across the landing page and comparison pages (Docs link added, Go tier advertised as Full).

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

- 35659c8: Improve GitHub Releases format. Per-package releases are replaced with a single umbrella release per published run, listing every package version published, the full compatible-set matrix across all `@ctxo/*` packages, and per-package CHANGELOG excerpts. Plugin-only releases also produce an umbrella entry. Alpha/beta/rc/next versions are auto-marked as pre-release.
