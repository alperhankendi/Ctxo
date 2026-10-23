---
title: "SQL"
description: "@ctxo/lang-sql: T-SQL definitions and the data they read, write and execute."
---

# SQL

Plugin: **`@ctxo/lang-sql`** ([npm](https://www.npmjs.com/package/@ctxo/lang-sql))
Parser: **`@ctxo/sql-extract`** (zero-dependency T-SQL tokenizer and recognizers)
Tier: **`syntax`**
Extensions: `.sql`
Protocol: **v2** (`apiVersion: '2'`)

## What this plugin does

Two services can look independent in the dependency graph while both write the
same table. This plugin makes that coupling visible. It reads `.sql` scripts
(T-SQL), turns the tables, views, procedures and functions they define into
symbols, and links each view, procedure and function to the tables and
procedures its body touches with `reads`, `writes` and `executes` edges.

No database connection, no build step and no .NET: the recognizers are plain
TypeScript in `@ctxo/sql-extract`, so a SQL-only repository needs only Node.js.

## Install

```bash
ctxo install sql        # alias: ctxo install tsql
```

Or add the package yourself:

::: code-group
```bash [pnpm]
pnpm add -D @ctxo/lang-sql
```
```bash [npm]
npm install --save-dev @ctxo/lang-sql
```
```bash [yarn]
yarn add -D @ctxo/lang-sql
```
:::

`ctxo init`, `ctxo doctor` (language coverage) and `ctxo index --install-missing`
suggest the plugin when the repository has at least 5 `.sql` files and they are
at least 2% of its files (as `git ls-files` lists them). SQL has no manifest
file, so a few scripts in a large code base do not trigger the suggestion;
install the plugin yourself in that case. It is a protocol v2 plugin: an older
CLI skips it with a warning, so upgrade `@ctxo/cli` together with it.

## What it extracts

### Symbols

| Kind | Source |
| --- | --- |
| `table` | `CREATE [OR ALTER] TABLE`, with a `columns` annotation (every column, lowercase, sorted) |
| `view` | `CREATE [OR ALTER] VIEW`, `ALTER VIEW` |
| `procedure` | `CREATE [OR ALTER] PROC[EDURE]`, `ALTER PROC[EDURE]` |
| `function` | `CREATE [OR ALTER] FUNCTION`, `ALTER FUNCTION` |

The symbol ID carries the canonical two-part name, so a table defined in
`db/lending.sql` is `db/lending.sql::dbo.loans::table`. The symbol `name` keeps
the declared spelling, without delimiters and without an added schema.

### Edges

| Kind | From a view, procedure or function body |
| --- | --- |
| `reads` | tables after `FROM`, `JOIN`, `APPLY`, in a `FROM` comma list and after `MERGE ... USING` |
| `writes` | targets of `INSERT [INTO]`, `UPDATE`, `DELETE [FROM]`, `MERGE [INTO]`, `TRUNCATE TABLE`, `SELECT ... INTO` and `OUTPUT ... INTO` |
| `executes` | `EXEC` / `EXECUTE` of a procedure name |

Edge targets are 2-part references such as `dbo.loans::table` and
`dbo.usp_notifymember::procedure`. Ctxo resolves a table reference to the
defining `table` or `view`, whichever defines the name. See
[several definitions](#several-definitions-of-one-object) for what happens when
more than one file defines it.

```sql
-- db/lending.sql
CREATE TABLE dbo.Loans (Id INT PRIMARY KEY, MemberId INT, ClosedAt DATETIME2 NULL);
GO
CREATE PROCEDURE dbo.usp_CloseLoan @id INT AS
BEGIN
  UPDATE dbo.Loans SET ClosedAt = SYSUTCDATETIME() WHERE Id = @id;   -- writes dbo.loans
  INSERT INTO dbo.LoanEvents (LoanId, Kind) VALUES (@id, 'closed');   -- writes dbo.loanevents
  EXEC dbo.usp_NotifyMember @id;                                      -- executes dbo.usp_notifymember
END
```

## Rules

- **Names.** One to four dot-separated parts. `[...]` (with `]]`) and `"..."`
  delimiters are removed. A one-part name gets schema `dbo`. Three- and
  four-part names, temp tables (`#loans`), table variables (`@loans`), CTE
  names, aliases and the `sys` and `information_schema` schemas are skipped.
- **Case.** Only ASCII `A` to `Z` is folded to lowercase. `Ö`, `ı`, `İ` and every
  other character are kept, so `[dbo].[Ödünç Kaydı]` matches byte for byte on
  every side.
- **Bodies.** A view, procedure or function body ends at the end of its `GO`
  batch, or at the next view, procedure or function definition when `GO` is
  missing. `CREATE TABLE` or `ALTER TABLE` inside a body is body text: it
  defines nothing and adds no columns, and its DML is an ordinary access of the
  body.
- **Columns.** The column-list elements of `CREATE TABLE` (not constraints,
  keys, checks or indexes), plus `ALTER TABLE ... ADD` outside a body for a table
  defined in the same file.
- **Merging.** Two definitions of one object in a file merge into the first.
- **Not code.** Comments (`--`, nested `/* */`), string literals and `GO` inside
  them never produce accesses. Table hints such as `WITH (NOLOCK)` are fine. A
  leading byte order mark is ignored, and UTF-16 scripts saved by SSMS (with a
  byte order mark) are decoded.
- **Not edges.** Calls to SQL functions, table-valued functions in `FROM`,
  dynamic SQL (`EXEC (@sql)`, `EXEC @proc`) and `EXECUTE AS`. A recursive
  procedure has no self edge. SQL objects carry no complexity metrics.

## Several definitions of one object

Migration history often defines one object several times: the procedure is
created in `db/migrations/V1__init.sql` and changed with
`CREATE OR ALTER PROCEDURE` in `db/migrations/V7__close_loan.sql`, and a copy of
the schema sits in `docs/`. Every data edge points at one definition, the
winner, picked in this order:

1. outside test files, by the default test globs (`index.tests` is not
   consulted);
2. then not under a folder named `docs`, `doc` or `documentation` (ASCII case
   ignored);
3. then the codepoint-smallest symbol ID (the first file in sorted path order).

Among production copies that means the smallest path, not necessarily the
newest migration: `V10__` sorts before `V7__`. To keep docs or test copies out
of the index altogether, add them to `index.ignore`.

The copies still share one identity:

- [`get_blast_radius`](/mcp-tools/get-blast-radius),
  [`find_importers`](/mcp-tools/find-importers), `get_pr_impact`,
  `get_context_for_task`, the safe-edit guard and `ctxo blast-radius` give the
  same answer for every copy and for the 2-part ID (`dbo.usp_closeloan::procedure`):
  the winner's dependents. A pull request that adds `CREATE OR ALTER PROCEDURE`
  in a new migration therefore reports the procedure's callers.
- Forward edges stay per copy:
  [`get_logic_slice`](/mcp-tools/get-logic-slice) on a copy's full ID walks that
  copy's own body. A 2-part ID walks the winner's body.
- When a candidate executes a procedure, the [contexts view](/cli/contexts)
  gives it the bodies of every production copy (outside test files and docs
  folders), or the winner's body alone when no copy is production. Docs and
  test copies of a procedure that has a production copy add nothing there.

## C# interplay

When this plugin is installed, the CLI tells every plugin that `.sql` files
are indexed (`capabilities.sqlCallSites`). The [C# plugin](/languages/csharp#sql-at-call-sites)
then adds `reads`, `writes` and `executes` edges from C# methods to the same
`dbo.loans::table` targets, for constant SQL at known ADO.NET, Dapper
(including `CommandDefinition`), `SqlBulkCopy` and EF Core call sites (Roslyn
tier, .NET SDK 8+). A C# method and the stored procedure that both touch
`dbo.loans` then meet in the graph:

- [`get_blast_radius`](/mcp-tools/get-blast-radius) on a table lists its readers
  and writers as `confirmed` dependents, in SQL and in C#.
- [`find_importers`](/mcp-tools/find-importers) with `edgeKinds: ["writes"]`
  lists every writer of a table.
- The [contexts view](/cli/contexts) reports tables that two or more candidate
  contexts read or write. A procedure's reads and writes count for the
  candidates that execute it, not for the candidate that holds the script,
  unless no candidate executes it.

Without this plugin the C# plugin emits no SQL edges. A table that C# code
references but no indexed `.sql` file defines stays an unresolved reference in
the graph and appears as an external resource in the contexts view.

## Effects on the other tools

- **Blast radius.** `reads`, `writes` and `executes` are `confirmed` tiers, so the
  safe-edit guard also guards heavily used tables and procedures.
- **Dead code.** Symbols in `.sql` files are never reported by
  [`find_dead_code`](/mcp-tools/find-dead-code): their consumers may live outside
  the index.
- **Communities.** Data edges stay out of symbol-level communities and boundary
  violations; the contexts view reports data coupling instead.
- **Contexts view coverage.** At the default `contextsView.weights.data` of 0, a
  `.sql` file joins a candidate only through co-change. Scripts that never
  change together with other files stay unclustered and lower `coverage`; on one
  production fixture, 48 such scripts took it from 0.99 to 0.91 without moving
  any other file. Leave them out with `contextsView.exclude` if the number
  matters. A table that shares its name with a C# class can also appear as a
  [collision](/cli/contexts#collisions-and-sql-tables).
- **Search.** [`search_symbols`](/mcp-tools/search-symbols) and
  [`get_symbol_importance`](/mcp-tools/get-symbol-importance) accept `kind`
  `table`, `view` and `procedure`.

## Known limitations

- **T-SQL only**, with `dbo` as the default schema. Neither is configurable yet.
- **Size limit: 5 MiB.** A `.sql` file larger than 5 MiB is skipped: no
  symbols, no edges, and one warning from `ctxo index`
  (`skipped <file>: <n> MiB is over the 5 MiB SQL size limit`). Such files are
  usually data dumps or seed scripts, whose top-level DML gives no edges anyway,
  and parsing them could exhaust memory. Keep definitions in their own scripts,
  or add a dump to `index.ignore` to silence the warning.
- **Top-level DML is skipped.** An `INSERT` or `SELECT` outside any definition
  (a migration or seed script) produces no edges. Co-change still links those
  scripts to the code that changes with them.
- **`ALTER TABLE ... ADD` columns count only in the defining file.**
- **CTE scope.** A CTE name is skipped from its `WITH` to the next top-level `;`
  or the end of the batch. A table that reuses a CTE name later in the same
  batch without a `;` in between is therefore skipped here, while ScriptDom (the
  C# side) reads it.
- **Constant SQL only.** Dynamic SQL is not followed.

The rules are pinned by a conformance corpus in
`packages/sql-extract/corpus` that `@ctxo/sql-extract`, this plugin and the C#
plugin's ScriptDom parser all run, so the TypeScript and C# sides agree. The
design record is
[ADR-017](https://github.com/alperhankendi/Ctxo/blob/master/docs/architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md).

## Related

- [C#](/languages/csharp): SQL at call sites
- [Edge kinds](/reference/edge-kinds) and [Symbol IDs](/reference/symbol-ids)
- [`ctxo contexts`](/cli/contexts): shared tables between candidate contexts
- [Writing a plugin](/languages/writing-a-plugin): the protocol v2 surface
