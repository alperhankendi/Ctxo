# Dev Agent Prompt — Story 7.5: Go Full-Tier via `ctxo-go-analyzer`

Copy everything below the `---` line into the new session.

---

You are picking up Ctxo Story 7.5: shipping Go full-tier semantic analysis. All planning is done. Your job is end-to-end implementation in a single session — no phasing, no further design discussion.

## Where you are

- **Worktree:** `d:\workspace\Ctxo\.claude\worktrees\gopls-mcp-spike`
- **Branch:** `worktree-gopls-mcp-spike`
- **Project root for all paths in this prompt:** the worktree above

Run all commands from the worktree. Do NOT `cd` to `d:\workspace\Ctxo` (that is the main checkout).

## Read first (in this order)

1. `docs/architecture/ADR/adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md` — the decision and all 4 resolved open questions
2. `docs/design/go-full-tier-plan.md` — the implementation checklist, file-by-file gap list, test strategy, execution sequence
3. `docs/artifacts/epics.md` § Story 7.5 — acceptance criteria
4. `CLAUDE.md` — project rules (especially: no `console.log`, plugin boundary, error handling, naming conventions)
5. `packages/lang-csharp/` — **the reference implementation you will mirror.** Specifically read:
   - `package.json`
   - `src/composite-adapter.ts`
   - `src/csharp-adapter.ts`
   - `src/roslyn/roslyn-adapter.ts`
   - `src/roslyn/roslyn-process.ts`
   - `src/roslyn/solution-discovery.ts`
   - `src/logger.ts`
   - `tools/ctxo-roslyn/Program.cs`
   - `tools/ctxo-roslyn/ctxo-roslyn.csproj`
   - `src/__tests__/` — note the vitest patterns
6. `packages/lang-go/` — current state you are extending
7. `packages/plugin-api/src/types.ts` — `SymbolNode`, `GraphEdge`, `ComplexityMetrics`, `ILanguageAdapter` shapes you must produce

## Mission

Add type-aware semantic analysis to the Go plugin so that ctxo's graph tools (`get_blast_radius`, `find_importers`, `get_logic_slice`, `get_symbol_importance`, `get_class_hierarchy`, `find_dead_code`) return accurate results on Go codebases, matching the fidelity C# reached via Roslyn.

The strategy is the **Go analog of `ctxo-roslyn`**: a standalone Go binary inside the plugin package that uses Go's compiler libraries for analysis, talks to the TypeScript plugin via JSONL on stdout. Tree-sitter is retained as a co-equal layer for symbol inventory + complexity metrics + broken-code tolerance + fallback.

## Hard constraints (do not violate)

1. **`packages/cli/` must not change.** No new files, no edits to existing files, no new dependency in `packages/cli/package.json`. All Go-related code stays in `@ctxo/lang-go`. If you find yourself wanting to edit cli, stop and reconsider — the plugin API is sufficient.
2. **`packages/plugin-api/` must not change.** Current `SymbolNode` / `GraphEdge` / `ComplexityMetrics` shapes are sufficient.
3. **No VTA** (Variable Type Analysis from `x/tools/go/callgraph/vta`). RTA only.
4. **No `console.log`** anywhere — use `createLogger('ctxo:lang-go')` pattern from the plugin's own logger (mirror `packages/lang-csharp/src/logger.ts`).
5. **No barrel exports** — import directly from source file paths.
6. **Co-locate tests** in `__tests__/` next to the source.
7. **Match the existing naming conventions** in `CLAUDE.md` (PascalCase types, kebab-case files, etc.).

## Library stack for the binary (decided, do not change)

| Package | Role |
|---|---|
| `go/ast`, `go/token`, `go/parser` (stdlib) | AST + positions |
| `go/types` (stdlib) | Type checking, `types.Implements()`, struct embedding, generics |
| `golang.org/x/tools/go/packages` | Workspace loading; handles `go.work` natively |
| `golang.org/x/tools/go/ssa` | SSA form for callgraph |
| `golang.org/x/tools/go/callgraph` + `callgraph/rta` | Reachability + interface dispatch refinement |
| Reflect-safe heuristics ported from `golang.org/x/tools/cmd/deadcode` | Prevents false-positive dead code from `reflect`, plugin loading, JSON unmarshal |

## Resolved decisions (do not re-litigate)

| # | Decision |
|---|---|
| 1 | `go.work` multi-module supported from day one (`go/packages` handles it) |
| 2 | Binary built lazily via `go build -trimpath -o ~/.cache/ctxo/lang-go-analyzer/<sourceHash>/ctxo-go-analyzer[.exe]`. Cache key = source hash + `go version`. |
| 3 | RTA runs as a separate phase with **60s timeout**. RTA failure = `_meta.hint` warning + reduced precision, semantic edges still returned. Whole-binary crash = composite falls back to tree-sitter. |
| 4 | Generics: emit single `uses` edge to **unconstructed generic type**; preserve `typeArgs: ["int"]` on edge metadata. Do NOT emit per-instantiation symbols. |

## Files to create (mirror lang-csharp layout)

Inside `packages/lang-go/`:

| New file | Mirrors |
|---|---|
| `src/logger.ts` | `packages/lang-csharp/src/logger.ts` |
| `src/composite-adapter.ts` | `packages/lang-csharp/src/composite-adapter.ts` |
| `src/analyzer/analyzer-adapter.ts` | `packages/lang-csharp/src/roslyn/roslyn-adapter.ts` |
| `src/analyzer/analyzer-process.ts` | `packages/lang-csharp/src/roslyn/roslyn-process.ts` |
| `src/analyzer/module-discovery.ts` | `packages/lang-csharp/src/roslyn/solution-discovery.ts` |
| `src/analyzer/toolchain-detect.ts` | (inline in roslyn-adapter — extract here for clarity) |
| `tools/ctxo-go-analyzer/main.go` | `tools/ctxo-roslyn/Program.cs` |
| `tools/ctxo-go-analyzer/go.mod` | `tools/ctxo-roslyn/ctxo-roslyn.csproj` |
| `tools/ctxo-go-analyzer/internal/load/` | (loader: `go/packages`) |
| `tools/ctxo-go-analyzer/internal/symbols/` | (AST → `SymbolNode`) |
| `tools/ctxo-go-analyzer/internal/edges/` | (type-resolved `calls` / `uses` / `implements` / `extends`) |
| `tools/ctxo-go-analyzer/internal/reach/` | (SSA + RTA + reflect-safe heuristics) |
| `tools/ctxo-go-analyzer/internal/emit/` | (JSONL writer) |

## Files to modify

| File | Change |
|---|---|
| `packages/lang-go/src/index.ts` | `tier: 'syntax'` → `'full'`; `createAdapter` returns `new GoCompositeAdapter()`; export `GoCompositeAdapter`, `GoAnalyzerAdapter` |
| `packages/lang-go/src/go-adapter.ts` | Remove the exported-only filter so unexported symbols flow through tree-sitter as well |
| `packages/lang-go/package.json` | Add binary sources to `files`: `["dist/", "tools/ctxo-go-analyzer/**/*.go", "tools/ctxo-go-analyzer/go.mod", "tools/ctxo-go-analyzer/go.sum", "README.md"]` |

## JSON schema (binary → plugin)

JSONL on stdout. Match `RoslynBatchResult` shape from `packages/lang-csharp/src/roslyn/roslyn-process.ts` for cross-language consistency:

```jsonc
{"type":"file","file":"...","symbols":[...],"edges":[...],"complexity":[]}
{"type":"projectGraph","projects":[...],"edges":[...]}
{"type":"summary","totalFiles":N,"elapsed":"..."}
```

`complexity` array is empty from binary — tree-sitter layer fills it (composite merges them).

Edge with generics metadata example:
```json
{"from":"pkg/foo.go::funcA::function","to":"pkg/list.go::List::class","kind":"uses","typeArgs":["int"]}
```

## Execution order (from plan §3)

1. Scaffold `tools/ctxo-go-analyzer/` skeleton + `go.mod` + main loop emitting empty JSONL — proves spawn works
2. `internal/load` + `internal/symbols` — full symbol coverage
3. `internal/edges` for `calls` + `uses` (type-resolved, no SSA yet)
4. `internal/edges` for `implements` (`types.Implements()` enumeration, all type × interface pairs)
5. `internal/edges` for `extends` (struct embedding via `types.Struct.Field(i).Embedded()`)
6. `internal/reach` — SSA + RTA + reflect-safe; powers `find_dead_code` and refines interface-call edges
7. TypeScript: `analyzer-process.ts`, `analyzer-adapter.ts`, `composite-adapter.ts`, `index.ts` rewire
8. Tests at every step (Go binary tests are independent of Node-side tests — run early and often)
9. Integration fixture under `packages/lang-go/test-fixtures/sample-module/` (see plan §2.3 for required fixture shape)
10. E2E test in `packages/cli/test/e2e/` consuming the fixture (the only test file that touches `packages/cli/`, and it must not import any Go-specific type or run any Go-specific logic)
11. Docs sweep: README, CHANGELOG entry, `architecture.md` FR-13 row marked ✅, `docs/runbook/mcp-validation/` updated

## Test strategy summary

- **Go binary unit tests** — table-driven `go test` per `internal/*` package, fixtures in `testdata/`
- **TypeScript unit tests** — vitest in `packages/lang-go/src/__tests__/`, mirror `lang-csharp/src/__tests__/` patterns
- **Integration test** — fixture Go module exercising interface satisfaction, struct embedding, generics, reflect, dead code (see plan §2.3 for required fixture layout)
- **E2E test** — `ctxo index` over fixture, then call all relevant MCP tools, snapshot match
- **CI matrix** — add Go 1.22 + 1.23 dimension; Go-binary tests gracefully skipped when `go` not on PATH

Tests must pass before each commit. Use `pnpm --filter @ctxo/lang-go test` and `cd packages/lang-go/tools/ctxo-go-analyzer && go test ./...`.

## What "done" looks like

All Story 7.5 acceptance criteria in `docs/artifacts/epics.md` § Story 7.5 met. Specifically:
- All listed files created/modified, no others
- `pnpm -r build` green
- `pnpm -r test` green (including the new Go binary tests, the new vitest specs, and existing tests)
- `pnpm -r typecheck` green
- Fixture Go module: `get_blast_radius` on the test interface returns its 2 implementations; `find_dead_code` flags only the truly dead symbol (not the reflect-accessed one); `get_class_hierarchy` returns embedding hierarchy
- `packages/cli/package.json` byte-identical to start
- `packages/cli/src/**` byte-identical to start (verified via `git diff packages/cli/`)
- Production validation table reproduced in `docs/runbook/mcp-validation/test-sessions/` against a real-world OSS Go project (suggest: `prometheus/prometheus` or `kubernetes/kubectl` — pick one ≥ 200 files)
- CHANGELOG entry under v0.8.0-alpha
- Single coherent commit history on `worktree-gopls-mcp-spike` branch

## What NOT to do

- Do not re-open the design questions resolved in ADR-013 § Open question decisions
- Do not add VTA, even if it looks tempting for a specific call site
- Do not consume `gopls` (LSP or MCP) — the binary owns analysis
- Do not change `@ctxo/plugin-api` types
- Do not add a new MCP tool — Story 7.5 is about making existing tools accurate on Go, not new surface
- Do not skip the reflect-safe heuristics — false-positive dead code = production incident
- Do not commit prebuilt binaries
- Do not phase the work across multiple stories — finish in this session

## When you get stuck

- For library API questions, the canonical references are: <https://pkg.go.dev/golang.org/x/tools/go/packages>, <https://pkg.go.dev/golang.org/x/tools/go/callgraph/rta>, source of `golang.org/x/tools/cmd/deadcode` for reflect handling
- The C# implementation is the structural answer to "how do we lay this out?" — when in doubt, mirror `packages/lang-csharp/`
- If a hard constraint above blocks something you think is needed, leave a clear comment, finish the rest, and surface the question in the final PR description rather than guessing

Begin with reading the files in the "Read first" list, then start at execution order step 1.
