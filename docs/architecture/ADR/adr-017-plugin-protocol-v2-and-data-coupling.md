# ADR-017: Plugin Protocol v2, Data Coupling and Facts

| Field | Value |
|---|---|
| **Status** | Accepted (0.13) |
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
- This PR lands the types, the schema and the plumbing. The detectors land in PR 4.

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
- **Release (K40).** Protocol v2 ships in `@ctxo/plugin-api` 0.9.0, because the separately staged 0.8.0 release on protocol v1 lands first, and the CLI reaches 0.13 with this work. The peer ranges cover both release orders: `^0.7.3 || ^0.8.0 || ^0.9.0` for the existing plugins and `^0.8.0 || ^0.9.0` for `@ctxo/lang-sql`. PR 1B is rebased onto the staged release before merge, and `changeset status` must show no dependent receiving a major bump.
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
- **Core requirement.** `@ctxo/lang-sql` needs a v2 core and declares `^0.8.0 || ^0.9.0` as its plugin-api peer.
- **Constants only.** SQL held in variables, built dynamically or kept in `static readonly` fields is missed. ORMs and query builders are not covered.
- **Roslyn fallback (K39).** The Roslyn helper gains a ScriptDom NuGet reference, restored for every C# user. If the restore or build fails (for example a private or offline feed that does not carry the package), `@ctxo/lang-csharp` falls back to the tree-sitter path. Symbols are kept, and the tree-sitter tier still emits attribute annotations, with literal arguments only (strings, numbers, booleans). Only the Roslyn-tier details (the resolved `named.type` and non-literal argument values such as enum constants, `typeof(T)` and arrays) and the SQL call-site edges are lost. `ctxo index` reports the syntax tier, and the `csharp_tier` doctor check probes `dotnet restore` of the helper and warns with the first error line and a fix hint.
- **Resolution ambiguity.** When several files define the same name, kind-agnostic matching picks one winner, and every data edge points at it. Amended after the fixture run (R2), where 26 of 30 multi-defined names had resolved to a docs or test copy under plain first-path-wins:
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
