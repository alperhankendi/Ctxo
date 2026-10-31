# ADR-017: Plugin Protocol v2, Data Coupling and Facts

| Field | Value |
|---|---|
| **Status** | Accepted (0.13); addendum for TypeScript, Java and Go language parity (PR 1C) |
| **Date** | 2026-10-22 |
| **Deciders** | Alper Hankendi |
| **Decision** | Ship plugin protocol v2 in `@ctxo/plugin-api` 0.9.0 with data kinds (`table`, `view`, `procedure`; `reads`, `writes`, `executes`), typed symbol annotations and an opt-in facts channel; add `@ctxo/sql-extract` and `@ctxo/lang-sql`; extract constant SQL at known C# call sites with ScriptDom; and report data coupling in the contexts view without letting it drive clustering. |
| **Relates to** | [#156](https://github.com/alperhankendi/Ctxo/issues/156), [ADR-012](adr-012-plugin-architecture-and-monorepo.md), [ADR-016](adr-016-co-change-engine-and-snapshot-policy.md), [domain knowledge layer spec](../../superpowers/specs/2026-10-20-domain-knowledge-layer-design.md) (section 8) |

---

## Context

The contexts view (PR 1A) groups files into candidate bounded contexts from imports, calls and co-change. In codebases that share a database, the strongest coupling between contexts is often the data they touch, and no import edge shows it. Two services can look independent in the graph while both write the same table.

Three gaps stand in the way:

1. **The protocol has no data vocabulary.** Symbol kinds stop at `function | class | interface | method | variable | type`, and edge kinds at `imports | calls | extends | implements | uses`. A table, a view or a stored procedure cannot be represented, and neither can an edge that reads or writes one.
2. **Symbols carry no structured metadata.** Attributes such as `[Fact]`, `[Trait("Category", "Loans")]` or `[HttpGet("/loans")]` say what a method is for (a test, an endpoint, a category), but the index drops them. Test-file recognition falls back to file-name globs, which misfire.
3. **There is no channel for code facts.** Later phases (domain rules, detectors) need small, line-level observations such as literal comparisons or retry timeouts. The protocol has nowhere to carry them and no way for the host to ask for them only when needed.

Plugins also cannot learn from the host whether SQL extraction is worth doing: a C# repo with no `.sql` plugin should not get edges to resources that cannot exist.

---

## Decision

### 1. New kinds (K3)

`@ctxo/plugin-api` exports the lists from spec section 8.2 verbatim:

```ts
export const SYMBOL_KINDS = ['function', 'class', 'interface', 'method', 'variable', 'type',
                             'table', 'view', 'procedure'] as const;
export const EDGE_KINDS = ['imports', 'calls', 'extends', 'implements', 'uses',
                           'reads', 'writes', 'executes'] as const;
export const DATA_RESOURCE_KINDS = ['table', 'view'] as const;
```

"Data coupling" is the concept. `DATA_RESOURCE_KINDS` is what core analyses use; they never test for the literal `table`. `@ctxo/lang-sql` stays a language plugin for `.sql` files (K3a): the name describes the file type, not the concept, so a future NoSQL schema language gets its own plugin rather than widening this one.

The cli drops its duplicate kind lists and imports these from `@ctxo/plugin-api`. Every place that enumerates kinds follows: `SymbolIdSchema`, `EdgeTargetSchema`, `EdgeKindSchema`, the MCP tool input enums and handler schemas, the blast-radius tier sets, `get_class_hierarchy`, `context-assembler.ts`, both visualizer color maps and the docs.

### 2. Annotations (K3)

| Field | Meaning |
|---|---|
| `name` | Annotation name as written, without namespace and without an `Attribute` suffix (for example `Fact`, `Trait`, `HttpGet`, `columns`). |
| `args` | Constant positional arguments, as strings. |
| `named` | Constant named arguments, as a string map. `named.type` is reserved for the fully qualified type name when the extractor knows it. |

`SymbolNode` gains an optional `annotations` array of this shape.

- **Always on.** Annotations are capped, additive and need no host request. C# users see a one-time change in their committed index JSON on the first re-index after upgrading, and the changelog says so.
- **Caps.** Host-language attributes, annotations and decorators follow the C# caps: 20 per symbol, 10 positional arguments and 10 named entries plus the reserved `type` each, 200 characters per value. A source argument named `type` is dropped in both C# tiers, so it never collides with the reserved key.
- **`columns`.** `@ctxo/lang-sql` emits a `columns` annotation on a table listing every column (sorted, lowercase). It feeds term collisions in the contexts view and is not subject to the host-language caps.
- **Validation.** Core validates shape only (Designer call 4): a string `name`, string arrays and a string map. It does not interpret meaning, so a plugin can add annotation names without a core release.
- **Test-file recognition (K38).** Test-framework annotations mark test files. The recognized names are `Fact`, `Theory`, `SkippableFact`, `SkippableTheory`, `Test`, `TestCase`, `TestCaseSource`, `TestFixture`, `TestMethod`, `DataTestMethod` and `TestClass`. When the index holds C# files with annotations, a file matched only by a name-based glob (`**/*Test.cs`, `**/*Tests.cs`) counts as a test only if it carries such an annotation. This removes the name-glob false positives. A repository whose C# files have no annotations in the index keeps the glob behavior.

### 3. Facts (K12)

```ts
export const FACT_KINDS = ['literal-comparison', 'normalization', 'retry-timeout', 'endpoint'] as const;
export interface CodeFact {
  readonly kind: FactKind;
  readonly symbolId: SymbolId;   // enclosing symbol
  readonly line: number;         // 0-based
  readonly text: string;         // single line, trimmed, at most 200 chars
  readonly detail?: Readonly<Record<string, string>>;
}
// ILanguageAdapter gains an optional method:
extractFacts?(filePath: string, source: string): Promise<CodeFact[]>;
```

- Produced **only on request**: the host sets `capabilities.facts` when `index.facts: true` is configured and, from PR 2B, when `@ctxo/domain` is installed. A plugin never extracts facts on its own initiative.
- Facts live in the file's index JSON only (`FileIndexSchema` gains `facts`). SQLite is unchanged.
- This PR lands the types, the schema and the plumbing. The detectors land in PR 4 (see the [addendum](#addendum-fact-detectors-pr-4)).

### 4. Capabilities

```ts
export interface PluginCapabilities {
  readonly facts?: boolean;         // host wants extractFacts
  readonly sqlCallSites?: boolean;  // host has a plugin for .sql loaded
}
// PluginContext gains: readonly capabilities?: PluginCapabilities
```

Capabilities are offered to every plugin through `PluginContext`; a plugin ignores the ones it does not use. `sqlCallSites` is set only when a plugin that handles `.sql` is discovered, so repositories without `@ctxo/lang-sql` get no edges to resources that cannot exist.

### 5. Versioning

- `SUPPORTED_API_VERSIONS = ['1', '2']`. `plugin-discovery.ts` accepts both. Version `'1'` stays accepted for at least 12 months after `'2'` ships.
- Versions gate loading only. Plugins declare the **lowest** version they work on (Designer call 2): the existing official plugins stay on `'1'`, and only `@ctxo/lang-sql` declares `'2'`.
- **Release (K40).** Protocol v2 ships in `@ctxo/plugin-api` 0.9.0, because the separately staged 0.8.0 release on protocol v1 lands first, and the CLI reaches 0.13 with this work. The existing plugins accept `^0.7.3 || ^0.8.0 || ^0.9.0`, so they install next to either release. `@ctxo/lang-sql` requires `^0.9.0`: plugin-api 0.8.0 (shipped with CLI 0.12.0) is protocol v1, and its loader cannot load a v2 plugin. PR 1B is rebased onto the staged release before merge, and `changeset status` must show no dependent receiving a major bump.
- A v1 plugin keeps working unchanged. A v2 plugin's kinds, annotations and facts survive the JSON round trip.

### 6. Data coupling

- **Tier.** `reads`, `writes` and `executes` are `confirmed` in the blast radius: a schema change breaks readers and writers directly.
- **Names.** Accesses from host languages point at a canonical 2-part name: lowercase, brackets stripped, default schema `dbo`, for example `dbo.loans::table`.
- **Resolution.** A 2-part reference matches any node whose kind is in `DATA_RESOURCE_KINDS` and whose name matches, regardless of whether it is a table or a view, because the host side cannot know which one it is. The same rule applies to procedures. When several files define the same object, one definition wins by a fixed ranking (see "Resolution ambiguity" below), so resolution stays deterministic.
- **Graph hygiene.** Data edges are kept out of symbol-level communities and out of boundary violations. `.sql` symbols are never reported as dead code, because their consumers may live outside the index.
- **Contexts view.** The view gains:
  - `sharedTables`: data resources accessed (read or written, directly or through a procedure) by files of two or more candidates, with the access modes per candidate.
  - Attribution (R4): a procedure body's reads and writes count for the candidates that execute the procedure, decided by its canonical name, and only a procedure that no candidate executes credits the candidate whose file holds it. With several definitions, the bodies that count are those of every production copy (outside test files and docs folders), or the winner's alone when no copy is production; docs and test copies of a procedure that has a production copy add nothing.
  - An ownership hint: the candidate that writes a resource, with several writers flagged.
  - External resources: resources referenced but defined in no `.sql` file.
  - `contextsView.weights.data`, default `0`. Shared tables are a boundary finding to show, not a reason to merge candidates.
  - Table, view and column names in the term harvest.
- **MCP response size (ruling F1).** The `mode: "contexts"` summary carries data coupling as counts only: `sharedTableCount` per candidate, plus `dataResourcesTotal`, `sharedResourcesTotal` and `externalResourcesTotal`. The `candidate: <id>` detail carries `sharedTables` (capped at 15, each with `accesses` capped at 10) and the candidate's own `dataResources` (capped at 15), each with totals. The caps alone could not meet the 8 KB fit, so the detail also uses a byte-budget fill: while it is larger than the response limit (`CTXO_RESPONSE_LIMIT`, default 8192 bytes), it drops the last entry by name from the longer of the two lists (`dataResources` on a tie), and the counts keep the totals; the tool description says that both lists hold fewer entries when the response limit requires. Both responses stay within the default 8 KB envelope. `contexts-view.json` keeps the full lists.

### 7. SQL extraction (K3, K10)

- **C# call sites.** The Roslyn helper parses constant SQL at known call sites with `Microsoft.SqlServer.TransactSql.ScriptDom`, driven by a data-driven API table: ADO.NET (`SqlCommand` constructor text, `CommandText` assignments, `CommandType.StoredProcedure`), Dapper (`SqlMapper` extension methods, and the `CommandDefinition` constructor's `commandText` with its `commandType` argument, added on fixture evidence as R1), `SqlBulkCopy.DestinationTableName` and EF Core raw SQL (`FromSqlRaw`, `ExecuteSqlRaw`, `SqlQueryRaw`). It runs only when `capabilities.sqlCallSites` is set. Only compile-time constants are used (literals, `const` fields, constant concatenation, verbatim and raw strings). Non-constant SQL is counted and logged at debug level, never guessed.
- **`.sql` files.** `@ctxo/lang-sql` uses the TypeScript tokenizer in `@ctxo/sql-extract`, not ScriptDom, so SQL-only repositories need no .NET.
- **Input bound.** `@ctxo/lang-sql` skips a `.sql` source larger than 5 MiB with one warning per file and no symbols, edges or facts. Parsing holds the whole token stream in memory, and an out-of-memory abort cannot be caught, so the bound keeps a data dump from crashing `ctxo index`.
- **Shared corpus.** The conformance corpus lives in `packages/sql-extract/corpus` (Designer call 1), one `<case>.sql` with a `<case>.expected.json` per case. The `@ctxo/sql-extract` tests run every case, and a dotnet-gated lang-csharp test runs the same cases through `ctxo-roslyn --sql-extract`. Both sides must agree.
- **SQL extraction rules (summary).**
  - Tokenizer: line and block comments, strings with doubled quotes and `N'...'`, bracketed and double-quoted identifiers, `GO` batch separators on their own line, semicolons.
  - Definitions: `CREATE [OR ALTER] TABLE | VIEW | PROC[EDURE] | FUNCTION` and plain `ALTER VIEW | PROC | FUNCTION`. Symbol id `<file>::<schema.name>::<kind>` with the canonical lowercase name; functions map to the existing `function` kind.
  - Accesses: `FROM` and `JOIN` tables are `reads`; `INSERT`, `UPDATE`, `DELETE`, `MERGE` targets, `TRUNCATE` and `SELECT INTO` are `writes`; `EXECUTE` is `executes`. Temp tables, table variables, CTE names and aliases are excluded, and `UPDATE alias ... FROM table alias` resolves to the table.
  - Top-level DML in migration or seed scripts (outside any definition) is skipped in v1; co-change still connects those scripts.
  - Dialect and default schema are constants in v1 (`tsql`, `dbo`). Configuration waits for the first non-T-SQL consumer.

### 8. Dependency exception (K18)

Language plugins import only from `@ctxo/plugin-api`. The exception: a language plugin may depend on a Ctxo-owned utility package that has zero runtime dependencies. Today that is only `@ctxo/sql-extract`. It is a library, not a plugin, and is never discovered. PR 1C makes the TypeScript, Java and Go plugins use it, and ADR-017 gets an addendum then.

### 9. Future path, not built (K3b)

NoSQL and messaging are not implemented here; the design leaves room for them.

- **NoSQL.** A `collection` kind. Resources are virtual nodes such as `@data/mongodb::loans::collection`. Host-plugin recognizers cover driver calls; EF Core `ToTable` and `[Table]` go through the same mechanism; config recognizers cover in-house wrappers. Schema languages such as CQL, Cypher and Prisma get their own language plugins.
- **Messaging.** `topic` and `queue` kinds with `publishes` and `subscribes` edges. Type-based buses point at the message class symbol. Named channels get virtual nodes such as `@msg/kafka::loan-events::topic`. Evidence lives in host plugins, context-map interpretation lives in `@ctxo/domain`, and AsyncAPI is a future language plugin.

---

## Consequences

**Positive**

- Shared-database coupling between candidate contexts becomes visible, with access modes and an ownership hint.
- Annotations give test recognition, endpoint discovery and categories a structured source, and fix name-glob false positives for tests.
- Facts and capabilities give later phases a request-driven channel without taxing every index run.
- v1 plugins keep working, and the kind lists have one source of truth in `@ctxo/plugin-api`.

**Negative and risks**

- **One-time C# index change.** The first re-index after upgrading rewrites committed index JSON for C# files because annotations are always on.
- **Older CLIs.** An older CLI reading a v2 index drops the new kinds and edges with a warning.
- **Core requirement.** `@ctxo/lang-sql` needs a v2 core and declares `^0.9.0` as its plugin-api peer, because plugin-api 0.8.0 is protocol v1.
- **Constants only.** SQL held in variables, built dynamically or kept in `static readonly` fields is missed. ORMs and query builders are not covered.
- **Roslyn fallback (K39).** The Roslyn helper gains a ScriptDom NuGet reference, restored for every C# user. If the restore or build fails (for example a private or offline feed that does not carry the package), `@ctxo/lang-csharp` falls back to the tree-sitter path. Symbols are kept, and the tree-sitter tier still emits attribute annotations, with literal arguments only (strings, numbers, booleans). Only the Roslyn-tier details (the resolved `named.type` and non-literal argument values such as enum constants, `typeof(T)` and arrays) and the SQL call-site edges are lost. `ctxo index` reports the syntax tier, and the `csharp_tier` doctor check probes `dotnet restore` of the helper and warns with the first error line and a fix hint.
- **Resolution ambiguity.** When several files define the same name, kind-agnostic matching picks one winner, and every data edge points at it. Amended after the fixture run (R2), where most multi-defined names had resolved to a docs or test copy under plain first-path-wins:
  - **Ranking.** A definition outside test files (by the default test globs; `index.tests` is not consulted) comes first, then one not under a `docs`, `doc` or `documentation` folder, then the codepoint-smallest symbol ID. The result does not depend on insertion order. Docs or test copies can also be left out with `index.ignore`.
  - **One identity.** Same-name copies share the winner's dependents. A reverse lookup (blast radius, importers, PR impact, the gate) of any copy, or of the 2-part reference such as `dbo.loans::table`, returns the winner's incoming edges, so every copy reports the same impact. Forward edges stay per copy: a procedure body in a later migration keeps its own reads and writes.
  - **Remaining cost.** Among production copies the codepoint-smallest path wins, which need not be the newest migration (`V10__` sorts before `V7__`). The contexts view is not affected by which production copy wins, because it takes the union of the production copies' bodies. The choice is deterministic, and the cost is accepted.
- **Runtime target.** The helper targets `net8.0` and declares `<RollForward>Major</RollForward>`, so the .NET host keeps using an installed 8.x runtime and rolls forward to the lowest newer major only when no 8.x is installed. What was observed: the built helper ran with `dotnet exec --fx-version` on .NET 8, 9 and 10 with identical output, and an integration test checks `rollForward: Major` in the built runtimeconfig and runs the helper on the newest installed runtime with `--fx-version`. A machine with no 8.x runtime at all was not tested.

---

## Alternatives considered

- **Embedded-fragment routing between plugins** (host plugin hands SQL strings to the SQL plugin). Rejected: it couples plugins to each other and needs a routing protocol; each side extracts with a shared corpus instead.
- **Cross-plugin edge ownership** (the SQL plugin owns edges that originate in C# files). Rejected: edges belong to the file that contains the call, which keeps incremental indexing and the JSON-per-file contract intact.
- **A ScriptDom helper for `.sql` files.** Rejected: it would require .NET in SQL-only repositories. The TypeScript tokenizer covers definitions and bodies, and the corpus keeps both sides aligned.
- **Data access as a default clustering weight.** Rejected: shared tables are a boundary finding, and merging candidates on them would hide exactly the coupling the view should show. `contextsView.weights.data` stays available at `0`.
- **Moving every official plugin to `'2'`.** Rejected: plugins declare the lowest version they work on, and forcing `'2'` would cut off hosts that only speak `'1'` for no gain.

---

## Addendum: language parity (PR 1C)

Date: 2026-10-23. Relates to [#156](https://github.com/alperhankendi/Ctxo/issues/156) (Phase 1 of the domain knowledge layer, K18) and [spec section 8A](../../superpowers/specs/2026-10-20-domain-knowledge-layer-design.md). PR 1C gives `@ctxo/lang-typescript`, `@ctxo/lang-java` (with `@ctxo/lang-java-analyzer`) and `@ctxo/lang-go` what PR 1B gave `@ctxo/lang-csharp`: SQL edges at known call sites, typed annotations, and test symbols with edges. Rule-to-test links become test-level, and reachability from tests works, in all four official languages.

Release: minors for `@ctxo/lang-typescript` (0.9.0), `@ctxo/lang-java` and `@ctxo/lang-java-analyzer` (0.11.0) and `@ctxo/lang-go` (0.10.0), plus an `@ctxo/cli` patch (0.13.1, for the `find_dead_code` test-file change and the `ctxo install sql` help line), as `pnpm changeset status --since=origin/master` reports with the PR's changesets. `@ctxo/sql-extract` and `@ctxo/plugin-api` get no release (only tests, the unpublished corpus and a JSDoc comment change).

### Scope

- **The same scope as C#** (spec 8A.1): raw SQL text at known call sites and stored-procedure calls, compile-time constants only, full tier only, emitted only when the host sets `capabilities.sqlCallSites` (a plugin for `.sql` files, today `@ctxo/lang-sql`, is loaded). Without `@ctxo/lang-sql`, no language emits `reads`, `writes` or `executes` edges.
- **ORM and query builders stay out in every language**, C# included: EF LINQ, JPQL and Spring Data derived queries, knex chains, Prisma model calls, TypeORM repositories, gorm model calls. They map entities rather than SQL text, and they stay deferred.
- **Canonical names.** The same 2-part form as C#, produced only by `@ctxo/sql-extract`: `reads` and `writes` point at `<schema.name>::table`, `executes` at `<schema.name>::procedure` (lowercase, brackets stripped, default schema `dbo`, for example `dbo.loans::table`). All four languages and `@ctxo/lang-sql` therefore resolve to the same nodes through the resolution rules of section 6.
- **Dependency exception (section 8).** The TypeScript, Java and Go plugins join `@ctxo/lang-sql` in depending on `@ctxo/sql-extract` (`workspace:^`, kept external in each bundle). A package test in each plugin limits its source imports to `@ctxo/plugin-api`, `@ctxo/sql-extract`, its own parsers (`ts-morph`, `tree-sitter`, `tree-sitter-java`, `tree-sitter-go`), Node built-ins and relative paths. No plugin imports from `@ctxo/cli`.

### Known-API tables and call-site matching

Each plugin holds its rows of the shared table as data (spec 8A.2), as the C# helper does:

| Language | Where call sites are found | APIs |
|---|---|---|
| TypeScript/JS | `@ctxo/lang-typescript`, in process with ts-morph | pg `query`; mysql2 `query`, `execute`; mssql `query` (call or tagged template), `execute` (procedure name); `knex.raw`; Prisma `$queryRaw`, `$executeRaw` and their `Unsafe` forms; TypeORM `query`; Sequelize `query`; better-sqlite3 `prepare`, `exec` |
| Java | the JDT analyzer reports them, `@ctxo/lang-java` parses | JDBC `Connection.prepareStatement`, `prepareCall` and `Statement.execute*`; Spring `JdbcTemplate`, `NamedParameterJdbcTemplate` and their `*Operations` interfaces; `EntityManager.createNativeQuery` (`javax` and `jakarta`); `@Query(value = ..., nativeQuery = true)`; MyBatis `@Select`, `@Insert`, `@Update`, `@Delete` |
| Go | ctxo-go-analyzer reports them, `@ctxo/lang-go` parses | `database/sql` `Query`, `QueryRow`, `Exec`, `Prepare` and their `Context` forms on `DB`, `Tx`, `Conn`, `Stmt`; sqlx `Select`, `Get`, `Queryx`, `NamedExec`, `MustExec` (methods and package functions); pgx v4 and v5 `Query`, `QueryRow`, `Exec`, including `pgxpool`; gorm `Raw`, `Exec` |

Each language matches a call site with the type information it has:

- **TypeScript: receiver provenance.** The in-memory ts-morph project has no library types (`node_modules` is not loaded), so a call `<receiver>.<member>` (also `?.` and the tagged-template form) counts only when a provenance walk ties the receiver to a module in the table. The walk follows imports (named, default, namespace and `import x = require`), `require('M')`, type annotations and initializers, destructuring, constructor parameter properties and `this` members (a `this` member also resolves through the enclosing class's `extends` clause), a class's `extends` clause, function return types, `import('M').T`, `export *` barrels and dynamic `import()`, for at most 8 steps and without revisiting a declaration. A step is one hop from an identifier to its declaration or import binding, and each barrel module followed costs one, with a cycle guard; unwrapping `await`, parentheses, `as`, `satisfies` and `!` is free. Relative modules missing from the in-memory project are read from disk for one `extractEdges` call and released after it, so an incremental run (the post-commit hook, `--files`, watch) gives the same SQL edges as a full run. Disk reads are limited to `.ts`, `.tsx`, `.js` and `.jsx` files and stay under `projectRoot`; a specifier with a backslash is refused, because it could escape the root on Windows. Constants: string literals, templates without substitutions, `+` and templates whose parts are all constant, and `const` bindings with an initializer in the same file or behind a relative import; a constant used more than once in one expression stays constant (a revisit costs no step). A tagged template's interpolations become the placeholders `@p0`, `@p1` and so on, and pg `{ text }` and mysql2 `{ sql }` config objects count. Edges start at the innermost exported function, method of an exported class, exported variable or test block; calls outside these scopes are skipped.
- **Java: receiver type, supertypes and imports.** The JDT analyzer matches the owner on the receiver's static type, the method binding's declaring class or any supertype. Without a binding (dependency JARs missing from the classpath), it takes the declared type of the field, local variable or parameter in the same compilation unit, resolved through the single-type imports or the same package. Annotation types (`@Query`, MyBatis) resolve through the binding, else through the imports. When the method binding resolves, a matched member whose first parameter is not `java.lang.String` is not a call site; without a binding, a `String` constant first argument decides. The SQL is the first argument (every argument of an all-`String` `batchUpdate`), and a JDBC escape `{call name(...)}` or `{? = call name(...)}` gives a procedure name. Constants come from JDT constant evaluation (literals, `static final` fields, concatenation, text blocks). Edges start at the enclosing method or constructor; a lambda belongs to its enclosing method.
- **Go: the callee's method object.** ctxo-go-analyzer resolves the callee through `go/types` to a `*types.Func`. Its receiver type (pointer stripped) names the owner, with the selection's receiver as a fallback. Matching covers the `Context` variants, both pgx major versions with `pgxpool`, the pgx v5 `Tx` interface and the `*sql.DB` methods promoted onto `sqlx.DB`. The SQL is the argument bound to the callee's first `string` parameter, and it is constant when `go/types` gives it a constant string value. A matching callee without a `string` parameter, such as a `*sql.Stmt` method (its text is read at `Prepare`), is not counted. A closure belongs to its enclosing function declaration.

### Analyzer protocol

- Both analyzers take `--sql-call-sites`, as the Roslyn helper does; the JDT analyzer honours it in batch and keep-alive modes. Without the flag, they report no call sites and no `sql` stats.
- With the flag, a file result carries `sqlCallSites`: `{ symbolId, line, text, kind }` records with a 0-based `line` (the Go analyzer converts from the 1-based `token.Position`) and `kind` `statement` or `procedureName`, sorted by line, then text, and omitted when empty. Java records sit in `FileResult.sqlCallSites`, Go records in `FileRecord.sqlCallSites`.
- The final summary line (`done` in the JDT analyzer, the summary record in ctxo-go-analyzer) gains `sql: { constant, nonConstant }`. Non-constant SQL is counted, never guessed; the adapters expose the counts through `getSqlStats()` and debug logging only, and the index stores nothing about them.
- What the `sql` stats count: in the JDT analyzer, a matched call whose first argument is not a constant, counted with a method binding when the first parameter is a `String`, and without one when the argument is `String`-typed (so the count does not depend on whether the classpath is present); in ctxo-go-analyzer, a matched callee whose `string` argument is not a constant. `@ctxo/lang-typescript` keeps the same two counters in process for every matched call site whose text is not constant. All three expose them through `getSqlStats()` (cumulative per adapter instance) and debug logging.
- **Encoding.** The JDT analyzer reads sources as UTF-8 on every JRE, and its keep-alive reads stdin as UTF-8. Its JSONL output escapes every non-ASCII character (`\uXXXX`), because on Windows the JVM writes stdout in the platform code page while the plugin decodes UTF-8; ASCII lines stay byte-identical. Non-ASCII annotation values and SQL names therefore arrive intact.
- This JSON is an internal protocol of each plugin, not part of the plugin API.
- **Parsing on the TypeScript side.** Each plugin turns call sites into edges with a short `sqlEdgesFromCallSites` module: `extractSqlAccesses(text, kind)` from `@ctxo/sql-extract`, then `reads` and `writes` edges to `<name>::table` and `executes` edges to `<name>::procedure`, from the call site's `symbolId`. Edges are unique by source, kind and target and sorted in codepoint order by the same keys, so analyzer output order never decides edge order. A call-site text longer than 1 MiB (1,048,576 characters) is skipped, for the same reason as the `.sql` input bound in section 7. In lang-java and lang-go the SQL edges are added after the adapter's existing 3-part edge filter, so the 2-part targets survive it, and in lang-go only the call site's `symbolId` takes the module prefix when `go.mod` sits in a subdirectory.

### Annotations

- **C#'s caps** (section 2): 20 annotations per symbol, 10 positional arguments, at most 10 named entries and 200 characters per value. `args` and `named` are omitted when empty, and a symbol without annotations has no `annotations` key. Annotations are always on, as in C#.
- **Reserved keys.** `named.type` stays reserved in every language, and no plugin in this PR sets it: a decorator property, a Java annotation member or a struct-tag key named `type` is dropped in TypeScript, both Java tiers and Go. `named.member` joins it, reserved only where a plugin emits it (TypeScript properties, Go struct fields): on an annotation that a property or field passes to its class, it holds the member's name, wins over a source key of the same name and does not count toward the 10 named entries. Java fields are symbols, so Java (like C#) keeps a source member named `member`. The `SymbolAnnotation` JSDoc in `@ctxo/plugin-api` names both keys (a comment change with no plugin-api changeset).
- **TypeScript decorators** on class and method symbols. `name` is the rightmost identifier of the decorator expression (`@nest.Injectable()` gives `Injectable`); `args` are the string-literal and no-substitution-template arguments; `named` holds the string-valued properties of object-literal arguments, the first occurrence winning. Property decorators attach to the class with `named.member`, after the class's own decorators, so `@Column({ name: 'member_id' })` on the property `memberId` gives `{ name: 'Column', named: { member: 'memberId', name: 'member_id' } }` on the class. Accessor and parameter decorators are ignored.
- **Java annotations** on types, methods and fields; every fragment of a field declaration gets the declaration's annotations, and `name` is the simple name in both tiers.
  - Full tier (JDT): the declared member values of the resolved annotation binding in source order, else the syntax with constant evaluation, so annotations survive a missing classpath. The `value` member (shorthand or explicit) goes to `args`, the other members to `named`. Declared values only, no defaults: strings as they are, numbers through `String.valueOf`, booleans as `true` or `false`, enum constants as `Type.MEMBER` and class literals as the qualified name (as written when unresolved). Arrays are flattened in `args` and joined with `,` in `named`; nested annotations and nulls are skipped.
  - Tree-sitter tier: `marker_annotation` and `annotation` nodes with string literals (Java escapes decoded, unicode and octal included) and string arrays; text blocks and non-string values are skipped, so a value such as `nullable = false` appears only in the full tier, and string constants and concatenation are not evaluated. In the full tier's syntax fallback, a number JDT cannot evaluate keeps its raw token (`10L`, `0x10`).
- **Go struct tags.** ctxo-go-analyzer emits raw `{ field, tag }` pairs on struct symbols, and one TypeScript parser (`reflect.StructTag` conventions: the first key wins, parsing stops at the first malformed pair) builds the annotations for both tiers, so the tiers agree by construction; the tree-sitter tier reads the tags itself. Each tagged field gives `{ name: 'tag', named: { member: 'LoanID', json: 'loan_id', gorm: 'column:loan_id;primaryKey' } }` on its struct. An embedded field is named by its type's last identifier, and untagged fields give nothing.
- **No new symbols** for TypeScript class properties or Go struct fields: their metadata rides on the class symbol. Java fields are symbols already, so their annotations stay on them.

### Test symbols

- **Go.** ctxo-go-analyzer loads packages with `Tests: true` and partitions them into production packages (exactly the set a load without tests gives) and test variants; test mains are dropped. The production passes run unchanged. A test pass analyses only `_test.go` files, each once, in the first test variant by ID that holds it, with `implements` and `extends` computed inside that variant, so a test fake can implement a production interface. Test functions become `function` symbols with `calls` edges. Reachability (`dead`, `hasMain`) still runs on production packages only, and `dead` never lists a test symbol.
- **TypeScript.** Test files are recognised by the TypeScript and JavaScript part of `DEFAULT_TEST_GLOBS` (`**/__tests__/**`, `**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`), reimplemented in the plugin because it cannot import the CLI. Since the `testGlobs` addendum below, the CLI hands the plugin the effective globs and this rule is only the fallback. In a test file, each `describe`, `it` or `test` block (also `suite`, `context`, `specify`, the `f` and `x` variants, and modifiers such as `.only`, `.skip`, `.each` and `.skipIf`) becomes a synthetic `function` symbol named by its title path, for example `LoanPolicy > renewal > extends by seven days`, and annotated `{ name: 'test' }`. A block without a callback (`it.todo`) is not a symbol.
  - Titles: a non-literal title keeps its source text; whitespace runs collapse to one space, runs of `:` collapse to one and a trailing `:` is dropped, an empty title becomes `(untitled)`, and a title is cut at 200 characters, so every ID splits into exactly three `::` parts. A path seen again in the file, or equal to the name of an exported function in it, gets ` #2`, ` #3` in source order, and children use their parent's final name.
  - Edges: a block's `calls` and `uses` edges come from its own callback minus nested blocks, so each `it` owns its edges and a `describe` keeps its hooks. The file's `imports` edges keep today's source.
- **Java.** The JDT analyzer already walks the whole project root except build folders, so test methods under `src/test/java` are method symbols today; this PR verifies that with a test and adds their annotations. A JUnit `@Test` gives the annotation `Test`, one of the test-framework names of section 2 (K38), so a Java file with a `@Test` method now counts as a test file through `filesWithTestAnnotations`, wherever it sits.

### Versioning and the corpus

- The three plugins keep `apiVersion: '1'` and PR 1B's peer range `^0.7.3 || ^0.8.0 || ^0.9.0`, by the lowest-version rule of section 5. An older CLI ignores annotations and never requests SQL edges, so the new plugin versions keep working with it.
- `@ctxo/lang-java-analyzer` takes the same minor as `@ctxo/lang-java`, so the JAR resolver's base-version check stays quiet.
- **Host-language corpus modes.** `packages/sql-extract/corpus` gains cases written in each host language: `<case>.<ts|java|go>.fixture` with a `<case>.expected.json` whose `mode` (`typescript`, `java` or `go`) matches the extension and whose `accesses` hold the union of the case's data edges by kind. These cases default to `sides: []`, so the sql-extract, lang-sql and ScriptDom tests never run them; only the matching plugin does (Java and Go against stub types for the library APIs), and the sql-extract corpus test checks pairing and modes. One statement case with the host languages' parameter placeholders (`?`, `$1`, `:name`, `#{x}`, `@p0`, `{0}`) runs on the sql-extract side only, because ScriptDom does not parse placeholders that are not T-SQL.

### Consequences

**Positive**

- Code that touches tables is visible in TypeScript, Java and Go, at the same canonical nodes as C# and `.sql` files, so blast radius and shared tables meet at one node across languages.
- Tests are symbols with edges in all four official languages: rule-to-test links become test-level, and reachability from tests works.
- Decorators, Java annotations and struct tags give endpoints, entities and test categories a structured source in every official language.

**Negative and risks**

- **One-time index change.** The first re-index after upgrading rewrites committed index JSON for TypeScript, Java and Go files, because annotations and test symbols are always on (SQL edges appear only with `@ctxo/lang-sql`). The changelog says so.
- **Tests are blast-radius dependents.** TypeScript test blocks and Go test functions now have edges into production code and count as its dependents, so the safe-edit gate may fire more often on well-tested symbols, as it does for C#.
- **find_dead_code.** The CLI's dead-code detector recognises test files with the shared test-file classifier (`DEFAULT_TEST_GLOBS` plus the files a test-framework annotation marks) instead of its own path patterns, which missed `_test.go`, `src/test/` and `.test.js` files. Unless `includeTests` is set, test symbols are never reported dead, even without outgoing edges, and production code called only from tests is not dead. In particular, find_dead_code no longer reports Go functions whose only callers are tests, as in the other languages. This CLI change ships in the `@ctxo/cli` patch, together with the new `ctxo install sql` help line.
- **Go full-tier cost.** Go full-tier runs load and type-check the test packages as well, so they take longer on modules with many tests.
- **Communities shift once.** Test symbols and their edges join the graph, so symbol-level communities shift once after the upgrade. Data edges stay out of communities (section 6).
- **`type` values are lost.** A decorator property, Java annotation member or struct-tag key named `type`, such as `type: 'int'` in a TypeORM `@Column`, is dropped to keep `named.type` reserved. A later minor can carry such values under another key.
- **Java edges stay type-level.** JDT `calls` and `uses` edges still start at the enclosing type, so a Java test method's own dependencies show at its class; data edges do start at the method or constructor.
- **Constants and provenance only.** As in C#, SQL built at runtime is missed. In TypeScript, a receiver that the provenance walk cannot tie to a listed module (a client passed through an untyped factory or a dependency-injection container, or more than 8 steps away) is missed, not guessed.
- **CI.** A `plugin-tests` job in `ci.yml` runs the TypeScript, Java and Go plugin suites, JUnit on both Maven profiles, `go test` and the cross-language e2e (`CTXO_PARITY_E2E=1`) with JDK 21, Go and a UTF-8 locale; that workflow ran none of them before.
- **Known limits.** TypeScript: union-typed receivers (`Pool | null`), getters or methods returning a pool, namespace imports of a relative module and numeric constants in templates are not followed. Java: without a method binding, subclass receivers (`LoanJdbc extends JdbcTemplate`) and `super.update(...)` are missed and array literals in `batchUpdate` are not expanded; MyBatis `<script>` and `${}` texts pass through as written. Go: the tree-sitter tier decodes interpreted tag literals with JSON rules, not Go unquote rules (raw-string tags agree), and reads exported structs only; build-tagged test files are not loaded, so the full tier gives them no symbols; user-defined interfaces (sqlc `DBTX`), method values and method expressions give no call sites; the sqlx `...Context` forms are not in the table. The feature doc lists them per language.

### Alternatives rejected

- **Library types through `node_modules` in ts-morph.** Slow, and install-dependent: the edges would depend on whether dependencies are installed, so committed index JSON would differ between machines and CI.
- **SQL parsing inside each analyzer.** Java and Go would each need a T-SQL parser of their own, so four parsers (with ScriptDom and `@ctxo/sql-extract`) would have to agree on the corpus, instead of one library serving TypeScript, Java, Go and `.sql` files.
- **New symbols for TypeScript properties and Go fields.** They would grow dead-code reports and communities with members that have no behaviour of their own; `named.member` on the class keeps the metadata.
- **Moving JDT `calls` and `uses` edges from types to methods in this PR.** It would change every Java file's edges and blast radius for a reason unrelated to parity. It stays deferred until the owner asks for it.
- **An edge helper inside `@ctxo/sql-extract`.** It would turn the two-function library of spec 8.5 into one that knows the plugin protocol's edge shape. Each plugin keeps a short `sqlEdgesFromCallSites` module instead; plugins share no code beyond `@ctxo/plugin-api` and `@ctxo/sql-extract`.

---

## Addendum: fact detectors (PR 4)

PR 4 lands the detectors that section 3 left for later (#156 Phase 4, spec 12.1, K12). The protocol is unchanged: `FACT_KINDS`, `CodeFact` and the optional `extractFacts` are as above, and the four official plugins stay on `apiVersion: '1'`.

### The evidence protocol

- **Evidence, then one finisher.** Analyzers and tree-sitter walkers report syntactic evidence records (`comparison`, `call`, `binding`, `duration`, `route`); `finishFacts` on each plugin's TypeScript side applies the trivial-literal list, evaluates numbers, builds `text` and `detail`, attributes evidence without a symbol to the innermost enclosing symbol (or the module symbol `<file>::<basename>::variable`), sorts, drops duplicates and keeps at most 500 facts per file. Both tiers of a language therefore agree by construction on everything both parsers see.
- **`--facts=<base64>`.** The Roslyn helper, the JDT analyzer and ctxo-go-analyzer collect evidence only with `--facts=<base64 of UTF-8 JSON { "normalizationMethods": [...] }>`, one argument, and report it as `factEvidence` in their per-file records (omitted when empty or without the flag). Analyzers apply only the normalization patterns and the retry and timeout name rule, to keep their output small. The JDT analyzer adds `"facts":true` to its `done` and `ready` lines; an older JAR ignores the flag, and `@ctxo/lang-java` then prints `analyzer too old for facts; run ctxo install java --full-tier` once.
- **`PluginContext.config.facts`.** The options reach plugins through the existing `config` record, under a host-reserved key: the CLI sets `config` to `{ facts: <FactDetectorOptions> }` only when facts are requested and a module declares options (the first module in load order wins), else `{}`. A plugin reads `trivialLiterals` and `normalizationMethods` with a per-field fallback to the spec lists. The options object and its lists are deep-frozen and shared by every plugin of a run; a plugin never mutates them.
- **`facts: []`.** An adapter with `extractFacts` that finds nothing now writes `facts: []`; an adapter without the method writes no key. The absent key is what tells `@ctxo/domain` to run its text scan for that file. The official plugins warn and continue: a fact extraction failure for a file is written to stderr and gives `[]`; an `extractFacts` that throws gets no key for that file.
- **Rules on the TypeScript side.** `fact-types.ts`, `fact-options.ts`, `fact-rules.ts` and `finish-facts.ts` are identical copies in `@ctxo/lang-csharp` (the master), `@ctxo/lang-typescript`, `@ctxo/lang-java` and `@ctxo/lang-go`, and `@ctxo/domain` carries the same rules for its text scan; a drift test fails when a copy differs. Each plugin adds its own `StringLiteralDecoder` for string forms other than a plain double-quoted literal (C# verbatim, interpolated, raw and `u8`; TypeScript single-quoted and substitution-free templates; Java text blocks; Go raw strings). Plugins share no code beyond `@ctxo/plugin-api` and `@ctxo/sql-extract`, so copying is the cost of that rule.
- **The conformance vectors.** `packages/plugin-api/conformance/fact-vectors.json` (in the published `files`, so third-party plugin authors can test against the copy in `node_modules/@ctxo/plugin-api/conformance/`) holds a `defaults` block, one array of `{ input, expected }` per rule (`canonicalNumber`, `isTrivialLiteral`, `isTrivialLiteralCustom`, `hasRetryTimeoutFragment`, `matchesNormalizationPattern`, `matchesNormalizationPatternCustom`, `normalizeFactText`, `capFactValue`, `detailLiteral`, `joinRoute`) and `languageSpecific.<language>` blocks run with that language's decoder. Every copy and the text scan are tested against them; the vectors, not prose, define the rules.

### Decisions

- **Retry and timeout names on token boundaries (G6, Q10).** A name matches a fragment when its ASCII tokens, read from the start of some token, begin with it. This is a deliberate narrowing of spec 12.1's "a name containing": `settlementDays` contains `ttl` and does not match. The vectors are the definition.
- **Typed trivial literals (G3).** Numbers, strings, booleans and `null`: the string `"0"` is not the number `0`. Number literals are compared as evaluated doubles, so `0.9999999` is not `1`.
- **Numbers.** Integer results print as digits; others round the exact double to 6 decimals, ties half away from zero (`BigDecimal(double)` with `HALF_UP` in Java, `big.Rat` in Go, never `FormatFloat`). Integer divisions with a remainder, leading-zero integers, `|v| >= 2^53` and results that round to 0 are not constants, because each language would read them differently.
- **Tier agreement.** Syntax tiers attribute facts with the IDs their full tier would give (fields, properties, private members). For this, the C# syntax tier now applies file-scoped namespaces, the Java syntax tier indexes the members the JDT tier indexes (and the JDT tier the members of enum constant bodies), and the Go syntax tier drops type parameters from receivers; each is a one-time ID change noted in its changeset. C#'s `(n)` parameter suffix stays on syntax-tier methods; fingerprints ignore it.
- **No `retry-timeout` facts in test files.** On the owner's precision measurement, the CLI drops that kind for files the shared test-file classifier marks as tests (in index and watch, one place), since plugins do not know the test-file rules. The check is per file and annotation-aware.
- **Watch parity.** `ctxo watch` loads the modules and requests facts and options as `ctxo index` does, so incremental runs never drop native facts.

## Addendum: test globs reach the plugins

`index.tests` globs reached the core's test-file classifier (contexts view, the module host) but not the plugins, so `@ctxo/lang-typescript` decided test blocks by its reimplementation of the default globs only, and a file that only an `index.tests` glob names had no test symbols.

- **`PluginContext.testGlobs?: readonly string[]`.** The CLI sets it in `ctxo index` and `ctxo watch` to the default test globs (`DEFAULT_TEST_GLOBS`, in order) followed by the valid `index.tests` globs in config order, each glob once: one frozen array shared by every plugin of the run. It is a plain field of the context, not a capability (it is data, not a host feature) and not a `config` key (`config` is per plugin; these globs are the same for all).
- **Matching.** picomatch with `{ dot: true }`, without negation, against the project-relative, forward-slash paths the adapter receives: the rules the core applies. A plugin that hands the globs to a helper process can forward them as data.
- **Compatibility.** The field is optional and needs no protocol version: a v1 or v2 plugin that ignores it keeps working, and a plugin on an older CLI (no field) uses its own default rule. `@ctxo/plugin-api` ships it as a patch release, so the official peer ranges (`^0.7.3 || ^0.8.0 || ^0.9.0`) stay as they are; the field is type-only.
- **TypeScript.** `@ctxo/lang-typescript` builds one matcher from the field (picomatch, `dot: true`) and uses it for test blocks, their `calls` and `uses` edges, SQL call-site scopes and fact owners. Absent field, or no usable glob in it, falls back to `isTestFilePath`. A non-string or non-compiling value is skipped, never thrown.
- **Other plugins.** Go needs no change: `_test.go` is the Go toolchain's rule, and the analyzer's test pass reads the test variants `go/packages` loads. Java and C# find tests by annotations (JUnit, TestNG, xUnit, NUnit, MSTest), not by path, so neither has a path check to replace.
- **Not changed.** The data-resource tie-break in the symbol graph still uses the default test globs (the graph has no config), and the CLI-side drop of `retry-timeout` facts in test files already used `index.tests`.
