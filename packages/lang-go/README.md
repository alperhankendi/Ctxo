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
