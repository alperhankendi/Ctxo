---
title: "C#"
description: "@ctxo/lang-csharp: Roslyn full tier + tree-sitter fallback."
---

# C#

Plugin: **`@ctxo/lang-csharp`** ([npm](https://www.npmjs.com/package/@ctxo/lang-csharp))
Parser: **`ctxo-roslyn`** helper (.NET SDK 8+) with **tree-sitter-c-sharp** fallback
Tier: **`full`** (advertised), downgrades to `syntax` when .NET SDK is missing
Extensions: `.cs`

## What this plugin does

The C# plugin wraps a small .NET helper project (`tools/ctxo-roslyn`) that
hosts the Roslyn compiler APIs. At index time the plugin launches the helper
as a long-running process, loads the solution or project, and streams
per-file index results back over stdio. A composite adapter picks between
Roslyn and a tree-sitter fallback at `initialize()` time so you never have
to configure which one is active.

If .NET SDK 8+ is not on `PATH`, or no `.sln` / `.csproj` is found, the
plugin downgrades to the tree-sitter syntax adapter. Both adapters produce
the same `SymbolNode` and `GraphEdge` shapes; only the resolution quality
differs.

The plugin also falls back to tree-sitter when the helper itself cannot
restore its NuGet packages or build (for example on a private or offline
feed). Symbols and attribute annotations are kept (with literal arguments only,
see [tier differences](#attribute-annotations)); the Roslyn-tier details and
the [SQL call-site edges](#sql-at-call-sites) are lost. `ctxo index` then
reports `C#: N files (syntax tier - the Roslyn helper failed, run "ctxo doctor")`,
and the [`csharp_tier` doctor check](/cli/doctor#c-analysis-tier) says why.

## Install

::: code-group
```bash [pnpm]
pnpm add -D @ctxo/lang-csharp
```
```bash [npm]
npm install --save-dev @ctxo/lang-csharp
```
```bash [yarn]
yarn add -D @ctxo/lang-csharp
```
:::

Or:

```bash
ctxo install csharp --yes
```

For full tier, install a .NET SDK 8+ alongside Node.js. The helper project
lives inside the installed plugin and is restored on first use: Roslyn
(`Microsoft.CodeAnalysis`) and `Microsoft.SqlServer.TransactSql.ScriptDom` come
from your NuGet sources, so they must be reachable (nuget.org or a mirror).

The helper targets `net8.0` with `RollForward` set to `Major`: the .NET host
keeps using an installed .NET 8 runtime, and on a machine with only a newer
runtime it rolls forward to that one. The built helper has been run with
`dotnet exec --fx-version` on .NET 8, 9 and 10.

## Roslyn vs tree-sitter

| Capability                                                     | Roslyn (`full`) | tree-sitter (`syntax`) |
| -------------------------------------------------------------- | :-------------: | :--------------------: |
| Symbol extraction                                              |       yes       |          yes           |
| `imports` edges                                                |       yes       |          yes           |
| Cross-file `calls` resolution                                  |       yes       |        limited         |
| `extends` / `implements` on nominal types                      |       yes       |          yes           |
| Generic type argument `uses` edges                             |       yes       |         no             |
| Extension methods resolved to defining class                   |       yes       |         no             |
| Partial class merging across files                             |       yes       |         no             |
| Cyclomatic complexity                                          |       yes       |          yes           |
| Attribute annotations                                          |       yes       |          yes           |
| `named.type` (resolved attribute class)                        |       yes       |         no             |
| SQL edges at known call sites (needs `@ctxo/lang-sql`)         |       yes       |         no             |

Roslyn drives the `full` tier because it can ask the real compiler for the
symbol behind every `IdentifierNameSyntax`, which tree-sitter cannot.

## What it extracts

### Symbols

| Kind        | Sources                                                         |
| ----------- | --------------------------------------------------------------- |
| `class`     | `class` declarations (partial classes merged in full tier)      |
| `interface` | `interface` declarations                                        |
| `method`    | Methods, constructors, property accessors                       |
| `function`  | Local functions, top-level statements                           |
| `type`      | `struct`, `record`, `enum`, `delegate`                          |
| `variable`  | Top-level fields and constants                                  |

### Edges

| Kind         | Notes                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| `imports`    | `using` directives                                                       |
| `calls`      | Method invocations; resolved against the `IMethodSymbol` in full tier    |
| `extends`    | Base class in `: Base` clauses                                           |
| `implements` | Interfaces in the same base list                                         |
| `uses`       | Type references in fields, parameters, generic arguments, attributes     |
| `reads`, `writes`, `executes` | Constant SQL at known data-access call sites (Roslyn tier, with `@ctxo/lang-sql`) |

## Attribute annotations

Every symbol carries the attributes written on it as `annotations`, in both
tiers. They are always on and live in the JSON index only.

```json
{
  "symbolId": "tests/Lending.Tests/LoanTests.cs::Lending.Tests.LoanTests.ClosesLoan::method",
  "name": "Lending.Tests.LoanTests.ClosesLoan",
  "kind": "method",
  "annotations": [
    { "name": "Fact", "named": { "type": "Xunit.FactAttribute" } },
    { "name": "Trait", "args": ["Category", "Loans"], "named": { "type": "Xunit.TraitAttribute" } }
  ]
}
```

- `name` is the attribute name as written, without namespace and without the
  `Attribute` suffix.
- Only constant arguments are kept. In the Roslyn tier: strings and characters
  as their value, numbers in invariant culture, `true` and `false`, enum
  constants as `Type.Member`, `typeof(T)` as the type's display string, array
  arguments flattened, nulls skipped. `args` and `named` are omitted when empty.
- Caps: 20 attributes per symbol, 10 positional entries and 10 named entries
  plus the reserved `type` each, 200 characters per value.
- `named.type` is the attribute class's fully qualified name. Only the Roslyn
  tier knows it, when the class resolves. A source argument that is itself
  named `type` is dropped in both tiers, so it never takes that key.
- **Tier differences.**
  - Tree-sitter keeps literal arguments only (strings, numbers, booleans).
    Enum constants, `typeof(T)`, array arguments and other expressions are
    dropped there.
  - In the Roslyn semantic path an argument written with a parameter name
    (`name: "x"`) arrives in `args`; tree-sitter puts it in `named`.
  - Roslyn formats real-number exponents its own way.

The first `ctxo index` after upgrading to a version with annotations rewrites
the committed index JSON of every C# file once.

Test-framework attributes (`Fact`, `Theory`, `Test`, `TestCase`, `TestMethod`,
`TestClass` and five more) mark a file as a test file for the
[contexts view](/cli/contexts). Once annotations are in the index, a file
matched only by the name globs `**/*Test.cs` or `**/*Tests.cs` needs one of them
to count as a test. See the [config reference](/reference/config-schema#test-files).

- **Exact names only.** Custom attributes derived from `Fact` or `Theory` (a
  project's own `[LoanFact]`, say) are not recognised, because attribute base
  types are not resolved. A `*Tests.cs` file outside the test folders that uses
  only such attributes becomes a production file; add an `index.tests` glob.
- **Capital `Tests/` folders.** A bare `Tests/` or `Test/` folder is not a
  default test glob (`**/tests/**` is case-sensitive). Add it to `index.tests`.

::: warning Run a full `ctxo index` after upgrading
After upgrading `@ctxo/lang-csharp`, run a full `ctxo index` once. An
incremental run (`--files`, `--commit`, and so the post-commit hook) gives
annotations only to the files it re-indexes, but the contexts view already
counts the index as annotated. Until the full run, every name-only
`*Test.cs` / `*Tests.cs` match that has not been re-indexed yet shows up as a
production file.
:::

## SQL at call sites

With [`@ctxo/lang-sql`](/languages/sql) installed and the Roslyn tier active,
the helper parses **constant** SQL at known call sites with
`Microsoft.SqlServer.TransactSql.ScriptDom` and adds `reads`, `writes` and
`executes` edges from the calling method or constructor to `dbo.loans::table`
style targets, the same ones the SQL plugin defines.

| API | SQL text | Procedure name when |
| --- | --- | --- |
| `SqlCommand` (Microsoft.Data.SqlClient, System.Data.SqlClient) | constructor argument `cmdText` | `CommandType = CommandType.StoredProcedure` on the same command in the same method |
| `CommandText` on `SqlCommand`, `DbCommand`, `IDbCommand` and subtypes | simple assignment | same |
| Dapper `SqlMapper` methods starting with `Query` or `Execute` | argument `sql` | `commandType: CommandType.StoredProcedure` |
| Dapper `CommandDefinition` constructor | argument `commandText` | its `commandType` argument (named or positional) is `CommandType.StoredProcedure` |
| `SqlBulkCopy.DestinationTableName` | simple assignment | never; the table is written |
| EF Core `FromSqlRaw`, `ExecuteSqlRaw`, `ExecuteSqlRawAsync`, `SqlQueryRaw` | argument `sql` | never |

```csharp
public sealed class LoanRepository
{
    private const string CloseLoanSql =
        "UPDATE dbo.Loans SET ClosedAt = SYSUTCDATETIME() WHERE Id = @id";

    private static readonly string OpenLoansSql =
        "SELECT Id FROM dbo.Loans WHERE ClosedAt IS NULL";

    public void CloseLoan(SqlConnection connection, int id)
    {
        using var command = new SqlCommand(CloseLoanSql, connection);   // writes dbo.loans
        command.Parameters.AddWithValue("@id", id);
        command.ExecuteNonQuery();
    }

    public void NotifyMember(SqlConnection connection, int id)
    {
        using var command = new SqlCommand("dbo.usp_NotifyMember", connection)
        {
            CommandType = CommandType.StoredProcedure,                   // executes dbo.usp_notifymember
        };
        command.ExecuteNonQuery();
    }

    public IEnumerable<int> OpenLoans(IDbConnection connection) =>
        connection.Query<int>(OpenLoansSql);                             // no edge: static readonly

    public void RenewLoan(IDbConnection connection, int id) =>
        connection.Execute(new CommandDefinition(
            "dbo.usp_RenewLoan", new { id },
            commandType: CommandType.StoredProcedure));                  // executes dbo.usp_renewloan
}
```

The `SqlMapper` overloads that take a `CommandDefinition` have no `sql`
argument, so the definition's constructor is the call site: the edge belongs to
the method that constructs it.

- **Constants only.** Literals, `const` fields, constant concatenation, verbatim
  and raw strings count. SQL built at runtime, interpolation with non-constant
  holes, parameters and `static readonly` fields do not. To make SQL visible,
  declare it `const string`, not `static readonly string`.
- **EF placeholders.** EF Core `{0}` placeholders are rewritten to parameters
  (`@p0`) before parsing.
- **Dapper lists.** `IN @ids` is read as `IN (@ids)`.
- **CommandType** is recognised only on a local and in an object initializer of
  the same method. `CommandText +=` builds text at runtime and counts as
  non-constant.
- **Parse errors.** A constant that ScriptDom rejects adds no edges and never
  stops indexing.
- **Counts.** `DEBUG=ctxo:roslyn ctxo index` logs
  `Roslyn SQL call sites: N constant, M non-constant, K unparsable`.
- **Fallback.** The tree-sitter tier gives no SQL edges, and without
  `@ctxo/lang-sql` the plugin emits none.

## Solution (.sln) discovery

Roslyn needs a project or solution to open. The plugin probes, in order:

1. A `*.sln` file in the root, then the shallowest `*.sln` up to three levels down
2. A `*.slnx` file, the same way
3. The first `*.csproj` up to three levels down

A repository with a lone `.csproj` and no solution file indexes in the Roslyn
tier. With several `.csproj` files and no solution, only the first project's
files get Roslyn symbols; add a solution file that lists them all.

If nothing is found, Roslyn logs `Roslyn adapter unavailable: no .sln or
.csproj found` and the tree-sitter fallback takes over. For nested layouts,
keep a solution file at the ctxo project root, or run `ctxo index` from the
directory that contains the `.sln`.

## Known issues

- **Cold start:** the first Roslyn run restores NuGet packages for
  `ctxo-roslyn` (Roslyn and ScriptDom) and warms up MSBuild. Subsequent runs
  are much faster thanks to the keep-alive process used by `ctxo watch`.
- **Idle keep-alive:** the `ctxo watch` keep-alive shuts itself down after a
  period without requests. The next re-index restarts it once; if the restart
  fails, the file is re-indexed with tree-sitter instead of being written with
  zero symbols.
- **Restore failures:** when the helper cannot restore or build, indexing falls
  back to tree-sitter instead of losing the C# files. Run `ctxo doctor` to see
  the restore error.
- **Source generators:** generated files in `obj/Generated` are indexed
  like any other `.cs` file. If you do not want them in the graph, add
  `obj/**` to `.ctxo/config.yaml#index.ignore`.
- **Scripting files** (`.csx`) are not supported.

## Related

- [SQL](/languages/sql)
- [Dependency graph](/concepts/dependency-graph)
- [Symbol IDs](/reference/symbol-ids)
- [Edge kinds](/reference/edge-kinds)
- [Languages overview](/languages/overview)
