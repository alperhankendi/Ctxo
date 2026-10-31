# @ctxo/lang-go

Go language plugin for [Ctxo](https://github.com/alperhankendi/Ctxo). Ships
two analysis tiers selected at runtime:

| Tier | Engine | Activated when |
|---|---|---|
| **Full** | `ctxo-go-analyzer` binary (Go stdlib + `x/tools` SSA + CHA) | Go ≥ 1.22 on PATH **and** the bundled analyzer source builds successfully |
| **Syntax** | `tree-sitter-go` | Go toolchain absent; binary build fails; or analyzer cannot locate `go.mod` / `go.work` |

The composite picks at `initialize()` and forwards every `extractSymbols` /
`extractEdges` call to the active layer. `extractComplexity` is always served
by tree-sitter — the analyzer intentionally emits empty complexity arrays so
the two layers compose cleanly.

## What full-tier adds over tree-sitter

- **Cross-package symbol-id resolution.** `pkg/a` calling `pkg/b.Do()` produces
  an edge whose target is `pkg/b/file.go::Do::function`, not a synthetic
  placeholder. Every `get_blast_radius`, `find_importers`, and `get_logic_slice`
  query that crosses a package boundary now returns real results.
- **`implements` edges.** Go's structural typing means interface satisfaction
  is invisible to a syntactic parser; the analyzer pairs every concrete type
  against every interface and emits an edge when `types.Implements(T, I)` or
  `types.Implements(*T, I)` is true.
- **`extends` edges for embedding.** Anonymous fields (struct embedding) and
  embedded interface members produce explicit hierarchy edges so
  `get_class_hierarchy` works on Go.
- **Generics with `typeArgs` metadata.** `List[int]` and `List[string]` both
  produce a `uses` edge to the unconstructed `List` symbol; the type
  arguments are preserved on edge metadata for future query precision.
  See [ADR-013 §4 Q4](../../docs/architecture/ADR/adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md#open-question-decisions-resolved-2026-04-13).
- **Dead-code detection via CHA reachability.** Unreachable functions and
  methods are emitted in a single `dead` record. A reflect-safe pass marks
  methods of any type touched by `reflect.TypeOf` / `reflect.ValueOf` /
  `reflect.New` or `json.Marshal` / `Unmarshal` / `NewDecoder` / `NewEncoder`
  as live to prevent false positives.

## Struct tags as annotations

Struct field tags become annotations on the struct, in both tiers, always on. Each tagged field
gives one `tag` annotation with the field name in `named.member` and one entry per tag key
(`reflect.StructTag` rules: the first key wins, parsing stops at the first malformed pair; a key
named `type` is dropped):

```go
type Loan struct {
	LoanID string `json:"loan_id" gorm:"column:loan_id;primaryKey"`
}
// Loan: [{ name: 'tag', named: { member: 'LoanID', json: 'loan_id', gorm: 'column:loan_id;primaryKey' } }]
```

The analyzer emits the raw tags and one parser builds the annotations for both tiers. The
tree-sitter tier reads exported structs only and decodes interpreted (double-quoted) tag literals
with JSON rules rather than Go unquote rules; raw-string tags agree in both tiers.

## Test files

The full tier loads packages with their tests: functions and methods in `_test.go` files become
symbols with `calls` edges (a test fake can implement a production interface), so tests count as
dependents in the blast radius. Production analysis, `hasMain` and the dead list are unchanged and
never hold a test symbol. Build-tagged test files (for example `//go:build integration`) are not
loaded, so the full tier gives them no symbols. Loading tests makes full-tier runs slower on modules with
many tests.

## SQL at call sites

With [`@ctxo/lang-sql`](../lang-sql) installed (`capabilities.sqlCallSites`) and the full tier
active, the analyzer reports constant SQL at known call sites, and the plugin turns it into
`reads`, `writes` and `executes` edges from the enclosing function, through
[`@ctxo/sql-extract`](../sql-extract):

- `database/sql`: `Query`, `QueryRow`, `Exec`, `Prepare` and their `Context` forms on `DB`, `Tx`,
  `Conn`, `Stmt`
- sqlx: `Select`, `Get`, `Queryx`, `NamedExec`, `MustExec` (methods and package functions)
- pgx v4 and v5: `Query`, `QueryRow`, `Exec`, including `pgxpool`
- gorm: `Raw`, `Exec`

The callee is resolved through `go/types` and matched on its receiver type; the SQL is the
argument bound to its first `string` parameter, and it counts only when `go/types` gives it a
constant value. User-defined interfaces (sqlc's `DBTX`), method values and method expressions give
no call sites, and the sqlx `...Context` forms are not listed. The tree-sitter tier gives no SQL
edges, and without `@ctxo/lang-sql` there are none.

## Facts

When the host requests facts (`@ctxo/domain` installed, or `index.facts: true`), both tiers report
`literal-comparison`, `normalization`, `retry-timeout` and `endpoint` facts with the shared rules
(see [facts](https://github.com/alperhankendi/Ctxo/blob/master/docs/features/domain-knowledge.md#facts)):

- The analyzer collects evidence behind `--facts=`; the tree-sitter tier finds the same evidence and
  gives the same facts and symbol ids for the same code.
- Comparisons in `if`, `for` conditions, expression `switch` cases and tagless `switch` cases;
  `strings.ToLower`, `strings.TrimSpace` and the other configured normalization methods; numeric
  constants bound to retry and timeout names, and durations (`n * time.Second`,
  `time.Duration(n) * time.Minute`, a bare `time.Hour`), whatever their name.
- Endpoints from `net/http` `HandleFunc` and `Handle` (package functions and `*ServeMux`; a pattern
  `"GET /loans"` gives the verb) and gin `GET`, `POST`, ..., `Any` and `Handle` on `*gin.Engine`,
  `*gin.RouterGroup`, `gin.IRouter` and `gin.IRoutes`; echo `GET`, ..., `Any` and `Add` on `*echo.Echo` and
  `*echo.Group`; chi `Get`, ..., `Handle`, `HandleFunc`, `Method` and `MethodFunc` on `*chi.Mux` and `chi.Router`.
  Group and mount prefixes created in the same file are joined (gin and echo `Group("/api")`, chi `Route`,
  `Group`, `With` and `Mount`); a dynamic, conflicting or unresolved prefix leaves the route as written.
- Raw (backtick) strings are decoded as Go does. The syntax tier matches routes by name, so a
  `HandleFunc` on another type, and router or path constants declared in another file, can read
  differently than in the full tier. A file created during `ctxo watch` gets `facts: []` until the
  next batch.
- Since this release the syntax tier drops type parameters from method receivers
  (`List.Get::method`, as the full tier), a one-time id change for generic methods.

## How the binary is built

On first use, `GoAnalyzerAdapter.initialize()` hashes the analyzer source +
`go version` and runs `go build -trimpath -o
~/.cache/ctxo/lang-go-analyzer/<hash-goVersion>/ctxo-go-analyzer[.exe]`.
Subsequent runs reuse the cached binary. No build happens during `npm install`
to keep package installs sandbox-safe (ADR-013 §4 Q2).

If `go` is not on PATH, build fails, or no `go.mod`/`go.work` is found, the
plugin transparently falls back to tree-sitter and `ctxo doctor` surfaces the
missing toolchain.

## Limitations (v0.8.0-alpha.0)

- **Library mode is approximate.** Without a `main.main` to anchor RTA-style
  reachability, every exported function/method becomes a root. This
  over-approximates liveness — fewer false dead-code reports, but symbols
  that nothing actually consumes still look live.
- **Generic types skipped from `implements` / `extends` enumeration.** Pairing
  generic named types is unstable in current `go/types`; we revisit when the
  upstream API stabilizes.
- **Closures and reflective construction.** Functions passed to stdlib
  callbacks (`sort.Slice(..., func(i,j) bool {...})`) follow a CHA edge so
  they ARE reachable; constructed-via-reflection types are kept alive only
  for the explicit reflect/json call sites listed above.

## Architecture and rationale

See [ADR-013](../../docs/architecture/ADR/adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md)
for the full decision record (alternative options considered, library
choices, open question resolutions). Mirrors the C# pattern from
[ADR-007](../../docs/architecture/ADR/adr-007-csharp-roslyn-lsp.md).
