# PR 1B: Plugin Protocol v2, Data Coupling and @ctxo/lang-sql Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship plugin protocol v2 (data kinds, typed annotations, the facts protocol, host capabilities), the zero-dependency `@ctxo/sql-extract` library, the `@ctxo/lang-sql` plugin, Roslyn attribute annotations and SQL edges at known C# call sites, and data coupling in the contexts view (Phase 1 of #156; K3, K3a, K3b, K10, K12, K18).

**Architecture:**
- `@ctxo/plugin-api` gains the v2 surface. The CLI imports its kind lists from there, loads plugins declaring `'1'` or `'2'`, hands every plugin `capabilities` (`sqlCallSites` only when a `.sql` plugin is discovered, `facts` only on request), and keeps annotations and facts in the JSON index only.
- `@ctxo/sql-extract` holds the one T-SQL tokenizer and recognizer set. `@ctxo/lang-sql` turns `.sql` definitions into `table`, `view`, `procedure` and `function` symbols with `reads`, `writes` and `executes` edges. The Roslyn helper parses constant SQL at known call sites with ScriptDom. A shared corpus in `packages/sql-extract/corpus` keeps the two parsers in agreement.
- Core resolves 2-part data references kind-agnostically (first file in sorted path order), puts data edges in the confirmed tier and keeps them out of symbol-level communities. The contexts view reports shared tables, ownership and external resources without letting data access merge candidates.

**Tech Stack:** TypeScript (ESM, Node >= 20), zod 4, vitest, tsc/tsup, pnpm workspace with changesets; C# (.NET 8 target, Roslyn 4.12, Microsoft.SqlServer.TransactSql.ScriptDom); tree-sitter-c-sharp 0.23.1.

**Spec:** `docs/superpowers/specs/2026-10-20-domain-knowledge-layer-design.md`, section 8 (8.1 to 8.7), with sections 3, 4, 5, 7.1 (annotation rule), 7.3, 8A (seams for PR 1C), 13, 14, 15 and 18 (owner decisions K3, K3a, K3b, K10, K12, K18; the PR 1B calls in 18).

## Global Constraints

- **Base:** a new worktree and branch `feat/plugin-v2-sql-156`, stacked on the finished PR 1A branch `feat/contexts-view-156` (itself on PR 0). From those PRs this plan consumes: the contexts view (`core/contexts-view/*`: `buildFileGraph`, `EDGE_KIND_WEIGHTS`, `FilePair`, `harvestTopTerms`, `findTermCollisions`, `buildContextsView`, `ContextsView`, `ContextCandidate`; `ContextsViewSchema`; `ResolvedContextsViewConfig`; `computeAndWriteContextsView` in `cli/index-contexts-view.ts`; `buildContextsOverlay`; `ContextsCommand`), `createTestFileClassifier` and `indexTestPatterns`, `compareCodepoint`, the test helper `cli/__tests__/helpers/temp-project.ts` (`createProject`, `IDENTITY`), `IndexCommand.run({ files, commit })` and the e2e test `tests/e2e/mcp-tool-registration.test.ts`. Code that PR 0 and 1A change is referenced by name, not line.
- **Release state (no dependency on the staged release):** a release the owner has staged separately takes `@ctxo/plugin-api` to `0.8.0` on protocol v1, widens plugin peer ranges to `^0.7.3 || ^0.8.0` and enables changesets' `onlyUpdatePeerDependentsWhenOutOfRange`. It may or may not have reached this stack, and this plan works either way. Protocol v2 ships in the next plugin-api minor, whatever that is (called N: `0.8.0` without the staged release, `0.9.0` with it). Existing official plugins' `peerDependencies["@ctxo/plugin-api"]` become `^0.7.3 || ^0.8.0 || ^0.9.0` and lang-sql's becomes `^0.8.0 || ^0.9.0`, so both orders stay in range. Never touch the staged release's files on the main checkout.
- **Protocol (spec 8.2, verbatim):** `SYMBOL_KINDS = ['function', 'class', 'interface', 'method', 'variable', 'type', 'table', 'view', 'procedure']`; `EDGE_KINDS = ['imports', 'calls', 'extends', 'implements', 'uses', 'reads', 'writes', 'executes']`; `DATA_RESOURCE_KINDS = ['table', 'view']`; `FACT_KINDS = ['literal-comparison', 'normalization', 'retry-timeout', 'endpoint']`; `SUPPORTED_API_VERSIONS = ['1', '2']`. Core keeps accepting `'1'` for at least 12 months after `'2'` ships (ADR-012). Core analyses use `DATA_RESOURCE_KINDS`, never the literal `table`.
- **Opt-in rules (spec 8.3, 8.4, 18):** facts are produced only on request (`index.facts: true`; `@ctxo/domain` adds itself in PR 2B); SQL call-site edges appear only when a plugin for `.sql` is loaded (`capabilities.sqlCallSites`); annotations are always on. Annotations and facts live in the JSON index; SQLite is unchanged.
- **C# annotations (spec 8.4):** caps of 20 attributes per symbol, 10 args each, 200 chars per arg; `name` is the attribute name as written, without namespace and `Attribute` suffix; `named.type` carries the fully qualified name when known.
- **SQL (spec 8.4, 8.5):** compile-time constants only; dialect `tsql` and default schema `dbo` are constants; edges go from the calling method or SQL object to `schema.name::table` or `schema.name::procedure` (canonical form: lowercase, brackets stripped, default schema `dbo`); temp tables, table variables and CTE names are excluded; top-level DML in scripts is not turned into edges. The full rule set is "SQL extraction rules" below.
- **Blast radius (spec 8.3):** `reads`, `writes` and `executes` are `confirmed`.
- **Data coupling (spec 8.6):** `contextsView.weights.data` defaults to 0; shared tables are a finding, not a clustering weight.
- **Dependencies:** language plugins import only from `@ctxo/plugin-api`; the one exception is `@ctxo/sql-extract` (ADR-017), which has zero runtime dependencies, is not a plugin and is never discovered. Inside `@ctxo/cli` the hexagonal rules hold: `core/` never imports `adapters/` or `ports/`, `ports/` never imports `adapters/`, `adapters/mcp/` imports only `core/` and `ports/`, only `packages/cli/src/index.ts` wires adapters, no barrel exports, every adapter implements a port. A package entry (`src/index.ts` of plugin-api, sql-extract, lang-sql) is its only re-export module.
- **Output channels:** never `console.log` (stdout is JSON-RPC). CLI human output goes to `console.error`, machine JSON to `process.stdout.write`, library logs through `createLogger('ctxo:<ns>')` (plugins use their own minimal logger). Adapters warn and continue; MCP handlers never throw; every MCP payload passes through `wrapResponse` and `masking.mask`.
- **Determinism (spec 13.1):** sort with `compareCodepoint`, never `localeCompare`; C# sorts with `StringComparer.Ordinal`; no wall clock or randomness in results; artifacts are rewritten only when their content changes.
- **Tests:** vitest, co-located in `__tests__/`. Every git operation that creates commits in a temp repo (commit, merge, rebase, cherry-pick, amend, revert, tag) passes `-c commit.gpgsign=false -c user.name=Test -c user.email=test@test.com`, plus `-c tag.gpgsign=false` for tags (the machine has a global `commit.gpgsign=true`). Dotnet tests are gated with `describe.skipIf(!HAS_DOTNET)`, where `HAS_DOTNET` is `dotnet --version` with major >= 8, as in `roslyn-adapter.integration.test.ts`. C# fixtures use stub types defined in fixture source, never NuGet packages. Rebuild `@ctxo/plugin-api`, `@ctxo/sql-extract` and `@ctxo/lang-sql` before running the tests of their dependents (they resolve through `dist/`).
- **Git on the branch:** each commit stages exactly the paths of its task (`git add <path>...`, never `-A` or `.`), and never `.ctxo/` or `.claude/settings.local.json`. Branch commits are GPG-signed through the user's own config: never pass `--no-gpg-sign` or `-c commit.gpgsign=false` there; on a signing failure stop and report BLOCKED. The post-commit hook may take minutes; wait for the commit to return.
- **Safe edits:** before editing an existing symbol, call the ctxo MCP tools `get_blast_radius` and `get_why_context` on it. The session's ctxo MCP server indexes the main checkout (older code), so `found: false` from either tool for a symbol added on these branches is expected: call the tools as the project rule asks, then proceed.
- **Text:** English only, no em dashes, no `Co-Authored-By` or AI attribution lines. No push, PR, publish or issue without the owner's approval.
- **Tarball:** the CLI limit is 1350 KB (`packages/cli/tests/e2e/release-packaging.test.ts`); when crossed, raise it with the measured size and the reason in the PR description (sourcemaps keep shipping).
- **Privacy:** nothing from the private fixture (code, paths, names, table names, business rules) goes into the repo, tests, docs, commits or PR text. All SQL and C# test data in this plan is the synthetic library-lending sample. Fixture work happens only in the private fixture clone (path in the owner's brief); scripts and raw outputs stay in the session scratchpad; only aggregate numbers leave it.

## Review Focus

1. **Upgrading `@ctxo/lang-csharp` from npm after the helper gains source files:** `files` lists only `Program.cs` and the csproj today, so a published package would fail `dotnet run` and every C# file would lose its symbols. Expected: the packed file list holds the csproj and every `tools/ctxo-roslyn/*.cs`. Test owned by Task 11.
2. **SQL scripts saved as UTF-16 LE with a BOM (SSMS) or UTF-8 with a BOM:** the core decodes everything as UTF-8, so a UTF-16 file yields no definitions. Expected: both give the same symbols as plain UTF-8, and `ctxo index --check` reports them fresh. Tests owned by Tasks 7 and 10.
3. **SQL text ScriptDom rejects or that only becomes valid at runtime:** Dapper list parameters (`WHERE Id IN @ids`), a typo in a constant. Expected: `IN @ids` reads like `IN (@ids)` on both sides; an unparsable constant is counted as `unparsable` and never stops the batch. Tests owned by Tasks 8, 12 and 13.
4. **SQL-looking text that is not code:** line, block and nested block comments, string literals, `GO` inside strings or comments, legacy `(NOLOCK)` hints, CRLF line endings. Expected: no phantom or lost accesses, and identical accesses from sql-extract and ScriptDom. Tests owned by Tasks 7, 8 and 12.
5. **Non-ASCII or mixed-case object names** (`[dbo].[Ödünç Kaydı]`, `KİTAP`): JavaScript `toLowerCase` and .NET `ToLowerInvariant` disagree on characters such as `İ`, so a C# reference could miss the lang-sql node. Expected: both sides fold only ASCII A-Z and produce byte-identical canonical names. Tests owned by Tasks 7, 8 and 12.

## Designer calls (spec gaps decided here; the owner may override)

1. **Corpus home:** `packages/sql-extract/corpus/` instead of spec 8.5's `packages/lang-sql/corpus/`. The rules live in sql-extract, lang-sql depends on it (every test reads along the dependency direction), and PR 1C's TypeScript, Java and Go hosts use sql-extract, not lang-sql.
2. **Versions gate loading only:** core handles output identically for `'1'` and `'2'`. A plugin declares the lowest version it works on, so only `@ctxo/lang-sql` declares `'2'`. `@ctxo/lang-csharp` stays `'1'`: v1 cores ignore annotations and never set the capability SQL edges need, so upgrading it alone never breaks an older CLI. `SUPPORTED_API_VERSION` stays exported at `'1'` (deprecated). The version report gives `pluginApiVersion: '2'` (newest) plus `pluginApiVersions: ['1', '2']`.
3. **Capabilities:** a named `PluginCapabilities` interface, computed from the discovered plugins before any `createAdapter` call and handed to every plugin; `sqlCallSites` when a discovered plugin lists `.sql`; `facts` from `index.facts: true` (config only, no CLI flag).
4. **Schemas check shape, not caps:** caps are the producing plugin's job, so lang-sql's `columns` annotation lists every column. The JSON reader keeps a symbol whose annotations are invalid by dropping its annotations, and drops only invalid facts.
5. **Data edges stay out of symbol-level communities, god nodes, cross-cluster counts and boundary violations** (data coupling is reported by the contexts view). **Symbols in `.sql` files are never dead code** (other systems may use them).
6. **Name resolution:** the first-file tie-break also applies to `procedure` references; other kinds keep "resolve only when unambiguous".
7. **Canonical names fold ASCII A-Z only;** 3- and 4-part names, temp tables, table variables and the `sys` and `information_schema` schemas are skipped on both sides.
8. **Access details** (in the rules below): `OUTPUT ... INTO` writes; `FROM` references stay reads when they also name the `UPDATE`/`DELETE` target; CTE names are skipped to the next top-level `;` or the end of the batch; table-valued functions are skipped, parenthesized table hints are not; Dapper `IN @p` is rewritten on the C# side.
9. **Definitions:** a body also ends at the next view, procedure or function definition when `GO` is missing, while table DDL inside a body is body text; `ALTER TABLE ... ADD` columns count only outside a body, for a table defined in the same file; two definitions of one object in a file merge; `name` keeps the declared spelling without delimiters and without an added schema; SQL objects have no complexity metrics; calls to SQL functions are not edges.
10. **`CodeFact.line` is 0-based,** like `SymbolNode.startLine`.
11. **C# annotation values:** the name comes from the syntax as written; numbers in invariant culture, `true`/`false`, enum constants as `Type.Member`, `typeof(T)` as the type's display string, array arguments flattened, nulls skipped; longer values truncated to 200 chars; at most 10 positional and 10 named entries; `named.type` is reserved for the resolved type name; `args` and `named` are omitted when empty.
12. **C# call sites:** only in method and constructor bodies (the existing edge scope); `CommandType` is resolved within the method for the same local or object initializer; `static readonly` SQL is non-constant; the batch `done` line reports `sql: { constant, nonConstant, unparsable }`.
13. **`--sql-extract` takes several files** and prints one JSON line per file; it runs before MSBuild registration.
14. **`<RollForward>Major</RollForward>`** goes into `ctxo-roslyn.csproj` after the check in Task 12.
15. **UTF-16 sources:** index, `--check` and watch decode UTF-16 LE/BE when a BOM is present; UTF-8 decoding is unchanged (a UTF-8 BOM stays in the text), so existing content hashes stay valid.
16. **Contexts view shapes:** top-level `dataResources` (every resource a candidate file reads or writes) plus per-candidate `sharedTables` (resources of two or more candidates). Unclustered files are ignored; hubs count for their assigned candidate. Reading a view does not expand to its tables. The data weight is a third normalized component, and data edges never count as hub dependents. MCP caps `dataResources` at 50 (with `dataResourcesTotal` when capped) and `sharedTables` at 15 per candidate (with `sharedTableCount`); both are additive arrays on an existing tool, so they are capped at the source and are not truncatable fields.
17. **Collisions** compare member and column names after ASCII lowercasing and removing `_`; views appear in top terms but not in collisions.
18. **Test-framework annotation names match exactly:** `Fact`, `Theory`, `Test`, `TestCase`, `TestMethod`.
19. **Packages:** the new packages start at `0.0.0`, so the minor changeset publishes `0.1.0`. lang-sql depends on `@ctxo/sql-extract` with `workspace:^` and peers `@ctxo/plugin-api` `^0.8.0 || ^0.9.0`. The v1 plugins get patch changesets for the widened peer ranges (`^0.7.3 || ^0.8.0 || ^0.9.0`), and `@ctxo/lang-java-analyzer` gets one too, to stay in version lockstep with `@ctxo/lang-java`. lang-sql reads its runtime version from its package.json. `ctxo install` accepts `tsql` as an alias of `sql`. CI also runs the plugin-api, sql-extract and lang-sql tests.

## SQL extraction rules (normative for Tasks 8, 9, 12 and 13)

- **Names.** One to four dot-separated parts; `[...]` (with `]]`) and `"..."` (with `""`) delimiters are removed. One part gets schema `dbo`; two parts are `schema.name`; three or four parts are skipped. A last part starting with `#` or `@`, and the schemas `sys` and `information_schema`, are skipped. The canonical form folds ASCII `A`-`Z` to lowercase and keeps every other character. Targets are `<canonical>::table` for `reads`/`writes` and `<canonical>::procedure` for `executes`.
- **reads.** Named tables after `FROM`, `JOIN` and `APPLY`, in the comma list of a `FROM` clause, and after `MERGE ... USING`. A name followed by `(` is a table-valued function and is skipped, unless the parenthesis holds table hints (`NOLOCK`, `READUNCOMMITTED`, `UPDLOCK`, `HOLDLOCK`, `ROWLOCK`, `TABLOCK`, `TABLOCKX`, `PAGLOCK`, `NOWAIT`, `READPAST`, `XLOCK`, `SERIALIZABLE`, `REPEATABLEREAD`, `READCOMMITTED`, `NOEXPAND`, `INDEX`, `FORCESEEK`, `FORCESCAN`). A `(` after `FROM` or `JOIN` opens a derived table that is scanned like other text. Aliases are never tables. No read comes from `FROM` after `FETCH ...`, from the `FROM` of `DELETE [FROM] target`, or from `FROM` inside a parenthesis that does not start with `SELECT` (for example `TRIM(' ' FROM x)`).
- **writes.** Targets of `INSERT [INTO]`, `UPDATE`, `DELETE [FROM]`, `MERGE [INTO]`, `TRUNCATE TABLE`, `SELECT ... INTO` and `OUTPUT ... INTO`, after optional `TOP (n)`. A one-part `UPDATE`/`DELETE` target equal to an alias of the same statement's `FROM` clause (ASCII case-insensitive) is the aliased table. `FROM` references stay reads when they also name the target. `INSERT`, `UPDATE` and `DELETE` preceded by `FOR`, `AFTER`, `OF`, `INSTEAD OF` or `THEN` (MERGE actions), or followed by `(`, `UPDATE STATISTICS`, and the foreign key actions `ON DELETE` and `ON UPDATE` followed by `CASCADE`, `NO` (`NO ACTION`) or `SET` (`SET NULL`, `SET DEFAULT`) are not DML. Any other `ON` does not block, so the DML after `SET NOCOUNT ON` or `SET XACT_ABORT ON` without a `;` stays DML.
- **executes.** `EXEC`/`EXECUTE` followed by a procedure name, after an optional `@var =`. `EXEC (...)`, `EXEC @var` and `EXECUTE AS` are skipped. A bare procedure name without `EXEC` is not an access.
- **CTEs.** Names from `WITH name [(columns)] AS (` and each further `, name [(columns)] AS (` are skipped from the `WITH` to the next top-level `;` or the end of the batch. ScriptDom scopes them per statement; corpus cases never reuse a CTE name as a table name.
- **Dapper.** `IN @p` not followed by `(` is valid input; the C# side rewrites it to `IN (@p)` before ScriptDom parses.
- **Text that is not code.** Comments (`--`, nested `/* */`) and strings (`'...'` with `''`, `N'...'`) never produce accesses. `GO` separates batches only alone on its line (optional count, optional trailing `--` comment, any case). A leading byte order mark is ignored.
- **Definitions (sql-extract and lang-sql).** `CREATE [OR ALTER] TABLE | VIEW | PROC | PROCEDURE | FUNCTION` and `ALTER VIEW | PROC | PROCEDURE | FUNCTION` outside another definition's body; kinds `table`, `view`, `procedure`, `function`. A view, procedure or function body runs to the end of its batch, or to the next `CREATE | ALTER VIEW | PROC | PROCEDURE | FUNCTION` at paren depth 0 (a missing `GO`). A `CREATE TABLE` or `ALTER TABLE` inside a body is body text: it creates no definition and no columns, and its DML targets (for example `INSERT INTO` the new table) are ordinary accesses of the body. Table columns are the column-list elements whose first token is not `CONSTRAINT`, `PRIMARY`, `UNIQUE`, `FOREIGN`, `CHECK`, `INDEX` or `PERIOD`, plus the elements of an `ALTER TABLE <t> ADD` outside a body when `<t>` is defined in the same file; sorted, unique, ASCII-folded. Accesses come from bodies only. A second definition of the same canonical name and kind in one file merges into the first (first span; columns and accesses unioned). Accesses are unique and sorted by kind, then name.

## Conformance corpus format

`packages/sql-extract/corpus/<case>.sql` (UTF-8, LF, pinned by `.gitattributes`) with `<case>.expected.json`:

```json
{
  "description": "one sentence",
  "mode": "statement",
  "sides": ["sql-extract", "scriptdom"],
  "definitions": [{ "kind": "table", "name": "dbo.loans", "columns": ["closedat", "id", "memberid"] }],
  "accesses": { "reads": ["dbo.loans"], "writes": [], "executes": [] }
}
```

- `mode`: `"statement"` (SQL as code sends it: sql-extract `extractSqlAccesses`, ScriptDom on the whole text) or `"file"` (a script of definitions without top-level DML: sql-extract `extractSqlDefinitions` with the union of body accesses, lang-sql through its adapter, ScriptDom on the whole script). PR 1C adds the host-language modes `typescript`, `java` and `go` (sources `<case>.<ext>.fixture`), which only the matching host plugin runs.
- `sides`: optional; default `["sql-extract", "lang-sql", "scriptdom"]` for file mode and `["sql-extract", "scriptdom"]` for statement mode, and `[]` for the host-language modes, so a host case never reaches the sql-extract, lang-sql or ScriptDom tests. Only cases that are not valid T-SQL may leave out `scriptdom`. Every side test selects its cases by `mode` and `sides`; a test that reads corpus files by extension alone is wrong.
- `definitions`: file mode only, sorted by name, then kind; `columns` only for tables. Every `accesses` key is present, each list sorted.

---

### Task 0: Branch setup (no commit)

- [ ] **Step 1:** Create the worktree with superpowers:using-git-worktrees: branch `feat/plugin-v2-sql-156` from the head of `feat/contexts-view-156` once every PR 1A task is committed.
- [ ] **Step 2:** Copy this plan into the worktree if it is missing (Task 1 commits it together with ADR-017, so the ADR is the PR's first commit).
- [ ] **Step 3:** Run `pnpm install --frozen-lockfile && pnpm -r build && pnpm -r test`. Expected: all green (dotnet-gated tests may skip). This is the baseline.
- [ ] **Step 4:** Record the release state in the scratchpad: `node -p "require('./packages/plugin-api/package.json').version"` and the peer ranges of the four `packages/lang-*/package.json` with a plugin-api peer. Expected: `0.7.3` and `^0.7.3` while the staged release is absent, `0.8.0` and `^0.7.3 || ^0.8.0` once it has landed; also note whether `.changeset/config.json` holds `onlyUpdatePeerDependentsWhenOutOfRange`. Task 16 widens the ranges either way.

---

### Task 1: ADR-017 (first commit of the PR)

**Files:**
- Create: `docs/architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md`
- Add: `docs/superpowers/plans/2026-10-21-pr1b-plugin-v2-and-sql.md` (gitignored folder, `git add -f`)

- [ ] **Step 1: Write ADR-017** with ADR-015's field table (Status `Accepted (<release>)`, where `<release>` is the version `pnpm changeset status` reports for `@ctxo/cli` (expected 0.13 if the staged release lands first), Date `2026-10-21`, Deciders `Alper Hankendi`, Relates to ADR-012, ADR-016 and the spec) and sections Context, Decision, Consequences, Alternatives considered. The Decision records:
  - **Kinds (K3):** the spec 8.2 lists verbatim; `DATA_RESOURCE_KINDS` is what core analyses use; "data coupling" is the concept and `@ctxo/lang-sql` stays a language plugin for `.sql` files (K3a).
  - **Annotations (K3):** the `SymbolAnnotation` shape; always on; host-language attributes, annotations and decorators follow the C# caps (20 / 10 / 200); `named.type` is reserved; lang-sql's `columns` annotation lists every column; shape-only validation in core (Designer call 4).
  - **Facts (K12):** `FACT_KINDS`, `CodeFact` (0-based `line`, single-line trimmed `text` of at most 200 chars), optional `extractFacts`; produced only on request (`capabilities.facts`, set by `index.facts: true` and, from PR 2B, by `@ctxo/domain`); JSON only; detectors land in PR 4.
  - **Capabilities:** `PluginCapabilities { facts?, sqlCallSites? }`, offered to every plugin; `sqlCallSites` only when a `.sql` plugin is discovered.
  - **Versioning:** `SUPPORTED_API_VERSIONS`; `'1'` accepted for at least 12 months after `'2'` ships; versions gate loading only and plugins declare the lowest version they work on (Designer call 2); v2 ships in the next plugin-api minor (0.8.0, or 0.9.0 when the separately staged 0.8.0 release on v1 lands first), with peer ranges that cover both orders (`^0.7.3 || ^0.8.0 || ^0.9.0` for the existing plugins, `^0.8.0 || ^0.9.0` for lang-sql).
  - **Data coupling:** confirmed tier for data edges; canonical 2-part names; kind-agnostic resolution within `DATA_RESOURCE_KINDS`, first file in sorted path order (also for procedures); data edges kept out of symbol-level communities and boundary violations; `.sql` symbols never dead code; `sharedTables`, ownership hint, external resources and `contextsView.weights.data: 0` in the contexts view.
  - **SQL extraction (K3, K10):** the Roslyn helper parses constant SQL at known call sites with ScriptDom through a data-driven API table (ADO.NET, Dapper, `SqlBulkCopy`, EF Core raw SQL), only with `sqlCallSites`; lang-sql uses the TypeScript tokenizer in `@ctxo/sql-extract`; the shared corpus lives in `packages/sql-extract/corpus` (Designer call 1); a summary of "SQL extraction rules"; `tsql` and `dbo` constants; top-level DML skipped.
  - **Dependency exception (K18):** language plugins may depend on Ctxo-owned, zero-dependency utility packages; today only `@ctxo/sql-extract`, which is not a plugin and is never discovered; PR 1C makes the TypeScript, Java and Go plugins use it (addendum then).
  - **Future path, not built (K3b):** NoSQL and messaging exactly as spec 8.1 states them (`collection` kind, virtual nodes `@data/mongodb::loans::collection`, host-plugin recognizers for driver calls, EF Core `ToTable`/`[Table]`, config recognizers for in-house wrappers, own lang plugins for CQL, Cypher, Prisma; `topic`/`queue` kinds, `publishes`/`subscribes` edges, message-class targets for type-based buses, virtual nodes `@msg/kafka::loan-events::topic`, evidence in host plugins, context-map interpretation in `@ctxo/domain`, AsyncAPI as a future lang plugin).
  - Consequences: the one-time C# index JSON change; older CLIs drop the new kinds from a v2 index with a warning; lang-sql needs a v2 core; constants-only SQL misses dynamic and `static readonly` SQL; ORM and query builders are not covered. Alternatives rejected: embedded-fragment routing between plugins, cross-plugin edge ownership, a ScriptDom helper for `.sql` files (needs .NET in SQL-only repos), data access as a default clustering weight, moving every official plugin to `'2'`.
- [ ] **Step 2: Check the text.** `LC_ALL=C.UTF-8 grep -nP '\x{2014}' docs/architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md` prints nothing; the ADR names nothing from the private fixture.
- [ ] **Step 3: Commit.**
  ```bash
  git add docs/architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md
  git add -f docs/superpowers/plans/2026-10-21-pr1b-plugin-v2-and-sql.md
  git commit -m "docs(adr): ADR-017 plugin protocol v2, data coupling and facts (#156)"
  ```

---

### Task 2: `@ctxo/plugin-api` v2 and core kind lists from it

**Files:**
- Modify: `packages/plugin-api/src/types.ts`, `packages/plugin-api/src/adapter.ts`, `packages/plugin-api/src/plugin.ts`, `packages/plugin-api/src/index.ts`
- Create: `packages/plugin-api/src/facts.ts`, `packages/plugin-api/src/version.ts`
- Modify: `packages/cli/src/core/types.ts` (lines 3-28: the local `SYMBOL_KINDS`/`EDGE_KINDS` become imports from `@ctxo/plugin-api`; `SymbolKindSchema`, `EdgeKindSchema` and the inferred types stay)
- Modify: `packages/cli/src/core/contexts-view/file-graph.ts` (`EDGE_KIND_WEIGHTS` gains `reads`, `writes`, `executes` at 0 so the `Record<EdgeKind, number>` still type-checks; Task 14 adds the data component)
- Test: `packages/plugin-api/src/__tests__/contract.test.ts`, `packages/cli/src/core/__tests__/types.test.ts`

**Interfaces:**
- Produces (all re-exported from `packages/plugin-api/src/index.ts`):
  ```ts
  // types.ts: SYMBOL_KINDS, EDGE_KINDS (spec lists), and
  export const DATA_RESOURCE_KINDS = ['table', 'view'] as const;
  export type DataResourceKind = (typeof DATA_RESOURCE_KINDS)[number];
  export interface SymbolAnnotation { readonly name: string; readonly args?: readonly string[]; readonly named?: Readonly<Record<string, string>> }
  export interface SymbolNode { /* existing fields */ readonly annotations?: readonly SymbolAnnotation[] }
  // facts.ts
  export const FACT_KINDS = ['literal-comparison', 'normalization', 'retry-timeout', 'endpoint'] as const;
  export type FactKind = (typeof FACT_KINDS)[number];
  export interface CodeFact { readonly kind: FactKind; readonly symbolId: SymbolId; readonly line: number; readonly text: string; readonly detail?: Readonly<Record<string, string>> }
  // version.ts
  export const SUPPORTED_API_VERSIONS = ['1', '2'] as const;
  export type ApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];
  /** @deprecated Use SUPPORTED_API_VERSIONS. Stays '1' so plugins that declare it keep loading on older cores. */
  export const SUPPORTED_API_VERSION = '1' as const;
  // adapter.ts
  extractFacts?(filePath: string, source: string): Promise<CodeFact[]>;   // ILanguageAdapter, called only when facts are requested
  // plugin.ts
  export interface PluginCapabilities { readonly facts?: boolean; readonly sqlCallSites?: boolean }
  // PluginContext gains `readonly capabilities?: PluginCapabilities`; CtxoLanguagePlugin.apiVersion becomes ApiVersion
  ```
- JSDoc carries the protocol rules: the annotation caps for host-language attributes, `CodeFact.line` 0-based and `text` single-line, trimmed, at most 200 chars, and both capability meanings.

- [ ] **Step 1: Write the failing tests.**
  - Contract: `supports protocol versions 1 and 2` (`[...SUPPORTED_API_VERSIONS]` equals `['1', '2']`); `keeps the deprecated SUPPORTED_API_VERSION at "1"`; `enumerates all symbol kinds` and `enumerates all edge kinds` (the spec lists, in order); `data resource kinds are table and view, both symbol kinds`; `enumerates the fact kinds`; `admits a v2 plugin literal with capabilities, annotations and facts` (`apiVersion: '2'`, a symbol with `annotations: [{ name: 'columns', args: ['id'] }]`, `extractFacts` returning one `CodeFact`, a context with `capabilities: { facts: true, sqlCallSites: true }`); the existing v1 literal test stays unchanged.
  - CLI `types.test.ts`: `core kind schemas use the plugin-api lists` (`SymbolKindSchema.options` and `EdgeKindSchema.options` equal the plugin-api arrays); `SymbolIdSchema accepts table, view and procedure ids` (`db/loans.sql::dbo.loans::table`); `EdgeTargetSchema accepts 2-part data references` (`dbo.loans::table`, `dbo.usp_closeloan::procedure`); `GraphEdgeSchema accepts reads, writes and executes`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/plugin-api test` and `pnpm --filter @ctxo/cli exec vitest run src/core/__tests__/types.test.ts`. Expected: FAIL (missing exports, unknown kinds).
- [ ] **Step 3: Implement** the plugin-api surface and the core import; rebuild with `pnpm --filter @ctxo/plugin-api build`.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm -r typecheck` and `pnpm --filter @ctxo/cli test:unit`. Expected: green (the contexts-view weights keep their values).
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(plugin-api): protocol v2 kinds, annotations, facts and capabilities (#156)"`.

---

### Task 3: Annotation and fact schemas; every kind list in the CLI

**Files:**
- Modify: `packages/cli/src/core/types.ts` (`SymbolAnnotationSchema`, `FactKindSchema`, `CodeFactSchema`; `SymbolNodeSchema.annotations`; `FileIndexSchema.facts`)
- Modify: `packages/cli/src/adapters/storage/json-index-reader.ts` (`readSingle` recovery path). Before editing: `get_blast_radius` and `get_why_context` on `JsonIndexReader`.
- Modify: `packages/cli/src/index.ts` (`search_symbols.kind`, `find_importers.edgeKinds`, `get_symbol_importance.kind`)
- Modify: `packages/cli/src/adapters/mcp/search-symbols.ts`, `find-importers.ts` (`InputSchema` and the two `edge.kind as ...` casts), `get-symbol-importance.ts`, `get-class-hierarchy.ts` (the two `isHierarchyEdge` lambdas)
- Modify: `packages/cli/src/core/context-assembly/context-assembler.ts` (`VALID_SYMBOL_KINDS`)
- Modify: `packages/cli/pages/visualize-template.html` (`EDGE_COLORS`, the `edgeKinds` list in `buildEdgeLegend`), `pages/ctxo-visualizer.html` (`KIND_COLORS`, `EDGE_STYLES`, the kind array in step 3 of the MCP loader)
- Test: `packages/cli/src/core/__tests__/types.test.ts`, `packages/cli/src/adapters/storage/__tests__/json-index-reader.test.ts`, `packages/cli/src/adapters/mcp/__tests__/search-symbols.test.ts`, `find-importers.test.ts`, `get-symbol-importance.test.ts`, `get-class-hierarchy.test.ts`, `packages/cli/src/core/context-assembly/__tests__/context-assembler.test.ts`, new `packages/cli/src/cli/__tests__/visualizer-kinds.test.ts`

**Interfaces:**
- Produces in `core/types.ts`:
  - `SymbolAnnotationSchema`: `{ name: string min 1, args?: string[], named?: record<string, string> }`.
  - `FactKindSchema = z.enum(FACT_KINDS)`; `CodeFactSchema`: `{ kind, symbolId: SymbolIdSchema, line: int >= 0, text: string, detail?: record<string, string> }`; `export type CodeFact = z.infer<typeof CodeFactSchema>`.
  - `SymbolNodeSchema` gains `annotations` (optional) and `FileIndexSchema` gains `facts` (optional). Nested arrays use `.readonly()`, so plugin-api values stay assignable to `FileIndex` (`pnpm -r typecheck` proves it in `index-command.ts`).
- `HIERARCHY_EDGE_KINDS: ReadonlySet<EdgeKind>` (`extends`, `implements`) in `get-class-hierarchy.ts`; `VALID_SYMBOL_KINDS` is built from `SYMBOL_KINDS`.
- Registrations and handler schemas use `SymbolKindSchema.optional()` and `z.array(EdgeKindSchema).optional()`, descriptions `'Filter by symbol kind (table, view and procedure come from SQL plugins)'` and `'Filter by edge kinds (reads, writes and executes are data access)'`.
- Visualizer colors: template `EDGE_COLORS` adds `reads: { color: '#76B7B2', opacity: 0.6 }`, `writes: { color: '#E15759', opacity: 0.7 }`, `executes: { color: '#EDC948', opacity: 0.7 }`, legend rows undashed; `KIND_COLORS` adds `table: '#eab308'`, `view: '#84cc16'`, `procedure: '#ec4899'`; `EDGE_STYLES` adds `reads: { color: '#14b8a6', dash: [4,2], width: 1.5 }`, `writes: { color: '#f43f5e', dash: [], width: 2 }`, `executes: { color: '#eab308', dash: [6,2], width: 1.5 }`; the loader's kind array lists all nine symbol kinds.

- [ ] **Step 1: Write the failing tests.**
  - Types: `SymbolNodeSchema keeps annotations` (parse output deep-equals the input); `SymbolNodeSchema rejects an annotation without a name or with a non-string arg`; `FileIndexSchema keeps facts and rejects an unknown fact kind`.
  - Reader: `readAll keeps a symbol and drops only its invalid annotations` (one symbol with `args: [1]`; result has the symbol without `annotations` and one warning); `readAll keeps the valid facts of a file and drops invalid ones`; `annotations and facts survive a JsonIndexWriter round trip`.
  - MCP: `search_symbols filters by kind table`; `find_importers accepts edgeKinds reads and writes` (only the reading importer of a table node returns with `edgeKinds: ['reads']`); `get_symbol_importance accepts kind procedure`; `reads and writes edges never appear in class hierarchies`.
  - Assembler: `synthesizes an orphan table id with kind table, not variable`.
  - `visualizer-kinds.test.ts` reads both HTML files as text and extracts each block by its opening marker up to the closing brace: `every edge kind has an EDGE_COLORS entry and a legend row in the template`; `every edge kind has an EDGE_STYLES entry and every symbol kind a KIND_COLORS entry in the visualizer`; `the visualizer loads every symbol kind through search_symbols`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/__tests__/types.test.ts src/adapters/storage src/adapters/mcp src/core/context-assembly src/cli/__tests__/visualizer-kinds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reader recovery: a symbol failing `SymbolNodeSchema` is retried without `annotations` and kept when that passes; `facts` is filtered with `CodeFactSchema` before the re-parse; both counts join the existing warning line.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/cli build && pnpm --filter @ctxo/cli exec vitest run --config vitest.config.e2e.ts tests/e2e/mcp-tool-registration.test.ts`. Expected: PASS (registration and handler enums equal).
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(core): annotation and fact schemas and the v2 kinds in every list (#156)"`.

---

### Task 4: Core loads v1 and v2 plugins with host capabilities

**Files:**
- Modify: `packages/cli/src/adapters/language/plugin-discovery.ts` (`tryLoad` version check, lines 148-153)
- Modify: `packages/cli/src/cli/plugin-loader.ts` (`buildContext` lines 60-73, `LoadPluginsOptions` lines 75-82, `loadPlugins` lines 84-112; new `hostCapabilities`)
- Modify: `packages/cli/src/cli/version-command.ts` (`PluginVersionInfo.compatible`, `VersionInfo`, `gatherVersionInfo`, `formatVerbose`)
- Modify: `packages/cli/src/adapters/diagnostics/checks/versions-check.ts` (fix text, `buildSummary`)
- Modify: `packages/cli/src/core/config/config-schema.ts` (`IndexConfigSchema.facts`), `packages/cli/src/core/config/load-config.ts` (new `factsRequested`)
- Modify: `packages/cli/src/cli/index-command.ts` (`registerDiscoveredPlugins` passes `facts`), `packages/cli/src/cli/watch-command.ts` (`WatchCommand.run` loads config before plugins and passes `facts`)
- Test: `packages/cli/src/adapters/language/__tests__/plugin-discovery.test.ts`, `packages/cli/src/cli/__tests__/plugin-loader.test.ts`, new `packages/cli/src/cli/__tests__/plugin-loader.capabilities.test.ts` (its module mock must not reach the existing loader tests), `packages/cli/src/cli/__tests__/version-command.test.ts`, `packages/cli/src/adapters/diagnostics/__tests__/versions-check.test.ts`, `packages/cli/src/core/config/__tests__/load-config.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_API_VERSIONS`, `PluginCapabilities` (Task 2).
- Produces:
  ```ts
  // plugin-loader.ts
  export interface LoadPluginsOptions { readonly ignoreProjects?: readonly string[]; readonly facts?: boolean }
  export function hostCapabilities(plugins: readonly CtxoLanguagePlugin[], options: { readonly facts: boolean }): PluginCapabilities;
  // { facts, sqlCallSites: some plugin lists '.sql' (case-insensitive) }; computed once, before any createAdapter
  // load-config.ts
  export function factsRequested(config: CtxoConfig): boolean;   // index.facts === true; PR 2B adds @ctxo/domain
  // version-command.ts
  // VersionInfo { ctxo; pluginApiVersion: string /* '2', newest */; pluginApiVersions: readonly string[]; plugins; runtime }
  // PluginVersionInfo.compatible = SUPPORTED_API_VERSIONS includes apiVersion
  ```
- Discovery failure reason: `unsupported apiVersion <v> (supported: 1, 2)`. Verbose report line `Plugin API: 1, 2`; incompatible status `incompatible (core supports 1, 2)`; doctor summary `(API 1, 2)`.

- [ ] **Step 1: Write the failing tests.**
  - Discovery: `loads a v2 plugin`; `still loads a v1 plugin`; replace the `'2'` rejection test with `rejects apiVersion 3 naming the supported versions` (reason matches `/unsupported apiVersion 3 \(supported: 1, 2\)/`).
  - Loader: `hostCapabilities sets sqlCallSites only when a plugin lists .sql` (TypeScript only: false; TypeScript plus a plugin with `['.SQL']`: true); `hostCapabilities copies the facts option`; in the new capabilities file, `loadPlugins hands the same capabilities to every createAdapter` (`vi.mock` of `../../adapters/language/plugin-discovery.js` returning two fake plugins, one listing `.sql`, that record their context; with `{ facts: true }` both see `{ facts: true, sqlCallSites: true }`).
  - Version: `marks v1 and v2 plugins compatible`; `reports pluginApiVersion 2 and pluginApiVersions 1, 2 in JSON`; `verbose output shows Plugin API: 1, 2`. Doctor: `versions check summary names API 1, 2`.
  - Config: `index.facts accepts a boolean and rejects other values`; `factsRequested is false by default and true with index.facts: true`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/adapters/language src/cli/__tests__/plugin-loader.test.ts src/cli/__tests__/plugin-loader.capabilities.test.ts src/cli/__tests__/version-command.test.ts src/adapters/diagnostics/__tests__/versions-check.test.ts src/core/config`. Expected: FAIL.
- [ ] **Step 3: Implement.** `buildContext` gains a `capabilities` parameter; `loadPlugins` computes `hostCapabilities(result.plugins.map(p => p.plugin), { facts: options.facts ?? false })` once; `IndexCommand.run` passes `factsRequested(ignore.config)`, `runCheck` passes nothing.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: green.
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(core): load protocol v1 and v2 plugins with host capabilities (#156)"`.

---

### Task 5: Data semantics in core

**Files:**
- Create: `packages/cli/src/core/data-coupling/data-kinds.ts`
- Modify: `packages/cli/src/core/graph/symbol-graph.ts` (`resolveNodeId`, `resolveNodeFuzzy`). Before editing: `get_blast_radius` and `get_why_context` on `SymbolGraph`.
- Modify: `packages/cli/src/core/blast-radius/blast-radius-calculator.ts` (`CONFIRMED_KINDS`, `LIKELY_KINDS`, `edgeKindToConfidence` become `EDGE_KIND_CONFIDENCE`). Before editing: the two MCP tools on `BlastRadiusCalculator`.
- Modify: `packages/cli/src/core/overlay/community-detector.ts` (the `weightByPair` loop, `countCrossClusterEdges`, `detectGodNodes`), `packages/cli/src/core/overlay/boundary-violation-detector.ts` (the edge loop in `detect`). Before editing: the two MCP tools on both classes.
- Modify: `packages/cli/src/core/dead-code/dead-code-detector.ts` (candidate filter)
- Modify: `packages/cli/src/index.ts` (`get_blast_radius` description)
- Test: `packages/cli/src/core/graph/__tests__/symbol-graph.test.ts`, `packages/cli/src/core/blast-radius/__tests__/blast-radius-calculator.test.ts`, `packages/cli/src/core/overlay/__tests__/community-detector.test.ts`, `boundary-violation-detector.test.ts`, `packages/cli/src/core/dead-code/__tests__/dead-code-detector.test.ts`, `packages/cli/src/core/data-coupling/__tests__/data-kinds.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // core/data-coupling/data-kinds.ts
  export const DATA_EDGE_KINDS: ReadonlySet<EdgeKind>;                       // reads, writes, executes
  export function isDataResourceKind(kind: string): kind is DataResourceKind; // from DATA_RESOURCE_KINDS
  // core/blast-radius/blast-radius-calculator.ts
  export const EDGE_KIND_CONFIDENCE: Readonly<Record<EdgeKind, ImpactConfidence>>;
  // calls, extends, implements, reads, writes, executes: confirmed; uses: likely; imports: potential
  ```
- SymbolGraph rule, after the existing exact, `file::name` and `.js` to `.ts` steps: a reference whose kind is a data resource kind takes the codepoint-smallest symbolId among nodes of any data resource kind with that name; a `procedure` reference takes the smallest among procedure nodes with that name; every other kind keeps "only when exactly one node matches". The symbolId starts with the file path, so the smallest is the first file in sorted path order. `getNode` and `hasNode` follow the same rule.
- `get_blast_radius` description: the tiers read "confirmed (`calls`, `extends`, `implements` and the data edges `reads`, `writes`, `executes`)".
- `DeadCodeDetector` leaves symbols of files matching `/\.sql$/i` out of its candidates, like config files.

- [ ] **Step 1: Write the failing tests.**
  - Graph: `a 2-part table reference resolves to a view of that name`; `a data reference defined in several files resolves to the first file in sorted path order whatever the insertion order` (nodes `db/b.sql::dbo.loans::table` and `db/a.sql::dbo.loans::table` added in that order; the edge points at `db/a.sql`); `a procedure reference defined in two files resolves to the first file`; `an undefined data reference stays unresolved` (`edge.to === 'dbo.audit::table'`); `getNode resolves a 2-part data reference`; `an ambiguous class name reference stays unresolved as before`.
  - Blast radius: `reads, writes and executes dependents are confirmed`; `every edge kind has a confidence` (sorted keys of `EDGE_KIND_CONFIDENCE` equal sorted `EDGE_KINDS`).
  - Communities, on a graph where `a/x.ts` functions A1, A2 and `b/y.ts` functions B1, B2 call within their file and all four read or write `db/t.sql::dbo.t::table`: `data edges do not join communities` (the table is alone in its community, A1 and B1 differ); `crossClusterEdges ignores data edges` (0); `a table is never a god node`.
  - Boundary: `data edges never produce boundary violations`.
  - Dead code: `symbols of .sql files are never reported as dead and are not counted` (a lone table and a lone procedure are absent from `deadSymbols`, and `totalSymbols` excludes them).
  - Data kinds: `isDataResourceKind accepts table and view only`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/graph src/core/blast-radius src/core/overlay src/core/dead-code src/core/data-coupling`. Expected: FAIL.
- [ ] **Step 3: Implement** the rules above; the community and boundary golden tests stay unchanged.
- [ ] **Step 4: Run them.** Expected: PASS, including `community-detector.golden.test.ts`. Then `pnpm --filter @ctxo/cli test:unit`. Expected: green.
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(core): data-resource resolution, confirmed data tiers, data edges outside communities (#156)"`.

---

### Task 6: Facts on request and the v2 round trip

**Files:**
- Create: `packages/cli/src/cli/index-facts.ts`
- Modify: `packages/cli/src/cli/index-command.ts` (a Phase 1c after the Phase 1b edge loop)
- Modify: `packages/cli/src/cli/watch-command.ts` (both re-index paths build their `FileIndex` through a new exported `buildWatchFileIndex`)
- Test: `packages/cli/src/cli/__tests__/index-command.plugin-v2.test.ts`, `packages/cli/src/cli/__tests__/index-facts.test.ts`, `packages/cli/src/cli/__tests__/watch-command.test.ts`

**Interfaces:**
- Consumes: `factsRequested` (Task 4), `CodeFact` (Task 3).
- Produces:
  ```ts
  // cli/index-facts.ts
  export async function extractFileFacts(adapter: ILanguageAdapter, relativePath: string, source: string): Promise<CodeFact[] | undefined>;
  // undefined when the adapter has no extractFacts or returns []; on a throw it prints
  // "[ctxo] Fact extraction failed for <path>: <message>" to stderr and returns undefined
  // cli/watch-command.ts
  export interface WatchFileIndexParts {
    readonly lastModified: number; readonly contentHash: string;
    readonly symbols: readonly SymbolNode[]; readonly edges: readonly GraphEdge[]; readonly complexity: readonly ComplexityMetrics[];
    readonly intent: readonly CommitIntent[]; readonly antiPatterns: readonly AntiPattern[]; readonly facts?: readonly CodeFact[];
  }
  export function buildWatchFileIndex(file: string, parts: WatchFileIndexParts): FileIndex;  // symbols kept whole; edges to "ns:" dropped
  ```
- Phase 1c runs only when `factsRequested(config)`; it sets `fileIndex.facts` only for a non-empty result. Watch passes `facts` to `loadPlugins` and extracts facts the same way. The keep-alive path stops picking symbol fields, so annotations and offsets survive a watch re-index.

- [ ] **Step 1: Write the failing tests.**
  - `index-command.plugin-v2.test.ts` (`createProject` plus `src/a.fake`; `vi.mock` of `../../adapters/language/plugin-discovery.js` returns one fake v2 plugin for `.fake` whose adapter emits `src/a.fake::dbo.loans::table` with `annotations: [{ name: 'columns', args: ['id', 'member_id'] }]`, `src/a.fake::dbo.usp_close::procedure`, the edges procedure `writes` `dbo.loans::table` and `executes` `dbo.usp_audit::procedure`, and one `endpoint` fact):
    - `a v2 plugin's kinds, annotations and edges survive the JSON round trip and reach SQLite` (`JsonIndexReader.readAll()` deep-equals the emitted symbols and edges; SQLite lists the table symbol and the `writes` edge).
    - `facts are extracted and written only with index.facts: true` (without config `extractFacts` is never called and the JSON has no `facts` key; with it, `facts` deep-equals the fact).
  - `index-facts.test.ts`: `returns undefined for an adapter without extractFacts or with no facts`; `returns undefined and reports a throwing adapter`.
  - Watch: `buildWatchFileIndex keeps annotations and offsets of keep-alive symbols and drops ns: edges`; `buildWatchFileIndex writes facts only when given`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/index-command.plugin-v2.test.ts src/cli/__tests__/index-facts.test.ts src/cli/__tests__/watch-command.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** Phase 1c, `extractFileFacts` and `buildWatchFileIndex`.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: green.
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(index): facts on request and the v2 plugin round trip (#156)"`.

---

### Task 7: `@ctxo/sql-extract` package, tokenizer and names

**Files:**
- Create: `packages/sql-extract/package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`
- Create: `packages/sql-extract/src/index.ts`, `src/types.ts`, `src/tokenizer.ts`, `src/names.ts`
- Modify: `pnpm-lock.yaml` (`pnpm install`)
- Test: `packages/sql-extract/src/__tests__/tokenizer.test.ts`, `names.test.ts`, `package.test.ts`

**Interfaces:**
- Package: mirror `packages/plugin-api` (`package.json` scripts `tsc -p tsconfig.json`/`tsc --noEmit`/`vitest run`, `exports`, `files: ["dist/", "README.md"]`, `engines`, `publishConfig`, author, license, a repository block with directory `packages/sql-extract`; `tsconfig.json` with `"types": []`). Name `@ctxo/sql-extract`, version `0.0.0`, description `Zero-dependency T-SQL tokenizer and data-access recognizers shared by Ctxo language plugins`; no `dependencies` or `peerDependencies`; devDependencies `typescript`, `vitest`, `@types/node`. README: purpose, the two functions, "not a plugin".
- Produces (internal modules; `src/index.ts` exports only Task 8's public API and the types):
  ```ts
  // types.ts
  export type SqlTokenKind = 'word' | 'quoted' | 'string' | 'number' | 'variable' | 'punct' | 'batch';
  export interface SqlToken {
    readonly kind: SqlTokenKind;
    readonly text: string;   // raw source slice
    readonly value: string;  // word as written (temp names keep '#'); quoted: delimiters removed, doubled closers collapsed; string: content
    readonly start: number; readonly end: number;   // UTF-16 offsets into the source
    readonly line: number;                          // 0-based
  }
  // tokenizer.ts
  export function tokenizeSql(source: string): SqlToken[];   // comments and whitespace dropped; never throws
  // names.ts
  export const SQL_DIALECT = 'tsql' as const;
  export const DEFAULT_SQL_SCHEMA = 'dbo' as const;
  export function foldAsciiLower(text: string): string;                   // A-Z only
  export function canonicalFromParts(parts: readonly string[]): string | undefined;   // the Names rule
  export function canonicalSqlName(text: string): string | undefined;     // tokenizes a multipart name text, then canonicalFromParts
  ```

- [ ] **Step 1: Write the failing tests.**
  - Tokenizer: `drops line comments and nested block comments` (`SELECT 1 /* a /* b */ c */ -- d` yields `SELECT`, `1`); `reads doubled quotes and N-prefixed strings as one string token`; `reads bracketed and double-quoted identifiers with escaped closers` (`[a]]b]` value `a]b`, `"x""y"` value `x"y`); `emits a batch token for GO alone on a line, with a count or a trailing comment, in any case`; `does not treat GO inside a string, a comment or a bracket, or GOTO, as a batch`; `numbers lines from 0 across LF and CRLF`; `ignores a leading byte order mark` (Review Focus 2); `does not throw on an unterminated string, comment or bracket`; `reports offsets that slice back to each token's text`.
  - Names (Review Focus 5): `[dbo].[Loan Items]` gives `dbo.loan items`; `Loans` gives `dbo.loans`; `"Sales"."Orders"` gives `sales.orders`; `OtherDb.dbo.Loans`, `srv.db.dbo.Loans`, `#tmp`, `##g`, `@t`, `sys.tables` and `INFORMATION_SCHEMA.COLUMNS` give `undefined`; `[dbo].[Ödünç Kaydı]` gives `dbo.Ödünç kaydı`; `KİTAP` gives `dbo.kİtap`.
  - Package: `declares no runtime dependencies` (no `dependencies` or `peerDependencies` in package.json); `source modules import only relative paths` (every import specifier in non-test `src/**/*.ts` starts with `./`).
- [ ] **Step 2: Run them.** `pnpm install && pnpm --filter @ctxo/sql-extract test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the tokenizer and names.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/sql-extract build && pnpm --filter @ctxo/sql-extract typecheck`. Expected: green.
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(sql-extract): zero-dependency T-SQL tokenizer and canonical names (#156)"`.

---

### Task 8: Definitions, accesses and the conformance corpus

**Files:**
- Create: `packages/sql-extract/src/accesses.ts`, `src/definitions.ts`, `src/keywords.ts`
- Modify: `packages/sql-extract/src/index.ts`, `src/types.ts`
- Create: `packages/sql-extract/corpus/<case>.sql` and `<case>.expected.json` for the cases below
- Modify: `.gitattributes` (add `packages/sql-extract/corpus/** text eol=lf`)
- Test: `packages/sql-extract/src/__tests__/accesses.test.ts`, `definitions.test.ts`, `corpus.test.ts`

**Interfaces:**
- Consumes: Task 7.
- Produces (public, from `src/index.ts`, with `SQL_DIALECT` and `DEFAULT_SQL_SCHEMA`):
  ```ts
  export type SqlObjectKind = 'table' | 'view' | 'procedure' | 'function';
  export type SqlAccessKind = 'reads' | 'writes' | 'executes';
  export interface SqlAccess { readonly kind: SqlAccessKind; readonly name: string }   // canonical 2-part name
  export interface SqlDefinition {
    readonly kind: SqlObjectKind;
    readonly name: string;           // canonical
    readonly declaredName: string;   // delimiters removed, case kept, no schema added
    readonly startLine: number; readonly endLine: number;       // 0-based
    readonly startOffset: number; readonly endOffset: number;   // UTF-16 offsets
    readonly columns: readonly string[];    // tables; [] otherwise
    readonly accesses: readonly SqlAccess[];// bodies; [] for tables
  }
  export interface SqlFileExtraction { readonly definitions: readonly SqlDefinition[] }   // source order
  export type SqlTextKind = 'statement' | 'procedureName';
  export function extractSqlDefinitions(source: string): SqlFileExtraction;
  export function extractSqlAccesses(text: string, kind?: SqlTextKind): SqlAccess[];      // default 'statement'
  // 'procedureName': one executes access for a valid name, [] otherwise
  ```
- Rules: "SQL extraction rules". `keywords.ts` holds the reserved words that end an alias position.
- Corpus cases (synthetic; statement mode unless noted; expected lists already canonical):

  | Case | SQL (abridged) | reads | writes | executes |
  |---|---|---|---|---|
  | `select-join-alias` | `SELECT l.Id FROM dbo.Loans l INNER JOIN [dbo].[Members] AS m ON m.Id = l.MemberId` | dbo.loans, dbo.members | | |
  | `default-schema-brackets` | `SELECT * FROM Loans; SELECT * FROM [Sales].[Order Lines]` | dbo.loans, sales.order lines | | |
  | `insert-select` | `INSERT INTO dbo.LoanArchive (Id) SELECT Id FROM dbo.Loans WHERE ClosedAt IS NOT NULL` | dbo.loans | dbo.loanarchive | |
  | `update-alias-from` | `UPDATE l SET l.ClosedAt = GETDATE() FROM dbo.Loans AS l JOIN dbo.Holds h ON h.LoanId = l.Id` | dbo.holds, dbo.loans | dbo.loans | |
  | `delete-forms` | `DELETE FROM dbo.Holds WHERE ExpiresAt < @now; DELETE h FROM dbo.Holds h JOIN dbo.Members m ON m.Id = h.MemberId` | dbo.holds, dbo.members | dbo.holds | |
  | `merge-using` | `MERGE dbo.Members AS t USING dbo.MemberStaging AS s ON t.Id = s.Id WHEN MATCHED THEN UPDATE SET t.Name = s.Name WHEN NOT MATCHED THEN INSERT (Id, Name) VALUES (s.Id, s.Name);` | dbo.memberstaging | dbo.members | |
  | `truncate-select-into` | `TRUNCATE TABLE dbo.LoanStaging; SELECT * INTO dbo.LoanSnapshot FROM dbo.Loans; SELECT * INTO #tmp FROM dbo.Holds` | dbo.holds, dbo.loans | dbo.loansnapshot, dbo.loanstaging | |
  | `output-into` | `UPDATE dbo.Loans SET ClosedAt = GETDATE() OUTPUT inserted.Id INTO dbo.LoanAudit (Id) WHERE Id = @id; DELETE FROM dbo.Holds OUTPUT deleted.Id INTO @gone (Id)` | | dbo.holds, dbo.loanaudit, dbo.loans | |
  | `exec-forms` | `DECLARE @rc int, @sql nvarchar(max), @p sysname; EXEC dbo.usp_CloseLoan @id = 1; EXECUTE usp_Audit; EXEC @rc = [dbo].[usp_Notify]; EXEC (@sql); EXEC @p; EXECUTE AS USER = 'auditor'; REVERT;` | | | dbo.usp_audit, dbo.usp_closeloan, dbo.usp_notify |
  | `cte-temp-variables` | `WITH Active AS (SELECT * FROM dbo.Loans WHERE ClosedAt IS NULL), Late AS (SELECT * FROM Active WHERE DueAt < GETDATE()) SELECT * FROM Late l JOIN #Seen s ON s.Id = l.Id JOIN @Ids i ON i.Id = l.Id` | dbo.loans | | |
  | `comments-and-strings` | `-- SELECT * FROM dbo.Old` / `/* a /* FROM dbo.Gone */ JOIN dbo.Gone2 */` / `SELECT 'FROM dbo.Fake', N'JOIN dbo.Fake2' FROM dbo.Loans` | dbo.loans | | |
  | `subqueries-apply-functions` | `SELECT m.Id FROM dbo.Members m CROSS APPLY dbo.fn_LoanStats(m.Id) s OUTER APPLY (SELECT TOP 1 * FROM dbo.Holds h WHERE h.MemberId = m.Id) x WHERE m.Id IN (SELECT MemberId FROM dbo.Loans) AND TRIM(' ' FROM m.Name) <> ''` | dbo.holds, dbo.loans, dbo.members | | |
  | `table-hints` | `SELECT * FROM dbo.Loans WITH (NOLOCK) JOIN dbo.Members (NOLOCK) ON Members.Id = Loans.MemberId` | dbo.loans, dbo.members | | |
  | `dapper-list-parameter` | `SELECT * FROM dbo.Loans WHERE Id IN @ids` | dbo.loans | | |
  | `multipart-and-system` | `SELECT * FROM OtherDb.dbo.Loans; SELECT * FROM srv.OtherDb.dbo.Loans; SELECT * FROM sys.tables; SELECT * FROM INFORMATION_SCHEMA.COLUMNS; SELECT * FROM dbo.Members` | dbo.members | | |
  | `non-ascii-names` | `SELECT * FROM [dbo].[Ödünç Kaydı] AS o JOIN Üye u ON u.Id = o.UyeId JOIN KİTAP k ON k.Id = o.KitapId` | dbo.kİtap, dbo.Ödünç kaydı, dbo.Üye | | |

  File-mode cases:
  - `definitions-ssdt` (GO-separated): `CREATE TABLE [dbo].[Loans] ([Id] INT NOT NULL PRIMARY KEY, [MemberId] INT NOT NULL, [ClosedAt] DATETIME2 NULL, CONSTRAINT [FK_Loans_Members] FOREIGN KEY ([MemberId]) REFERENCES [dbo].[Members] ([Id]))`; `CREATE VIEW dbo.ActiveLoans WITH SCHEMABINDING AS SELECT l.Id, l.MemberId FROM dbo.Loans AS l WHERE l.ClosedAt IS NULL`; `CREATE PROCEDURE [dbo].[usp_CloseLoan] @id INT AS BEGIN` with a `-- GO` comment line, `UPDATE dbo.Loans ...`, `INSERT INTO dbo.LoanEvents (LoanId, Kind) VALUES (@id, 'GO')`, `EXEC dbo.usp_NotifyMember @id` and `END`; `CREATE FUNCTION dbo.fn_OpenLoanCount (@memberId INT) RETURNS INT AS BEGIN RETURN (SELECT COUNT(*) FROM dbo.ActiveLoans WHERE MemberId = @memberId) END`. Definitions (sorted): view `dbo.activeloans`, function `dbo.fn_openloancount`, table `dbo.loans` (`closedat`, `id`, `memberid`), procedure `dbo.usp_closeloan`. Accesses: reads `dbo.activeloans`, `dbo.loans`; writes `dbo.loanevents`, `dbo.loans`; executes `dbo.usp_notifymember`.
  - `create-or-alter-and-alter`: `CREATE TABLE dbo.Holds (Id INT NOT NULL, LoanId INT NOT NULL)`; `ALTER TABLE dbo.Holds ADD ExpiresAt DATETIME2 NULL, CONSTRAINT PK_Holds PRIMARY KEY (Id)`; `CREATE OR ALTER PROCEDURE dbo.usp_ExpireHolds AS DELETE FROM dbo.Holds WHERE ExpiresAt < SYSUTCDATETIME()`; `ALTER VIEW dbo.OpenHolds AS SELECT h.Id FROM dbo.Holds h JOIN dbo.Loans l ON l.Id = h.LoanId`; `ALTER PROC dbo.usp_TouchHold @id INT AS UPDATE h SET h.ExpiresAt = SYSUTCDATETIME() FROM dbo.Holds AS h WHERE h.Id = @id`. Definitions (sorted): table `dbo.holds` (`expiresat`, `id`, `loanid`), view `dbo.openholds`, procedures `dbo.usp_expireholds` and `dbo.usp_touchhold`. Accesses: reads `dbo.holds`, `dbo.loans`; writes `dbo.holds`.
  - `missing-go` (sides `sql-extract`, `lang-sql`): `CREATE PROCEDURE dbo.usp_A AS SELECT 'GO' AS Marker FROM dbo.Loans` then, without `GO`, `CREATE PROCEDURE dbo.usp_B AS DELETE FROM dbo.Holds`. Definitions: procedures `dbo.usp_a`, `dbo.usp_b`. Accesses: reads `dbo.loans`; writes `dbo.holds`.

- [ ] **Step 1: Write the failing tests.**
  - `corpus.test.ts` (a ten-line loader reads `corpus/` and keeps the `statement` and `file` mode cases; PR 1C adds the host-language pairing): `every corpus .sql file has an expected.json and the reverse`; `it.each` over cases whose sides include `sql-extract`: `<case>: statement accesses match` (`extractSqlAccesses(text)` grouped by kind) or `<case>: definitions and body accesses match` (`extractSqlDefinitions(text)` mapped to `{ kind, name, columns? }`, sorted by name then kind, plus the union of accesses); `<case>: CRLF line endings give the same result` (Review Focus 4).
  - `accesses.test.ts`: `a procedure name gives one executes access` (`extractSqlAccesses('[dbo].[usp_CloseLoan]', 'procedureName')` equals `[{ kind: 'executes', name: 'dbo.usp_closeloan' }]`); `a procedure name with spaces outside brackets or more than two parts gives nothing`; `accesses are unique and sorted by kind, then name`; `malformed SQL (unbalanced parentheses) returns what it found without throwing`; `a cursor FOR UPDATE OF and trigger-style AFTER UPDATE are not DML targets` (`DECLARE c CURSOR FOR SELECT Id FROM dbo.Loans FOR UPDATE OF ClosedAt` gives reads `dbo.loans` and no writes).
  - `definitions.test.ts`: `keeps the declared spelling in declaredName and the canonical name in name` (`CREATE TABLE [Sales].[OrderLines]` gives `Sales.OrderLines` and `sales.orderlines`); `ignores ALTER TABLE ADD for a table defined elsewhere`; `merges a CREATE and a later ALTER of the same view in one file`; `ignores top-level DML outside definitions`; `spans run from CREATE to the end of the batch, 0-based`; `the same source twice gives deep-equal output`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/sql-extract test`. Expected: FAIL.
- [ ] **Step 3: Implement** `extractSqlDefinitions`, `extractSqlAccesses` and the keyword list; write the corpus files.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/sql-extract build && pnpm --filter @ctxo/sql-extract typecheck`. Expected: green.
- [ ] **Step 5: Commit.** Stage the Files block paths and `packages/sql-extract/corpus`; `git commit -m "feat(sql-extract): definitions, accesses and the shared conformance corpus (#156)"`.

---

### Task 9: `@ctxo/lang-sql` plugin

**Files:**
- Create: `packages/lang-sql/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `README.md`
- Create: `packages/lang-sql/src/index.ts`, `src/sql-adapter.ts`
- Modify: `pnpm-lock.yaml`
- Test: `packages/lang-sql/src/__tests__/plugin.test.ts`, `sql-adapter.test.ts`, `corpus.test.ts`

**Interfaces:**
- Consumes: `extractSqlDefinitions` (Task 8); `CtxoLanguagePlugin`, `ILanguageAdapter`, `SymbolNode`, `GraphEdge` (Task 2).
- Package: mirror `packages/lang-go` (tsup config, vitest config, tsconfig, `files`, `exports`, `publishConfig`, repository directory `packages/lang-sql`). Name `@ctxo/lang-sql`, version `0.0.0`, description `Ctxo SQL language plugin (T-SQL definitions and data access)`; dependencies `{ "@ctxo/sql-extract": "workspace:^" }`; peerDependencies `{ "@ctxo/plugin-api": "^0.8.0 || ^0.9.0" }`; devDependencies `@ctxo/plugin-api` (`workspace:*`), `@types/node`, `tsup`, `typescript`, `vitest`; tsup `external: ['@ctxo/plugin-api', '@ctxo/sql-extract']`. README: what it indexes, the rules summary, the effect on C# (`sqlCallSites`).
- Produces:
  ```ts
  // src/index.ts
  export const plugin: CtxoLanguagePlugin;   // apiVersion '2', id 'sql', name 'SQL (T-SQL definitions and data access)',
                                             // version from package.json, extensions ['.sql'], tier 'syntax'
  export default plugin;
  export { SqlAdapter } from './sql-adapter.js';
  // src/sql-adapter.ts
  export class SqlAdapter implements ILanguageAdapter { /* extractSymbols, extractEdges, extractComplexity (always []), isSupported (.sql, any case) */ }
  ```
- Symbol: `{ symbolId: '<file>::<def.name>::<def.kind>', name: def.declaredName, kind, startLine, endLine, startOffset, endOffset }`, plus `annotations: [{ name: 'columns', args: def.columns }]` for a table with columns. Edge: `{ from: symbolId, to: '<access.name>::table'` (reads/writes) or `'::procedure'` (executes), `kind: access.kind }`, no self edges, sorted. `extractSymbols` and `extractEdges` share one extraction per file and source.

- [ ] **Step 1: Write the failing tests.**
  - Plugin: `declares protocol 2, id sql, the .sql extension and the syntax tier`; `version equals package.json version`; `source imports only @ctxo/plugin-api types, @ctxo/sql-extract, node built-ins and relative paths`.
  - Adapter: `symbol ids use the canonical name and name keeps the declared spelling`; `a table carries a sorted lowercase columns annotation`; `procedure, view and function bodies become reads, writes and executes edges to 2-part references`; `a recursive procedure has no self edge`; `.SQL in upper case is supported`; `a file with only top-level DML has no symbols`; `complexity is empty`; `extracting the same file twice gives deep-equal symbols and edges`.
  - `corpus.test.ts`: `it.each` over file-mode cases whose sides include `lang-sql`: `<case>: adapter symbols and edges match` (symbols mapped to `{ kind, name: middle segment of symbolId, columns? }`; edges grouped by kind with the target's first segment).
- [ ] **Step 2: Run them.** `pnpm install && pnpm --filter @ctxo/sql-extract build && pnpm --filter @ctxo/lang-sql test`. Expected: FAIL.
- [ ] **Step 3: Implement** the plugin and the adapter; the version comes from `createRequire(import.meta.url)('../package.json').version`, which resolves from both `src/` and `dist/`.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/lang-sql build && pnpm --filter @ctxo/lang-sql typecheck`. Expected: green.
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(lang-sql): SQL language plugin on protocol v2 (#156)"`.

---

### Task 10: Register `@ctxo/lang-sql` in the CLI; UTF-16 sources; CI

**Files:**
- Modify: `packages/cli/src/core/detection/detect-languages.ts` (`KNOWN_LANGUAGES` gains `'sql'`, `EXTENSION_LANGUAGE` gains `'.sql': 'sql'`; `officialPluginFor` needs no change)
- Modify: `packages/cli/src/cli/install-command.ts` (`normalizeLanguage` aliases gain `tsql: 'sql'`)
- Modify: `packages/cli/src/cli/update-command.ts` (export `defaultDiscoverInstalled` for its test)
- Modify: `packages/cli/package.json` (devDependencies gain `"@ctxo/lang-sql": "workspace:*"`, which global-install discovery reads), `pnpm-lock.yaml`
- Modify: `packages/cli/src/cli/cli-router.ts` (`printHelp`: `ctxo install sql          SQL plugin: .sql definitions, data edges from C# call sites`)
- Create: `packages/cli/src/cli/read-source.ts`
- Modify: `packages/cli/src/cli/index-command.ts` (Phase 1a and `runCheck` read through `readSourceText`; the tier summary adds `[ctxo]   SQL: <n> files (syntax tier)`), `packages/cli/src/cli/watch-command.ts` (both read sites)
- Modify: `.github/workflows/ci.yml` (pack list gains `@ctxo/sql-extract @ctxo/lang-sql`; the unit-tests job gains a step `pnpm --filter @ctxo/plugin-api --filter @ctxo/sql-extract --filter @ctxo/lang-sql test` after the CLI unit tests)
- Test: `packages/cli/src/core/detection/__tests__/detect-languages.test.ts`, new `packages/cli/src/cli/__tests__/install-sql.test.ts`, `packages/cli/src/adapters/diagnostics/__tests__/language-coverage-check.test.ts`, new `packages/cli/src/cli/__tests__/update-command.discovery.test.ts` (mocks plugin discovery, so it stays out of `update-command.test.ts`), new `packages/cli/src/cli/__tests__/read-source.test.ts`, new `packages/cli/src/cli/__tests__/index-command.sql.test.ts`

**Interfaces:**
- Consumes: the lang-sql plugin (Task 9), discovery of `'2'` (Task 4), data resolution (Task 5).
- Produces: `export function readSourceText(absolutePath: string): string` (BOM `FF FE`: UTF-16 LE; `FE FF`: UTF-16 BE by swapping byte pairs; otherwise exactly `readFileSync(path, 'utf-8')`).

- [ ] **Step 1: Write the failing tests.**
  - Detection: `counts .sql files as sql and maps it to @ctxo/lang-sql`; `needs sql when at least 5 .sql files make up at least 2% of the files`.
  - Install: `ctxo install sql plans @ctxo/lang-sql` and `tsql is an alias of sql` (`buildPluginSpecifiers` and a `--dry-run` run).
  - Doctor: `language coverage counts sql and passes when @ctxo/lang-sql resolves` (a temp repo with five committed `.sql` files; the plugin resolves in the monorepo, so the message names `sql`; the warn path stays covered by the existing python test).
  - Update: `defaultDiscoverInstalled lists a v2 plugin with its version` (discovery stubbed to return `@ctxo/lang-sql` at `0.1.0`).
  - Read source (Review Focus 2): `decodes UTF-16 LE with a BOM`; `decodes UTF-16 BE with a BOM`; `keeps UTF-8 decoding unchanged, including a UTF-8 BOM character`.
  - `index-command.sql.test.ts` (`createProject` plus `db/tables/Loans.sql`, `db/tables/Members.sql` written as UTF-16 LE with a BOM, and `db/procs/usp_CloseLoan.sql` that updates `dbo.Loans` and reads `dbo.Members`; real plugins discovered through the CLI's devDependencies):
    - `indexes .sql definitions as table and procedure symbols with a columns annotation`;
    - `procedure accesses resolve to the table nodes and make the procedure a confirmed dependent` (`loadGraph` plus `BlastRadiusCalculator` on `db/tables/Loans.sql::dbo.loans::table`);
    - `a UTF-16 LE file indexes like UTF-8 and ctxo index --check reports it fresh` (stderr shows `Index is up to date`, `process.exit` never called with 1);
    - `the summary reports the SQL files`.
- [ ] **Step 2: Run them.** `pnpm install && pnpm --filter @ctxo/lang-sql build && pnpm --filter @ctxo/cli exec vitest run src/core/detection src/cli/__tests__/install-sql.test.ts src/adapters/diagnostics src/cli/__tests__/update-command.discovery.test.ts src/cli/__tests__/read-source.test.ts src/cli/__tests__/index-command.sql.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the registrations, the reader and the CI edits.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit` and `grep -n "sql-extract @ctxo/lang-sql" .github/workflows/ci.yml`. Expected: green, and the pack line lists both packages.
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(cli): register @ctxo/lang-sql and decode UTF-16 sources (#156)"`.

---

### Task 11: C# attribute annotations (Roslyn and tree-sitter tiers)

**Files:**
- Create: `packages/lang-csharp/tools/ctxo-roslyn/Annotations.cs`
- Modify: `packages/lang-csharp/tools/ctxo-roslyn/Program.cs` (`ExtractSymbols` fills `Annotations`; `CtxoSymbol` gains it; a lone `.csproj` opens with `OpenProjectAsync`, see Step 3)
- Modify: `packages/lang-csharp/package.json` (`files`: `tools/ctxo-roslyn/*.cs` replaces `tools/ctxo-roslyn/Program.cs`)
- Modify: `packages/lang-csharp/src/roslyn/roslyn-process.ts` (`RoslynSymbol.annotations?`, new `RoslynAnnotation`)
- Modify: `packages/lang-csharp/src/roslyn/roslyn-adapter.ts` (new exported `toSymbolNode`, used by `extractSymbols` and `reindexFile`)
- Modify: `packages/lang-csharp/src/csharp-adapter.ts` (`visitSymbols` and `extractMethodSymbols` add annotations)
- Create: fixture `packages/lang-csharp/src/__tests__/fixtures/csharp-v2-sample/` (`CsharpV2Sample.sln`, `CsharpV2Sample/CsharpV2Sample.csproj` with `net8.0` and no package references, `CsharpV2Sample/.gitignore` for `bin/` and `obj/`, `CsharpV2Sample/Stubs/Xunit.cs`, `CsharpV2Sample/Tests/LoanPolicyTests.cs`)
- Create: fixture `packages/lang-csharp/src/__tests__/fixtures/csharp-csproj-only/` (`CsprojOnly.csproj` with `net8.0` and no package references, `.gitignore` for `bin/` and `obj/`, `Loans/Loan.cs` with `class Loan` and one method; no `.sln` or `.slnx` anywhere under it)
- Test: new `packages/lang-csharp/src/__tests__/roslyn-annotations.integration.test.ts`, new `roslyn-csproj-only.integration.test.ts`, `roslyn-adapter.test.ts`, `csharp-adapter.test.ts`, new `packaging.test.ts`

**Interfaces:**
- C#: `record CtxoAnnotation { string Name; List<string>? Args; Dictionary<string, string>? Named }` (JSON `name`, `args`, `named`; dictionary keys keep their spelling); `CtxoSymbol.Annotations` is `List<CtxoAnnotation>?`, null when empty. `static class AttributeAnnotations { public static List<CtxoAnnotation>? For(SyntaxNode declaration, ISymbol symbol, SemanticModel model) }`: walks the declaration's `AttributeLists` in source order (so each partial part keeps its own attributes); for each attribute uses the `AttributeData` of `symbol.GetAttributes()` whose `ApplicationSyntaxReference` points at it when its class resolves, otherwise the syntax (`model.GetConstantValue` for each argument; `NameEquals`/`NameColon` become `named`). Caps and value formatting: Designer call 11.
- TypeScript: `export interface RoslynAnnotation { name: string; args?: string[]; named?: Record<string, string> }`; `export function toSymbolNode(s: RoslynSymbol): SymbolNode` (copies `annotations` when present).
- Tree-sitter: `attribute_list` children of class, struct, record, interface, enum, method and constructor declarations; the name is the last identifier without the `Attribute` suffix; literal arguments only (string, verbatim and raw strings unquoted, numbers, `true`/`false`); `name_equals`/`name_colon` arguments become `named`; same caps; no `named.type`. Confirm node type names against tree-sitter-c-sharp 0.23.1 with `tree.rootNode.toString()` while writing the test.
- Fixture `LoanPolicyTests` methods and their expected annotations:

  | Method | Attributes | Expected `annotations` |
  |---|---|---|
  | `MemberHoldsAtMostFiveLoans` | `[Fact] [Trait("Rule", "LEND-03")]` | `[{ name: 'Fact', named: { type: 'Xunit.FactAttribute' } }, { name: 'Trait', args: ['Rule', 'LEND-03'], named: { type: 'Xunit.TraitAttribute' } }]` |
  | `CharacterizesOverdueFees` | `[Theory, Trait("Kind", "Characterization")]` | `Theory` (type `Xunit.TheoryAttribute`), then `Trait` with `['Kind', 'Characterization']` |
  | `UsesAnUnresolvedAttribute` | `[Unresolved("x", Level = 2)]` (no such type) | `[{ name: 'Unresolved', args: ['x'], named: { Level: '2' } }]` |
  | `HasTwelveArgs` | `[Args(1, 2, ..., 12)]`, `ArgsAttribute(params int[] values)` defined in the fixture | one annotation with `args` `'1'` to `'10'` |
  | `HasALongArg` | `[Note(LongText)]`, `const string LongText` of 250 characters | `args[0]` has length 200 |
  | `HasTwentyFiveAttributes` | `[A0, A1, ..., A24]` (unresolved) | 20 annotations, names `A0` to `A19` |

- [ ] **Step 1: Write the failing tests.**
  - `roslyn-annotations.integration.test.ts` (gated; `RoslynAdapter` initialized on the fixture and `batchIndex()` in `beforeAll`, 120 s): one `it` per table row comparing the method symbol's `annotations`; `the test class itself carries no annotations field`.
  - `roslyn-csproj-only.integration.test.ts` (test first; gated; `RoslynAdapter` initialized on the csproj-only fixture and `batchIndex()` in `beforeAll`, 120 s): `a repository with a lone .csproj and no solution yields symbols` (`isReady()` is true; `extractSymbols('Loans/Loan.cs', '')` holds the class `Loan` and its method). Today `discoverSolution` returns the `.csproj` and `Program.cs` hands it to `OpenSolutionAsync`, so the batch finds zero symbols and the test fails for that reason.
  - `roslyn-adapter.test.ts`: `toSymbolNode copies annotations and omits an absent list`.
  - `csharp-adapter.test.ts`: `tree-sitter emits attribute annotations with literal arguments` (`[Route("api/loans")] public class LoanController { [HttpGet("{id}")] [Obsolete(DiagnosticId = "X1")] public void Get(int id) {} }` gives class `[{ name: 'Route', args: ['api/loans'] }]` and method `[{ name: 'HttpGet', args: ['{id}'] }, { name: 'Obsolete', named: { DiagnosticId: 'X1' } }]`); `tree-sitter strips the Attribute suffix and a namespace qualifier` (`[Xunit.FactAttribute]` gives `Fact`).
  - `packaging.test.ts` (Review Focus 1): `the npm tarball ships the helper project and every helper source file` (`npm pack --dry-run --json` in the package lists `tools/ctxo-roslyn/ctxo-roslyn.csproj` and every `tools/ctxo-roslyn/*.cs` on disk, and no path under `bin/` or `obj/`).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/lang-csharp test`. Expected: the new tests FAIL (the integration tests skip without .NET 8); the csproj-only test fails with zero symbols.
- [ ] **Step 3: Implement** the helper and the TypeScript changes. Make the lone-project test pass first: in `Program.cs`, between the `.slnx` branch and the final `OpenSolutionAsync`, add a branch for a path ending in `.csproj` (ordinal, ignore case) that calls `await workspace.OpenProjectAsync(solutionPath)` and sets `solution = workspace.CurrentSolution`, the same way the `.slnx` loop opens projects (it also loads referenced projects); every other path keeps `OpenSolutionAsync`. Change the usage text to `<solution.sln|project.csproj>`.
- [ ] **Step 4: Run them.** Expected: PASS, with the integration tests running on this machine (.NET SDK present), the csproj-only one included. Then `pnpm --filter @ctxo/lang-csharp build && pnpm --filter @ctxo/lang-csharp typecheck`.
- [ ] **Step 5: Commit.** Stage the Files block paths and the fixture folders; `git commit -m "feat(lang-csharp): attribute annotations in the Roslyn and tree-sitter tiers, lone .csproj loading (#156)"`.

---

### Task 12: ScriptDom, `--sql-extract` and the corpus on the C# side; RollForward

**Files:**
- Modify: `packages/lang-csharp/tools/ctxo-roslyn/ctxo-roslyn.csproj` (PackageReference `Microsoft.SqlServer.TransactSql.ScriptDom`; `<RollForward>Major</RollForward>` after Step 4)
- Create: `packages/lang-csharp/tools/ctxo-roslyn/SqlText.cs`
- Modify: `packages/lang-csharp/tools/ctxo-roslyn/Program.cs` (`--sql-extract` mode at the very top, before `MSBuildLocator`)
- Test: new `packages/lang-csharp/src/__tests__/sql-corpus.integration.test.ts`, new `packages/lang-csharp/src/__tests__/roslyn-rollforward.integration.test.ts`

**Interfaces:**
- C#:
  ```csharp
  static class SqlText {
      public sealed record Accesses(SortedSet<string> Reads, SortedSet<string> Writes, SortedSet<string> Executes, int Errors);   // StringComparer.Ordinal
      public static Accesses Extract(string sql);                // "SQL extraction rules" over a statement or a script
      public static string? CanonicalName(SchemaObjectName name); // null when the Names rule skips it
      public static string? CanonicalName(string multipartText); // parser.ParseSchemaObjectName; null when invalid or skipped
  }
  ```
  `Extract` rewrites Dapper `IN @p` to `IN (@p)`, parses with the newest `TSqlNNNParser` of the pinned package (`initialQuotedIdentifiers: true`), records write targets first (`InsertSpecification`, `UpdateSpecification`, `DeleteSpecification` and `MergeSpecification` targets, `SelectStatement.Into`, `TruncateTableStatement.TableName`, `OutputIntoClause.IntoTable`), then classifies every other `NamedTableReference` as a read; one-part `UPDATE`/`DELETE` targets resolve through the statement's `FROM` aliases; CTE names come from each statement's `WithCtesAndXmlNamespaces`; `ExecuteSpecification` gives executes unless the entity is a variable or a string list. `Errors` is the parser's error count.
- `--sql-extract <file> [<file>...]`: one line per file, `{"type":"sqlExtract","file":"<as given>","reads":[...],"writes":[...],"executes":[...],"errors":<n>}`; exit 0.

- [ ] **Step 1: Write the failing tests.**
  - `sql-corpus.integration.test.ts` (gated; Review Focus 3, 4 and 5): `beforeAll` runs `dotnet run --project <helper dir> -- --sql-extract <every corpus file whose sides include scriptdom>` once (180 s), where the file list comes from the cases of mode `statement` or `file` only (host-language cases from PR 1C have `sides: []` and no `.sql` file, so the filter reads `mode` and `sides`, never the extension alone), and maps the lines by file name; `it.each`: `<case>: ScriptDom accesses match the corpus` (`errors` 0; the three lists equal the expected ones).
  - `roslyn-rollforward.integration.test.ts` (gated on .NET and on an installed `Microsoft.NETCore.App` with major > 8 from `dotnet --list-runtimes`): `the helper asks for roll forward to newer major runtimes` (after `dotnet build <csproj> -c Debug`, `bin/Debug/net8.0/ctxo-roslyn.runtimeconfig.json` has `runtimeOptions.rollForward === 'Major'`); `the helper runs on the newest installed runtime` (`dotnet exec --fx-version <newest> <dll> --sql-extract <corpus>/select-join-alias.sql` exits 0 with reads `['dbo.loans', 'dbo.members']`).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/lang-csharp exec vitest run src/__tests__/sql-corpus.integration.test.ts src/__tests__/roslyn-rollforward.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3: Add ScriptDom.** `dotnet add packages/lang-csharp/tools/ctxo-roslyn/ctxo-roslyn.csproj package Microsoft.SqlServer.TransactSql.ScriptDom`, keep the resolved exact version pinned, and name it in the commit message. Implement `SqlText` and the mode.
- [ ] **Step 4: Check RollForward before relying on it (spec 8.4).** `dotnet build` the helper and confirm the generated `runtimeconfig.json` has no `rollForward` (default `Minor`: a machine without an 8.x runtime cannot start it). Run the built DLL with `dotnet exec --fx-version <newest installed runtime>` and `--sql-extract` on a corpus file. Expected: exit 0 and correct output. Only then add `<RollForward>Major</RollForward>` (machines with 8.x keep using it) and record both observations in the scratchpad for the PR description.
- [ ] **Step 5: Run the tests.** Expected: PASS. Then `pnpm --filter @ctxo/lang-csharp test`. Expected: green (the Task 11 integration tests still pass on the newly built helper).
- [ ] **Step 6: Commit.** Stage the Files block paths; `git commit -m "feat(lang-csharp): ScriptDom SQL extraction, corpus mode and roll forward (ScriptDom <version>) (#156)"`.

---

### Task 13: SQL edges at known C# call sites

**Files:**
- Create: `packages/lang-csharp/tools/ctxo-roslyn/KnownSqlApis.cs`, `packages/lang-csharp/tools/ctxo-roslyn/SqlCallSites.cs`
- Modify: `packages/lang-csharp/tools/ctxo-roslyn/Program.cs` (`--sql-call-sites` flag; the method-body loop in `ExtractEdges` emits data edges; the `done` line gains `sql`)
- Modify: `packages/lang-csharp/src/roslyn/roslyn-process.ts` (`runBatchIndex`, `RoslynKeepAlive`, `RoslynBatchResult`), `packages/lang-csharp/src/roslyn/roslyn-adapter.ts` (constructor options, new exported `toGraphEdges` replacing the `VALID_SYMBOL_ID` filter in `extractEdges` and the `reindexFile` mapping), `packages/lang-csharp/src/composite-adapter.ts` (constructor options), `packages/lang-csharp/src/index.ts` (`createAdapter` reads the capability)
- Extend fixture `csharp-v2-sample/CsharpV2Sample/`: `Stubs/Dapper.cs`, `Stubs/SqlClient.cs`, `Stubs/EntityFrameworkCore.cs`, `Data/LoanRepository.cs`
- Test: new `packages/lang-csharp/src/__tests__/roslyn-sql-call-sites.integration.test.ts`, `roslyn-adapter.test.ts`, new `roslyn-process.test.ts`, new `plugin.test.ts`

**Interfaces:**
- Consumes: `SqlText` (Task 12), `PluginCapabilities` (Task 2).
- C# known-API table (data, one entry per row; a parameter is matched by name through `IArgumentOperation.Parameter.Name`):

  | Containing type | Member | SQL source | Procedure when |
  |---|---|---|---|
  | `Microsoft.Data.SqlClient.SqlCommand`, `System.Data.SqlClient.SqlCommand` | constructor | parameter `cmdText` | the command's `CommandType` is `StoredProcedure` |
  | the two `SqlCommand` types, `System.Data.Common.DbCommand`, `System.Data.IDbCommand` (and derived types) | `CommandText` assignment | assigned value | same |
  | `Dapper.SqlMapper` | methods starting with `Query` or `Execute` | parameter `sql` | argument `commandType` is `CommandType.StoredProcedure` |
  | `Microsoft.Data.SqlClient.SqlBulkCopy`, `System.Data.SqlClient.SqlBulkCopy` | `DestinationTableName` assignment | assigned value, a table name: `writes` | never |
  | `Microsoft.EntityFrameworkCore.RelationalQueryableExtensions` | `FromSqlRaw` | parameter `sql` | never |
  | `Microsoft.EntityFrameworkCore.RelationalDatabaseFacadeExtensions` | `ExecuteSqlRaw`, `ExecuteSqlRawAsync`, `SqlQueryRaw` | parameter `sql` | never |

  Text counts only when `IOperation.ConstantValue` holds a string (unwrap conversions). `static class SqlCallSites { public static void Collect(IOperation body, Action<string, string> addEdge /* (targetId, kind) */, SqlStats stats) }`, `sealed class SqlStats { public int Constant; public int NonConstant; public int Unparsable; }`; every constant text at a known call site counts as `Constant`; one that `SqlText.Extract` cannot parse (`Errors > 0`) also counts as `Unparsable` and adds nothing.
- TypeScript:
  ```ts
  export interface RoslynSqlStats { constant: number; nonConstant: number; unparsable: number }
  export interface RoslynRunOptions { readonly sqlCallSites?: boolean; readonly timeoutMs?: number }   // timeout default 120_000
  export async function runBatchIndex(projectDir: string, solutionPath: string, options?: RoslynRunOptions): Promise<RoslynBatchResult>;
  // RoslynBatchResult gains `sql?: RoslynSqlStats` (from the done line)
  export class RoslynKeepAlive { constructor(projectDir: string, solutionPath: string, options?: RoslynRunOptions) }   // timeout default 300_000
  // both append --sql-call-sites only when enabled; RoslynAdapter.startKeepAlive passes its own flag
  export class RoslynAdapter { constructor(options?: { readonly sqlCallSites?: boolean }) }
  export class CSharpCompositeAdapter { constructor(options?: { readonly sqlCallSites?: boolean }); readonly sqlCallSites: boolean }
  export function toGraphEdges(edges: readonly RoslynEdge[]): GraphEdge[];
  // keeps 3-part from and to; also keeps a 2-part to ('<name>::table|view|procedure') on reads, writes and executes edges
  ```
  `batchIndex` logs the stats through the debug-gated logger.
- Fixture `Lending.Data.LoanRepository` methods and expected edges (stubs are minimal; only type, member and parameter names must equal the real libraries'):

  | Method | Call site | Expected edges |
  |---|---|---|
  | `GetActive` | Dapper `Query<Loan>(ActiveLoansSql)`, `const string` joining `dbo.Loans l` and `[dbo].[Members] m` | reads `dbo.loans::table`, `dbo.members::table` |
  | `GetByIds` | Dapper `Query<Loan>("SELECT * FROM dbo.Loans WHERE Id IN @ids", ...)` | reads `dbo.loans::table` |
  | `Close` | `new SqlCommand("usp_CloseLoan", connection)` then `cmd.CommandType = CommandType.StoredProcedure` | executes `dbo.usp_closeloan::procedure` |
  | `Archive` | `cmd.CommandText = "INSERT INTO dbo.LoanArchive (Id) " + "SELECT Id FROM dbo.Loans WHERE ClosedAt < @cutoff"` | writes `dbo.loanarchive::table`, reads `dbo.loans::table` |
  | `Notify` | Dapper `Execute("[dbo].[usp_NotifyMember]", ..., commandType: CommandType.StoredProcedure)` | executes `dbo.usp_notifymember::procedure` |
  | `BulkLoad` | `new SqlBulkCopy(connection) { DestinationTableName = "dbo.LoanStaging" }` | writes `dbo.loanstaging::table` |
  | `RawEf` | `FromSqlRaw(@"SELECT * FROM dbo.Loans WHERE MemberId = {0}", id)` and `ExecuteSqlRaw("""DELETE FROM dbo.Holds WHERE ExpiresAt < GETDATE()""")` | reads `dbo.loans::table`, writes `dbo.holds::table` |
  | `Dynamic(string table)` | Dapper `Query<Loan>("SELECT * FROM " + table)` | none |
  | `StaticReadonly` | Dapper `Query<Loan>(StaticSql)`, `static readonly string` | none |
  | `Broken` | Dapper `Execute("SELEC * FROM dbo.Loans")` | none |

  Stats: `{ constant: 9, nonConstant: 2, unparsable: 1 }`.

- [ ] **Step 1: Write the failing tests.**
  - `roslyn-sql-call-sites.integration.test.ts` (gated; two `describe` blocks, each initializing an adapter on the fixture with `batchIndex()` in `beforeAll`, 120 s):
    - With `{ sqlCallSites: true }`: `it.each` over the table: `<method>: data edges match` (the method's `reads`/`writes`/`executes` edges equal the row, sorted); `the batch reports 9 constant, 2 non-constant and 1 unparsable SQL texts` (Review Focus 3); `existing calls and implements edges are unchanged`.
    - With `{ sqlCallSites: false }`: `no reads, writes or executes edge appears without the capability`; `the batch reports no sql stats`.
  - `roslyn-adapter.test.ts`: `toGraphEdges keeps 2-part table, view and procedure targets on data edges`; `toGraphEdges drops a 2-part target on a calls edge and malformed ids`.
  - `roslyn-process.test.ts` (`node:child_process` mocked as in `roslyn-adapter.test.ts`): `runBatchIndex appends --sql-call-sites only when enabled`; `the keep-alive process gets the same flag`.
  - `plugin.test.ts`: `createAdapter enables SQL call sites only when capabilities.sqlCallSites is true` (no capabilities, `{ sqlCallSites: false }` and `{ sqlCallSites: true }` give `adapter.sqlCallSites` false, false, true).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/lang-csharp test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the table, the collector, the flag plumbing and `toGraphEdges`.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/lang-csharp build && pnpm --filter @ctxo/lang-csharp typecheck`, and `pnpm --filter @ctxo/cli test:unit` (the CLI now hands the capability to C#). Expected: green.
- [ ] **Step 5: Commit.** Stage the Files block paths and the fixture additions; `git commit -m "feat(lang-csharp): SQL edges at known call sites behind sqlCallSites (#156)"`.

---

### Task 14: Data coupling in the contexts view

**Files:**
- Create: `packages/cli/src/core/contexts-view/data-coupling.ts`
- Modify: `packages/cli/src/core/config/config-schema.ts` (`contextsView.weights.data`, number >= 0), `packages/cli/src/core/config/load-config.ts` (`ResolvedContextsViewConfig.weights.data`, default 0)
- Modify: `packages/cli/src/core/contexts-view/file-graph.ts` (`FilePair.data`; `FileGraphInput.graph`; new `buildIndexGraph`; `dependents` from non-data edges), `context-terms.ts`, `contexts-view-builder.ts`, `contexts-view-schema.ts`
- Modify: `packages/cli/src/adapters/mcp/get-architectural-overlay.ts` (`buildContextsOverlay`: source caps for `dataResources` and `sharedTables`; `TRUNCATABLE_FIELDS` stays unchanged), `packages/cli/src/cli/contexts-command.ts`, `packages/cli/src/index.ts` (overlay description)
- Test: `packages/cli/src/core/contexts-view/__tests__/data-coupling.test.ts`, `file-graph.test.ts`, `context-terms.test.ts`, `contexts-view-builder.test.ts`, `packages/cli/src/core/config/__tests__/contexts-view-config.test.ts`, `packages/cli/src/adapters/storage/__tests__/contexts-view-reader.test.ts`, `packages/cli/src/adapters/mcp/__tests__/get-architectural-overlay.test.ts`, `packages/cli/src/cli/__tests__/contexts-command.test.ts`

**Interfaces:**
- Consumes: `DATA_EDGE_KINDS`, `isDataResourceKind` (Task 5), the SymbolGraph resolution (Task 5), PR 1A's contexts-view modules.
- Produces:
  ```ts
  // core/contexts-view/data-coupling.ts
  export type DataAccessMode = 'reads' | 'writes';
  export interface CandidateDataAccess { readonly candidate: number; readonly modes: readonly DataAccessMode[] }   // 'reads' before 'writes'
  export interface DataResourceUsage {
    readonly name: string;                 // canonical schema.name
    readonly kind?: DataResourceKind;      // absent when external
    readonly external: boolean;            // no indexed table or view defines it
    readonly accesses: readonly CandidateDataAccess[];   // by candidate id
    readonly writers: readonly number[];   // more than one: several writers
    readonly owner?: number;               // the only writer
  }
  export interface CandidateSharedTable { readonly name: string; readonly external: boolean; readonly accesses: readonly CandidateDataAccess[]; readonly owner?: number }
  export interface DataCouplingInput { readonly graph: SymbolGraph; readonly fileCandidate: ReadonlyMap<string, number> }   // members and assigned hubs
  export interface DataCoupling { readonly resources: readonly DataResourceUsage[]; readonly sharedTables: ReadonlyMap<number, readonly CandidateSharedTable[]> }
  export function computeDataCoupling(input: DataCouplingInput): DataCoupling;
  // core/contexts-view/file-graph.ts
  export function buildIndexGraph(indices: readonly FileIndex[]): SymbolGraph;   // files sorted; all nodes, then all edges
  // FileGraphInput gains `graph?: SymbolGraph`; FilePair gains `data`;
  // weight = weights.dependency * dependency + weights.coChange * coChange + weights.data * data,
  // data = log2(1 + dataCount) / log2(1 + maxDataCount) over distinct reads/writes/executes edges per pair
  // ContextCandidate gains `sharedTables: readonly CandidateSharedTable[]`; ContextsView gains `dataResources: readonly DataResourceUsage[]`
  ```
- Attribution: a `reads`/`writes` edge from a symbol in a candidate file records that candidate and mode for its target; an `executes` edge to a resolved procedure adds that procedure's reads and writes, following further `executes` edges transitively with a visited set; unresolved procedures add nothing. `dataResources` lists every resource with at least one access, sorted by name; `sharedTables` lists, per candidate, the resources of two or more candidates, sorted by name.
- Terms: `harvestTopTerms` adds the short names (last `.` segment of `name`) of data resource symbols and the tokens of their `columns` annotation; `findTermCollisions` adds tables with their columns as members and compares names after ASCII lowercasing and removing `_` (output keeps the original spellings).
- Schema: `dataResources` and each candidate's `sharedTables` use `.default([])`, so a PR 1A artifact still validates.
- Surfaces: `buildContextsOverlay` keeps `dataResources` top level and caps it at its source at 50 entries (the first 50 by name) with `dataResourcesTotal` added only when capped, and caps each candidate's `sharedTables` (nested, per candidate) at 15 with `sharedTableCount`. These are additive arrays on an existing tool, so per the cross-plan rule they are capped at the source and are NOT added to `TRUNCATABLE_FIELDS`: the envelope keeps truncating the mode's primary array (`candidates`), and the full lists stay in `ctxo contexts --json`. `ctxo contexts` appends `, <s> shared tables` to the header, ` shared tables: <n>` to candidate lines with any, and one line per shared resource: `shared <table|view|external> <name>  #<id> <reads|writes|reads+writes>, ...  owner #<id> | several writers | read only`. The overlay description gains: "Candidates also list sharedTables: SQL tables and views that files of two or more candidates read or write, with access modes per candidate. dataResources lists accessed resources (the first 50 by name; dataResourcesTotal gives the count when more exist, and ctxo contexts --json has them all) with their writers, the owning candidate when only one writes it, and external resources that no .sql file defines."

- [ ] **Step 1: Write the failing tests.**
  - Data coupling (synthetic indices: `src/billing/*.cs`, `src/shipping/*.cs`, `db/*.sql`): `a table read by two candidates is shared, with each candidate's modes`; `writes through a procedure count for the executing candidate` (candidate 1 executes `dbo.usp_close`, which writes `dbo.loans`, from a `.sql` file in candidate 2: both candidates write it); `procedure chains are followed and cycles terminate`; `the only writing candidate is the owner; two writers give no owner`; `a reference no .sql file defines is external and has no kind`; `a 2-part table reference to a view resolves to the view`; `unclustered files are ignored and hubs count for their candidate`; `reversed input gives deep-equal output`.
  - File graph: `data edges add nothing at the default weight and never count as dependents`; `weights.data above 0 adds the normalized data component`.
  - Terms: `table names and columns join the top terms`; `a table and a class of the same name with different shapes collide`; `member names compare without case and underscores` (`MemberId` matches `member_id`); `views appear in top terms but not in collisions`.
  - Builder: `candidates list sharedTables and the view lists dataResources`; PR 1A's `the same input in reversed order gives byte-identical JSON` passes with SQL symbols and data edges added to its input.
  - Config: `the defaults include weights.data 0` (the exact defaults object updated); `the schema rejects a negative data weight`.
  - Reader: `a contexts-view.json without sharedTables or dataResources still validates, with empty lists`.
  - MCP: `mode contexts returns dataResources at the top level and caps sharedTables at 15 with sharedTableCount`; `dataResources is capped at 50 with dataResourcesTotal, and has no total when under the cap` (200 resources give 50 entries and `dataResourcesTotal: 200`; 30 give 30 and no total field); `two arrays in one response: a large dataResources does not take over truncation` (120 candidates and 200 resources with `CTXO_RESPONSE_LIMIT=2048`: `_meta.truncated` is true and `_meta.totalItems` is 120 with the `candidates` hint, `dataResources` still holds its 50 entries and `dataResourcesTotal` is 200).
  - CLI: `the header counts shared tables and each shared resource gets a line with modes and owner`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/contexts-view src/core/config src/adapters/storage src/adapters/mcp src/cli/__tests__/contexts-command.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `buildContextsView` builds the graph once with `buildIndexGraph`, passes it to `buildFileGraph` and, after IDs and hub assignment, to `computeDataCoupling`.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: green.
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(contexts-view): shared tables, ownership, external resources and data terms (#156)"`.

---

### Task 15: Test files recognised by test-framework annotations (spec 7.1)

**Files:**
- Modify: `packages/cli/src/core/test-files/test-file-classifier.ts`
- Modify: `packages/cli/src/cli/index-contexts-view.ts` (`computeAndWriteContextsView`)
- Test: `packages/cli/src/core/test-files/__tests__/test-file-classifier.test.ts`, `packages/cli/src/cli/__tests__/index-contexts-view.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const TEST_FRAMEWORK_ANNOTATIONS: readonly string[];   // Fact, Theory, Test, TestCase, TestMethod
  export function filesWithTestAnnotations(indices: readonly FileIndex[]): Set<string>;
  export function createTestFileClassifier(extraGlobs?: readonly string[], annotatedFiles?: ReadonlySet<string>): TestFileClassifier;
  ```
- A file is a test file when a glob matches or when `annotatedFiles` holds its normalized path; `computeAndWriteContextsView` passes `filesWithTestAnnotations(options.indices)`.

- [ ] **Step 1: Write the failing tests.**
  - `filesWithTestAnnotations finds files with a Fact, Theory, Test, TestCase or TestMethod symbol` (`it.each`); `ignores other annotations and near misses` (`Facts`, `test`, `Trait`); `the classifier treats an annotated file as a test file whatever its path` (`src/Lending/LoanChecks.cs`); `backslash paths match the annotated set`.
  - `computeAndWriteContextsView leaves a file whose only test mark is a Fact annotation out of the view` (synthetic indices with three linked production files and `src/Lending/LoanChecks.cs` holding a `Fact`-annotated method linked to them).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/test-files src/cli/__tests__/index-contexts-view.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS; then `pnpm --filter @ctxo/cli test:unit`.
- [ ] **Step 5: Commit.** Stage the Files block paths; `git commit -m "feat(core): test files recognised by test-framework annotations (#156)"`.

---

### Task 16: Docs, help, peer ranges, changeset and full verification

**Files:**
- Create: `docs/features/domain-knowledge.md`, `site/docs/languages/sql.md`, `.changeset/plugin-protocol-v2-and-sql.md`
- Modify: `docs/index.md`, `docs/plugins.md`, `docs/roadmap.md`, `CHANGELOG.md`, `llms.txt`, `llms-full.txt`, `CLAUDE.md`, `README.md`
- Modify: `site/docs/.vitepress/config.ts` (Languages sidebar: SQL after Java), `site/docs/languages/overview.md`, `csharp.md`, `writing-a-plugin.md`, `site/docs/reference/edge-kinds.md`, `symbol-ids.md`, `config-schema.md`, `site/docs/concepts/dependency-graph.md`, `logic-slices.md`, `blast-radius.md`, `site/docs/cli/install.md`, `config-yaml.md`, `site/docs/mcp-tools/get-architectural-overlay.md`, `get-blast-radius.md`, `search-symbols.md`, `find-importers.md`, `get-symbol-importance.md`, `site/docs/reference/response-envelope.md`
- Modify: `packages/lang-typescript/package.json`, `packages/lang-go/package.json`, `packages/lang-java/package.json`, `packages/lang-csharp/package.json` (peer ranges)
- Modify (only when the option is missing): `.changeset/config.json` (`onlyUpdatePeerDependentsWhenOutOfRange`, Step 1)

- [ ] **Step 1: Widen the peer ranges (no dependency on the staged release).** Set `peerDependencies["@ctxo/plugin-api"]` of the four existing plugins to `^0.7.3 || ^0.8.0 || ^0.9.0`, whatever they read now (`^0.7.3`, or `^0.7.3 || ^0.8.0` once the staged release has landed), and confirm lang-sql's is `^0.8.0 || ^0.9.0`. Check `.changeset/config.json`: if it lacks `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange: true`, add exactly that key and value in this commit (the staged release adds the same ones, so merging it later is a no-op); without it changesets gives every peer dependent a major bump for a plugin-api minor, in range or not. Do not stop to ask the owner. Record in the PR description draft that the peer ranges and the plugin-api version must be re-checked at release time.
- [ ] **Step 2: Feature doc** `docs/features/domain-knowledge.md` (the doc later PRs extend): data coupling as a concept; protocol v2 (kinds, annotations, facts on request, capabilities); lang-sql (what it indexes, the rules, v1 limits: T-SQL only, `dbo` default, top-level DML skipped, `ALTER TABLE ADD` columns only in the defining file); SQL at C# call sites (the API table, constants only, make SQL visible with `const`, `static readonly` stays invisible, needs .NET and lang-sql); the contexts-view fields and `contextsView.weights.data`; the degradation rows of spec 13.2 that this PR implements; the corpus and how to add a case. Link it and ADR-017 from `docs/index.md`.
- [ ] **Step 3: Roadmap and plugins.** `docs/plugins.md` gains the lang-sql row and a protocol v2 note. `docs/roadmap.md`: a shipped bullet under "Code intelligence"; deferred rows with triggers for NoSQL and messaging (ADR-017), SQL dialects beyond T-SQL and a configurable default schema, top-level DML as edges, `ALTER TABLE ADD` columns across files, ORM and query-builder data access, Dapper `CommandDefinition` and non-constant SQL (trigger: fixture or user evidence of missed edges).
- [ ] **Step 4: CHANGELOG `[Unreleased]`.**
  - Added: protocol v2 (kinds, annotations, facts protocol, capabilities, `SUPPORTED_API_VERSIONS`), `@ctxo/sql-extract`, `@ctxo/lang-sql`, `ctxo install sql`, C# attribute annotations, SQL edges at C# call sites, `sharedTables` and `dataResources` in the contexts view, `index.facts`, `contextsView.weights.data`.
  - Changed: `reads`/`writes`/`executes` are confirmed blast-radius tiers, so the safe-edit gate also guards heavily used tables and procedures; C# users see a one-time change in their committed index JSON on the first re-index (annotations); data edges stay out of symbol-level communities and boundary violations; `.sql` symbols are never dead code; UTF-16 source files are decoded; the Roslyn helper rolls forward to newer .NET runtimes.
  - Fixed: a C# repository with a lone `.csproj` and no solution file now indexes in the Roslyn tier (the helper opened the project as a solution and found no symbols).
  - Compatibility: older CLIs skip the new kinds with a warning; `@ctxo/lang-sql` needs a CLI that accepts protocol v2.
- [ ] **Step 5: llms files, CLAUDE.md and README.** Package layout with sql-extract and lang-sql and protocol v2; the kind lists, `annotations` and `facts` in the index schema; the new config keys; the overlay fields; `ctxo install sql`; a "New in <release>" list in `llms.txt`, where `<release>` is the version `pnpm changeset status` reports (expected 0.13 if the staged release lands first). CLAUDE.md: the package count, the architecture tree, "Plugin Architecture" (v2, the sql-extract exception), "Index JSON Schema" kinds, the config block. README: the SQL row in the language table.
- [ ] **Step 6: Site docs.** The new SQL language page (install, what it indexes, rules, C# interplay, limits); C# page (annotations, SQL call sites, .NET roll forward); writing-a-plugin (v2 surface, capabilities, lowest-version rule); edge kinds, symbol IDs, dependency graph and logic slices (new kinds, 2-part data references); blast radius concept and tool page (data tiers); config pages (`index.facts`, `contextsView.weights.data`); install page (`sql`, `tsql`); overlay page (`sharedTables`, `dataResources`, example with synthetic names); search, importers and importance pages (kind enums); envelope page (the source caps: `dataResources` at 50 with `dataResourcesTotal`, `sharedTables` at 15 with `sharedTableCount`; neither is a truncatable field).
- [ ] **Step 7: Help.** `pnpm --filter @ctxo/cli build && node packages/cli/dist/index.js --help`. Expected: the `ctxo install sql` line.
- [ ] **Step 8: Changeset** `.changeset/plugin-protocol-v2-and-sql.md`: `"@ctxo/plugin-api": minor`, `"@ctxo/cli": minor`, `"@ctxo/lang-csharp": minor`, `"@ctxo/sql-extract": minor`, `"@ctxo/lang-sql": minor`, `"@ctxo/lang-typescript": patch`, `"@ctxo/lang-go": patch`, `"@ctxo/lang-java": patch`, `"@ctxo/lang-java-analyzer": patch` (version lockstep with lang-java), with a three-sentence note naming #156 Phase 1. Run `pnpm changeset status --verbose`. Expected: those bumps, `@ctxo/plugin-api` at its next minor, and no `major` for any dependent (the widened ranges contain the new plugin-api version and the Step 1 option is on). A `major` on a `lang-*` package means the option is missing or a range does not contain the new version: fix that, never the bump type.
- [ ] **Step 9: No em dashes.** `git diff -U0 HEAD -- docs CHANGELOG.md llms.txt llms-full.txt CLAUDE.md README.md site .changeset packages/*/README.md | LC_ALL=C.UTF-8 grep -nP '^\+.*\x{2014}'`. Expected: no output.
- [ ] **Step 10: Full verification.** `pnpm install --frozen-lockfile && pnpm -r build && pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm --filter @ctxo/cli test:e2e`. Expected: all green, including the tarball test (raise the limit per Global Constraints if crossed); `pnpm --filter @ctxo/sql-extract pack --dry-run` and `pnpm --filter @ctxo/lang-sql pack --dry-run` list only `dist/`, `README.md` and `package.json`.
- [ ] **Step 11: Commit.** Stage the Files block paths; `git commit -m "docs: protocol v2, data coupling and lang-sql docs, peer ranges and changeset (#156)"`.

---

### Task 17: Fixture acceptance (private, nothing committed)

Everything runs in the private fixture clone (path in the owner's brief), never in its original checkout. Outputs and scripts stay in the session scratchpad.

- [ ] **Step 1:** `pnpm install && pnpm -r build` in the worktree, so the CLI's devDependency links `@ctxo/lang-sql`. In the clone keep PR 1A's private `.ctxo/config.yaml` but drop `cochange.include: ["**/*.sql"]` (lang-sql now indexes those files). Run `node <worktree>/packages/cli/dist/index.js index`. Expected: success, `Plugin sql@...` and the C# full tier in the log.
- [ ] **Step 2: Inventory (aggregate):** table, view, procedure and function symbols; data edges by kind; external resources; the `sql` stats of the Roslyn batch; objects defined in more than one file (the tie-break count).
- [ ] **Step 3: Oracle comparison** with a scratchpad-only script: Ctxo's tables (defined plus external) against the oracle's 72, procedures against its 29, and per-unit access (oracle units by table) against Ctxo's accesses mapped to the same units. Explain every difference by category: non-constant SQL, SQL outside known call sites, string literals that are not SQL (the oracle scans them all), aliases or comments misread by the oracle's regexes, 3- and 4-part names, temp tables and CTEs.
- [ ] **Step 4: Contexts view:** `ctxo contexts --json` to the scratchpad; tables shared by two or more candidates are listed with owners or several writers; externals listed. Expected: at least one shared table if the oracle shows units sharing tables; otherwise explain.
- [ ] **Step 5: Annotations:** count test methods carrying `Fact`, `Theory` or `Trait` annotations, and test files excluded from the view by annotation (aggregate only).
- [ ] **Step 6: Determinism and cost:** index twice more. Expected: byte-identical `contexts-view.json` and identical `symbols`/`edges` in the `.sql` JSON. Record the index duration against the PR 1A run.
- [ ] **Step 7:** Write the aggregate numbers, the explained differences and the RollForward observations (Task 12) into the PR description draft in the scratchpad. Nothing from the fixture enters the repo.
