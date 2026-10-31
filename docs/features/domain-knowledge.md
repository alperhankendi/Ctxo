# Domain Knowledge Layer

> [#156](https://github.com/alperhankendi/Ctxo/issues/156). Phase 1: data coupling, plugin protocol v2, `@ctxo/lang-sql` and language parity. Phase 2: the opt-in `@ctxo/domain` package (named contexts, `contexts-touched`, the fold guard, `verify-domain`, loader rules, boundaries and drift, discovery) and "Ctxo domain conventions v1", further down. Phase 3: [the domain graph](#the-domain-graph). Phase 4: [facts](#facts) in every official language, [the Deletion Test loop](#the-deletion-test-loop) and [the context map and rungs](#the-context-map-and-rungs).

## The problem this solves

Two services can look independent in the dependency graph while both write the same table. No import edge connects them, so an agent that changes one of them never learns that the other reads the rows it is about to reshape. The strongest coupling between bounded contexts in a shared-database codebase is often the data they touch, and until now Ctxo could not see it:

- The protocol had no data vocabulary: no table, view or stored procedure as a symbol, and no edge that reads or writes one.
- Symbols carried no structured metadata. `[Fact]`, `[Trait("Category", "Loans")]` or `[HttpGet("/loans")]` say what a method is for, but the index dropped them, so test files were recognised by file name alone.
- There was no channel for small code facts (literal comparisons, retry timeouts) that later phases need, and no way for the host to ask for them only when needed.

Phase 1 closes these gaps. The design record is [ADR-017](../architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md).

## Data coupling

"Data coupling" is the concept: code that reads, writes or executes the same database objects is coupled, whatever its imports say. Ctxo models it with three symbol kinds and three edge kinds:

| Kind | Meaning |
|---|---|
| `table`, `view` (symbols) | Data resources. Core analyses use `DATA_RESOURCE_KINDS` (`table`, `view`), never the literal `table`. |
| `procedure` (symbol) | A stored procedure. SQL functions map to the existing `function` kind. |
| `reads`, `writes` (edges) | From a method, procedure, view or function to a table or view. |
| `executes` (edge) | From a method or procedure to a stored procedure. |

Data edges point at a canonical 2-part name such as `dbo.loans::table` or `dbo.usp_closeloan::procedure`: lowercase (ASCII `A`-`Z` only), delimiters stripped, default schema `dbo`. The graph resolves a 2-part table or view reference to any `table` or `view` node with that name (the calling side cannot know which one it is), and a procedure reference to a `procedure` node. A reference that no indexed `.sql` file defines stays unresolved in the graph and appears as an external resource in the contexts view.

### Several definitions of one object

Repositories with migration history define the same object more than once: `CREATE OR ALTER PROCEDURE` again in a later migration, a copy of the schema in a docs folder, a test schema script. Every data edge points at one of them, the winner, chosen in this order:

1. a definition outside test files, by the default test globs (`index.tests` is not consulted: the graph has no config);
2. then one not under a folder named `docs`, `doc` or `documentation` (ASCII case ignored; folder names only, not the file name);
3. then the codepoint-smallest symbol ID, which is the first file in sorted path order.

The choice does not depend on the order in which files were read. Among production copies the codepoint-smallest path wins, which is not necessarily the newest migration (`V10__` sorts before `V7__`). Docs or test copies can also be left out of the index with `index.ignore`.

All copies of an object share one identity for impact questions:

- **Reverse lookups agree.** The full ID of any copy, or the 2-part ID (`dbo.loans::table`, `dbo.usp_closeloan::procedure`), gives the same answer in `get_blast_radius`, `find_importers` (direct and transitive), `get_pr_impact`, `get_context_for_task`, the safe-edit gate and `ctxo blast-radius`: the winner's dependents, because every data edge points at the winner. A `CREATE OR ALTER PROCEDURE` in a new migration therefore reports the callers of the procedure, not zero.
- **Forward edges stay per copy.** `get_logic_slice` on a copy's full ID walks that copy's own body, so a procedure body in a later migration keeps its own reads and writes. A 2-part ID walks the winner's body.
- **History.** `get_why_context` with a 2-part ID reports the history of the winner's file.

### What the data edges change elsewhere

- **Blast radius.** `reads`, `writes` and `executes` are `confirmed`: a schema change breaks readers and writers directly. Because the safe-edit gate counts `confirmed + likely` dependents, it now also guards heavily used tables and procedures.
- **Communities.** Data edges stay out of symbol-level communities, god nodes, cross-cluster counts and boundary violations. Data coupling is reported by the contexts view instead.
- **Dead code.** Symbols in `.sql` files are never reported by `find_dead_code`: their consumers may live outside the index.
- **PageRank.** `get_symbol_importance` runs on the whole graph, data edges included, so a table that many methods read ranks high.

## Plugin protocol v2

`@ctxo/plugin-api` carries the v2 surface. Everything is additive: a v1 plugin keeps working unchanged.

### Kinds

```ts
export const SYMBOL_KINDS = ['function', 'class', 'interface', 'method', 'variable', 'type',
                             'table', 'view', 'procedure'] as const;
export const EDGE_KINDS = ['imports', 'calls', 'extends', 'implements', 'uses',
                           'reads', 'writes', 'executes'] as const;
export const DATA_RESOURCE_KINDS = ['table', 'view'] as const;
```

The CLI imports these lists from `@ctxo/plugin-api`; it has no copy of its own. The MCP tool enums (`search_symbols.kind`, `get_symbol_importance.kind`, `find_importers.edgeKinds`) follow.

### Annotations

`SymbolNode` gains an optional `annotations` array:

```ts
export interface SymbolAnnotation {
  readonly name: string;                               // as written, no namespace, no "Attribute" suffix
  readonly args?: readonly string[];                   // constant positional arguments
  readonly named?: Readonly<Record<string, string>>;   // constant named arguments; named.type is reserved
}
```

- Always on. Annotations need no host request; they are capped and additive.
- Host-language attributes, annotations and decorators follow the C# caps: 20 per symbol, 10 positional entries and 10 named entries plus the reserved `type` each, 200 characters per value (longer values are truncated). `named.type` is reserved for the fully qualified type name when the extractor knows it, so a source argument that is itself named `type` is not kept.
- `@ctxo/lang-sql` emits a `columns` annotation on each table with every column (sorted, lowercase). It is not subject to the host-language caps.
- Core validates shape only. A symbol whose annotations are malformed is kept without them.
- Annotations live in the JSON index only. SQLite is unchanged.
- MCP output: `get_logic_slice` returns them on its nodes at `L4` only; `L1` to `L3` and `get_context_for_task` leave them out, so they do not crowd out dependencies. When the graph comes from the SQLite fallback instead of the JSON index, nodes carry no annotations at any level.

### Facts on request

```ts
export const FACT_KINDS = ['literal-comparison', 'normalization', 'retry-timeout', 'endpoint'] as const;
export interface CodeFact {
  readonly kind: FactKind;
  readonly symbolId: SymbolId;   // enclosing symbol
  readonly line: number;         // 0-based, like SymbolNode.startLine
  readonly text: string;         // single line, trimmed, at most 200 characters
  readonly detail?: Readonly<Record<string, string>>;
}
// ILanguageAdapter gains: extractFacts?(filePath: string, source: string): Promise<CodeFact[]>
```

Facts are produced only when the host asks for them: `index.facts: true` in `.ctxo/config.yaml` (no CLI flag), or an installed `@ctxo/domain` whose registry file exists (`domain.registry`, default `docs/domain/contexts.yaml`). Without a registry the package asks for nothing, so the index JSON has no `facts` key, as without the package. `ctxo index` and `ctxo watch` then call `extractFacts` on plugins that implement it and write the result into the file's index JSON under `facts`: a fact-capable plugin that finds nothing writes `facts: []`, and a plugin without `extractFacts` writes no `facts` key. Since PR 4 the TypeScript, C#, Java and Go plugins implement it; see [Facts](#facts) for what they detect.

### Capabilities

```ts
export interface PluginCapabilities {
  readonly facts?: boolean;         // index.facts: true
  readonly sqlCallSites?: boolean;  // a discovered plugin handles .sql
}
// PluginContext gains: readonly capabilities?: PluginCapabilities
```

The CLI computes capabilities from the discovered plugins before any `createAdapter` call and hands them to every plugin. A plugin ignores the ones it does not use. `sqlCallSites` is set only when a plugin that lists `.sql` is installed, so a C# repository without `@ctxo/lang-sql` gets no edges to resources that cannot exist.

### Versioning

- `SUPPORTED_API_VERSIONS = ['1', '2']`. The CLI loads plugins that declare either. `'1'` stays accepted for at least 12 months after `'2'` ships (ADR-012). The old `SUPPORTED_API_VERSION` export stays at `'1'` and is deprecated.
- Versions gate loading only: the CLI handles output identically for `'1'` and `'2'`. A plugin declares the **lowest** version it works on. The existing official plugins stay on `'1'`; only `@ctxo/lang-sql` declares `'2'`.
- An older CLI skips `@ctxo/lang-sql` with a warning (`unsupported apiVersion 2`), and when it reads an index written by a newer one it drops the symbols and edges of the new kinds with a warning.
- The official plugins accept `@ctxo/plugin-api` `^0.7.3 || ^0.8.0 || ^0.9.0` as a peer; `@ctxo/lang-sql` accepts `^0.9.0`, the first release with protocol v2.

### The one dependency exception

Language plugins import only from `@ctxo/plugin-api`. The exception: a plugin may depend on a Ctxo-owned utility package with zero runtime dependencies. Today that is only `@ctxo/sql-extract`, the T-SQL tokenizer and recognizers, used by `@ctxo/lang-sql` and, for SQL at call sites, by `@ctxo/lang-typescript`, `@ctxo/lang-java` and `@ctxo/lang-go`. It is a library, not a plugin, and it is never discovered.

## `@ctxo/lang-sql`

```bash
ctxo install sql        # or: ctxo install tsql
```

A syntax-tier plugin for `.sql` files (T-SQL), built on `@ctxo/sql-extract`. No database connection and no .NET: SQL-only repositories need nothing beyond Node.js. `ctxo init`, `ctxo doctor` (language coverage) and `ctxo index --install-missing` suggest it when the repository has at least 5 `.sql` files and they are at least 2% of its files (as `git ls-files` lists them). SQL has no manifest file, so a handful of scripts in a large code base does not trigger the suggestion; install the plugin yourself if you want them indexed.

### What it indexes

| Source | Becomes |
|---|---|
| `CREATE [OR ALTER] TABLE` | `table` symbol with a `columns` annotation |
| `CREATE [OR ALTER] VIEW`, `ALTER VIEW` | `view` symbol |
| `CREATE [OR ALTER] PROC[EDURE]`, `ALTER PROC[EDURE]` | `procedure` symbol |
| `CREATE [OR ALTER] FUNCTION`, `ALTER FUNCTION` | `function` symbol |
| `FROM`, `JOIN`, `APPLY`, `MERGE ... USING` tables in a body | `reads` edge |
| `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE TABLE`, `SELECT ... INTO`, `OUTPUT ... INTO` targets in a body | `writes` edge |
| `EXEC` / `EXECUTE` of a procedure in a body | `executes` edge |

Symbol IDs carry the canonical name: `db/lending.sql::dbo.loans::table`. The symbol `name` keeps the declared spelling without delimiters and without an added schema.

### The rules in short

- **Names.** One to four dot-separated parts; `[...]` and `"..."` delimiters are removed. One part gets schema `dbo`. Three- and four-part names, temp tables (`#t`), table variables (`@t`), CTE names, aliases and the `sys` and `information_schema` schemas are skipped. Only ASCII `A`-`Z` is folded, so `[dbo].[Ödünç Kaydı]` matches byte for byte on every side.
- **Bodies.** Accesses come from the body of a view, procedure or function. A body ends at the end of its `GO` batch, or at the next view, procedure or function definition when `GO` is missing. `CREATE TABLE` or `ALTER TABLE` inside a body is body text: it defines nothing and adds no columns.
- **Columns.** Column-list elements of `CREATE TABLE` (constraints and indexes excluded), plus `ALTER TABLE ... ADD` outside a body for a table defined in the same file.
- **Merging.** Two definitions of one object in a file merge into the first.
- **Text that is not code.** Comments, string literals and `GO` inside them never produce accesses. A leading byte order mark is ignored, and UTF-16 files saved by SSMS are decoded.
- **Not edges.** A call to a SQL function, dynamic SQL (`EXEC (@sql)`, `EXEC @proc`) and `EXECUTE AS`. A recursive procedure has no self edge. SQL objects carry no complexity metrics.

### v1 limits

- **T-SQL only**, with `dbo` as the default schema. Neither is configurable yet.
- **Size limit: 5 MiB.** A `.sql` file larger than 5 MiB is skipped: it gets no symbols, edges or facts, and `ctxo index` prints one warning for it (`skipped <file>: <n> MiB is over the 5 MiB SQL size limit`). Such files are usually data dumps or seed scripts, whose top-level DML gives no edges anyway, and parsing them could exhaust memory. Keep definitions in their own scripts, or leave a dump out with `index.ignore` to silence the warning.
- **Top-level DML is skipped.** An `INSERT` or `SELECT` outside any definition (a migration or seed script) produces no edges. Co-change still connects those scripts to the code that changes with them.
- **`ALTER TABLE ... ADD` columns count only in the defining file.** Columns added from another file are not attached to the table.
- **CTE scope.** A CTE name is skipped from its `WITH` to the next top-level `;` or the end of the batch. A table that reuses a CTE name later in the same batch without a `;` in between is therefore skipped by `@ctxo/sql-extract`, while ScriptDom (the C# side) reads it.
- Objects defined outside indexed `.sql` files exist only as external resources.

## SQL at C# call sites

With `@ctxo/lang-sql` installed (`capabilities.sqlCallSites`) and the C# plugin in its Roslyn tier (.NET SDK 8+), the Roslyn helper parses **constant** SQL at known call sites with `Microsoft.SqlServer.TransactSql.ScriptDom` and adds `reads`, `writes` and `executes` edges from the calling method or constructor to the same 2-part targets that `@ctxo/lang-sql` defines. A C# method and the stored procedure that touch `dbo.loans` meet in the graph.

| API | Where the SQL comes from | Procedure when |
|---|---|---|
| ADO.NET `SqlCommand` (`Microsoft.Data.SqlClient` and `System.Data.SqlClient`) | constructor argument `cmdText` | the command's `CommandType` is `StoredProcedure` in the same method |
| `CommandText` on `SqlCommand`, `DbCommand`, `IDbCommand` and their subtypes | simple assignment | the command's `CommandType` is `StoredProcedure` in the same method |
| Dapper `SqlMapper` extension methods whose name starts with `Query` or `Execute` | argument `sql` | the call passes `commandType: CommandType.StoredProcedure` |
| Dapper `CommandDefinition` constructor (for the `SqlMapper` overloads that take one) | argument `commandText` | the constructor's `commandType` argument, named or positional, is `CommandType.StoredProcedure` |
| `SqlBulkCopy.DestinationTableName` | simple assignment | never; the table is written |
| EF Core `FromSqlRaw` | argument `sql` | never |
| EF Core `ExecuteSqlRaw`, `ExecuteSqlRawAsync`, `SqlQueryRaw` | argument `sql` | never |

- **Constants only.** The text counts when the compiler knows it: string literals, `const` fields, constant concatenation, verbatim and raw strings. SQL built at runtime, interpolation with non-constant holes, parameters and `static readonly` fields are non-constant and produce no edges. Nothing is guessed.
- **Make SQL visible.** Declare it as a `const string`, not `static readonly string`:

  ```csharp
  private const string CloseLoanSql =
      "UPDATE dbo.Loans SET ClosedAt = SYSUTCDATETIME() WHERE Id = @id";   // visible: writes dbo.loans

  private static readonly string ActiveLoansSql =
      "SELECT Id FROM dbo.Loans WHERE ClosedAt IS NULL";                    // invisible: not a constant
  ```

- **EF placeholders.** EF Core composite-format placeholders (`{0}`, `{1}`) are rewritten to parameters (`@p0`) before ScriptDom parses the text.
- **Dapper lists.** `WHERE Id IN @ids` is rewritten to `IN (@ids)` before parsing.
- **CommandType** is recognised only on a local (`command.CommandType = CommandType.StoredProcedure`) and in an object initializer of the same method. `CommandText +=` (and `??=`) builds text at runtime and counts as non-constant.
- **Parse failures.** A constant that ScriptDom rejects adds no edges and never stops the batch.
- **Scope.** Call sites inside method and constructor bodies, the same scope as the other C# edges. For a `CommandDefinition`, the edge belongs to the method that constructs it.
- **Counts.** `DEBUG=ctxo:roslyn ctxo index` logs `Roslyn SQL call sites: N constant, M non-constant, K unparsable`.
- **Needs.** The .NET SDK 8+ (Roslyn tier) and `@ctxo/lang-sql`. The tree-sitter fallback gives no SQL edges.

## C# attribute annotations

`@ctxo/lang-csharp` reports the attributes written on each symbol as annotations, in both tiers:

- `name` is the attribute name as written, without namespace and without the `Attribute` suffix (`Fact`, `Trait`, `HttpGet`).
- Values in the Roslyn tier: strings and characters as their value, numbers in invariant culture, `true` and `false`, enum constants as `Type.Member`, `typeof(T)` as the type's display string, array arguments flattened, nulls skipped.
- In the Roslyn tier, `named.type` carries the attribute class's fully qualified name when it resolves. A source argument named `type` is dropped in both tiers, so it never takes that key.

Tier differences:

- Tree-sitter keeps literal arguments only (strings, numbers, booleans). Enum constants, `typeof(T)`, array arguments and other expressions are dropped there.
- In the Roslyn semantic path, an argument written with a parameter name (`name: "x"`) arrives in `args`, while the tree-sitter tier puts it in `named`. Consumers should not depend on which of the two holds such an argument.
- Roslyn formats real-number exponents its own way.

The first `ctxo index` after upgrading rewrites the committed index JSON of C# files once, because annotations are always on. Run that first index as a full `ctxo index`, not an incremental one: see the upgrade note under [test files](#test-files-recognised-by-annotations).

## Test files recognised by annotations

The contexts view leaves test files out. A file is a test file when a test glob matches it (the shared defaults plus `index.tests`) or when any symbol in it carries a test-framework annotation. The names match exactly:

`Fact`, `Theory`, `SkippableFact`, `SkippableTheory`, `Test`, `TestCase`, `TestCaseSource`, `TestFixture`, `TestMethod`, `DataTestMethod`, `TestClass`

- An annotated file is a test file whatever its path.
- A project's own attribute derived from one of these (`[LoanFact]` from `Xunit.FactAttribute`, at any depth) counts too in the C# Roslyn tier: the plugin resolves the attribute's base types and adds an annotation of the nearest known base after it, for example `{ name: "Fact", named: { type: "Xunit.FactAttribute", via: "Lending.Tests.LoanFactAttribute" } }`, so the name match above sees it. Look-alike names that derive from no test attribute (`[Factory]`) get nothing. The tree-sitter tier stays name-based.
- Once any C# file in the index carries annotations (the evidence that the annotating plugin ran), a file matched only by the name globs `**/*Test.cs` or `**/*Tests.cs` and without a test annotation becomes a production node. This removes the false positives of name-only matching, such as a production `LoanPolicyTests.cs` helper.
- Folder globs (`**/tests/**`, `**/*.Tests/**`, `**/*.Test/**` and the rest of the defaults) still decide on their own.
- A repository whose C# files have no annotations in the index keeps the plain glob behaviour.

Limitations, all fixed with an `index.tests` glob:

- Test classes that use only other attributes, for example FsCheck `[Property]`.
- In the C# tree-sitter tier (no .NET SDK, or a file Roslyn did not report): custom attributes derived from a known one (a project's own `[LoanFact]`, say), because that tier does not resolve base types; a `*Tests.cs` file outside the test folders that uses only such attributes becomes a production node.
- An unannotated `*Tests.cs` file in a bare capital `Tests/` or `Test/` folder: `**/tests/**` is case-sensitive, so that folder is not a default test glob.

**Upgrade note: run a full `ctxo index` after upgrading `@ctxo/lang-csharp`.** The version that resolves test attributes by base type also changes the endpoint facts of C# projects with route groups or base controllers, and so their shadow-spec fingerprints. An incremental run (`--files`, `--commit`, and so the post-commit hook) re-indexes only the changed files, so only those carry annotations at first. The contexts view already counts the index as annotated, and every `*Test.cs` or `*Tests.cs` file outside the test folders that has not been re-indexed yet becomes a production node until a full run.

```yaml
index:
  tests:
    - "**/Tests/**"
    - "src/Lending.Properties/**"
```

A JUnit `@Test` gives the Java annotation `Test`, one of the names above, so since the Java plugin reports annotations, a Java file with a `@Test` method counts as a test file wherever it sits (through the same annotation rule, `filesWithTestAnnotations`), not only under `src/test/`.

## Language parity: TypeScript, Java and Go

`@ctxo/lang-typescript`, `@ctxo/lang-java` (with `@ctxo/lang-java-analyzer`) and `@ctxo/lang-go` now do what `@ctxo/lang-csharp` does: they report annotations, index tests as symbols with edges, and, with `@ctxo/lang-sql` installed, add data edges for constant SQL at known call sites. A TypeScript repository, a Spring service and a Go module that touch `dbo.loans` meet the C# code and the `.sql` definitions at the same node. The design record is the [ADR-017 addendum](../architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md#addendum-language-parity-pr-1c).

### No SQL edges without `@ctxo/lang-sql`

SQL call sites are read only when the host sets `capabilities.sqlCallSites`, which it does only when a plugin for `.sql` files (today `@ctxo/lang-sql`) is installed. Without it, no language emits `reads`, `writes` or `executes` edges, so a repository never gets edges to tables that cannot exist in its graph. Annotations and test symbols need no capability: they are always on.

### SQL at call sites

Every language uses the same rules as C#: only compile-time constant SQL counts, ORM and query-builder calls are left out (knex chains, Prisma model calls, TypeORM repositories, JPQL and Spring Data derived queries, gorm model calls), and the text goes through `extractSqlAccesses` of `@ctxo/sql-extract`, so the targets are the canonical 2-part names (`dbo.loans::table`, `dbo.usp_closeloan::procedure`). Each plugin keeps its rows of the shared API table as data:

| Language | APIs | SQL text | Procedure name when |
|---|---|---|---|
| TypeScript / JavaScript | pg `query` (also a `{ text }` config object); mysql2 `query`, `execute` (also `{ sql }`); mssql `query` (call or tagged template), `execute`; `knex.raw`; Prisma `$queryRaw`, `$executeRaw` (tagged template) and `$queryRawUnsafe`, `$executeRawUnsafe`; TypeORM `query`; Sequelize `query`; better-sqlite3 `prepare`, `exec` | the first argument, or the tagged template | mssql `execute` (its argument is a procedure name) |
| Java | JDBC `Connection.prepareStatement`, `prepareCall` and `Statement.execute*`; Spring `JdbcTemplate`, `NamedParameterJdbcTemplate` and their `*Operations` interfaces (`query*`, `update`, `batchUpdate`, `execute`); `EntityManager.createNativeQuery` (`javax` and `jakarta`); Spring Data `@Query(value = ..., nativeQuery = true)`; MyBatis `@Select`, `@Insert`, `@Update`, `@Delete` | the first `String` argument (every argument of an all-`String` `batchUpdate`); the annotation's `value`, array elements joined with a space | the text is a JDBC escape, `{call name(...)}` or `{? = call name(...)}` |
| Go | `database/sql` `Query`, `QueryRow`, `Exec`, `Prepare` and their `Context` forms on `DB`, `Tx`, `Conn`, `Stmt`; sqlx `Select`, `Get`, `Queryx`, `NamedExec`, `MustExec` (methods and package functions); pgx v4 and v5 `Query`, `QueryRow`, `Exec`, including `pgxpool`; gorm `Raw`, `Exec` | the argument bound to the callee's first `string` parameter | never (an `EXEC` inside a statement still gives an `executes` edge) |

What counts as a constant:

- **TypeScript:** string literals, templates without substitutions, `+` and templates whose parts are all constant, and `const` bindings with such an initializer, in the same file or behind a relative import. A constant used twice in one expression stays constant. In a tagged template (mssql, Prisma), each interpolation becomes a placeholder `@p0`, `@p1` and so on, so `` prisma.$queryRaw`SELECT id FROM dbo.Loans WHERE member_id = ${memberId}` `` reads `dbo.loans`.
- **Java:** JDT constant evaluation: literals, `static final` constants, constant concatenation and text blocks.
- **Go:** a value that `go/types` gives a constant string: literals, `const` declarations and constant concatenation.

How the receiver is matched:

- **TypeScript: receiver provenance.** The in-memory ts-morph project has no library types (`node_modules` is not loaded), so a call `<receiver>.<member>` counts only when a walk ties the receiver to a module in the table: imports (named, default, namespace, `import x = require`), `require('pg')`, type annotations and initializers, destructuring, constructor parameter properties and `this` members (also through the enclosing class's `extends` clause), function return types, `import('pg').Pool`, `export *` barrels and dynamic `import()`. The walk takes at most 8 steps (each declaration hop or barrel module is one) and never revisits a declaration. Relative modules missing from the in-memory project are read from disk for that one file's extraction (`.ts`, `.tsx`, `.js` and `.jsx` only, never outside the project root), so the post-commit hook, `--files` and `ctxo watch` give the same SQL edges as a full `ctxo index`. Edges start at the innermost exported function, method of an exported class, exported variable or test block; calls elsewhere are skipped.
- **Java: receiver type, supertypes and imports.** The JDT analyzer matches the receiver's static type, the method binding's declaring class or any of their supertypes. When the dependency JARs are not on the classpath, it reads the declared type of the field, local variable or parameter in the same file and resolves it through the single-type imports or the package. With a method binding, a member whose first parameter is not `java.lang.String` is no call site; without one, the first argument decides when it is a `String` constant or `String`-typed. Edges start at the enclosing method or constructor; a lambda belongs to its method.
- **Go: the callee's method object.** ctxo-go-analyzer resolves the callee through `go/types`; its receiver type (pointer stripped) names the owner. The `*sql.DB` methods promoted onto `sqlx.DB` and the pgx v5 `Tx` interface match too. A matching callee without a `string` parameter (a `*sql.Stmt` method, whose text was read at `Prepare`) is not counted. A closure belongs to its enclosing function declaration.

**Full tier only for Java and Go.** The SQL text comes from the JDT analyzer (JRE 11+ and `@ctxo/lang-java-analyzer`) and from ctxo-go-analyzer (Go 1.22+); the tree-sitter tiers give no SQL edges. TypeScript has one tier, so its call sites are always read.

**Counts.** Non-constant SQL is counted, never guessed. The counts reach debug logging only (`DEBUG=ctxo:*`), never the index: TypeScript counts every matched call site whose text is not constant; the JDT analyzer counts a matched call whose first argument is not a constant (with a method binding when the first parameter is a `String`, without one when the argument is `String`-typed); ctxo-go-analyzer counts every matched call whose `string` argument is not a constant. Each analyzer's summary line carries them as `sql: { constant, nonConstant }`.

**Make SQL visible** by keeping it in a constant:

```ts
const CLOSE_LOAN = 'UPDATE dbo.Loans SET closed_at = now() WHERE id = $1';   // visible: writes dbo.loans
export async function closeLoan(pool: Pool, id: string) {
  await pool.query(CLOSE_LOAN, [id]);
}
```

### Annotations per language

All three follow the C# caps: 20 annotations per symbol, 10 positional arguments, 10 named entries and 200 characters per value; `args` and `named` are omitted when empty. `named.type` stays reserved in every language and none of these plugins sets it, so a decorator property, Java annotation member or struct-tag key named `type` is dropped (a TypeORM `@Column({ type: 'int' })` loses its `type`). `named.member` is reserved only where the plugin emits it, for metadata of a member that is not a symbol of its own:

| Language | Source | Annotation |
|---|---|---|
| TypeScript | decorators on classes and methods | `name` is the rightmost identifier (`@nest.Injectable()` gives `Injectable`); `args` are string-literal and plain-template arguments; `named` holds the string properties of object-literal arguments, the first occurrence winning. Accessor and parameter decorators are ignored |
| TypeScript | property decorators | on the class, after the class's own decorators, with `named.member`: `@Column({ name: 'member_id' }) memberId` gives `{ name: 'Column', named: { member: 'memberId', name: 'member_id' } }` |
| Java (JDT) | annotations on types, methods and fields | the simple name; the `value` member goes to `args`, other members to `named`; declared values only (no defaults): strings, numbers, `true`/`false`, enum constants as `Type.MEMBER`, class literals as the qualified name; arrays flattened in `args` and joined with `,` in `named`; nested annotations and nulls skipped |
| Java (tree-sitter) | the same | string literals and string arrays only |
| Go | struct field tags, in both tiers | one `tag` annotation per tagged field on its struct: `` LoanID string `json:"loan_id" gorm:"column:loan_id;primaryKey"` `` gives `{ name: 'tag', named: { member: 'LoanID', json: 'loan_id', gorm: 'column:loan_id;primaryKey' } }`; an embedded field is named by its type's last identifier; untagged fields give nothing |

Java fields are symbols of their own, so their annotations stay on them, and Java (like C#) keeps a source member named `member`. TypeScript class properties and Go struct fields do not become symbols.

### Test symbols per language

| Language | What becomes a symbol |
|---|---|
| TypeScript / JavaScript | In a test file (`**/__tests__/**`, `**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`), every `describe`, `it` or `test` block (also `suite`, `context`, `specify`, the `f` and `x` variants and modifiers such as `.only`, `.skip`, `.each`, `.skipIf`) becomes a `function` symbol named by its title path and annotated `{ name: 'test' }`. A block's `calls` and `uses` edges come from its own callback minus nested blocks, so each `it` owns its edges and a `describe` keeps its hooks. A block without a callback (`it.todo`) is not a symbol |
| Go | The full tier loads test packages too: functions and methods in `_test.go` files become symbols with `calls` edges (a test fake can `implements` a production interface). Reachability still runs on production packages only, so the analyzer's dead list never holds a test symbol |
| Java | Test methods under `src/test/java` were method symbols already; they now carry their annotations, and a `@Test` marks the file as a test file |

TypeScript test titles: a non-literal title keeps its source text; whitespace runs become one space, runs of `:` become one and a trailing `:` is dropped; an empty title becomes `(untitled)`; titles are cut at 200 characters. A path seen again in the file (or equal to an exported function's name) gets ` #2`, ` #3` in source order, and children use their parent's final name:

```text
src/loans/loan-policy.test.ts::LoanPolicy > renewal > extends by seven days::function
src/loans/loan-policy.test.ts::LoanPolicy > renewal > extends by seven days #2::function
```

The CLI hands every plugin the default test globs plus `index.tests` (`PluginContext.testGlobs`), so an `index.tests` glob such as `spec/**/*.check.ts` also makes TypeScript test blocks. With an older CLI, which does not set the field, only the default globs above count.

### What changes elsewhere

- **Blast radius and the gate.** Test blocks and Go test functions have edges into production code and count as its dependents, so the safe-edit gate may fire more often on well-tested symbols, as it does for C#.
- **Dead code.** `find_dead_code` recognises test files with the shared test-file classifier (the default test globs plus files a test-framework annotation marks) instead of its own path patterns, which missed `_test.go`, `src/test/java`, `*.test.js` and `*.test.tsx` files. Unless `includeTests` is set, test symbols are never reported dead, even without outgoing edges, and production code called only from tests is not dead. In particular, Go functions whose only callers are tests are no longer reported. Production code under a folder named `test/` or `src/test/`, and any file with a test-annotated symbol, is left out of the analysis as well.
- **Communities.** Test symbols and their edges join the graph, so symbol-level communities shift once after the upgrade. Data edges stay out of communities.
- **Java edges stay type-level.** JDT `calls` and `uses` edges still start at the enclosing type, so a Java test method's own dependencies show at its class; data edges start at the method or constructor.
- **Go full-tier cost.** Go full-tier runs load and type-check the test packages as well, so they take longer on modules with many tests.

### Limitations

- **TypeScript.** A receiver the provenance walk cannot tie to a listed module is missed, not guessed: a client passed through an untyped factory or a dependency-injection container, more than 8 steps away, a union-typed receiver (`Pool | null`), a getter or method that returns a pool, a namespace import of a relative module. Numeric constants in a template are not constant.
- **Java.** The tree-sitter tier keeps string values only (non-string values such as `nullable = false` appear only in the full tier), does not evaluate string constants or concatenation (escapes in literals are decoded). MyBatis `<script>` and `${}` texts pass through as written. Without a method binding (dependency JARs missing), subclass receivers (`LoanJdbc extends JdbcTemplate`) and `super.update(...)` are missed, and array literals in `batchUpdate` are not expanded. In the syntax fallback, numbers keep their raw token (`10L`, `0x10`) when JDT cannot evaluate them.
- **Go.** The tree-sitter tier decodes interpreted (double-quoted) tag literals with JSON rules, not Go unquote rules, so `\x41`, octal and `\a` escapes can differ from the full tier (raw-string tags, the usual form, agree); it reads exported structs only. Build-tagged test files (for example `//go:build integration`) are not loaded, so the full tier gives them no symbols. User-defined interfaces (sqlc's `DBTX`), method values and method expressions give no call sites, and the sqlx `...Context` forms are not in the table.

### Host-language corpus cases

`packages/sql-extract/corpus` holds cases written in each host language next to the SQL ones: `<case>.<ts|java|go>.fixture` with a `<case>.expected.json` whose `mode` (`typescript`, `java` or `go`) matches the extension and whose `accesses` hold the union of the case's data edges by kind. They default to `sides: []`, so the sql-extract, lang-sql and ScriptDom tests skip them; only the matching plugin runs them (Java and Go against the stub library types of the lending samples), and the sql-extract corpus test checks the pairing and modes.

**Adding one.** Write `<case>.ts.fixture` (or `.java.fixture`, `.go.fixture`) with synthetic library-lending names, write `<case>.expected.json` with `"mode": "typescript"` (or `java`, `go`) and the expected `reads`, `writes` and `executes`, each sorted, then run `pnpm --filter @ctxo/sql-extract test` and the plugin's suite: `pnpm --filter @ctxo/lang-typescript test`, `pnpm --filter @ctxo/lang-java test` with `CTXO_JDT_ANALYZER_JAR` pointing at a built analyzer JAR, or `pnpm --filter @ctxo/lang-go test` with Go on `PATH`. A Java or Go case that needs a library type the stubs do not have adds it to the stubs.

## Data coupling in the contexts view

`ctxo index` adds data coupling to `.ctxo/index/contexts-view.json` (see "Candidate contexts" in [architectural intelligence](architectural-intelligence.md) for the view itself):

| Field | Meaning |
|---|---|
| `dataResources[]` | Every table or view that a candidate file (members and assigned hubs) reads or writes, by name: `name`, `kind` (absent when external), `external`, `accesses` (per candidate, `modes` of `reads` and `writes`), `writers`, `owner` |
| `dataResources[].external` | No indexed `.sql` file defines it |
| `dataResources[].owner` | The only candidate that writes it; several writers leave it absent with more than one entry in `writers` |
| `candidates[].sharedTables[]` | The resources of this candidate that at least one other candidate also reads or writes, by name, with every candidate's access modes |

How access is counted:

- A `reads` or `writes` edge from a symbol in a candidate file records that candidate and mode. Edges from procedure bodies are the exception: they count through `executes`, below.
- **Procedure bodies count for the candidates that execute them.** An `executes` edge from a candidate's symbol to an indexed procedure adds that procedure's reads and writes to the candidate, following further `executes` edges transitively. An unresolved procedure adds nothing.
- **The production copies count.** When several files define the procedure ([several definitions](#several-definitions-of-one-object)), the executing candidate takes on the union of the bodies of every production copy, meaning every copy outside test files and outside `docs`, `doc` or `documentation` folders, not only the winner's. When no copy is production, it takes the winner's body alone. Docs and test copies of a procedure that has a production copy add nothing: their reads, writes and `executes` edges count for no candidate.
- **Executed means executed by name.** When any candidate executes `dbo.usp_closeloan`, directly or through another procedure, no copy of that procedure credits its own candidate, whichever copy won resolution.
- **A procedure nobody executes credits its own candidate.** When no candidate executes it, directly or through other procedures, the candidate whose file holds it takes on its reads and writes, as if it executed it. With several copies, that is the candidate of each production copy (or of the winner when no copy is production), and each takes on the bodies of all those copies. Procedures that only execute each other, with nothing outside the cycle executing them, each credit their own candidate.
- Reading a view does not expand to its tables.
- Unclustered files and test files are ignored; hubs count for their assigned candidate.

Without the `executes` rule, the candidate that holds a procedure script becomes a reader and writer of every table its procedures touch. On one production fixture that candidate accounted for most of the tables with several writers. The rule reduces the artifact but may not remove it: test files and unclustered files are not candidates, so a procedure that only test or unclustered code executes still credits the candidate that holds its script, and so does each other production copy of it that sits in a candidate file. A docs or test copy credits its candidate only when no production copy exists and it is the winner.

**Clustering weight.** `contextsView.weights.data` (default `0`) adds a third component to a file-pair weight: the data edges between two files (an accessor and the `.sql` file that defines the object), log-normalised like the dependency component. At the default, data access never pulls candidates together. Shared tables are a boundary finding to show, not a reason to merge candidates. Data edges never count as hub dependents and never appear in `crossEdges`.

**Coverage on SQL-heavy repositories.** At the default `weights.data` of 0, a `.sql` file joins the file graph's clusters only through co-change: its data edges carry no weight and SQL has no import or call edges. Scripts that never change together with other files stay unclustered and lower `coverage`. On one production fixture, such scripts lowered coverage noticeably while the candidates themselves stayed the same. If the number matters, leave those scripts out of the view with `contextsView.exclude`. Whether to change the default is open (see the [roadmap](../roadmap.md)).

**Terms and collisions.** Table and view names and table columns join the top-term harvest of the candidate whose `.sql` file they are in. A table takes part in collisions with its columns as members; names and members compare with ASCII case and `_` ignored, so `LoanItems` meets `loan_items`. Views appear in terms but not in collisions. A C# class and a SQL table with the same name (an entity `LoanItems` next to the table `dbo.loan_items`) can therefore appear as a collision when the class's members differ from the columns. That is often an entity mapped to its table rather than two meanings of one term, so treat such entries as possible noise (several collisions on one fixture were of this kind).

**Surfaces.**

- `ctxo index` prints `, <S> shared tables` at the end of its contexts line when any table is shared.
- `ctxo contexts` adds the shared table count to its header and to each candidate line that has any, then one `shared` line per shared resource with its accesses and `owner #<id>`, `several writers` or `read only`. `ctxo contexts --json` prints the full lists.
- `get_architectural_overlay({ mode: "contexts" })`: the summary carries counts only, `sharedTableCount` on each candidate that has shared tables, plus `dataResourcesTotal`, `sharedResourcesTotal` and `externalResourcesTotal`. With `candidate: <id>`, the detail adds `sharedTables` (the first 15 by name, each with up to 10 accesses, the asking candidate's own access always kept, plus `accessCount`) with `sharedTableCount`, and the candidate's own `dataResources` (the first 15 by name, each with its `modes`, `owner`, `writerCount` and `external`) with `dataResourcesTotal`.
- **Byte budget.** When the detail is still larger than the response limit (`CTXO_RESPONSE_LIMIT`, default 8192 bytes), trailing entries are dropped by name order from the longer of the two lists (`dataResources` on a tie) until it fits. The counts keep the totals. Neither list is a truncatable field of the envelope.

**Design note: artifact size.** For a table shared by k candidates, the artifact lists all k accesses under each of those candidates, so its size grows with k² for widely shared tables. The MCP responses are capped; the artifact keeps the full lists.

## Configuration

```yaml
index:
  facts: false             # true asks plugins for code facts (index JSON only); @ctxo/domain asks once its registry exists
  tests: []                # extra test-file globs
contextsView:
  weights: { dependency: 1.0, coChange: 1.0, data: 0 }
domain:                    # only read when @ctxo/domain is installed
  registry: docs/domain/contexts.yaml
  coverage: { unowned: warn }
  boundaries: { enforce: by-rung, blockingRungs: [bounded, boring] }
  rules: { idPattern: "^[A-Z][A-Z0-9]*-\\d+$", trackerPrefixes: [] }
  tests:
    ruleTraitKeys: [Rule]
    characterization:
      annotations: ["Trait:Kind=Characterization", "Tag:characterization"]
      paths: ["**/Characterization/**"]
      names: ["[characterization]"]
    contract:
      annotations: ["Trait:Kind=Contract", "Tag:contract"]
      paths: ["**/Contract/**", "**/Contracts.Tests/**"]
      names: ["[contract]"]
  rungs: { pinnedCoverage: 0.8 }
  facts:
    trivialLiterals: [0, 1, -1, null, true, false, ""]
    normalizationMethods: [ToLower*, ToUpper*, Trim*, Normalize, toLowerCase, toUpperCase, trim, strings.ToLower, strings.TrimSpace, equalsIgnoreCase]
    textScanExtensions: [.dart, .ex, .exs, .groovy, .kt, .kts, .php, .py, .rb, .rs, .scala, .swift]
  guard: { enabled: true, subagents: false }   # base: <ref> is optional
```

| Key | Default | Effect |
|---|---|---|
| `index.facts` | `false` | Sets `capabilities.facts`; plugins that implement `extractFacts` write `facts` into the index JSON. An installed `@ctxo/domain` requests facts whatever this says, once the `domain.registry` file exists |
| `contextsView.weights.data` | `0` | Weight of data edges in the contexts-view file graph |
| `index.tests` | `[]` | Extra test-file globs; the fix for the annotation limitations above. Plugins receive them with the defaults as `PluginContext.testGlobs` (TypeScript test blocks) |
| `domain.registry` | `docs/domain/contexts.yaml` | Path of the context registry, relative to the repository root |
| `domain.coverage.unowned` | `warn` | `warn` or `error`: severity of check 4b (unowned files) |
| `domain.boundaries.enforce` | `by-rung` | `by-rung` or `report`: severity of boundary violations |
| `domain.boundaries.blockingRungs` | `[bounded, boring]` | Rungs whose contexts make a violation an error in `by-rung` mode |
| `domain.rules.idPattern` | `^[A-Z][A-Z0-9]*-\d+$` | Shape of a rule ID |
| `domain.rules.trackerPrefixes` | `[]` | Issue-tracker prefixes; for these, plain text never links to a rule |
| `domain.tests.ruleTraitKeys` | `[Rule]` | `Trait` keys whose value is a rule ID |
| `domain.tests.characterization` | see above | `annotations`, `paths` and `names` that mark a characterization test (K13a, [conventions](#test-conventions-k13a)) |
| `domain.tests.contract` | see above | The same three lists for contract tests |
| `domain.rungs.pinnedCoverage` | `0.8` | Share (0 to 1) of a context's main paths that characterization tests must reach for `pinned` |
| `domain.facts.trivialLiterals` | `[0, 1, -1, null, true, false, ""]` | Literals that never make a `literal-comparison` fact; typed, so `"0"` is not `0` |
| `domain.facts.normalizationMethods` | the spec list | Method names for `normalization` facts: `Name`, `Name*` (prefix) or `q.Name` (only calls written `q.Name(...)`) |
| `domain.facts.textScanExtensions` | the list above | Extensions of tracked files no plugin indexes that the text scan reads (lower-cased, deduplicated) |
| `domain.guard.enabled` | `true` | `false` turns the fold guard off |
| `domain.guard.base` | unset | Base ref of the branch range, before the detected one |
| `domain.guard.subagents` | `false` | Also run the guard on `SubagentStop` |

Each invalid `domain:` key falls back to its default and is reported by `verify-domain` check 1 and by `ctxo doctor`.

## Graceful degradation

| Missing | Behaviour |
|---|---|
| JRE 11+ or `@ctxo/lang-java-analyzer` | The Java plugin runs its tree-sitter tier: annotations with string values only, no SQL call-site edges |
| Go 1.22+ (or no `go.mod` / `go.work`) | The Go plugin runs its tree-sitter tier: struct-tag annotations on exported structs and no SQL call-site edges |
| .NET SDK 8+ | No Roslyn annotations and no SQL call-site edges; the tree-sitter tier still emits attribute annotations, with literal arguments only. `ctxo doctor` (`csharp_tier`) passes at the syntax tier with a hint |
| The Roslyn helper cannot restore or build (for example a private or offline NuGet feed without ScriptDom) | The C# plugin falls back to tree-sitter: symbols and literal-only annotations are kept; Roslyn-tier details (resolved `named.type`, non-literal argument values) and SQL call-site edges are lost. `ctxo index` reports `C#: N files (syntax tier - the Roslyn helper failed, run "ctxo doctor")` and `ctxo doctor` warns (`csharp_tier`) |
| The Roslyn keep-alive of `ctxo watch` is gone (idle shutdown or crash) | The next re-index restarts it once. If the restart fails, the C# plugin falls back to tree-sitter, so watch never writes a C# file with zero symbols because the keep-alive stopped |
| `@ctxo/lang-sql` not installed | No SQL call-site edges in any language; no `table`, `view` or `procedure` symbols |
| No annotations in the index | Test files are recognised by globs alone, as before |
| An older CLI | Skips `@ctxo/lang-sql` with a warning and drops the new kinds from a newer index with a warning |
| `@ctxo/domain` | No domain tools, fields, commands or hooks; a known domain command name prints an install hint and exits 1, `ctxo domain-guard-hook` exits 0 without output |
| A domain registry | The domain commands print a hint and exit 0; no `context` fields appear |
| A plugin without facts (a v1 community plugin) | The text-scan fallback in `@ctxo/domain`, marked `source: "text"` |
| A language without an official plugin (Python and others) | A file-level text scan for facts (extensions in `domain.facts.textScanExtensions`) and rule IDs; no SQL edges, annotations or test symbols |
| .NET SDK, a JRE or Go (the syntax tiers) | Facts from the tree-sitter tier; they agree with the full tier's (C#'s `(n)` suffix is ignored by fingerprints) |
| `shadow-candidates.json` or `maturity.json` (never indexed with PR 4, or removed because the last `ctxo index` could not build them) | `find_shadow_specs`, `get_context_map` and `ctxo domain map / shadow-specs` answer with the hint to run `ctxo index` (the CLI faces exit 2) |
| `boundaries.json` | `get_context_map` answers with `boundariesKnown: false`, `bounded` not met, and a hint |

## Upgrade notes

- **One-time C# index change.** The first re-index rewrites the committed JSON of C# files (annotations). Make it a full `ctxo index` after upgrading `@ctxo/lang-csharp`: an incremental run gives annotations to the changed files only, and until a full run the contexts view treats unannotated name-only `*Test.cs` / `*Tests.cs` matches as production files.
- **Test folders named `Tests/`.** A bare capital `Tests/` or `Test/` folder is not a default test glob (`**/tests/**` is case-sensitive). If your test files live in one, add it to `index.tests`.
- **UTF-16 sources.** `ctxo index`, `--check` and `ctxo watch` now decode UTF-16 LE and BE files that start with a byte order mark. Their content hash changes once, so the first `ctxo index --check` after upgrading reports them stale until the next `ctxo index`. UTF-8 decoding is unchanged.
- **ScriptDom restore.** The Roslyn helper now restores `Microsoft.SqlServer.TransactSql.ScriptDom` from NuGet for every C# user, with or without `@ctxo/lang-sql`. If your feed cannot serve it, the plugin falls back to tree-sitter (see above); make the package reachable from your NuGet sources to keep the Roslyn tier.
- **.NET roll forward.** The helper targets `net8.0` with `RollForward` `Major`: the .NET host keeps using an installed 8.x runtime and rolls forward to a newer major runtime when no 8.x is installed. The built helper has been run with `dotnet exec --fx-version` on .NET 8, 9 and 10, and an integration test checks the `rollForward` setting and runs the helper on the newest installed runtime.
- **Lone `.csproj`.** A C# repository with one `.csproj` and no solution file now indexes in the Roslyn tier.
- **Facts in the index (PR 4).** C#, TypeScript, Java and Go repositories with `@ctxo/domain` and a registry file, or with `index.facts: true`, get a `facts` array (possibly empty) in every indexed file's JSON on the next re-index. Run a full `ctxo index` once after upgrading, and again after adding the registry: index entries written by an older CLI or before the registry existed, or left untouched by an incremental `--commit` run, carry no `facts` key, so their files get `text` candidates (the noisier text scan) until a full run rewrites them.
- **One-time TypeScript, Java and Go index change.** The first re-index after upgrading `@ctxo/lang-typescript`, `@ctxo/lang-java` or `@ctxo/lang-go` rewrites the committed JSON of their files: annotations and test symbols are always on, and SQL edges appear when `@ctxo/lang-sql` is installed. Make it a full `ctxo index`, so every file and every test symbol changes in one commit. Expect the safe-edit gate to fire somewhat more often on well-tested symbols, and symbol-level communities to shift once.

## The conformance corpus

`packages/sql-extract/corpus/` keeps the TypeScript and C# SQL parsers in agreement. It also holds host-language cases for TypeScript, Java and Go call sites (see [host-language corpus cases](#host-language-corpus-cases)). Each case is a `<case>.sql` file (UTF-8, LF, pinned by `.gitattributes`) with a `<case>.expected.json`:

```json
{
  "description": "Tables after FROM and JOIN are read; the aliases l and m are not tables.",
  "mode": "statement",
  "accesses": { "reads": ["dbo.loans", "dbo.members"], "writes": [], "executes": [] }
}
```

- `mode`: `"statement"` for SQL as code sends it (`extractSqlAccesses`, and ScriptDom on the whole text), or `"file"` for a script of definitions (`extractSqlDefinitions` with the union of body accesses, `@ctxo/lang-sql` through its adapter, and ScriptDom on the whole script).
- `sides` (optional): defaults to `["sql-extract", "scriptdom"]` for statement cases and `["sql-extract", "lang-sql", "scriptdom"]` for file cases. Only a case that is not valid T-SQL may leave out `scriptdom`.
- `definitions` (file mode only): sorted by name, then kind; `columns` only for tables.
- `accesses`: every key present, each list sorted.

The `@ctxo/sql-extract` and `@ctxo/lang-sql` tests run every case on their side. A lang-csharp integration test (it needs the .NET SDK 8+) runs the same cases through `ctxo-roslyn --sql-extract`, for LF and CRLF text.

**Adding a case.** Write `<case>.sql` with synthetic names (library lending: `dbo.loans`, `dbo.members`, `usp_CloseLoan`), write `<case>.expected.json` with the accesses you expect, then run `pnpm --filter @ctxo/sql-extract test` and `pnpm --filter @ctxo/lang-sql test`. With the .NET SDK installed, also run the lang-csharp tests so ScriptDom agrees. When the two parsers disagree on valid T-SQL, fix the parser, not the expectation.

## Named contexts and the domain package

`@ctxo/domain` is an opt-in package. It lets a team name its bounded contexts, say which paths and which markdown card each one owns, and keep cards in step with code. Ctxo supplies structure, linkage, verification and retrieval; it never writes domain text, calls an LLM or fetches external documentation (ADR-004 stands). The design record is [ADR-018](../architecture/ADR/adr-018-domain-knowledge-layer.md).

```bash
ctxo install domain      # installs @ctxo/domain at this CLI's version
ctxo init --domain       # config defaults, registry skeleton, fold guard hooks, skill
```

Without the package the core is unchanged: no domain commands, fields or hooks. With the package and no registry, the domain commands print a hint and exit 0, and no `context` fields appear.

`@ctxo/domain` and `@ctxo/cli` always share one version (a changesets `fixed` group). The CLI loads the package from the project's `node_modules`, then from next to the running CLI, and only a copy at the same `major.minor` loads. A mismatch warns and leaves the domain features off.

### The registry and named contexts

The registry is `docs/domain/contexts.yaml` (path configurable through `domain.registry`). It is the source of truth for context IDs, paths, cards and rungs:

```yaml
version: 1
contexts:
  - id: lending                       # kebab-case, unique, permanent
    name: Lending
    card: docs/domain/lending/domain.md   # optional only while the rung is fear
    paths: ["src/Lending/**", "src/Holds/**"]
    rung: pinned                      # fear | pinned | named | bounded | boring (the owner sets it)
    rulePrefix: LEND                  # optional; rule IDs in this card must use it
    contracts:                        # allowed crossings into other contexts
      billing: ["src/Billing/Api/IChargeService.cs"]
unowned:
  allow: ["src/Host/**"]              # files allowed to belong to no context
glossary: docs/domain/glossary.md     # default
contextMap: docs/domain/context-map.md   # default
```

- `paths` are globs over repo-relative forward-slash paths, matched by the same matcher the CLI uses everywhere (picomatch with `dot: true`).
- **Ownership.** Every indexed non-test source file belongs to at most one context. A file that matches two contexts is an error; a file that matches none is a warning by default and an error with `domain.coverage.unowned: error`, unless it matches `unowned.allow`.
- **Contracts.** `contracts.<target>` lists files (globs) in the target context that this context may depend on. An edge from context A into context B is allowed when its target file matches `A.contracts.B`. Edges into unowned files are allowed. Data resources are anchored to their defining `.sql` file, so contracts cover them through file globs.
- **Rungs** describe how far a context has come on the adoption ladder (see the end of this document). The registry is the source of truth; the context map must agree with it (check 9).

### `ctxo contexts-touched`

```bash
ctxo contexts-touched [--since <ref>] [--committed | --staged] [--json] [--check]
```

Lists the named contexts that a set of changes touched, and whether each is resolved.

- **Changes considered.** By default the committed range `merge-base(ref, HEAD)..HEAD` plus working-tree changes (staged, unstaged, untracked and not ignored). `--committed` restricts to the range (the guard uses it), `--staged` to the staged changes. Without `--since`, the base is `domain.guard.base`, else `merge-base(HEAD, origin/HEAD)`, else `main` or `master`.
- **Touched.** A context is touched when its paths contain a changed non-test file (the shared test-file classifier). Changed files that belong to no context are listed under `unowned`.
- **Statuses.** `card-changed` (the card file changed in the considered changes), `acknowledged` (a `Domain-Unchanged` trailer, see below), `unresolved`, and `no-card` (a context without a card, allowed at rung `fear`, has nothing to fold into and is never unresolved).
- `--check` exits 1 when anything is unresolved. Exit 2 means the registry has problems, the base cannot be found (in CI, check out with `fetch-depth: 0`) or git failed. With no registry it prints a hint and exits 0.

`--json` prints the report on stdout:

```json
{
  "mode": "all",
  "since": "origin/main", "base": "a1b2c3d", "head": "e4f5a6b",
  "contexts": [
    { "id": "lending", "files": ["src/Lending/LoanPolicy.cs"], "card": "docs/domain/lending/domain.md",
      "cardChanged": false, "acknowledged": { "commit": "9f8e7d6", "reason": "refactor only" },
      "status": "acknowledged" }
  ],
  "unowned": [], "unresolved": [], "warnings": []
}
```

`mode` is `all`, `committed` or `staged`; `warnings` carries unknown trailer IDs.

### The fold guard and the trailer

A team keeps a card current by folding behaviour changes back into it in the same branch. When behaviour did not change, a commit says so with a trailer:

```text
Domain-Unchanged: <id>[, <id>...] [(reason)]
```

- It is read with `git log --format=%(trailers:key=Domain-Unchanged,valueonly)`. The reason is the balanced parenthesised group that ends the value; the IDs are the comma-separated text before it.
- Only commits in the evaluated range count: the `--since` range for `contexts-touched` and `verify-domain`, the session's branch range for the guard. A trailer elsewhere in history acknowledges nothing.
- A card change in the range also resolves a context, and wins over an acknowledgement.
- Uncommitted work cannot be acknowledged, because a trailer lives in a commit. An empty commit that carries the trailer is fine (`git commit --allow-empty`), so an acknowledgement never needs a code change.
- An unknown ID in a trailer gives a warning, never an error.

**The guard.** `ctxo domain-guard-hook` (hidden) runs as a Claude Code hook on `SessionStart`, `Stop` and `TaskCompleted`; `ctxo init --domain` registers it. `SubagentStop` is off unless `domain.guard.subagents: true`. One command serves every event.

- **Scope.** It judges only the commits of the current session: `startHead..HEAD` (recorded at `SessionStart` in `.ctxo/.cache/domain-guard/<session>.json`), intersected with the branch range (`domain.guard.base`, else the merge base with `origin/HEAD`, else `main` or `master`; on the default branch itself, the unpushed commits `@{u}..HEAD`). Uncommitted work never blocks, and neither does history from earlier sessions or from other people: that is left to CI (`verify-domain --since`).
- **Decision.** It allows when `stop_hook_active` is true, when no context is unresolved, when the guard is disabled or the registry is missing, and when it already blocked this session for the same fingerprint (the HEAD SHA plus the sorted unresolved IDs). Otherwise it blocks once. `Stop` writes `{"decision":"block","reason":"..."}` to stdout and exits 0; `TaskCompleted` writes the reason to stderr and exits 2.
- **Fail-open.** Any internal error, malformed input, a missing session ID or a corrupt session file allows. When `startHead` is no longer an ancestor of HEAD (rebase, amend, reset), the record is re-anchored to HEAD and the turn is allowed.
- **Resolution.** Commit a card change, or any commit in the range carrying the trailer.

The reason names the contexts, up to three changed files each, the card, and the exact trailer line:

```text
ctxo domain guard: 1 context has committed changes without a card update.
- lending: 3 files (src/Lending/LoanPolicy.cs, ...)
  card: docs/domain/lending/domain.md (unchanged)
Update the card if behaviour changed (rules, decisions, contracts), then commit it.
If behaviour did not change, add this trailer to a commit:
  Domain-Unchanged: lending (reason)
```

Claude Code is the only client with the guard. Other clients get the `ctxo-domain-fold` skill (Cursor: `.cursor/rules/ctxo-domain-fold.mdc`), the generated loader rules and the CI gate.

### `ctxo verify-domain`

```bash
ctxo verify-domain [--since <ref>] [--boundaries by-rung|report] [--json]
```

The CI gate. It checks structure, never meaning.

| # | Check | Severity |
|---|---|---|
| 1 | Registry schema valid, IDs unique and kebab-case, rungs valid; the `domain:` config valid | error |
| 2 | Every context with a rung above `fear` has a card; every listed card exists | error |
| 3 | Every `paths` glob matches at least one indexed file | error |
| 4a | No file owned by two contexts | error |
| 4b | No unowned file outside `unowned.allow` | `domain.coverage.unowned`: `warn` (default) or `error` |
| 5 | Cards have the five template H2 headings in order | error |
| 6 | Rule IDs match `domain.rules.idPattern`, are unique across cards and match `rulePrefix`; IDs in structured test references exist in cards; every rule has a test link, a `Tests:` line or an `Untested:` line; `Tests:` and `Code:` files exist; a symbol ID in a card line that the index does not hold, and an unknown ID with a rule prefix in a production `rule:` comment, are warnings (see [check 6 and the graph](#verify-domain-check-6-and-the-graph)) | error |
| 7 | Relative links and heading anchors in cards resolve (external URLs are not fetched) | error |
| 8 | Generated loader files match what `ctxo domain rules` would write, and no hand-written file blocks an expected path | error |
| 9 | `context-map.md` has a table with `Context` and `Rung` columns that agrees with the registry (a missing file while contexts exist is a warning) | error |
| 10 | Boundaries: edges outside `contracts` | error for `blockingRungs` in `by-rung` mode, else warning |
| 11 | With `--since`: no unresolved touched contexts | error |
| 12 | Shadow-spec resolutions: a `shadow-specs.yaml` that does not parse is an error; an entry whose fingerprint matches no current candidate (stale), an entry naming an unknown rule, and a `shadow-specs.yaml` in a folder that belongs to no context are warnings (see [check 12](#verify-domain-check-12)) | error or warning |

- **Exit codes.** 0 when there are no errors (warnings allowed), 1 on errors, 2 on a missing index, a git failure (a base that cannot be found, with the `fetch-depth: 0` hint) or an internal error. With no registry it prints a hint and exits 0. CI never passes silently on an internal failure.
- **`--json` and stdout.** The JSON report (`registry`, `checks`, `summary`, `exitCode`) is printed on stdout only when the checks run. On exit 2 and on the no-registry path stdout is empty and the message goes to stderr, so a pipeline must read the exit code, not only stdout. The human report always goes to stderr.
- **Day one.** With the init skeleton (no contexts) or a partial registry, unowned files and a missing context map are warnings, so CI stays green until the team sets `domain.coverage.unowned: error`. Boundaries are computed from the current graph on every run; the stored artifacts are never read.
- **In CI.** `ctxo verify-domain --since origin/main` needs the base branch's history: use `actions/checkout` with `fetch-depth: 0`. See [CI integration](../../site/docs/reference/ci-integration.md).

### Generated loader rules

`ctxo domain rules --write | --check` generates one pointer file per context that has a card, so the agent reads the card before it edits the context's code. The `ctxo-context-` prefix keeps them apart from user rules and from the `ctxo-domain-fold` skill.

`.claude/rules/ctxo-context-lending.md`:

```markdown
---
paths:
  - "src/Lending/**"
  - "src/Holds/**"
---
<!-- generated by ctxo domain rules; do not edit -->
# Lending context
Before changing code under these paths, read `docs/domain/lending/domain.md` (rules, contracts, decisions).
If behaviour changes, update that card in the same PR. If it does not, add `Domain-Unchanged: lending (reason)` to a commit.
```

`.cursor/rules/ctxo-context-lending.mdc` carries the same text with front matter `description`, `globs: src/Lending/**,src/Holds/**` and `alwaysApply: false`; it is generated only when `.cursor/` exists.

- **Marker.** A file is generated when the marker is the first line after the front matter. A quoted marker deeper in a hand-written file does not count.
- **`--write`** creates missing files, rewrites outdated ones and deletes stale ones (generated files of a context that no longer exists). It never overwrites a file without the marker.
- **`--check`** exits 1 when a generated file is missing, outdated or stale, and also when a hand-written file without the marker sits at a path a generated file belongs at (it is `blocked`: rename or delete it, then run `--write`). Prefixed files without the marker elsewhere are reported as `foreign` and never checked.
- Claude Code loads a path-scoped rule when Read, Write or Edit touches a matching file (not Glob or Grep).

### Boundaries and drift by named context

When a registry exists, `ctxo index` runs a domain pass (Phase 2e, on every run that refreshes the product) and writes `.ctxo/index/domain/`:

| File | Holds |
|---|---|
| `contexts.json` | The file-to-context map, unowned and multiply owned files, files that moved between contexts through renames in the co-change window |
| `boundaries.json` | Cross-context edges by kind (allowed through a contract, or violations) and the violations under the configured mode |
| `history/` | One entry per commit with per-context metrics, a rotating history of 10 |
| `graph.json`, `shadow-candidates.json`, `maturity.json` | Written by later phases: [the domain graph](#the-domain-graph) and [the loop artifacts](#artifacts-of-the-loop) |

Each artifact carries a `ctxoArtifact` marker (`domain-contexts`, `domain-boundaries`, `domain-history`). The core index reader skips any JSON that carries one, and the writer refuses to delete one as a stale index entry. Artifacts are written only when their content changed.

- **Boundary modes.** `domain.boundaries.enforce: by-rung` (default) makes an edge outside the contracts an error when either context's rung is in `domain.boundaries.blockingRungs` (default `[bounded, boring]`) and a warning otherwise; `report` makes every violation a warning. The computation is the same in both modes and linear in edges. `verify-domain --boundaries` overrides the mode once; `ctxo init --domain --boundaries <mode>` sets it without the prompt.
- **What counts.** Edges whose source file is a test are skipped, and so are edges with an unowned or multiply owned end and unresolved name references (a data resource without an indexed definition). Both ends in one context count as internal.
- **Drift by named context.** The per-context share of cross-context edges (`crossShare`) is tracked over the per-commit history, with `distinctCommits` and a confidence (fewer than 3 low, 3 to 6 medium, 7 or more high). Files that moved between contexts through renames are listed with the commit and date.

### The `context` field and other additive fields

With `@ctxo/domain` and a registry, existing tools gain fields. Every one is additive and appears only then. Each is applied before the response envelope, so masking and truncation see it, and each is skipped when `contexts.json` was built from another registry text (a stale artifact never labels).

| Tool | Field |
|---|---|
| `search_symbols` | `context` on each result |
| `get_blast_radius` | `context` on each impacted symbol |
| `find_importers` | `context` on each importer |
| `get_logic_slice` | `context` on the root symbol (each root in a batch) |
| `get_pr_impact` | `context` on each changed symbol, and `contextBoundaryViolations`: edges that touch changed symbols and cross a boundary outside the contracts, with `from`, `to`, `edgeKind` and `severity` (capped at 50, with `contextBoundaryViolationsTotal` when cut) |
| `get_why_context` | `contextDrift` for the symbol's context: `crossShare` (`current`, `previous`, `delta`), `trend`, `movedFiles`, `distinctCommits`, `confidence` |

`context` is set only when exactly one context owns the symbol's file. A throwing enricher drops its fields, never the response. A core payload that holds a value JSON cannot represent (a `Date`, a `Map`) drops all enrichment with one warning.

With a domain graph, `get_blast_radius`, `get_why_context`, `get_context_for_task` and `get_pr_impact` gain seven more fields; see [Fields on core tools](#fields-on-core-tools).

### `ctxo init --domain`

```bash
ctxo init --domain                       # also the domain part
ctxo init --only domain                  # just the domain part
ctxo init --domain --boundaries report   # boundary mode without the prompt
ctxo init --skip domain                  # every part except domain
```

`domain` is the seventh `ctxo init` part (`rules,skills,guard,mcp,git-hooks,config,domain`). Without `--domain` or `--only domain`, init leaves the domain alone. The part:

1. needs `@ctxo/domain`: when it is missing, init installs it with consent (`--yes` accepts, `--no-install` never installs); without it the part is skipped with a warning and the run exits 1;
2. adds the `domain:` config defaults to `.ctxo/config.yaml`, asking for the boundary mode (existing values are never changed, comments are kept);
3. creates the registry skeleton (`version: 1`, `contexts: []`, no cards) when there is no file;
4. runs discovery, shows the proposal and asks for confirmation (`--yes` accepts);
5. runs the loader rules write when a context has a card;
6. registers `ctxo domain-guard-hook` for `SessionStart`, `Stop` and `TaskCompleted` in `.claude/settings.json` (Claude Code), and installs the `ctxo-domain-fold` skill for Claude Code and Cursor.

`--dry-run` lists every file the part would create or change and writes nothing.

### Discovery and the ID safeguards

Teams arrive with their own conventions: tracker keys shaped like rule IDs (`LEND-456`), existing test tags, their own test folders. Ctxo learns them by discover, propose, confirm. The config stays the single source of truth, so behaviour never shifts silently.

```bash
ctxo domain discover [--json] [--write]
```

It prints evidence and a proposed config, and writes only with `--write` (a merge into `.ctxo/config.yaml` that adds values and removes none). The printed config quotes every list value as a JSON string (`paths: ["**/Contract/**", "**/Contracts.Tests/**"]`), so the block is valid YAML to paste even with `**` globs. A wrong value, once written, stays until you remove it by hand, and discovery (and `ctxo doctor`) proposes it again until the evidence changes, so review before `--write`.

Run it first when you adopt the domain layer or tune its config. The rules block `ctxo init` writes into `CLAUDE.md` and the other instruction files says so in one line when the domain layer is set up (a `domain` key in `.ctxo/config.yaml` or the default registry `docs/domain/contexts.yaml`, both committed; otherwise a loaded `@ctxo/domain`) (both tiers; otherwise the block is unchanged), the `ctxo-domain-fold` skill says so, the `get_context_map` description names it, the `found: false` hints for no registry and no domain graph name it, and `get_context_map` (and `ctxo domain map`) adds a hint while `domain.rules.trackerPrefixes`, `domain.tests.ruleTraitKeys`, `domain.tests.characterization` and `domain.tests.contract` are all at their defaults and the last `ctxo index` found that discovery would add something. The index pass records that in `maturity.json` (`discovery: { addsSomething }`) from committed inputs only (its own index and change log and the tracked files, never local branch refs, since `maturity.json` is committed); a run without a change log (`--skip-history`) keeps the last result.

- **Rule IDs:** prefixes found in card headings; tracker-like keys (`\b[A-Z][A-Z0-9]{1,9}-\d+\b`) in commit subjects of the co-change window and in branch names (local and remote-tracking names count once). A prefix seen in at least 5 commits or branches is proposed as a tracker prefix, marked when it overlaps a rule prefix.
- **External IDs:** keys of a well-known external family (`ADR`, `BIP`, `CAPEC`, `CVE`, `CWE`, `EIP`, `GHSA`, `IEC`, `ISO`, `JSR`, `KEP`, `OWASP`, `PEP`, `RFC`) are references, not rule IDs: they are reported with their counts (`externalIds` in the JSON) and never proposed. They need no config: a plain mention never links as a rule ID, because only IDs that exist in a card link. (Listing a prefix in `trackerPrefixes` only turns such a key in a card decision into an external provenance reference.) A family that equals a card rule prefix is flagged (`overlapsRulePrefix`). Since 0.17 these families no longer appear in `trackerKeys`.
- **GitHub issues (#N):** subjects with an issue reference (`#N` at the start, a `(#N)` suffix or group, or `#N` after fixes, closes, resolves, refs, see, issue or pull request; a bare `step #1` does not count), with their share of all subjects and the count of `(#N)` squash suffixes, and branches named `N-slug` or `type/N-slug` (a year-like `release/2024-q1` does not count). When there are at least 5 references and they outnumber every tracker-key family, the line says "the issue tracker (GitHub); no config key needed". Evidence only.
- **Other identifiers:** lowercase `name-NN` branch families seen in at least 3 branches (runtime names such as `node`, `python` or `dotnet` left out), reported as "lowercase identifiers; not proposed". A family whose upper case is a card rule prefix, a tracker key in the evidence or a configured tracker prefix is marked "possible tracker key, lowercase" (Linear branches such as `user/eng-123-title` are lowercase). Never proposed.
- **Test tagging:** annotation keys used on test methods whose values look like IDs (proposed for `domain.tests.ruleTraitKeys`).
- **Test folders** that hold annotated tests but match no default glob (proposed for `index.tests`), Characterization and Contract folders, and ADR and spec folders.
- **Test kind markers** beyond folders, per kind (`testKindMarkers` in the JSON):
  - `Trait`, `Category`, `TestCategory` and `Tag` values in test files (qualified names such as `NUnit.Framework.Category` too) that equal the kind or end with it, optionally followed by `Test` or `Tests` (`Contract`, `StorageContract`, `ContractTests`; not `ContractRenewal`), proposed as `Trait:<Key>=<Value>` or `<Name>:<Value>` matchers for `annotations`. A matcher that would not match its own annotation (a value with `=`) is left out.
  - Custom test attributes with the kind directly before a test attribute ending (`StorageContractFact`, `StorageContractTheory`, `FeeCharacterizationTest`; not `DataContract` or `ContractTestBase`), proposed as annotation names.
  - Test source files named `*ContractTests`, `*ContractTest`, `*CharacterizationTests` or `*CharacterizationTest`, or in the dotted and snake-case forms (`*.contract.test.ts`, `*.contract.spec.ts`, `*_contract_test.go`), proposed as `paths` globs such as `**/*ContractTests.cs`. File-name patterns go to `paths`, not `names`, because a `names` marker matches test case names and declared titles only, never file or class names. A file named after a non-test class, interface or type of the index (`LoanContractTests.cs` next to a `LoanContract` class) tests an entity, so its glob is evidence only; one such file keeps the whole family out of the proposal. A tag value named after such a class (`Category("LoanContract")`) is no marker either.

  A value a configured matcher or glob already covers is not proposed.

```text
$ ctxo domain discover
Rule IDs
  card prefixes:      LEND (5 rules)
  tracker-like keys:  OPS in 12 commit subjects/branches
  external IDs:       CWE (7), ISO (1)   <- references, not rule IDs; no config needed
  GitHub issues (#N): 40 of 72 subjects (56%), 40 with a (#N) suffix; 2 branches   <- the issue tracker (GitHub); no config key needed
  other identifiers:  acme-NN in 3 branches   <- lowercase identifiers; not proposed
Test tagging          xUnit Trait keys in use: Category (3), Rule (1)
Test folders          no Characterization folders; no Contract folders
Test kind markers     contract: values Trait:Category=StorageContract (2); attributes StorageContractFact (2), StorageContractTheory (1); file names **/*ContractTests.cs (2)
                      StorageContractFact   <- not covered by domain.tests.contract.annotations
                      StorageContractTheory   <- not covered by domain.tests.contract.annotations
                      Trait:Category=StorageContract   <- not covered by domain.tests.contract.annotations
                      **/*ContractTests.cs   <- not covered by domain.tests.contract.paths
Provenance folders    docs/adr (1)

Proposed config (.ctxo/config.yaml)
  domain:
    rules:
      trackerPrefixes: ["OPS"]
    tests:
      ruleTraitKeys: ["Rule"]
      contract:
        annotations: ["Trait:Kind=Contract", "Tag:contract", "StorageContractFact", "StorageContractTheory", "Trait:Category=StorageContract"]
        paths: ["**/Contract/**", "**/Contracts.Tests/**", "**/*ContractTests.cs"]
  index:
    tests: []
```

`ctxo doctor` re-runs discovery later and only warns, for example when a new tracker prefix overlaps a rule prefix. It never edits config.

**Safeguards that hold with any config, or none:**

- A link is created only to an ID that exists in a card.
- "Unknown rule ID" errors come only from structured references (rule-key annotations, `rule:` comments and test titles that start with an ID of a known rule prefix), never from plain mentions.
- When a rule prefix is also a tracker prefix, only structured references count for that prefix; plain text never links.

### Global installs, one copy

A repository without `package.json` (a .NET repository, say) has nowhere to declare a devDependency. A global install is the supported path there:

```bash
npm i -g @ctxo/cli @ctxo/domain @ctxo/lang-sql
```

- `ctxo install` without a `package.json` installs globally and says so; `ctxo install domain` pins `@ctxo/domain` to the running CLI's version. Project-local installs in repositories with `package.json` keep working.
- When `ctxo init` runs from a global install in a project without `@ctxo/cli` in its `package.json`, it writes MCP entries that call the global `ctxo` binary instead of `npx -y @ctxo/cli`. It replaces only ctxo's own default npx entry, never a custom one.
- **`install_copies`** (doctor check). The MCP entries and the hooks should start the same copy of ctxo. The check warns, and never fails, when the hooks call `ctxo` and none is on PATH (they never run), or when the MCP entry is an npx entry pinned to a version that differs from the global CLI the hooks run (two copies: a package added to one is missing from the other). An unpinned npx entry shares the global copy and passes. It runs on every project; its message names `@ctxo/domain` only when the package is installed.

### Doctor checks

With `@ctxo/domain` installed, `ctxo doctor` adds three checks, all `pass` or `warn`, never writing a file:

| Check | Reports |
|---|---|
| `domain_registry` | Registry or `domain:` config problems, and every unknown key under `domain:` by dotted path with a "did you mean" suggestion for a near miss (`domain.boundaires (did you mean domain.boundaries?)`); "no registry" is a pass |
| `domain_agent_setup` | With contexts: the guard hooks missing from `.claude/settings.json` (`SubagentStop` too with `domain.guard.subagents`), a missing or outdated `ctxo-domain-fold` skill, loader rules missing, outdated, stale or blocked |
| `domain_conventions` | A tracker prefix that overlaps a rule prefix and is not in `domain.rules.trackerPrefixes`, or discovery proposing conventions the config lacks |

An unknown key is one the domain config does not read, such as a typo (`domain.rules.trackerPrefix`) or a key in the wrong section (`domain.trackerPrefixes`, which suggests `domain.rules.trackerPrefixes`; when several sections have a key of that name, all of them are listed, so `domain.paths` suggests both `domain.tests.characterization.paths` and `domain.tests.contract.paths`). An empty key reads `domain.""`. Nested sections are checked to the leaf (`domain.tests.contract.pathz`). The config still ignores the unknown key, as before, so the key you meant to set keeps its default value; the warning only names the unknown key. The known keys come from the defaults of the domain config, so a new key is known as soon as it has a default. Keys outside `domain:` are the core `config` check's job.

A repository with neither a `.claude/` nor a `.cursor/` folder is checked as a Claude Code setup, so it gets a standing `domain_agent_setup` warning until `ctxo init --only domain` registers the hooks and installs the skill. `ctxo doctor --fix` repairs the agent setup.

The bundled `ctxo-domain-fold` skill carries a version marker (`<!-- ctxo-skill v0.16 -->` in this release, which adds the `find_shadow_specs` step; v0.15 added the `get_domain_context` and `get_rule` step). A copy installed by an earlier release is reported as outdated until `ctxo init --only domain` or `ctxo doctor --fix` installs the new one.

## The domain graph

A card that nobody reads at the moment of a change does not protect the rule it states. With `@ctxo/domain` and a registry, `ctxo index` turns the cards and the glossary into a graph that links each rule to the tests that pin it and the code that implements it, each decision to its provenance, and each term to the identifiers that carry it. The core tools then put the relevant rules, cards and decisions in front of the agent while it works on the code, and two new tools answer domain questions directly. Ctxo still never writes domain text: every node is text a person wrote in a card, and every link is evidence found in the repository.

### Cards, the consumer contract

The card format is the contract between a team and Ctxo. Everything below is optional on top of the five template headings: a card with headings only is valid, and each element adds links when it is there.

```markdown
# Lending

## Language
- **Loan**: one book held by one member until its due date.
- **Fine**: an unpaid charge for a late return that Lending was told about.

## Rules and invariants
### LEND-03 A member holds at most five loans
Tests: `tests/Lending.Tests/LoanLimitTests.cs`
Code: `src/Lending/LoanLimit.cs`

The sixth loan is refused at the desk and online alike.

### LEND-04 A member with an unpaid fine cannot borrow
Untested: the unpaid-fine check has no test yet

## Boundary contracts
Lending asks Billing to charge a fine through the charge service only (`src/Billing/IChargeService.cs`).

## Decisions
- 2026-09-12: Loan limit raised from 3 to 5 (LEND-03). [spec](../../specs/loan-limit.md), #123, [ADR-007](../../adr/adr-007-loan-limit.md)
- 2026-10-01: Any unpaid fine blocks a new loan, whatever the amount (LEND-04). https://example.com/issues/45

## Open questions
- Should renewals count as new loans?
```

- **Rule headings.** `### <ID> <title>` under `Rules and invariants`. IDs are permanent. The rule text is the body under the heading, without its rule lines, up to the next heading of level 1 to 3. An H1 or H2 ends the `Rules and invariants` section, so a `### X-NN` heading after a stray H1 there is not a rule.
- **`Tests:` and `Code:` lines** at the start of a rule body: comma-separated, backticked, repo-relative values. A value is a file path (`src/Lending/LoanLimit.cs`) or a symbol ID (`src/lending/loan-limit.ts::canBorrow::function`, anything with `::`). For a plain test name write `file#Name` (`tests/Lending.Tests/LoanLimitTests.cs#RejectsTheSixthLoan`); `::` always means a symbol ID. The file part must be a file that exists; a directory does not count.
- **`Untested:` line**: why the rule has no test (it satisfies check 6 for that rule, and `get_pr_impact` reports the reason).
- **Term items**: list items starting with `**Term**` in `Language` (`- **Loan**: definition`). A definition can continue on indented lines.
- **Glossary items**: the same items anywhere in `glossary.md`, under any heading. `- **Loan** (context: lending): one copy lent to a member` adds a definition to the `lending` term; an item without `(context: <id>)` (or with an unknown id, which warns) is a repo-wide term.
- **Decision lines**: list items starting with an ISO date and a colon (`- 2026-09-12: ...`). Rule IDs written in the line link the decision to those rules. Relative links are provenance files; `#123`, URLs and tracker keys are external provenance strings. A nested list under a decision folds into it, so provenance written as a sub-bullet still counts.
- **Open questions**: list items, or the whole section as one question when it has no list.

"Ctxo domain conventions v1" (below) carries the same format; the `Code:` line, term items, decision lines and the glossary form are additions to it, and none of them asks for a code change, so no level of the adoption ladder does either.

### The graph

`ctxo index` writes `.ctxo/index/domain/graph.json` next to the PR 2B artifacts, with the marker `"ctxoArtifact": "domain-graph"` (the core index reader skips it, and only a marked file is ever overwritten or deleted). It holds:

| Node | ID | Holds |
|---|---|---|
| Context | `context:lending` | Name, rung, card, `rulePrefix` |
| Rule | `rule:LEND-03` | Title, text, card, line, `untested` |
| Term | `term:lending/member-account` | The term, its definitions (card or glossary origin), the identifier count. The key is the term lowercased with whitespace runs as `-`; repo-wide glossary terms use the context `*` |
| Decision | `decision:lending/2026-09-12-1` | Date, text, card, line; `n` counts that card's decisions of the same date in document order from 1 |
| Section | `section:<card>:<line>` | The other card sections (intro, contracts, open questions), for search only |

Links form one sorted `links` array; every link carries its `kind`, `from`, `to`, its `source` and, except term links, the location `at` (file, 1-based line) where the evidence is:

| Kind | Sources |
|---|---|
| `rule-test` | `annotation`, `category`, `test-title`, `rule-comment`, `mention`, `card-tests` |
| `rule-symbol` | `card-code`, `rule-comment` |
| `decision-provenance` | `card-link` (a markdown link), `card-text` (`#123`, a URL, a tracker key) |
| `decision-rule` | `card-text` |
| `term-identifier` | `symbol-name`, `table-name` (with `match`: `exact` or `partial`) |

Card values that resolve to nothing are kept in `unresolved` (`missing-file` or `not-a-symbol`). The graph also stores `registryHash` (the registry text it was built from) and `cardsHash` (the cards and the glossary).

- **What never reads it.** PageRank, communities, snapshots, dead code and the gate's percentiles work on the code graph only, so editing a card never shifts code clusters or blast-radius scores.
- **When it is rebuilt.** On every `ctxo index` that refreshes the product, including the post-commit hook's `ctxo index --commit HEAD`, also for a commit that changed only a card. `ctxo watch` runs no module pass and does not rebuild it. The file is written only when its content changed, and the same input gives a byte-identical file.
- **Staleness.** When the registry changed since the graph was built, the domain fields are left out and the tools answer with the hint to run `ctxo index`. When only cards or the glossary changed, the tools still answer from the graph and add `stale: true` and the hint `Cards or the glossary changed since the last "ctxo index"; run it to refresh rule links.`
- **Shared cards.** When two contexts name the same card, its rules belong to the first context by id, and `ctxo index` and `ctxo verify-domain` warn once. The other context still lists the card's terms, decisions and open questions, and counts them in its `decisionCount`.
- **Teammates on different analysis tiers.** Term links carry symbol IDs, and C# IDs differ between the Roslyn and tree-sitter tiers, so a committed `graph.json` can differ between machines in the same way the index JSON does.

### Linking rules to tests and code

A link is created only to an ID that a card defines. The test side:

| Framework | Annotation | Value |
|---|---|---|
| xUnit | `[Trait("Rule", "LEND-03")]`, with a key in `domain.tests.ruleTraitKeys` (default `Rule`) | The rule ID (source `annotation`) |
| NUnit | `[Category("LEND-03")]` | Starts with a rule ID (source `category`) |
| MSTest | `[TestCategory("LEND-03")]` | Starts with a rule ID (source `category`) |
| JUnit 5 | `@Tag("LEND-03")` | Starts with a rule ID (source `category`) |

- **The text scan of test files** finds rule IDs that exist in cards, with the variants `LEND-03`, `LEND03`, `Lend03` and `lend_03` at token boundaries. A hit links to the innermost indexed symbol spanning the line, else to the file. When the line declares a test (`it(`, `test(`, `describe(`, `t.Run(`, `@DisplayName(`, `[Fact(DisplayName =`), its title becomes the link's `testName` (source `test-title`); a `rule: LEND-03` comment gives `rule-comment`, any other hit `mention`. Without a captured title, `testName` is the linked symbol's name.
- **The card's `Tests:` line** gives `card-tests`; the card's `Code:` line gives `card-code`.
- **`rule:` comments in production code.** A comment `rule: LEND-03` in any comment style (`//`, `/* */`, `/** */`, `#`, `--`, a `*` line) in an indexed non-test file up to 1 MiB links the rule to code. It links to the symbol that starts within three lines below the comment (attributes and decorators count as part of the declaration) when that symbol sits inside the symbol that contains the comment, else to the innermost symbol spanning it. So the usual style, a comment right above a method, links the method and not its class, and a comment at the end of a short method body links that method, not the next one. Marker, `rule:` and ID must be on one line.
- **Symbol IDs that are not in the index.** A `Tests:` or `Code:` value with `::` that the index does not hold links to its file (`fallback: true`), and check 6 warns. C# IDs differ between the analysis tiers (Roslyn writes `Ns.LoanLimit.CanBorrow`, tree-sitter `Ns.LoanLimit.CanBorrow(1)`), so C# teams should prefer file paths in `Code:` lines.
- **Tracker safeguards.** With a rule prefix that is also a tracker prefix (`domain.rules.trackerPrefixes`), only structured references link: annotations, titles, `rule:` comments and card lines, never a plain mention. An unknown ID in a production `rule:` comment is a check 6 warning only when its prefix is a rule prefix, so `# rule: E501` in a linter comment stays silent.

### Decisions and provenance

- A relative link in a decision line is resolved against the card's folder to a repository file (`{ kind: "file", path, exists, label }`). A link that leaves the repository is kept as an external string and never read; a pure anchor (`#section`) and a folder are not provenance.
- `#123`, URLs and tracker keys with a configured `domain.rules.trackerPrefixes` prefix that are not rule IDs are external strings (`{ kind: "external", value }`), stored as written and never fetched (ADR-004).
- Rule IDs written exactly in a decision line link the decision to the rule, even when their prefix is also a tracker prefix (cards are curated text); only IDs that exist in cards link.

### Terms

A term links to identifiers whose name carries its words:

- The last `.` segment of a symbol name (namespaces and the C# parameter suffix dropped), split with the core tokenizer (camelCase and snake_case), must contain the term's tokens as a contiguous run, case-insensitively, with plural folding both ways (`s`, `es`, `y` to `ies`): `Loan` matches `LoanService` and the table `dbo.loans`, `Late fees` matches `LateFee`.
- A context term matches only symbols in non-test files of its own context; a repo-wide glossary term matches all non-test files. Namespace segments never match.
- Terms whose tokens are all shorter than three characters (`ID`) link nothing.
- At most 50 identifiers per term are stored (exact matches and types first), with the full `identifierCount`.

### Fields on core tools

With a valid graph, seven additive fields appear on four core tools, possibly empty. Without the package, a registry or a graph, or with a registry that changed since the last index, they are absent. Each list is capped at 50 at the source (`decisions` at five) with a `<name>Total` count when entries were cut, and none is truncatable, so the envelope always truncates the tool's own primary array.

| Tool | Field | Example (synthetic library-lending sample) |
|---|---|---|
| `get_blast_radius` | `rulesAffected`: rules linked to the root or an impacted symbol, root first, each with `via` (up to five `{ symbolId, link }`, `link` is `code` or `test`) and `viaCount` | `{ "ruleId": "LEND-03", "title": "A member holds at most five loans", "context": "lending", "card": "docs/domain/lending/domain.md", "via": [{ "symbolId": "src/lending/loan-limit.ts::canBorrow::function", "link": "code" }], "viaCount": 1 }` |
| `get_blast_radius` | `cardsToUpdate`: the cards of those rules, in registry order | `{ "context": "lending", "card": "docs/domain/lending/domain.md" }` |
| `get_why_context` | `decisions`: up to five decisions of the symbol's context with provenance, those naming a rule linked to the symbol first, each group newest first | `{ "id": "decision:lending/2026-09-12-1", "date": "2026-09-12", "rules": ["LEND-03"], "provenance": [{ "kind": "external", "value": "#123" }] }` |
| `get_context_for_task` | `cardExcerpt`: target rules (text up to 600 characters), neighbour rules (titles), terms, contracts, within the token budget | `{ "context": "lending", "rules": [{ "ruleId": "LEND-03", "linkedTo": "target" }], "terms": [{ "term": "Loan", "definition": "..." }], "tokens": 204, "omitted": 0 }` |
| `get_pr_impact` | `contextsTouched`: named contexts the change touched, with status, card and up to 10 files | `{ "id": "lending", "status": "unresolved", "cardChanged": false, "fileCount": 1, "files": ["src/lending/loan-limit.ts"] }` |
| `get_pr_impact` | `cardsChanged`: registry cards changed in the range or the working tree | `"docs/domain/lending/domain.md"` |
| `get_pr_impact` | `rulesWithoutTests`: rules of the touched contexts without a test link, with the `Untested:` reason | `{ "ruleId": "LEND-04", "context": "lending", "untested": "the unpaid-fine check has no test yet" }` |

- **`cardExcerpt` and the budget.** The domain module reserves up to a quarter of `tokenBudget` before the code context is packed, and the excerpt fills what the code context left, so `totalTokens + cardExcerpt.tokens` never exceeds `tokenBudget`. The excerpt is left out only when even an empty one does not fit (a very small `tokenBudget`); otherwise it is always present with a valid graph.
- **`get_pr_impact` and `since`.** The three lists use the change set of `ctxo contexts-touched` (the commits after the merge base of `since` and HEAD, plus the working tree), while `files` stays `git diff <since>`. When git cannot resolve `since`, the lists are left out with a warning.
- **Async enrichment.** `get_pr_impact` needs git for its fields, so module enrichers on the asynchronous tools (`get_blast_radius`, `get_why_context`, `get_pr_impact`) may return a Promise. `@ctxo/domain` bounds them at 5 seconds; a slower one leaves its fields out of that response.

### The two tools

Ctxo has 14 core tools; 18 with `@ctxo/domain` (these two plus [`find_shadow_specs` and `get_context_map`](#the-deletion-test-loop)). The two tools are registered whenever the package is loaded and answer `{ found: false, hint }` without a registry or a graph.

- **`get_domain_context({ symbolId?, path? })`**: the card of the named context that owns a symbol or file: the context (id, name, rung, card, paths), its terms with definitions and up to 15 identifiers each, its rules with up to 10 tests and 10 code links each (and the counts), contracts (outbound, inbound, the contracts text and its references), decisions with provenance and open questions. `symbolId` wins over `path`, its file part selects the context and the symbol need not exist; a card path selects that card's context. With neither parameter it lists every context with its counts.
- **`get_rule({ ruleId })`**: one rule (`LEND-03`; `LEND03`, `Lend03`, `lend_03` and the `rule:LEND-03` id of a domain-scope hit also match): its text and context, every test linked to it with the source of each link, the symbols that implement it, the decisions that mention it and their provenance, and the card values that did not resolve.

Their primary arrays (`contexts`, `terms`, `rules`, `openQuestions`, `tests`, `symbols`, `provenance`, `unresolved`) are truncatable with drill-in hints. See the [`get_domain_context`](../../site/docs/mcp-tools/get-domain-context.md) and [`get_rule`](../../site/docs/mcp-tools/get-rule.md) pages for full responses.

### The domain search scope

With the package, `get_ranked_context` gains `scope`: `"code"` (the default, the symbol ranking, unchanged) or `"domain"`. The domain scope runs the core BM25 engine (`k1 1.2`, `b 0.75`, no PageRank blend) over rules, terms, decisions and card sections from `graph.json`, and over the in-repo provenance files that decisions link to, read at query time (regular files inside the repository up to 256 KB, cached by modification time). Hits carry `id` (the node id, or `file:<path>`), `kind`, `title`, `context`, `path`, `line`, an `excerpt` of up to 300 characters and `relevanceScore`, packed into `tokenBudget`. `strategy` and `searchMode` do not apply. Without the package the tool has no `scope` parameter and behaves exactly as before.

```json
{ "query": "five loans", "scope": "domain" }
```

returns `rule:LEND-03` first, then the spec and the ADR the LEND-03 decision links to.

### `verify-domain` check 6 and the graph

Check 6 reads card values and production comments the same way the graph does:

- A `Tests:` or `Code:` value whose file part does not exist, or is a directory, is an error: `LEND-03: Tests file "<file>" does not exist`, `LEND-03: Code file "<file>" does not exist`.
- A value with `::` that the index does not hold is a warning: `LEND-03: Code: "<value>" is not an indexed symbol; it links to its file`.
- An unknown rule ID in a production `rule:` comment is a warning, `rule: comment names unknown rule LEND-09`, only when its prefix is a rule prefix. In a test file an unknown ID in a `rule:` comment stays an error, as in PR 2B.

## Facts

A rule that lives only in code is invisible to a card: `if (loans.length >= 5)` is the loan limit, whether or not any card says so. Facts are the small pieces of code that look like business logic. Since PR 4 the four official plugins detect them in both tiers, `@ctxo/domain` scans the text of every other language, and [the Deletion Test loop](#the-deletion-test-loop) turns them into candidates a team resolves one by one.

| Fact kind | Detects | `detail` |
|---|---|---|
| `literal-comparison` | A comparison in a condition (`if`, `while`, ternary, `switch case`, `when`) with a literal operand other than 0, 1, -1, null, true, false, empty string (configurable) | `operator`, `literal` |
| `normalization` | String normalization on a value: `ToLower*`, `ToUpper*`, `Trim*`, `Normalize`, `toLowerCase`, `toUpperCase`, `trim`, `strings.ToLower`, `strings.TrimSpace`, `equalsIgnoreCase` (configurable list) | `method` |
| `retry-timeout` | A numeric constant bound to a name containing retry, retries, attempt, timeout, delay, backoff, ttl, expir; or a duration constructor (`TimeSpan.From*`, `Duration.of*`, `time.Second * n`, `setTimeout(..., n)`) | `name`, `value` |
| `endpoint` | A public route: C# `[HttpGet]`/`[Route]`/`MapGet`, TS Express/Fastify/Koa/Hono/Nest, Go `http.HandleFunc`/gin/echo/chi, Java `@GetMapping` and friends, Flask decorators in the text scan; mount and group prefixes joined (see below) | `verb`, `route` |

**When facts are produced.** With `@ctxo/domain` installed and its registry file present (`domain.registry`), or with `index.facts: true`, `ctxo index`, the post-commit hook (`ctxo index --commit HEAD`) and `ctxo watch` ask every plugin for facts and hand them the `domain.facts` lists (`PluginContext.config.facts`). A fact-capable plugin writes `facts` into each file's index JSON, `[]` when it finds nothing; a plugin without `extractFacts` writes no key, and its files go to the text scan. Facts live in the JSON index only. Without `@ctxo/domain` (or without its registry file) and with `index.facts: false`, the index is byte-identical to earlier releases. The detector lists are one deep-frozen object shared by every plugin of a run. When fact extraction fails for a file, the official plugins print a warning on stderr and return `[]`, so the file gets `facts: []` and indexing carries on; an `extractFacts` that throws gets no `facts` key for that file.

### The fact contract

The rules are shared byte for byte by the four plugins (`fact-rules.ts`, `finish-facts.ts`, `fact-types.ts` in each plugin's `src/facts/`; a drift test keeps them identical); the `@ctxo/domain` copy for the text scan differs only in its header and imports. The conformance vectors in `packages/plugin-api/conformance/fact-vectors.json` define every rule below; where this text and the vectors disagree, the vectors win.

- **Conditions.** The tests of `if`, `while`, `do ... while`, the `for` condition, the ternary condition, C# `when` guards (case labels, switch arms, catch filters), Go tagless `switch` cases, and switch case labels and arms. Comparisons (`==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, `>=`, C# relational, constant and `not` patterns) are found through `&&`, `||`, `!`, parentheses and C# `and` / `or` patterns, never inside calls or lambdas. Exactly one operand must be a literal. A case label gives the text `<subject> case <label>` with operator `case`. A TypeScript type guard is no fact: a comparison whose other operand is a `typeof` expression (`typeof x === 'string'`) and the case labels of `switch (typeof x)` are skipped.
- **Literal forms.** Numbers (optionally signed, with `_`, type suffixes, hex, binary, octal and exponent forms), strings, chars, `true`, `false`, `null`, `nil` and `None`. The shared rules decode only a plain double-quoted string (and a plain single-quoted char) with the common escapes; every other string form (verbatim, interpolated, raw, single-quoted and template strings, Java text blocks, Go raw strings) goes through the language's own decoder. A literal no decoder can read is not a constant, so it is never trivial.
- **Trivial literals** (`domain.facts.trivialLiterals`, default `[0, 1, -1, null, true, false, ""]`) are typed: a number literal is evaluated and compared exactly with the list's numbers (`0.0` and `0x0` are `0`, `0.9999999` is not `1`), strings compare by decoded content (`"0"` is not `0`), `null`, `nil` and `None` match `null`, booleans match case-insensitively.
- **Numeric constants** are a number literal or `+ - * /` arithmetic of number literals with parentheses; named constants are not followed, so the tiers agree. An integer result prints as plain digits (`30 * 1000` gives `30000`); any other result is rounded to 6 decimals (half away from zero). Not a constant: a division of two integers with a remainder (`7 / 2`), a leading-zero integer other than `0` (`017`), division by zero, `|v| >= 2^53`, and a non-zero result that rounds to 0.
- **Normalization patterns** (`domain.facts.normalizationMethods`): `Name` matches the callee's simple name exactly, `Name*` by prefix (case-sensitive), `q.Name` only a call written `q.Name(...)` (Go's `strings.ToLower`). No receiver type check. `detail.method` is the simple name.
- **Name fragments.** A retry or timeout name is split into ASCII tokens (camelCase, PascalCase, digit runs; every other character separates). A fragment of `retry`, `retries`, `attempt`, `timeout`, `delay`, `backoff`, `ttl`, `expir` matches when the tokens, read from the start of some token, begin with it: `TimeOut`, `tokenTTL`, `MAX_RETRIES`, `HTTPTimeout` match, `settlementDays` and `relay` do not. This token-boundary rule is a deliberate narrowing of spec 12.1's "a name containing" (`settlementDays` contains `ttl`); the vectors are the definition.
- **Bindings.** Declarations with an initializer (variables, constants, fields, properties), assignments, object-literal and initializer members, named arguments, annotation members and Go composite-literal keys. Text `<name> = <value>`, for example `MaxRetries = 3`.
- **Durations and units.** C# `TimeSpan.From{Milliseconds,Seconds,Minutes,Hours,Days,Microseconds}(n)`, Java `Duration.of{Millis,Seconds,Minutes,Hours,Days,Nanos}(n)` and `Duration.of(n, ChronoUnit.X)`, Go `n * time.X`, `time.X * n`, `time.Duration(n) * time.X` and a bare `time.X`, TypeScript and JavaScript `setTimeout(fn, n)`, with the units `ns`, `us`, `ms`, `s`, `min`, `h`, `d`. A duration bound to a name is one fact under that name, whatever the name (`HoldTimeout = 90min`); an unbound one is named by the constructor's last two segments (`TimeSpan.FromSeconds = 30s`); `setTimeout` is always `setTimeout`.
- **Endpoints.** Text `<VERB> <route>`; verbs upper case, `ANY` when none is declared; routes joined with one `/` between parts, a leading `/`, the empty route `/`.
  - C#: `HttpGet`, `HttpPost`, `HttpPut`, `HttpDelete`, `HttpPatch`, `HttpHead`, `HttpOptions` (template `args[0]`, else `named.template` or `named.Template`), the class `[Route]` as prefix, `[Route]` alone on a method gives `ANY`; a method template starting with `/` or `~/` ignores the class route; `[controller]` is the class name without `Controller`, `[action]` the method name. Minimal APIs: `MapGet`, `MapPost`, `MapPut`, `MapDelete`, `MapPatch` with a string literal first argument. In the Roslyn tier a class without its own `[Route]` takes the first `[Route]` of its nearest base class with one (as ASP.NET Core does; `[controller]` and `[action]` still come from the derived class and method; abstract classes and classes marked `[NonController]`, directly or through a base, inherit nothing; `[NonAction]` is not read), and a minimal API route joins its `MapGroup` prefixes: a group in a local that is never written again, nested and inline groups, ASP.NET conventions that return their receiver (`WithTags`, `RequireAuthorization`, `WithOpenApi`, `AddEndpointFilter`: generic `TBuilder M<TBuilder>(this TBuilder ...)` extensions in a `Microsoft.AspNetCore` namespace), and a group passed to a method or an extension method's `this` parameter when every call site in the project passes the same resolved prefix. Any part that does not resolve leaves the call's own route: a local written again in any form (Roslyn data flow over the later statements: assignment, compound or `??=`, deconstruction, `foreach` deconstruction, `ref` or `out`), a group returned by a method, a project's own fluent call, a non-constant prefix, a receiver whose type is a type parameter (`TBuilder` with `where TBuilder : IEndpointRouteBuilder`), call sites that disagree or none, a virtual or interface method, a method used as a method group, and a method, of any accessibility (`InternalsVisibleTo` lets a test project call an internal one), that code in a compiled project referencing this one (directly or not) references by symbol: its call sites there are outside this compilation. A test project that references the API project without calling its mappers changes nothing. The data-flow analysis behind the write check runs once per statement and is shared by the locals of a member body. The helper keeps a per-project name index and semantic models while it walks a project's files and releases them after each project (after each request in `ctxo watch`). When the call resolves, `MapGroup` counts only as ASP.NET's (declared by `EndpointRouteBuilderExtensions` or returning `RouteGroupBuilder`); by name when it does not.
  - TypeScript: Nest `Get`, `Post`, `Put`, `Delete`, `Patch`, `Head`, `Options`, `All` (`ANY`) in an exported class decorated `Controller` (prefix `args[0]` or `named.path`); Express, Fastify, Koa and Hono `get`, `post`, `put`, `delete`, `patch`, `head`, `options`, `all` with a string first argument and a handler, on a receiver traced to `express`, `fastify`, `@koa/router`, `koa-router` or `hono`; Koa also `del` (`DELETE`) and named routes (`router.get('name', '/path', h)`); Fastify `route({ method, url })` (a method array gives one fact per method).
  - Java: Spring `GetMapping`, `PostMapping`, `PutMapping`, `DeleteMapping`, `PatchMapping`, `RequestMapping` (verbs from `named.method`, `RequestMethod.GET` gives `GET`, none gives `ANY`; paths from `args`, else `named.path`, else `named.value`; the class `RequestMapping` is the prefix); JAX-RS `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS` with `Path` on the method and the class.
  - Go: `net/http` `HandleFunc` and `Handle` (package functions and `*ServeMux` methods; a pattern `"GET /x"` gives `GET /x`, else `ANY`); gin `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`, `Any`, `Handle(method, path)` on `*gin.Engine`, `*gin.RouterGroup`, `gin.IRouter` and `gin.IRoutes`; echo `GET`, ..., `CONNECT`, `TRACE`, `Any`, `Add(method, path)` on `*echo.Echo` and `*echo.Group`; chi `Get`, `Post`, ..., `Trace`, `Handle`, `HandleFunc`, `Method(method, pattern)` and `MethodFunc` on `*chi.Mux` and `chi.Router` (a chi pattern must start with `/`). The syntax tier takes gin, echo and chi routes only on a receiver the file shows to be a router (a constructor, a group, a chi closure parameter or mount target, or a declared framework type).
  - C# `MapGroup` prefixes and an inherited `Route` are followed in the Roslyn tier only.
- **Route prefixes.** A route on a mounted router or a group carries the prefix when the mount and the routes are both in the file being indexed: TypeScript Express and Koa `use('/api', router)` (nested mounts compose), Koa `new Router({ prefix })`, Hono `route('/api', app)` and `basePath('/api')`; Go gin and echo `Group("/api")`, chi `Route("/api", func(r chi.Router) {...})`, `Group(func)`, `With(...)` and `Mount("/api", sub)`; Flask Blueprint `url_prefix` in the text scan. Every segment of the chain must be a compile-time constant string: a dynamic, conditional, array, regex or template-with-expressions segment, a router mounted or bound at two different paths, a reassigned router, or a router from another file leaves the whole prefix unresolved, and the route is the path written at the call, never a partial join or a guess. Only the indexed file is read, so a full run and a `--files`, `--commit` or `ctxo watch` run give the same facts. The fact keeps the call's line and owner, so a prefixed route moves no fact to another symbol.
- **Attribution.** A fact belongs to its innermost enclosing declaration: the full tier's own symbol ID, and in a syntax tier the ID its full tier would give for members it does not index on its own (fields, properties, private members). Code outside every declaration belongs to the module symbol `<file>::<basename without its last extension>::variable`; annotation endpoints use the annotated method.
- **Text and the cap.** `text` is single-line: whitespace runs collapse to one space, trimmed, at most 200 code points (never inside a surrogate pair). `detail.literal` is capped the same way, with CRLF and CR turned into LF first. Facts are sorted by line, kind, text and `detail`, duplicates dropped, and at most 500 are kept per file (the first 500 in that order), so a generated file cannot balloon the committed index.
- **Test files.** `retry-timeout` facts are dropped for files the shared test-file classifier marks as tests (the default test globs, `index.tests`, and a test-framework annotation on one of the file's symbols). The check is per file and annotation-aware: it reads the annotations of the file's own symbols in the index, so a C# test class without a matching glob counts as a test file once it is indexed with annotations. The other kinds stay in test files, but [candidates](#candidates-and-their-sources) never come from test files.

### Tiers per language

| Language | Primary tier | Syntax tier |
|---|---|---|
| C# | Roslyn IOperation (`ctxo-roslyn --facts=`), .NET SDK 8+ | tree-sitter |
| TypeScript / JavaScript | ts-morph, in process | none (ts-morph is the only tier) |
| Java | Eclipse JDT (`@ctxo/lang-java-analyzer`, `--facts=`), JRE 11+ | tree-sitter |
| Go | ctxo-go-analyzer (`--facts=`), Go 1.22+ | tree-sitter |

Both tiers give the same `kind`, `line`, `text` and `detail` for the same code, except where the [known limits](#known-limits-of-facts-and-the-loop) say otherwise, and the same `symbolId` once C#'s `(n)` parameter suffix on syntax-tier methods is removed; fingerprints ignore that suffix, so a repository indexed on machines with different tiers resolves the same candidates. Analyzers report syntactic evidence only; each plugin's TypeScript side turns it into facts with the shared finisher, so tiers agree by construction on everything both parsers see.

### The text fallback

For an indexed file whose plugin has no fact detector (a `facts` key is absent), and for tracked files no plugin indexes whose extension is in `domain.facts.textScanExtensions`, `@ctxo/domain` runs a text scan during the domain index pass: a light lexer strips comments and strings (per comment style), then single-line heuristics find comparisons in conditions, case labels, normalization calls, retry and timeout bindings, durations and routes (`[HttpGet("x")]`, `@GetMapping("x")`, `MapGet("x")`, `HandleFunc("x")`, `@app.get("x")`, `@bp.route("x")` and `@app.route("x", methods=[...])` decorators (in a file that imports `flask`, a Blueprint's constant `url_prefix` declared earlier in the same file on one line, `bp = Blueprint("loans", __name__, url_prefix="/api")`, is joined to its routes, unless the file also registers that Blueprint with its own `url_prefix`, which Flask uses instead), and `<word>.get("/x")` router calls). The evidence goes through the same finisher, so the facts follow the contract above; candidates from it carry `source: "text"`. Only files with exactly one owning context are scanned, test files never, files over 1 MiB and binary files are skipped. Files are read as cards are: a tracked symlink or junction whose target stays inside the repository is followed, one whose target leaves it is skipped, so the scan never stores outside text in an artifact or a tool answer. The same applies to the `rule:` comment scan.

The heuristics are line-based, so the text scan is less precise than the plugins: a comparison split over lines is missed, and a few shapes are read differently (see [known limits](#known-limits-of-facts-and-the-loop)).

## The Deletion Test loop

The Deletion Test asks of each piece of business-looking code: if this line were deleted, would a rule in a card say it was wrong? `find_shadow_specs` lists the code that fails the test, the shadow specs, so an agent or an owner can pin each one with a rule or record why it is not one. The loop is: run `ctxo index`, call `find_shadow_specs` for a context, for each open candidate find or write the rule (`get_rule` shows the rule's tests), then record the outcome in `shadow-specs.yaml` or link the rule to the code. Every outcome is text a person wrote; Ctxo never decides that something is a rule.

### Candidates and their sources

| Kind | Candidate | `source` |
|---|---|---|
| `literal-comparison`, `normalization`, `retry-timeout`, `endpoint` | A fact in a non-test file owned by exactly one context | `native` (the plugin's facts) or `text` (the text scan) |
| `data-resource`, `procedure` | A `table` or `view` (`DATA_RESOURCE_KINDS`) or a `procedure` symbol in a file the context owns | `index` |
| `rule-without-tests` | A rule of the context's card without a test link | `card` |

Each candidate has `fingerprint`, `kind`, `file`, `line` (1-based), `symbolId` or `ruleId`, `text`, `detail` when the fact has one, `source` and, when resolved, `resolution`. Exact duplicates are dropped; several candidates may share one fingerprint (overloads, the same text twice in a method, a procedure defined in two migrations), and one resolution entry resolves them all. Counts are always per candidate, never per fingerprint.

### Fingerprints

A fingerprint is `<kind> | <symbol> | <normalized text>`, independent of line numbers: a moved line keeps its fingerprint, a changed literal changes it, so the candidate reopens. Spec 12.2's example:

```text
literal-comparison | LoanPolicy.CanBorrow | loans.Count >= 5
```

- **The symbol part** is the last two `.` segments of `<file basename without its last extension>.<symbol name without a trailing (...)>`, where the file part is one segment even when it holds dots: `src/Lending/LoanPolicy.cs::Lending.LoanPolicy.CanBorrow::method` gives `LoanPolicy.CanBorrow`, `src/lending/loan-policy.ts::canBorrow::function` gives `loan-policy.canBorrow`, `src/lending/loan.service.ts::withRetry::function` gives `loan.service.withRetry` (so `fine.service.ts::withRetry` never collides with it), `x.d.ts::x` gives `x.d.x`, the module symbol of a file gives its basename alone (`app.ts` gives `app`, `api.loan.service.ts` gives `api.loan.service`, never shared with `web.loan.service.ts`), and a C# syntax-tier `CanBorrow(2)` gives the same part as the full tier's `CanBorrow`. Members keep `Type.member` (`LoansController.find` in `loans.controller.ts`). A `.` inside `<...>`, `[...]`, `(...)` or a quoted segment does not split.
- **Members whose name holds a dot keep their containing type.** This is the general rule: any member whose name contains a dot, such as a C# explicit interface implementation (`Loan.IComparable<Lending.Loan>.CompareTo`) or a TypeScript computed or string-literal member (`LoanList.[Symbol.iterator]`), keeps the containing type in the symbol part, so two classes' iterators or `CompareTo` methods never collide.
- **The text part** is the fact text, normalized (whitespace collapsed, at most 200 code points); for a rule without tests, the rule title (or the ID when the heading has none); for a data object, its kind and name.
- **Encoding.** `%` and `|` in the kind and symbol parts are written `%25` and `%7C`, so the parts never hold a separator. Copy fingerprints verbatim into `shadow-specs.yaml` as YAML single-quoted scalars (`fingerprint: '...'`, a `'` inside written `''`): fact text can hold double quotes, backslashes, `: ` and ` #`, which break a double-quoted or plain scalar. `ctxo domain shadow-specs` prints every fingerprint in that form, ready to paste. A lower-case `%7c` matches too; a decoded `|` in the symbol part splits the fingerprint differently and is reported stale. Spacing around the separators does not matter.

### Resolution order

1. **A rule link.** A candidate whose symbol is reached by a rule's code links (card `Code:` lines and `rule:` comments, file links included) is resolved `{ by: "rule-link", rules: [...] }`.
2. **`Untested:`.** A rule without tests whose card has an `Untested:` line is resolved `{ by: "untested", reason }`.
3. **`shadow-specs.yaml`.** Otherwise an entry with the candidate's fingerprint resolves it: `{ by: "shadow-specs", rule }` (the rule ID canonicalized, `lend03` gives `LEND-03`) or `{ by: "shadow-specs", notARule }`. A candidate already resolved by 1 or 2 keeps that resolution. An entry naming a rule no card defines resolves nothing and is reported in `unknownRules`.

### `shadow-specs.yaml`

One file per context, next to the registry: `<registry folder>/<context>/shadow-specs.yaml` (`docs/domain/lending/shadow-specs.yaml` with the default registry). The team writes it; Ctxo only reads it, on every call, so an edit takes effect without a re-index.

```yaml
- fingerprint: 'literal-comparison | LoanPolicy.CanBorrow | loans.Count >= 5'
  resolution: { rule: LEND-03 }
- fingerprint: 'retry-timeout | SmtpSender.Send | Timeout = 30s'
  resolution: { notARule: "transport timeout, not a business rule" }
```

- An empty file, comments only, `[]` or a null document (`---`, `~`, `null`) hold no entries.
- A root that is not a list or a YAML syntax error is one error, and no entry of the file applies. So is a file that is not read: its real path lies outside the repository (a symlink pointing out), it is over 1 MiB, binary or not valid UTF-8.
- A broken item (a missing or empty fingerprint, a resolution that is not exactly one of `rule` or `notARule`, a repeated key) is an error and is skipped; the valid items still apply. A repeated fingerprint is a warning, and the first entry wins.

The schema (`packages/domain/schema/shadow-specs.schema.json`, shipped in the npm package):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ctxo.dev/schema/domain-shadow-specs.schema.json",
  "title": "Ctxo shadow-spec resolutions",
  "description": "<registry folder>/<context>/shadow-specs.yaml: resolutions of shadow-spec candidates by fingerprint (find_shadow_specs). One entry resolves every candidate with its fingerprint; an entry matching no candidate is stale. An empty file or a null document (---, ~, null) holds no entries.",
  "type": ["array", "null"],
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["fingerprint", "resolution"],
    "properties": {
      "fingerprint": {
        "description": "<kind> | <symbol> | <normalized text>, as find_shadow_specs reports it; spacing around the separators does not matter.",
        "type": "string",
        "pattern": "^[^|]*\\S[^|]*\\|[^|]*\\S[^|]*\\|[\\s\\S]*\\S"
      },
      "resolution": {
        "oneOf": [
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["rule"],
            "properties": {
              "rule": { "description": "The rule that states this candidate (LEND-03; lend03 also works).", "type": "string", "pattern": "\\S" }
            }
          },
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["notARule"],
            "properties": {
              "notARule": { "description": "Why this candidate is not a business rule.", "type": "string", "pattern": "\\S" }
            }
          }
        ]
      }
    }
  }
}
```

### `find_shadow_specs`

```json
{ "context": "lending", "kinds": ["literal-comparison"], "includeResolved": true }
```

- `context` (required): a context ID from the registry. `kinds` (optional): any of `literal-comparison`, `normalization`, `retry-timeout`, `endpoint`, `data-resource`, `procedure`, `rule-without-tests`; omitted or an empty list means all kinds. `includeResolved` (optional, default false): also return resolved candidates with their resolution.
- The response: `context` (`id`, `name`, `rung`), `counts` (`open`, `resolved` and `byKind`, `{ <kind>: { open, resolved } }` for each kind that has candidates, after the `kinds` filter), `shadowSpecs` (the candidates without their `context`), `resolutionFile` (the path of the context's `shadow-specs.yaml`, whether or not it exists), `staleResolutions` (`{ fingerprint, line }`), `unknownRules` (`{ fingerprint, rule, line }`) and `resolutionProblems` (`{ line, severity, message }`).
- An entry with an unknown rule that matches no candidate appears in both `staleResolutions` and `unknownRules`; the two lists are independent and never summed.
- `staleResolutions`, `unknownRules` and `resolutionProblems` are capped at 50 at the source, with `staleResolutionsTotal`, `unknownRulesTotal` and `resolutionProblemsTotal` when cut. Only `shadowSpecs` (and `contextMap` of `get_context_map`) is truncated by the envelope, with `_meta.hint`.
- Graceful misses: no registry, a registry with problems, no domain graph, a graph built from another registry (the registry changed since the last `ctxo index`), a context the registry does not name, or no loop artifacts give `{ found: false, hint }`. A blank `context` fails the tool's input schema. With a current graph, a loop artifact built for another registry, or cards changed since the last index, answer with `stale: true` and a hint to run `ctxo index`.
- Under `ctxo watch`, candidates refresh only on the next `ctxo index`, as `graph.json` does.

### `ctxo domain shadow-specs`

```bash
ctxo domain shadow-specs lending [--kinds literal-comparison,endpoint] [--all] [--json]
```

The CLI face of `find_shadow_specs`: `--json` prints exactly the tool's body without `_meta`; the human output lists each candidate (`open` or `resolved`, kind, `file:line`, text and resolution) with its fingerprint on the next line as a YAML single-quoted scalar (`'...'`, a `'` written `''`, ready to paste after `fingerprint: `), then the stale entries and the unknown rules (their fingerprints quoted the same way) and the file problems; `--json` keeps the plain strings. `--all` adds resolved candidates; repeated `--kinds` options add up (`--kinds endpoint --kinds normalization`), and an empty list means all kinds. Exit 0 when done (stale data, such as cards edited since the last index, prints a hint and still exits 0) or with no registry; 1 for bad arguments, an unknown kind or an unknown context; 2 for registry problems, no index data (`[ctxo] No shadow-spec data yet; run "ctxo index".`, or `[ctxo] No context map yet; run "ctxo index".` for `ctxo domain map`), index data built from another registry (`[ctxo] The domain registry changed since the last "ctxo index"; run it to rebuild the domain graph.`) and an internal error (`[ctxo] domain <name> failed: <message>`). `ctxo domain map` has the same exit codes. The CLI output is not masked, as for `ctxo contexts --json`; `shadow-candidates.json` holds the same text the index JSON `facts` already hold.

### `verify-domain` check 12

Check 12, "Shadow-spec resolutions", computes the candidates from the current index and repository (never from the stored artifacts) and reports, per context: each parse problem of its `shadow-specs.yaml` at its own severity (a file that does not parse is an error, so the run exits 1), each stale entry (`stale resolution "<fingerprint>" matches no candidate of <id>`, warning), each unknown rule (`resolution names unknown rule <ID>`, warning), and each `shadow-specs.yaml` in a folder that belongs to no context (`<path> belongs to no context`, warning). With registry problems check 12 is skipped, like checks 2 to 11. When the candidates cannot be built (the composition logged a warning), no entry is called stale; instead, when any `shadow-specs.yaml` has entries, check 12 adds one warning, `stale resolutions were not checked: <reason>`, and the exit code stays 0 unless another finding is an error. Parse problems, unknown rules and orphan files are still reported.

## The context map and rungs

`get_context_map` puts every named context on one page: what it owns, how well its rules are tested and how mature it is, with a suggested rung next to the owner's. The suggestion never changes the registry.

### Metrics per context

| Field | Meaning |
|---|---|
| `card` | `path` and `present` (the file exists inside the repository) |
| `rules` | `count`, `withTests` and `share` (3 decimals; `null` without rules) |
| `tests` | Characterization and contract test counts (the K13a conventions below) |
| `crossContextEdges` | Edges `in` and `out` across the context's boundary, from `boundaries.json` |
| `coChange` | Co-change `pairs` with files of other contexts at frequency 0.5 or more (non-test files), and the `top` 10 |
| `drift` | `crossShare`, `movedFiles`, `distinctCommits` and `confidence` from the domain history; `null` without history |
| `boundaryViolations` | `total`, `errors`, `warnings` (in or out) |
| `shadowSpecs` | `open` and `resolved` candidates, after the `shadow-specs.yaml` entries |
| `rung`, `suggestedRung` | The owner's rung from the registry and the suggested one |
| `criteria` | The status of each rung criterion, computed on its own, so the owner sees what blocks the next rung even when a lower one already fails |
| `boundariesKnown` | False when there is no `boundaries.json`: the edge and violation counts are 0 and unknown, and `bounded` is not met |

`summary` counts `contexts`, `agree`, `suggestedAbove` and `suggestedBelow`; `settings.pinnedCoverage` echoes the threshold.

### The ladder

The ladder is cumulative: the suggested rung is the highest one whose criterion and every lower one are met, `fear` otherwise.

| Rung | Criterion (each reported in `criteria`) |
|---|---|
| `fear` | None of the criteria below hold |
| `pinned` | At least `domain.rungs.pinnedCoverage` (default 0.8) of the context's main paths are reached from a characterization test, compared on the exact ratio (`coverage` is rounded for display). Main paths are the symbols of its `endpoint` facts plus its contract symbols. A context without main paths is pinned when it has at least one characterization test. Reported: `mainPaths`, `reached`, `coverage`, `threshold`, `characterizationTests`, `unreached` (at most 20) |
| `named` | A card exists, its Language section has at least one term, and every such term has a glossary entry (the context's own or a repo-wide one). Reported: `card`, `terms`, `inGlossary`, `missing` (at most 10, in card order) |
| `bounded` | Every contract symbol is reached from a contract test, and no boundary violation leads in or out. Met vacuously for a context with no contract symbols and no violations: every cross-context edge outside a contract is already a violation. Not met without `boundaries.json` (`boundariesKnown: false`). Reported: `contractSymbols`, `reached`, `unreached`, `boundaryViolations` |
| `boring` | Every rule has a test link (`Untested:` rules count as without tests) and no shadow-spec candidate is open. Reported: `rules`, `rulesWithoutTests`, `openCandidates` |

**Contract symbols** of a context are the symbols, other than containers, in its files that another context's `contracts` lists as allowed targets.

### Test conventions (K13a)

A test case is a `function` or `method` symbol of a test file that contains no other `function` or `method` of the file (TypeScript test blocks, xUnit, NUnit, MSTest and JUnit methods, Go test functions). It is a characterization or a contract test when any one of these matches:

- **`annotations`**: `Name` (the annotation name), `Name:value` (any argument equals `value`) or `Name:key=value` (the first two arguments, or a named argument), ASCII case ignored in keys and values. The annotation may sit on the test or on a symbol of its file that spans it (a test class). Defaults: `Trait:Kind=Characterization`, `Tag:characterization`; `Trait:Kind=Contract`, `Tag:contract`.
- **`paths`**: globs on the test file's path. Defaults `**/Characterization/**`; `**/Contract/**`, `**/Contracts.Tests/**`.
- **`names`**: a marker in the test's name or in a declared test title on a line it spans (ASCII case ignored). Defaults `[characterization]`, `[contract]`.

A test counts for the context that owns its file alone; a test in an unowned or multiply owned file counts for every context whose main paths its reach touches. `ctxo domain discover` proposes paths for folders named `Characterization`, `Contract`, `Contracts` or `Contracts.Tests` that the configured globs do not cover, as `<folder>/**`, keeping the configured globs in the proposed list; `--write` merges them into `domain.tests.characterization.paths` and `domain.tests.contract.paths`.

### Reachability

A test reaches what its forward code edges reach: `calls`, `uses`, `imports`, `extends`, `implements`. Data edges (`reads`, `writes`, `executes`) are never followed. A test without edges of its own starts from its container (JDT edges are type-level), and a reached type or file stands for what it contains. Limits: only graph edges count, so a test that calls an endpoint over HTTP (an in-process test server, a REST client) reaches nothing in the graph, and an endpoint registered in top-level code belongs to the module symbol, which a test reaches only through an import of that file. Such contexts can stay below `pinned` while being well tested; the owner's `rung` is not affected.

### `get_context_map`

No parameters. The response is `contextMap` (one entry per registry context, in registry order), `summary` and `settings`. Each entry can reach 4 to 5 KB, so a large registry is truncated by the envelope (`contextMap` is truncatable) with `_meta.hint` pointing to `ctxo domain map --json`. Graceful misses as for `find_shadow_specs`; a missing `boundaries.json` answers the map with a hint, and stale artifacts add `stale: true` and the hint.

### `ctxo domain map`

```bash
ctxo domain map [--json]
```

Prints the whole map with no truncation: one summary line, then per context its rung, suggested rung, rules with tests, open candidates and a check or cross per criterion. `--json` prints the `get_context_map` body without `_meta`. Exit codes as for `ctxo domain shadow-specs`.

### Artifacts of the loop

`ctxo index` (the domain pass, also on the post-commit hook) writes two more artifacts next to `graph.json`, each with a `ctxoArtifact` marker, `registryHash` and `cardsHash`, rewritten only when their content changed and byte-identical for the same input:

| File | Holds |
|---|---|
| `.ctxo/index/domain/shadow-candidates.json` | `"ctxoArtifact": "domain-shadow-candidates"`: every context's candidates with fingerprints and their automatic resolutions (rule links, `Untested:`); `shadow-specs.yaml` entries are applied at query time |
| `.ctxo/index/domain/maturity.json` | `"ctxoArtifact": "domain-maturity"`: per context the characterization and contract test counts, main paths and contract symbols with their reach, and cross-context co-change |

- Both are written or both are removed. When the graph builds but the shadow-spec candidates or the maturity facts cannot be built, the pass removes both files (only files that carry their `ctxoArtifact` marker, never a hand-written file of the same name) and warns, for example `The maturity facts could not be built: <message>; shadow-candidates.json and maturity.json removed.` or `The shadow-spec candidates are missing; shadow-candidates.json and maturity.json removed. Fix the cause and run "ctxo index".` `find_shadow_specs` and `get_context_map` then answer `{ found: false, hint: "No shadow-spec data yet; run \"ctxo index\"." }`, and `ctxo domain shadow-specs` and `ctxo domain map` print their no-data line and exit 2, instead of serving the previous run's data.
- When the graph itself cannot be built, `graph.json` and both loop files stay as they were (the previous run's data, served until the graph builds again).
- `ctxo watch` does not run the domain pass: candidates and the map refresh only on the next `ctxo index`.
- The tools check each artifact's `registryHash` against the current registry and answer from stale data with `stale: true` and a hint.

## Known limits of facts and the loop

- **C#:** only the first class `[Route]` is used. A `Route` inherited from a base class and `MapGroup` prefixes are resolved in the Roslyn tier only; the tree-sitter tier gives the method or call route alone. In the Roslyn tier a fact in the second or a later declarator of one field or event field declaration (`const int MaxRetries = 3, TimeoutMs = 5000;`) is owned by `...TimeoutMs::variable`, which is not a symbol: the tier indexes only the first declarator.
- **TypeScript:** a Nest controller must be exported to give endpoints; mount prefixes are joined only when the mount and the router are in the same file (a router imported from another file, a CommonJS `require` router or one returned by a call keeps its routes as written; see the [roadmap](../roadmap.md)). Constructor parameter defaults, parameter properties included (`constructor(private retries = 3)`), give no `retry-timeout` fact, while class properties and `#private` fields do. Symbol extraction still counts line numbers from the file start for every symbol, so `extractFacts` on a file with 4,000 methods takes about 1.8 s (the fact collector itself about 0.15 s); a newline index there is a [roadmap](../roadmap.md) follow-up.
- **Java:** an older `@ctxo/lang-java-analyzer` JAR ignores `--facts=`; the plugin prints `analyzer too old for facts; run ctxo install java --full-tier` once, and until then the full tier gives only the endpoint facts it reads from annotations: no comparisons, normalization or retry and timeout values, although the syntax tier could find them (it is not used to fill them in). A comparison whose number literal overflows `int`, and hex, octal or binary literals above `INT_MAX`, give no fact.
- **Go:** gin and echo `Group()` and chi `Route`, `Group`, `With` and `Mount` prefixes are joined only when the group is created, or the router mounted, in the same file (a router received as a parameter keeps its routes as written); the syntax tier takes gin, echo and chi routes only on receivers the file shows to be routers, (a struct field of the file typed as a router, `s.router.GET`, and a call to a function or method of the file whose result is a router type count), so a router whose type is declared in another file, or reached through an untyped expression, gives a fact in the full tier only; it matches the other routes by name (a `HandleFunc` on a non-`ServeMux` type, router or path constants declared in another file, and a named map type with identifier keys read differently than in the full tier). In `ctxo watch` a saved file keeps the symbols and edges of the last analyzer batch while its facts come from the tree-sitter tier on the new bytes (the tiers are built to agree); a file created during watch is not in the batch and gets `facts: []` until the next `ctxo index`. A process killed while it builds the analyzer binary leaves a `.build-*` temp file in the cache entry (harmless; nothing cleans it up).
- **Evidence cap:** every tier except TypeScript (the tree-sitter tiers, Roslyn, JDT and ctxo-go-analyzer) collects at most 2,000 pieces of evidence per file, in its own walk order, before the finisher keeps 500 facts. Trivial comparisons (`x == 0`, `== null`) count toward the 2,000, so in a long file full of null checks the real facts near its end can be lost, and above the cap the two tiers of a language can keep different subsets.
- **Numbers:** the shared number parser recurses once per parenthesis level, so a matched duration chain several thousand factors deep can exceed it; the plugin then warns on stderr and the file gets `facts: []`.
- **Text scan:** lines over 20,000 UTF-16 code units are skipped (minified or generated lines carry no useful facts); Kotlin `val x: Int = 3`, `when` arms not at line start and `for` conditions are missed; `"""` strings are lexed with backslash escapes in every style (a Kotlin raw `"""C:\"""` swallows the following lines); `methods=[...]` counts only inside the route call's own parentheses, deduplicated, at most 16 verbs (`methods=['GET', ('POST')]` drops POST); a file whose facts collapse to few under the 200-code-point text cap is scanned in full (linear). Comparisons in returned expressions (`=> loans < 5`) are not conditions under spec 12.1, so they give no fact: this is the specified behaviour, not a miss.
- **Fingerprints:** a quote right after `[` is not a quote, so a contrived `["a].b"]` member splits at its dot. Whitespace inside string literals is collapsed with the rest of the text (FC-2), so `code == "A  B"` and `code == "A B"` share a fingerprint, and changing only a literal's inner spacing does not reopen its candidate.
- **Cross-file C# endpoints:** in the Roslyn tier a file's endpoint facts can depend on other files: a `MapGroup` prefix comes from the call sites of the method that receives the group, and an inherited `[Route]` from a base controller. `ctxo index --files`, `--commit` (the post-commit hook) and `ctxo watch` re-index only the changed file, so after changing a call site (`app.MapGroup("/users").MapUsers()`) or a base controller's `[Route]`, the files that depend on it keep their old endpoint facts, and with `@ctxo/domain` their candidates' fingerprints change only when they are next re-indexed (check 12 stale warnings). `ctxo index --check` does not report this; run a full `ctxo index` after such a change. Marking these facts as cross-file in the output is a [roadmap](../roadmap.md) follow-up.
- **Incremental runs:** after `ctxo install domain`, after adding the registry file, or after changing `domain.facts.trivialLiterals` or `normalizationMethods`, the post-commit hook (`--commit`), `--files` and `ctxo watch` give native facts only to the files they touch. The other files keep text-scan facts (no `facts` key) or their old facts until a full `ctxo index`, so as they get re-indexed their candidates can change source, text or fingerprint, and `shadow-specs.yaml` entries churn into check 12 stale warnings. `ctxo index --check` does not report this; run a full `ctxo index` after each of these changes.
- **`ctxo watch` and the registry:** the fact request is decided once per process, so a `ctxo watch` started before the registry file existed keeps facts off until it is restarted.
- **Test conventions:** classifying the test cases of one file is quadratic in their number, so a generated or data-driven test file with thousands of cases slows the domain pass of every `ctxo index` (the maturity facts).
- **`verify-domain`:** check 12 needs the full domain graph, so an exception while building it exits 2 before checks 1 to 11 report: a graph bug turns the gate into an internal error.
- **`shadow-specs.yaml`:** on a case-insensitive file system a folder `Lending/` for context `lending` is read and also listed as an orphan; the line of the first bad UTF-8 byte counts only LF (a lone-CR file reports line 1); an outside-pointing `shadow-specs.yaml` symlink in an unknown-context folder, and an in-repo link with a non-context name pointing at a context folder, are listed as orphans; a permission error on one child folder empties the orphan list.
- **Config:** on `ctxo index` and `ctxo watch` a `[ctxo:config]` warning can print a second time.
- **Discovery:** the `<folder>/x` probe misses globs limited to one extension; proposed convention paths are not validated as globs.
- **Co-change cache:** keyed on modification time and size, with no racy-stamp rule.
- **MCP server state:** the domain history is cached by its folder's stamp, so a history entry rewritten in place is seen only after a server restart.

## Ctxo domain conventions v1

This is the contract a repository follows to use the domain layer. Nothing in it needs a code change: cards, a registry and, optionally, test links.

### The registry schema

The registry is validated against this JSON Schema (`packages/domain/schema/contexts.schema.json`, shipped in the package):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ctxo.dev/schema/domain-contexts.schema.json",
  "title": "Ctxo domain context registry",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "contexts"],
  "properties": {
    "version": { "const": 1 },
    "contexts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "name", "paths", "rung"],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$" },
          "name": { "type": "string", "minLength": 1 },
          "card": { "type": "string", "minLength": 1 },
          "paths": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
          "rung": { "enum": ["fear", "pinned", "named", "bounded", "boring"] },
          "rulePrefix": { "type": "string", "pattern": "^[A-Z][A-Z0-9]*$" },
          "contracts": {
            "type": "object",
            "additionalProperties": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } }
          }
        }
      }
    },
    "unowned": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "allow": { "type": "array", "items": { "type": "string", "minLength": 1 }, "default": [] }
      }
    },
    "glossary": { "type": "string", "minLength": 1, "default": "docs/domain/glossary.md" },
    "contextMap": { "type": "string", "minLength": 1, "default": "docs/domain/context-map.md" }
  }
}
```

The loader reads the YAML itself and reports problems with their path; the schema is the written contract for editors and CI. Beyond the schema, `id` values are unique, a context with a rung above `fear` has a card, and `contracts` keys name contexts that exist in the registry.

### The card template

A card is a markdown file with five H2 headings, in this order, and nothing else at that level:

1. `## Language`
2. `## Rules and invariants`
3. `## Boundary contracts`
4. `## Decisions`
5. `## Open questions`

Headings only: the checks read structure, never the prose under it. Rules are H3 headings under `Rules and invariants`:

```markdown
# Lending

## Language
- **Loan**: one book held by one member until its due date.

## Rules and invariants
### LEND-03 A member holds at most five loans
Tests: `tests/Lending.Tests/LoanLimitTests.cs`
Code: `src/Lending/LoanLimit.cs`

Free text written by people.

### LEND-04 A member with an unpaid fine cannot borrow
Untested: the unpaid-fine check has no test yet

## Boundary contracts
Free text; references to contract files.

## Decisions
- 2026-09-12: Loan limit raised from 3 to 5 (LEND-03). [spec](../../specs/loan-limit.md), #123

## Open questions
- ...
```

- A rule heading is `### <ID> <title>`. The optional lines `Tests:`, `Code:` and `Untested:` come at the start of the rule body; their values are comma-separated backticked repo-relative paths or symbol IDs. Use `#name` after a path for a plain test name (`LoanLimitTests.cs#RejectsTheSixthLoan`); a value with `::` is a symbol ID (`src/lending/loan-limit.ts::canBorrow::function`), and one the index does not hold links to its file with a check 6 warning. The file part must be a file that exists (a directory is an error).
- `Untested:` states why a rule has no test; it satisfies the "every rule has a test link" requirement of check 6 for that rule. A rule must have one of: a test link found by the scan, a `Tests:` line, or an `Untested:` line.
- Terms are list items starting with `**Term**` under `Language`; `glossary.md` holds the same items under any heading, and `- **Term** (context: <id>): definition` ties a glossary item to one context (without it the term is repo-wide). Decisions are list items starting with an ISO date and a colon; rule IDs written in a decision link it to those rules. Relative links point to provenance files and are checked (check 7); `#123` and URLs are external strings, never fetched.
- `Code:` lines, term items, decision lines and the glossary form feed the [domain graph](#the-domain-graph). They are additions to v1 that need no code change, so no level of the adoption ladder asks for one.

### Rule IDs

- **Shape.** `domain.rules.idPattern`, default `^[A-Z][A-Z0-9]*-\d+$` (`LEND-03`). An invalid pattern is reported by check 1 and the default is used meanwhile.
- **Permanence.** An ID is never reused or renumbered. Retire a rule by marking it in the card; give a new rule a new ID.
- **`rulePrefix`.** A context may declare `rulePrefix: LEND` (`^[A-Z][A-Z0-9]*$`); every rule ID in its card must then start with `LEND-`. IDs are unique across all cards.
- **Tracker overlap.** Issue trackers use the same shape (`LEND-456`). Confirm tracker prefixes in `domain.rules.trackerPrefixes` (see discovery). For a prefix that is both, only structured references link to a rule; a plain mention in a comment never does, and never raises an error.

How a test is linked to a rule (a link exists only to an ID that a card defines):

- **Annotations:** an xUnit `Trait` whose key is in `domain.tests.ruleTraitKeys` (default `Rule`) with a rule ID as value (`[Trait("Rule", "LEND-03")]`), and `Category`, `TestCategory` or `Tag` annotations whose value starts with a rule ID. Annotations come from the plugins' index, so any language that reports them works.
- **The text scan** of test files (the shared test-file classifier): comments of the form `rule: LEND-03`, test titles that start with an ID (`it('LEND-03 limits loans', ...)`, `t.Run`, `@DisplayName`, `[Fact(DisplayName = ...)]`), and plain mentions. Variants `LEND-03`, `LEND03`, `Lend03` and `lend_03` match at token boundaries. A hit links to the innermost indexed symbol spanning the line, else to the file, and records the declaring test's title as the test name.
- **The card's `Tests:` line.**

Adoption never needs a code change: the test names or framework tags a team already has, or a `Tests:` line in the card, are enough. On the code side, a `Code:` line in the card links a rule to its implementation; a `rule: LEND-03` comment above a declaration does the same from the code.

### The trailer

```text
Domain-Unchanged: <id>[, <id>...] [(reason)]
```

A commit that leaves a context's behaviour as it was carries it (details above). The loader rules, the guard reason and the skill all print the exact line to add.

### The adoption ladder

A team climbs one rung at a time; a context's `rung` in the registry says where it is. The ladder, verbatim:

> level 0: install and index; 1: registry with paths; 2: cards; 3: rule IDs and test links, through card `Tests:` lines, test names or framework tags; 4: contracts and shadow-spec resolutions

No level requires code changes. Level 4 names contracts (check 10 then guards the boundary) and shadow-spec resolutions: a `<registry folder>/<context>/shadow-specs.yaml` that follows the [resolution schema](#shadow-specsyaml) (`packages/domain/schema/shadow-specs.schema.json`), checked by `verify-domain` check 12.

## See also

- [ADR-017](../architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md): the decisions behind the first phase
- [ADR-018](../architecture/ADR/adr-018-domain-knowledge-layer.md): the in-repo knowledge layer, the CLI internal API and the fold guard
- [Domain commands](../../site/docs/cli/domain.md) and [the concept page](../../site/docs/concepts/domain-knowledge.md)
- [Architectural intelligence](architectural-intelligence.md): communities, co-change and the contexts view
- [SQL language page](../../site/docs/languages/sql.md) and the [C#](../../site/docs/languages/csharp.md), [TypeScript](../../site/docs/languages/typescript.md), [Java](../../site/docs/languages/java.md) and [Go](../../site/docs/languages/go.md) language pages
- [Writing a plugin](../../site/docs/languages/writing-a-plugin.md): the v2 surface for plugin authors
- [roadmap.md](../roadmap.md): deferred items (NoSQL, messaging, dialects, ORMs)
