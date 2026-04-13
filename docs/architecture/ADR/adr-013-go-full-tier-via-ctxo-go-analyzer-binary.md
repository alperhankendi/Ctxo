# ADR-013: Go Full-Tier Analysis via Standalone `ctxo-go-analyzer` Binary

| Field          | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| **Status**     | Accepted                                                               |
| **Date**       | 2026-04-13                                                             |
| **Deciders**   | Alper Hankendi                                                         |
| **Decision**   | Ship a standalone Go binary (`ctxo-go-analyzer`) bundled with `@ctxo/lang-go` that uses `go/packages` + `go/types` + `x/tools/go/ssa` + `x/tools/go/callgraph` (RTA) to emit semantic symbols and edges as JSON. Tree-sitter retained as a co-equal fallback layer. Go analog of ADR-007's `ctxo-roslyn` pattern. |
| **Relates to** | FR-13, Epic 7 Story 7.5, [ADR-007](adr-007-csharp-roslyn-lsp.md), [ADR-012](adr-012-plugin-architecture-and-monorepo.md) |

## Context

The current `@ctxo/lang-go` plugin is tree-sitter syntax-tier only. It emits exported symbols and import edges with synthetic placeholder IDs; `calls` / `uses` / `implements` / `extends` edges are never emitted. Every ctxo graph tool (`get_blast_radius`, `find_importers`, `get_logic_slice`, `get_symbol_importance`, `get_class_hierarchy`) is effectively broken on Go projects.

Two of the missing capabilities are **unreachable without a Go type checker**:
- `implements` — Go uses structural typing; interface satisfaction requires method-set comparison against full type info
- Cross-package symbol ID resolution — today's synthetic `<path>::<basename>::variable` placeholder targets break graph traversal at every package boundary

Generics instantiation, vendor/module resolution, unexported-symbol coverage, and reliable dead-code detection fall in the same bucket.

## Decision

Ship a **standalone Go binary** (`ctxo-go-analyzer`) bundled inside the `@ctxo/lang-go` package. The plugin spawns the binary in batch mode per index run, reads JSONL results, and converts them to `SymbolNode` / `GraphEdge` shapes defined by `@ctxo/plugin-api`.

### Library stack inside the binary

| Package | Role |
|---|---|
| `go/ast`, `go/token`, `go/parser` (stdlib) | AST + positions |
| `go/types` (stdlib) | Type checking, `types.Implements()`, struct embedding, generics |
| `golang.org/x/tools/go/packages` | Workspace loading with go.mod / vendor awareness |
| `golang.org/x/tools/go/ssa` | SSA form — prerequisite for callgraph |
| `golang.org/x/tools/go/callgraph` + `callgraph/rta` | Reachability + precise interface dispatch for `find_dead_code` and blast-radius tiers |
| Reflect-safe heuristics (ported from `golang.org/x/tools/cmd/deadcode`) | Prevents false-positive dead code from `reflect`, plugin loading, JSON/ORM unmarshal |

**VTA (Variable Type Analysis) is explicitly excluded** — experimental, added maintenance cost, RTA precision is sufficient.

### Two-layer composite adapter

Mirrors `CSharpCompositeAdapter` ([packages/lang-csharp/src/composite-adapter.ts](../../../packages/lang-csharp/src/composite-adapter.ts)): the plugin picks full-tier at `initialize()` if the binary is available, else falls back to tree-sitter.

| Layer | Owns |
|---|---|
| Tree-sitter (existing) | Symbol inventory + cyclomatic complexity + broken-code tolerance + fallback when Go toolchain missing |
| `ctxo-go-analyzer` binary (new) | Semantic edges (`calls`, `uses`, `implements`, `extends`), cross-package IDs, generics, dead-code signals |

Neither layer subsumes the other. Tree-sitter still owns complexity metrics (`x/tools` does not expose cyclomatic/cognitive) and keeps producing useful output on mid-edit broken files.

### Plugin boundary rule — `ctxo-cli` takes zero new dependencies

All Go-related concerns stay inside `@ctxo/lang-go`:

- Binary sources (`tools/ctxo-go-analyzer/`) ship inside the plugin package (mirrors `packages/lang-csharp/tools/ctxo-roslyn/`)
- Binary distribution, discovery, spawning, JSON parsing, toolchain detection — all inside the plugin
- `@ctxo/cli` sees only the `ILanguageAdapter` interface exposed by `@ctxo/plugin-api`
- No new npm dependency lands in `packages/cli/package.json`
- No `go` / `dotnet` logic leaks into `packages/cli/src/`

This is a hard rule per [ADR-012](adr-012-plugin-architecture-and-monorepo.md).

### Alternatives rejected

| Option | Why not |
|---|---|
| **Talk to `gopls` over LSP** | `gopls` is editor-oriented; request/response per file → N+1 pattern over 100s-1000s of files; batch indexing infeasible. Same rationale as ADR-007 rejecting Roslyn LSP. |
| **Talk to `gopls mcp` (experimental)** | Tool surface missing `implementation`, `callHierarchy`, `typeHierarchy`, `definition` — the exact capabilities we need. Would need LSP fallback anyway, doubling protocol surface. |
| **Import gopls as a library** | gopls is an application, not a library. Its internal packages are unstable and not meant for external consumption. |
| **Stay tree-sitter + heuristics** | `implements` and cross-package resolution are unreachable without type info; project goal of full coverage cannot be met. |
| **Consume `scip-go` output** | Adds a third-party indexer dependency + SCIP→Ctxo schema translation; maintenance outside our control. |
| **Include callgraph VTA** | Experimental; RTA's precision is sufficient for `find_dead_code` and blast-radius tiers; avoid premature cost. |

## Consequences

### Positive
- Full semantic coverage: every graph tool works on Go at the fidelity C# reached with Roslyn
- Consistent with C# — single mental model (`ctxo-roslyn` / `ctxo-go-analyzer`)
- Batch-optimized single-pass indexing, not N+1 over LSP
- Plugin boundary intact: zero impact on `@ctxo/cli`
- RTA-based `find_dead_code` matches Go ecosystem's official `cmd/deadcode` precision

### Negative / accepted costs
- **Indexing time +5-15s on medium repos** (SSA + callgraph build). Tool runtime unaffected — index is heavy, tools read JSON.
- **Memory peak ~5x during index** (SSA form). Transient.
- **We maintain a Go binary** (~1500 LOC estimate). Mitigation: stdlib + `x/tools` are rock-stable; minimal custom logic.
- **Library projects lack entry points** → RTA degrades toward CHA (still produces `implements` edges; dead-code detection weaker). Documented limitation.
- **Reflect false positives** in dead-code analysis. Mitigation: port conservative reflect heuristics from `golang.org/x/tools/cmd/deadcode`.
- **Platform binary distribution** — same postinstall/build strategy as `ctxo-roslyn` (Go toolchain on user machine; binary built on first use or shipped prebuilt).

## Open question decisions (resolved 2026-04-13)

| # | Question | Decision |
|---|---|---|
| 1 | Multi-module workspace (`go.work`) | **Supported from v0.8.** `go/packages` handles it natively; no extra binary code required. Avoids retrofit when monorepos demand it. |
| 2 | Binary build strategy | **Lazy build + hash-keyed cache.** `GoAnalyzerAdapter.initialize()` runs `go build -trimpath -o ~/.cache/ctxo/lang-go-analyzer/<sourceHash>/ctxo-go-analyzer[.exe]` on first use. Cache key = source hash + `go version` output. Postinstall rejected (breaks sandboxed npm installs); `go run` rejected (3-5s overhead per index run). |
| 3 | RTA failure / timeout behaviour | **Layered degradation.** Symbol + basic edge extraction (no SSA) is independent and always completes. RTA runs as a separate phase with 60s timeout. RTA failure or timeout → `find_dead_code` precision degraded + interface-call resolution falls back to type-set enumeration; warning surfaced via `_meta.hint`. Whole-binary crash → composite falls back to tree-sitter (existing behaviour). |
| 4 | Generics edge representation | **Option A — single edge to generic type.** `List[int]` and `List[string]` both emit `uses` edges to the unconstructed `List` symbol; type arguments preserved on edge metadata for future use. Rationale: prevents symbol-table explosion in utility-heavy codebases (`samber/lo`, query builders), preserves PageRank centrality, stays consistent with C# Roslyn behaviour (ADR-007), avoids `find_importers` ambiguity. |

### Future enhancement (deferred, not in v0.8 scope)

**Option B — instantiation-aware queries via edge metadata.** The binary will already attach `typeArgs: ["int"]` to each generic-using edge (zero extra emit cost). A future MCP tool surface — e.g. `get_blast_radius(symbol: "List", typeArgs: ["int"])` — could filter edges by metadata to answer instantiation-specific questions without expanding the symbol table. **Reactivation trigger:** user demand for instantiation-level precision in dead-code or blast-radius queries. Same trigger would extend ADR-007 to keep C#/Go parity.

## Rollout

1. **Scaffold `tools/ctxo-go-analyzer/`** inside `packages/lang-go/` — `go.mod`, `main.go`, JSON schema matching `RoslynBatchResult` shape
2. **Implement loader + type checker** — `go/packages` load, per-package iterate, emit symbols/edges
3. **Add SSA + RTA** — reachability + interface dispatch refinement; reflect-safe guards
4. **TypeScript side:** `GoAnalyzerAdapter` (sibling of `RoslynAdapter`) + `GoCompositeAdapter` (sibling of `CSharpCompositeAdapter`)
5. **Toolchain detection:** `go version` probe in `ctxo doctor`; graceful degradation when absent
6. **Validation:** reproduce ADR-007 before/after table on a real Go service
7. Ship in v0.8.0-alpha

## References
- [ADR-007](adr-007-csharp-roslyn-lsp.md) — sibling decision for C# (same pattern)
- [ADR-012](adr-012-plugin-architecture-and-monorepo.md) — plugin boundaries enforced here
- [packages/lang-csharp/tools/ctxo-roslyn/](../../../packages/lang-csharp/tools/ctxo-roslyn/) — reference implementation to mirror
- [packages/lang-csharp/src/composite-adapter.ts](../../../packages/lang-csharp/src/composite-adapter.ts) — reference composite adapter
- [Epic 7 Story 7.5](../../artifacts/epics.md#story-75-go-full-tier-via-ctxo-go-analyzer-binary)
