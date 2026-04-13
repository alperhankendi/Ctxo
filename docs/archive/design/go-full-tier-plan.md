# Go Full-Tier — Implementation Plan (Story 7.5)

Companion to [ADR-013](../architecture/ADR/adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md). This doc is the working checklist for shipping `ctxo-go-analyzer`. Delete after Story 7.5 lands.

## 1. Implementation gaps (what's missing today vs target)

### 1.1 Files to create inside `packages/lang-go/`

Mirrors `packages/lang-csharp/` layout exactly.

| Path | Sibling in lang-csharp | Purpose |
|---|---|---|
| `src/logger.ts` | `src/logger.ts` | Plugin-local logger (no `@ctxo/cli` import — protocol per CLAUDE.md) |
| `src/composite-adapter.ts` | `src/composite-adapter.ts` | `GoCompositeAdapter` — picks full vs syntax tier at `initialize()` |
| `src/analyzer/analyzer-adapter.ts` | `src/roslyn/roslyn-adapter.ts` | `GoAnalyzerAdapter` — full-tier adapter, owns binary lifecycle |
| `src/analyzer/analyzer-process.ts` | `src/roslyn/roslyn-process.ts` | `runBatchAnalyze()` — spawns binary, parses JSONL |
| `src/analyzer/module-discovery.ts` | `src/roslyn/solution-discovery.ts` | Walk up for `go.mod`; multi-module workspace detection |
| `src/analyzer/toolchain-detect.ts` | (inline in roslyn-adapter) | `go version` probe + min version check |
| `tools/ctxo-go-analyzer/main.go` | `tools/ctxo-roslyn/Program.cs` | Binary entry point |
| `tools/ctxo-go-analyzer/go.mod` | `tools/ctxo-roslyn/ctxo-roslyn.csproj` | Module manifest |
| `tools/ctxo-go-analyzer/internal/load/` | — | `go/packages` loader |
| `tools/ctxo-go-analyzer/internal/symbols/` | — | AST → `SymbolNode` extraction |
| `tools/ctxo-go-analyzer/internal/edges/` | — | Type-resolved edge extraction (calls/uses/implements/extends) |
| `tools/ctxo-go-analyzer/internal/reach/` | — | SSA + RTA reachability + reflect-safe heuristics |
| `tools/ctxo-go-analyzer/internal/emit/` | — | JSONL writer, schema matches `RoslynBatchResult` shape |

### 1.2 Files to modify inside `packages/lang-go/`

| File | Change |
|---|---|
| `src/index.ts` | Plugin tier `'syntax'` → `'full'`; `createAdapter` returns `new GoCompositeAdapter()`; export `GoCompositeAdapter`, `GoAnalyzerAdapter` |
| `src/go-adapter.ts` | Remove exported-only filter (unexported symbols flow through); minor — most fixes happen in binary |
| `package.json` | Add `files: ["dist/", "tools/ctxo-go-analyzer/**/*.go", "tools/ctxo-go-analyzer/go.mod", "tools/ctxo-go-analyzer/go.sum", "README.md"]` so binary sources ship in npm tarball |
| `tsup.config.ts` | Verify `external` covers `tree-sitter` (already correct); no new bundler config needed |

### 1.3 Files that MUST NOT change (plugin boundary check)

Hard constraint from [ADR-012](../architecture/ADR/adr-012-plugin-architecture-and-monorepo.md) and CLAUDE.md:

| Path | Why untouched |
|---|---|
| `packages/cli/package.json` | No new dependency lands here |
| `packages/cli/src/**` | No Go-specific code in cli; cli sees only `ILanguageAdapter` |
| `packages/plugin-api/**` | No protocol changes — current `SymbolNode` / `GraphEdge` / `ComplexityMetrics` shapes are sufficient |
| `packages/cli/src/adapters/diagnostics/checks/` | Go toolchain check lives in plugin, surfaces via existing diagnostic plumbing |

If during implementation any change here seems necessary, **stop and revisit** — it's a smell that the plugin boundary is being violated.

### 1.4 Distribution + build pipeline

| Concern | Decision |
|---|---|
| Binary built where? | Lazy on first use: `GoAnalyzerAdapter.initialize()` runs `go build` if binary not in `dist/bin/`. Same approach as `ctxo-roslyn` `dotnet run`. |
| Cache location | `~/.cache/ctxo/lang-go-analyzer/<hash>/ctxo-go-analyzer[.exe]` keyed by source hash + Go version |
| Go toolchain absence | Detected in `initialize()` → `isReady()` returns false → composite falls back to tree-sitter |
| `ctxo doctor` integration | Plugin contributes a check via existing diagnostic surface (no new file in `packages/cli/`) |
| Cross-platform | Go produces native binary; build per-platform on user machine; no prebuilt distribution in v0.8 (matches `ctxo-roslyn`) |

### 1.5 JSON schema (binary → plugin contract)

Reuse the `RoslynBatchResult` shape verbatim where possible — same edge/symbol/complexity types, no schema divergence between languages:

```jsonc
// JSONL stream (one record per line)
{"type":"file","file":"...","symbols":[...],"edges":[...],"complexity":[]}
{"type":"projectGraph","projects":[...],"edges":[...]}
{"type":"summary","totalFiles":N,"elapsed":"..."}
```

Note: `complexity:[]` empty from binary — tree-sitter layer fills it (composite merges).

## 2. Test strategy

### 2.1 Unit tests (Go binary, vitest-equivalent in Go = `go test`)

Inside `tools/ctxo-go-analyzer/internal/*/`:

| Package | Tests |
|---|---|
| `internal/load` | `go.mod` discovery, vendor handling, module boundaries |
| `internal/symbols` | All symbol kinds (function/method/struct/interface/type/var/const), unexported coverage, generics |
| `internal/edges` | `calls` (intra-pkg + cross-pkg), `uses`, `implements` (true positive + true negative cases), `extends` (struct embedding incl. promoted methods), generics instantiation |
| `internal/reach` | RTA from `main`, RTA from `Test*`, reflect escape (assert types reachable via `reflect.TypeOf` are NOT marked dead), library mode (no main → graceful) |
| `internal/emit` | JSONL framing, schema stability vs golden file |

Use **table-driven Go tests** with embedded fixture modules in `testdata/`.

### 2.2 Unit tests (TypeScript plugin side, vitest)

Inside `packages/lang-go/src/__tests__/`:

| File | Tests |
|---|---|
| `composite-adapter.test.ts` | Picks full when binary ready; falls back to tree-sitter when binary absent / crashes / times out; complexity always sourced from tree-sitter |
| `analyzer/analyzer-process.test.ts` | JSONL parsing, malformed line handling, child process timeout, non-zero exit |
| `analyzer/module-discovery.test.ts` | Walks up for `go.mod`, multi-module rejection or partial handling |
| `analyzer/toolchain-detect.test.ts` | `go version` parsing, min version gate, missing toolchain |

Mirror `packages/lang-csharp/src/__tests__/` patterns — same vitest setup, no new test infra.

### 2.3 Integration test — fixture Go module

Single fixture under `packages/lang-go/test-fixtures/sample-module/`:

```
sample-module/
  go.mod
  cmd/app/main.go        # entry point, exercises RTA
  internal/store/        # interface + 2 implementations (tests `implements`)
  internal/sync/         # struct embedding (tests `extends` + promoted methods)
  internal/generic/      # generic List[T] (tests generics)
  internal/reflect/      # reflect.TypeOf usage (tests reflect-safe RTA)
  internal/dead/         # truly unreferenced symbol (tests find_dead_code true positive)
  pkg/api/               # exported package, called from cmd/app
```

Test asserts:
- `extractSymbols` finds all symbols including unexported
- `extractEdges` produces `implements` between interface and both implementations
- `extractEdges` produces `extends` for struct embedding
- `extractEdges` cross-package `calls` resolve to real symbol IDs
- Reflect-accessed type in `internal/reflect/` NOT in dead-code output
- Truly dead symbol in `internal/dead/` IS in dead-code output

### 2.4 E2E test — full ctxo pipeline against fixture

Inside `packages/cli/test/e2e/` (existing harness):

- Run `ctxo index` over the fixture above
- Call all relevant MCP tools (`get_blast_radius`, `find_importers`, `get_class_hierarchy`, `find_dead_code`, `get_logic_slice`)
- Snapshot match expected output

This is the only test that touches `packages/cli/`. It does NOT add Go-specific code to cli — just uses the fixture.

### 2.5 CI matrix

Add to existing GitHub Actions workflow:
- Go 1.22, 1.23 (test matrix dimension)
- Existing OS × Node matrix unchanged
- Skip Go-binary tests when `go` not on PATH (graceful — verifies degradation)

### 2.6 Production validation (one-shot, manual)

Reproduce ADR-007's "Before vs After" table on a real Go service (suggest: indexing ctxo's own `tools/ctxo-go-analyzer/` once it exists, or any sufficiently-sized OSS Go project — Kubernetes `kubelet`, Prometheus, etc.). Capture into `docs/runbook/mcp-validation/test-sessions/`.

## 3. Execution sequence

1. Scaffold `tools/ctxo-go-analyzer/` skeleton + `go.mod`, emit empty JSONL — proves spawn loop works
2. `internal/load` + `internal/symbols` — full symbol coverage; tree-sitter parity check
3. `internal/edges` for `calls` / `uses` (no SSA yet — straight type-resolved)
4. `internal/edges` for `implements` (`types.Implements()` enumeration)
5. `internal/edges` for `extends` (struct embedding)
6. `internal/reach` — SSA + RTA + reflect-safe; powers dead-code
7. TypeScript composite + analyzer adapter wiring
8. Tests at each step (Go binary tests run independently of Node side)
9. Integration + E2E
10. Docs sweep + CHANGELOG entry + production validation table

Each step is independently testable and committable.

## 4. Resolved decisions

All four open questions resolved 2026-04-13. See [ADR-013 § Open question decisions](../architecture/ADR/adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md#open-question-decisions-resolved-2026-04-13) for full rationale.

| # | Question | Decision |
|---|---|---|
| 1 | `go.work` multi-module | Supported from v0.8 (`go/packages` handles it) |
| 2 | Binary build | Lazy `go build -trimpath` → hash-keyed cache at `~/.cache/ctxo/lang-go-analyzer/` |
| 3 | RTA failure | Layered degradation: 60s timeout, RTA-only failure = `_meta.hint` warning + reduced precision; binary crash = tree-sitter fallback |
| 4 | Generics | Option A — single edge to unconstructed generic type, type args on edge metadata (Option B deferred to future tool surface) |
