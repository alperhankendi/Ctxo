# @ctxo/lang-sql

SQL language plugin for [Ctxo](https://github.com/alperhankendi/Ctxo). It reads `.sql` scripts (T-SQL), turns the objects they define into symbols, and links each object to the tables, views and procedures its body touches. Data coupling then shows up in blast radius, the contexts view and the other graph tools, next to code coupling.

It is a protocol v2 plugin (`apiVersion: '2'`), so it needs a Ctxo CLI that understands the data kinds. Tier: syntax. No database connection, no build step, no extra runtime: the recognizers live in the zero-dependency [`@ctxo/sql-extract`](https://github.com/alperhankendi/Ctxo/tree/master/packages/sql-extract) library.

## What it indexes

| Source | Becomes |
|---|---|
| `CREATE [OR ALTER] TABLE` | symbol of kind `table`, with a `columns` annotation (every column, lowercase, sorted) |
| `CREATE [OR ALTER] VIEW`, `ALTER VIEW` | symbol of kind `view` |
| `CREATE [OR ALTER] PROC[EDURE]`, `ALTER PROC[EDURE]` | symbol of kind `procedure` |
| `CREATE [OR ALTER] FUNCTION`, `ALTER FUNCTION` | symbol of kind `function` |
| table and view references after `FROM`, `JOIN`, `APPLY` and `MERGE ... USING` in a body | `reads` edge |
| `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE TABLE`, `SELECT ... INTO`, `OUTPUT ... INTO` in a body | `writes` edge |
| `EXEC` / `EXECUTE` of a procedure in a body | `executes` edge |

Symbol ids look like `db/schema.sql::dbo.loans::table`: the canonical two-part name in lowercase (a missing schema is `dbo`). The symbol `name` keeps the spelling as declared, without delimiters and without an added schema. Edge targets are `dbo.loans::table` for `reads` and `writes` and `dbo.usp_notifymember::procedure` for `executes`; Ctxo resolves them to the defining file, whichever of table or view defines the name. When several files define the same object (migrations, a docs or test copy), a definition outside test files wins, then one outside `docs`, `doc` and `documentation` folders, then the codepoint-smallest path, and every copy reports the same dependents in the impact tools.

## Rules in short

The decision record is [ADR-017](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md). The rules are pinned by the conformance corpus in [`packages/sql-extract/corpus`](https://github.com/alperhankendi/Ctxo/tree/master/packages/sql-extract/corpus), which this package's tests also run.

- Names have one to four dot-separated parts. `[...]` and `"..."` delimiters are removed. Three- and four-part names, temp tables (`#t`), table variables (`@t`), CTE names and the `sys` and `information_schema` schemas are skipped.
- Canonical names fold only ASCII `A` to `Z`. `Ö`, `ı`, `İ` and every other character are kept, so a name such as `[dbo].[Ödünç Kaydı]` matches byte for byte on every side.
- Accesses come from the body of a view, procedure or function. Top-level DML in a script (an ad hoc `SELECT` or `INSERT`) produces no edges and no symbols.
- A body ends at the end of its `GO` batch, or at the next view, procedure or function definition when `GO` is missing. `CREATE TABLE` or `ALTER TABLE` inside a body is body text: it defines nothing and adds no columns.
- `ALTER TABLE ... ADD` outside a body adds columns to a table defined in the same file.
- Two definitions of one object in a file merge into the first.
- Comments, string literals and `GO` inside strings or comments never produce accesses. A leading byte order mark is ignored.
- A table with no body has a symbol and no edges. A recursive procedure has no self edge.
- SQL objects carry no complexity metrics, and a call to a SQL function is not an edge.

## Effect on C#

When this plugin is installed, the CLI tells every plugin that `.sql` files are indexed (`capabilities.sqlCallSites`). The C# plugin then adds `reads`, `writes` and `executes` edges from a method to the tables and procedures named by constant SQL at known call sites (ADO.NET, Dapper including `CommandDefinition`, `SqlBulkCopy`, EF Core raw SQL). Those edges point at the same `dbo.loans::table` targets this plugin defines, so a C# method and the stored procedure that touches the same table meet in the graph. Without this plugin the C# plugin emits no SQL edges.

## Install

```bash
ctxo install sql
```

Or add `@ctxo/lang-sql` to the project's `devDependencies`. Ctxo discovers it by name. `ctxo init`, `ctxo doctor` and `ctxo index --install-missing` suggest it when the repository has at least 5 `.sql` files that are also at least 2% of its files.

## Limits

- Only T-SQL is recognized.
- A `.sql` file larger than 5 MiB is skipped with one warning (`skipped <file>: <n> MiB is over the 5 MiB SQL size limit`) and yields no symbols or edges.
- Constant SQL only: dynamic SQL (`EXEC (@sql)`, `EXEC @proc`) is skipped.
- Only objects defined in indexed `.sql` files exist as symbols; a reference to an object defined elsewhere stays unresolved until its script is indexed.
