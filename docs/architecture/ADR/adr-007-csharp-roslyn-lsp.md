# ADR-007: C# Full-Tier Analysis via Roslyn Compiler API

| Field          | Value                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Status**     | Accepted                                                                                 |
| **Date**       | 2026-04-11                                                                               |
| **Deciders**   | Alper Hankendi                                                                           |
| **Decision**   | Standalone .NET console app using Roslyn Compiler API, async ILanguageAdapter, 3-layer warning |
| **Relates to** | FR-14, Epic 7 (Story 7.3), Sprint 4                                                     |
| **Priority**   | V2 roadmap                                                                               |

## Context

The current C# adapter (`tree-sitter-c-sharp`, V1.5) operates at **syntax tier** only. It extracts symbols and basic edges but cannot resolve cross-file dependencies, generic types, or method call graphs. This produces incomplete blast radius analysis and missing dependency edges for C# codebases.

### Observed Symptoms (Production)

When running ctxo on a real-world C# backend project (`CaasBackend`, ~400+ files):

1. **"C# edges not fully resolved"** warning on `get_blast_radius` - the tool falls back to grep
2. **Incomplete `find_importers`** - `using` directives parsed but not resolved to source files
3. **Missing method-level call graph** - `BaseSyncJob` has 34 subclasses, but blast radius only shows direct base_list edges, not transitive callers
4. **Heuristic-based inheritance** - I-prefix pattern matching (`IFoo` = interface) instead of semantic analysis

### Real-World Example: CaasBackend `BaseSyncJob` Analysis

**Project:** CaasBackend (enterprise C# backend, ~400+ files, multiple namespaces)

The AI assistant called `get_blast_radius` for `BaseSyncJob`. Ctxo returned a partial result with the warning `"C# edges not fully resolved"`. The assistant then fell back to manual Read and Grep tool calls, spending 10+ additional tool calls to manually reconstruct what a single `get_blast_radius` call should have delivered.

**What should happen with Roslyn full-tier (V2):**

```
get_blast_radius("BaseSyncJob")
-> 34 confirmed (direct subclasses via extends edge)
-> 12 likely (classes that call methods on subclasses)
-> 8 potential (co-change correlated files)
-> riskScore: 0.92

find_importers("BaseSyncJob")
-> 34 direct importers (subclasses)
-> 58 transitive importers (services, controllers, tests)
-> PageRank: top 3% (critical infrastructure class)
```

### Root Cause: Syntax Tier Limitations

| Capability        | V1.5 (tree-sitter)                                | Needed                                     |
| ----------------- | ------------------------------------------------- | ------------------------------------------ |
| Symbol extraction | Classes, methods, interfaces, enums (public only) | All access levels                          |
| Edge resolution   | File-level `using` directives, `base_list`        | Cross-project, transitive                  |
| Type resolution   | None                                              | Generics, overloads, implicit types        |
| Call graph        | Syntactic only                                    | Semantic: actual method calls, async flows |
| Scope             | Single file                                       | Solution-wide (.sln/.csproj)               |

---

## Decision

### Use Standalone .NET Console App with Roslyn Compiler API

After deep technical analysis comparing three approaches (Roslyn LSP, csharp-ls, standalone .NET app), we chose the **standalone .NET console app** using Microsoft.CodeAnalysis (Roslyn Compiler API) directly.

This approach is proven in production by:
- **scip-dotnet** (Sourcegraph) - SCIP indexer for C#, uses MSBuildWorkspace
- **RoslynMCP** (carquiza) - MCP server with SearchSymbols, FindReferences, AnalyzeCodeComplexity
- **roslyn-mcp** (egorpavlikhin) - MCP server with ValidateFile, FindUsages

### Why NOT Roslyn LSP (Original Plan)

| Problem | Detail |
|---|---|
| Custom protocol required | `solution/open`, `projectInitializationComplete` are non-standard |
| `--stdio` is brand new | Added January 2025, no Node.js precedent exists |
| stdout corruption risk | Third-party Roslyn analyzers can write to stdout, corrupting JSON-RPC |
| N+1 request pattern | 400 files = 400 individual LSP requests (20-60s vs 2-5s single pass) |
| No complexity metrics | LSP protocol has no code metrics support |
| No extends/implements distinction | `typeHierarchy/supertypes` returns single list without type info |
| Batch indexing impossible | LSP is request/response per file, designed for interactive editing |

### Why NOT csharp-ls

| Problem | Detail |
|---|---|
| `outgoingCalls` not implemented | Returns null - cannot build complete call graph |
| `workspace/symbol` hardcoded 100 limit | Insufficient for full codebase indexing |
| Bus factor of 1 | Single maintainer project |
| Requires .NET 10 SDK | Current version requires latest SDK |
| Performance on large solutions | 100+ projects causes multi-minute startup |

### Why Standalone .NET App Wins

| Advantage | Detail |
|---|---|
| **Batch indexing** | Single-pass iteration over all documents: 400 files in 2-5s vs 20-60s |
| **Full Roslyn API** | SymbolFinder, SemanticModel, Compilation, SyntaxTree - no protocol limitations |
| **extends vs implements** | `BaseType` vs `Interfaces` vs `AllInterfaces` as distinct properties |
| **Complete call graph** | `FindCallersAsync` (incoming) + `SemanticModel` syntax walk (outgoing) |
| **Cyclomatic complexity** | `SyntaxKind` enum - compiler-accurate branch counting |
| **IsDirect flag** | `SymbolCallerInfo.IsDirect` distinguishes direct vs virtual/interface dispatch |
| **No stdout corruption** | We control the process, no third-party analyzer interference |
| **No custom protocol** | We design the JSON protocol to match Ctxo's exact needs |
| **Cross-file + cross-project** | `SymbolFinder` operates on entire `Solution` object |
| **Proven** | scip-dotnet, RoslynMCP in production |

---

## Architecture

### High-Level Overview

```
Ctxo MCP Server (Node.js/TypeScript)
  |
  +-- ILanguageAdapter (port - async)
  |     |
  |     +-- TsMorphAdapter       (TS/JS - full tier, sync)     <- V1
  |     +-- TreeSitterAdapter    (Go/C# - syntax tier, sync)   <- V1.5
  |     +-- RoslynAdapter        (C# - full tier, async)       <- V2 (this ADR)
  |           |
  |           +-- spawns via stdio --->  ctxo-roslyn (.NET console app)
  |                                        |
  |                                        +-- MSBuildWorkspace
  |                                        +-- SymbolFinder
  |                                        +-- SemanticModel
  |                                        +-- Compilation
  |
  +-- Composition Root (src/cli/index-command.ts)
        +-- Adapter selection: dotnet available? -> RoslynAdapter
                                Else -> CSharpAdapter (tree-sitter fallback)
```

### .NET Console App (`ctxo-roslyn`)

A minimal .NET 8 app (2 files: `.csproj` + `Program.cs`). Runs as one-shot process:

```
ctxo index (Node.js)
     |
     +-- spawn: dotnet run --project tools/ctxo-roslyn -- MyApp.sln
     |
     |   ctxo-roslyn process:
     |     1. MSBuildWorkspace.OpenSolutionAsync("MyApp.sln")
     |     2. GetProjectDependencyGraph() -> project edges
     |     3. For each .cs file (single pass):
     |        - GetDeclaredSymbol -> symbols
     |        - IOperation tree walk -> edges (calls, uses, creates)
     |        - SymbolFinder.FindCallersAsync -> incoming calls
     |        - BaseType/Interfaces -> extends/implements
     |        - SyntaxKind counting -> complexity
     |     4. Write JSON to stdout (newline-delimited, one line per file)
     |     5. Exit
     |
     +-- Read stdout line by line -> parse into SymbolNode[], GraphEdge[]
     +-- Continue normal ctxo index pipeline (git history, write .ctxo/index/)
```

No stdin protocol needed for `ctxo index`. Arguments via CLI, output via stdout. Simple.

### Watch Mode (Keep-Alive Process)

For `ctxo watch`, the .NET process stays alive and accepts incremental file updates via stdin:

```
dotnet run --project tools/ctxo-roslyn -- MyApp.sln --keep-alive
```

**Keep-alive protocol:**
- Initial: loads solution, outputs `{"type":"ready"}` to stdout
- stdin receives: `{"file":"src/UserService.cs"}` (changed file path)
- .NET uses `solution.WithDocumentText()` for incremental re-compilation (<100ms)
- stdout: re-analyzed file result (same format as batch mode)
- Auto-shutdown after inactivity timeout (frees 500MB-1.5GB memory)
- Node.js side restarts process on next file change if needed

**Why this works:** Roslyn's `Solution` is immutable + snapshot-based. `WithDocumentText()` creates a new solution that reuses all unchanged compilations. Only the changed file's semantic model is recomputed. This gives sub-100ms re-indexing per file change.

### Configuration (`.ctxo/config.yaml`)

```yaml
# .ctxo/config.yaml
csharp:
  # Roslyn process mode: "keep-alive" (default) | "one-shot"
  mode: keep-alive
  # Keep-alive inactivity timeout in seconds (default: 300)
  timeout: 300
  # Explicit solution path (default: auto-discover nearest .sln)
  solution: ./MyApp.sln
```

| Setting | Default | Description |
|---|---|---|
| `csharp.mode` | `keep-alive` | `keep-alive`: process stays alive, incremental updates. `one-shot`: new process per invocation |
| `csharp.timeout` | `300` | Seconds of inactivity before keep-alive process auto-exits |
| `csharp.solution` | auto-discover | Explicit .sln path override (skips discovery) |

**Behavior by command:**

| Command | `mode: keep-alive` (default) | `mode: one-shot` |
|---|---|---|
| `ctxo index` | Batch, output all results, then keep process alive for subsequent watch | Batch, output all results, exit |
| `ctxo watch` | Process stays alive, incremental re-index per file (<100ms) | New process per file change (5-30s penalty) |
| MCP queries | Reuses warm process for symbol resolution | N/A (index already built) |

**Default is `keep-alive`** because:
- `ctxo index` followed by `ctxo watch` is the common workflow
- Solution load (5-30s) happens once, reused across both commands
- Incremental watch re-index is <100ms vs 5-30s with one-shot
- Memory is freed automatically after timeout (default 5 min inactivity)
- Users who want minimal memory usage can set `mode: one-shot`

### CLI Interface (One-Shot Mode)

```bash
dotnet run --project tools/ctxo-roslyn -- <solution-path> [options]

Options:
  --files <file1.cs> <file2.cs>   # Specific files (default: all .cs in solution)
  --include-complexity             # Include cyclomatic + cognitive metrics
  --include-project-graph          # Include project-level dependency graph
```

### stdout Output Format (Newline-Delimited JSON)

Each line is a complete JSON object:

```jsonl
{"type":"progress","message":"Loading solution...","projectCount":12}
{"type":"file","file":"src/Services/UserService.cs","symbols":[...],"edges":[...],"complexity":[...]}
{"type":"file","file":"src/Models/User.cs","symbols":[...],"edges":[...],"complexity":[...]}
{"type":"projectGraph","projects":[...],"edges":[...]}
{"type":"done","totalFiles":142,"elapsed":"4.2s"}
```

Streaming output allows Node.js to process results as they arrive (no need to wait for all 400 files).

### Key Design Decisions

**1. `batchIndex` as the primary method**

For `ctxo index`, the Node.js adapter sends a single `batchIndex` command with all .cs file paths. The .NET app iterates them in a single pass using the already-loaded `Solution` object. This eliminates the N+1 problem entirely.

**2. One-shot execution (primary) with optional keep-alive**

For `ctxo index`: the .NET process runs once, analyzes everything, outputs JSON to stdout, and exits. No long-running daemon needed. For `ctxo watch` (future): add `--keep-alive` flag to keep the process running and accept stdin commands.

**3. Custom protocol matches Ctxo's domain exactly**

The JSON protocol returns `SymbolNode[]` and `GraphEdge[]` in Ctxo's exact format. No mapping layer needed on the TypeScript side - the .NET app produces Ctxo-native output.

**4. `extractEdges` produces typed edges**

```json
{
  "edges": [
    {"from": "src/Services/UserService.cs::UserService::class", "to": "src/Interfaces/IUserRepo.cs::IUserRepository::interface", "kind": "implements"},
    {"from": "src/Services/UserService.cs::UserService.GetUser::method", "to": "src/Models/User.cs::User::class", "kind": "uses"},
    {"from": "src/Jobs/UserSyncJob.cs::UserSyncJob::class", "to": "src/Jobs/BaseSyncJob.cs::BaseSyncJob::class", "kind": "extends"},
    {"from": "src/Controllers/UserController.cs::UserController.Get::method", "to": "src/Services/UserService.cs::UserService.GetUser::method", "kind": "calls"}
  ]
}
```

Roslyn distinguishes `BaseType` (extends) vs `Interfaces` (implements) natively - no I-prefix heuristic needed.

### Module Structure (TypeScript Side)

```
src/adapters/language/roslyn/
  +-- roslyn-adapter.ts          # ILanguageAdapter implementation (spawns .NET process)
  +-- roslyn-process.ts          # Process lifecycle: spawn, communicate, shutdown
  +-- solution-discovery.ts      # .sln/.csproj discovery logic
```

### Module Structure (.NET Side) - Minimal 2 Files

```
tools/ctxo-roslyn/
  +-- ctxo-roslyn.csproj         # 12-line project file (package refs only)
  +-- Program.cs                 # ~400 lines: all analysis logic in one file
```

**Minimum .NET SDK: 8.0** (LTS, supported until Nov 2026). Works with 8.0, 9.0, 10.0+.

`ctxo-roslyn.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.CodeAnalysis.Workspaces.MSBuild" Version="4.12.0" />
    <PackageReference Include="Microsoft.CodeAnalysis.CSharp.Workspaces" Version="4.12.0" />
    <PackageReference Include="Microsoft.Build.Locator" Version="1.7.8" />
  </ItemGroup>
</Project>
```

**Execution:** `dotnet run --project tools/ctxo-roslyn -- <solution-path> [--files file1.cs file2.cs ...]`

**Output:** Newline-delimited JSON to stdout. Each line = one file's analysis result. Final line = project graph.

---

## ILanguageAdapter Async Evolution

Convert the port interface to `Promise<T>` return types. Sync adapters wrap with `Promise.resolve()`.

```typescript
export interface ILanguageAdapter {
  readonly extensions: readonly string[];
  readonly tier: 'full' | 'syntax';
  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]>;
  extractEdges(filePath: string, source: string): Promise<GraphEdge[]>;
  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]>;
  isSupported(filePath: string): boolean;
  setSymbolRegistry?(registry: Map<string, SymbolKind>): void;
  initialize?(rootDir: string): Promise<void>;
  dispose?(): Promise<void>;
}
```

Why `Promise<T>` not `T | Promise<T>`:
- Union type creates permanent interface noise and type narrowing complexity
- Sync adapters need only 9 lines of wrapping (`return Promise.resolve(...)`)
- Industry standard pattern for async-capable interfaces
- `TreeSitterAdapter` base class abstract methods need to change anyway

---

## 3-Layer Warning System

No doctor check. Warnings surfaced only when relevant:

**Layer 1 - `ctxo init`:** Project profiling when .cs files detected and .NET SDK not found
**Layer 2 - `ctxo index`:** Tier breakdown in index summary
**Layer 3 - MCP response `_meta.warnings`:** When C# symbol queried at syntax tier

---

## Alternatives Considered

| Option | Verdict | Reason |
|---|---|---|
| **Standalone .NET App (Roslyn API)** | **Chosen** | Proven, batch-capable, full API, no protocol limitations |
| Roslyn LSP | Rejected | Custom protocol, stdout risk, N+1 requests, no Node.js precedent |
| csharp-ls | Rejected | outgoingCalls missing, 100 symbol limit, bus factor 1 |
| OmniSharp | Rejected | Maintenance mode, no callHierarchy |
| tree-sitter only | Current (V1.5) | Syntax-only, insufficient for production |
| `T \| Promise<T>` interface | Rejected | Union type noise; `Promise<T>` is cleaner with trivial wrapping |

---

## V1.5 vs V2 Capability Matrix

| Capability | V1.5 (Current) | V2 (Roslyn API) |
|---|---|---|
| Symbol extraction | Public classes/methods/interfaces | All access levels, generics, properties, events |
| Edge resolution | File-level using directives | Cross-project via SymbolFinder, transitive |
| Type resolution | None | Full: SemanticModel resolves all types |
| Call graph (incoming) | None | `FindCallersAsync` with IsDirect flag |
| Call graph (outgoing) | None | SemanticModel + syntax walk |
| Inheritance | Heuristic I-prefix pattern | `BaseType` vs `Interfaces` (semantic) |
| Complexity | tree-sitter branch counting | `SyntaxKind` enum (compiler-accurate) |
| Cross-file | None | Full solution-wide resolution |
| Batch indexing | Per-file (already fast) | Single-pass all documents (2-5s for 400 files) |
| **Prerequisites** | **None** | **.NET SDK 8+** (graceful fallback to V1.5) |

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| .NET SDK not installed | Low | Graceful fallback to tree-sitter; 3-layer warning |
| .NET SDK < 8.0 | Low | Version check at startup; warn and fallback |
| MSBuildWorkspace load failure | Medium | Catch and log; NuGet restore guidance in stderr |
| .NET process crash/timeout | Medium | 120s timeout; fall back to tree-sitter for that run |
| Memory usage (500MB-1.5GB) | Medium | One-shot: process exits after index, memory freed |
| Solution load time (5-30s) | Medium | Progress lines to stdout; streaming results |
| Maintaining C# code | Low | Single Program.cs (~400 lines); stable Roslyn NuGet APIs |
| Symbol ID mismatch (tree-sitter vs Roslyn) | Medium | Full re-index required on first Roslyn run; detect and warn |
| NuGet restore needed before analysis | Medium | Auto-run `dotnet restore` before analysis; log if fails |
| First run NuGet package download | Low | One-time cost; packages cached in ~/.nuget/ |

---

## Implementation Plan

### Phase 1: ILanguageAdapter Async Evolution

- `src/ports/i-language-adapter.ts` - Change to `Promise<T>` returns, add `initialize?`, `dispose?`
- `src/adapters/language/tree-sitter-adapter.ts` - Wrap returns with `Promise.resolve()`
- `src/adapters/language/ts-morph-adapter.ts` - Wrap returns with `Promise.resolve()`
- `src/cli/index-command.ts` - Add `await` to adapter calls
- `src/cli/watch-command.ts` - Add `await` to adapter calls
- Extract shared `buildRegistry()` method for `run()`, `runCheck()`, and WatchCommand

### Phase 2: .NET Console App (ctxo-roslyn)

- `tools/ctxo-roslyn/ctxo-roslyn.csproj` - .NET 8 project
- `tools/ctxo-roslyn/Program.cs` - stdio JSON protocol handler
- `tools/ctxo-roslyn/Analysis/SymbolExtractor.cs` - Symbol extraction
- `tools/ctxo-roslyn/Analysis/EdgeExtractor.cs` - Edge extraction (SymbolFinder + SemanticModel)
- `tools/ctxo-roslyn/Analysis/ComplexityAnalyzer.cs` - SyntaxKind-based complexity
- `tools/ctxo-roslyn/Analysis/BatchIndexer.cs` - Single-pass batch
- `tools/ctxo-roslyn/Protocol/` - Request/Response types

### Phase 3: TypeScript Adapter

- `src/adapters/language/roslyn/roslyn-adapter.ts` - ILanguageAdapter implementation
- `src/adapters/language/roslyn/roslyn-process.ts` - Process lifecycle manager
- `src/adapters/language/roslyn/solution-discovery.ts` - .sln/.csproj + dotnet detection

### Phase 4: Integration

- `src/cli/index-command.ts` - Roslyn adapter registration with fallback
- `src/cli/watch-command.ts` - Roslyn keep-alive for watch mode
- `src/cli/init-command.ts` - Project profiling (Layer 1 warning)

### Phase 5: Tests (All TypeScript/vitest)

All tests are in TypeScript using vitest. No .NET test framework (xUnit/NUnit) dependency.

- **Unit tests (mock process):** Mock `child_process.spawn` output, test JSONL parsing, fallback logic, config handling. Always runs in CI.
- **Integration tests (conditional):** Spawn real `dotnet run`, validate output against fixture project. Skipped if `dotnet` not available.
- **C# fixture project:** `tests/e2e/fixtures/csharp-sample/` - minimal .sln with 6-7 .cs files covering all edge types.
- **Regression guard:** Existing 718 tests must pass unchanged.

---

## Testing Strategy

All tests in TypeScript/vitest. No .NET test dependencies (no xUnit/NUnit).

### Unit Tests (No .NET SDK Required - Always Runs in CI)

```typescript
// src/adapters/language/__tests__/roslyn-adapter.test.ts
describe('RoslynAdapter', () => {
  describe('JSONL parsing', () => {
    it('parses file result line into SymbolNode[]');
    it('parses file result line into GraphEdge[]');
    it('parses complexity metrics');
    it('parses project graph');
    it('handles progress lines');
    it('handles done line with stats');
    it('handles malformed JSON gracefully');
  });

  describe('process management', () => {
    it('returns isReady=false when dotnet not found');
    it('returns empty arrays when process unavailable (fallback)');
    it('handles process timeout (120s)');
    it('handles process crash with error log');
    it('restarts process after crash in keep-alive mode');
    it('sends shutdown on dispose');
  });

  describe('keep-alive mode', () => {
    it('sends file path via stdin on extractSymbols');
    it('reads incremental response from stdout');
    it('auto-exits after inactivity timeout');
    it('restarts process after auto-exit on next call');
  });

  describe('config', () => {
    it('reads csharp.mode from config.yaml');
    it('reads csharp.timeout from config.yaml');
    it('reads csharp.solution from config.yaml');
    it('defaults to keep-alive mode');
    it('defaults to 300s timeout');
    it('auto-discovers .sln when solution not configured');
  });
});

// src/adapters/language/__tests__/solution-discovery.test.ts
describe('solution-discovery', () => {
  it('finds .sln in project root');
  it('finds .sln in subdirectory');
  it('prefers shallowest .sln');
  it('ignores bin/obj/node_modules');
  it('falls back to .csproj when no .sln');
  it('returns null when nothing found');
  it('detects dotnet SDK version >= 8');
  it('returns null when dotnet not installed');
  it('handles Windows paths (os.homedir)');
});
```

### Integration Tests (Conditional - Requires .NET SDK)

```typescript
// src/adapters/language/__tests__/roslyn-adapter.integration.test.ts
import { execFileSync } from 'node:child_process';

const HAS_DOTNET = (() => {
  try {
    const v = execFileSync('dotnet', ['--version'], { encoding: 'utf-8' }).trim();
    return parseInt(v.split('.')[0]) >= 8;
  } catch { return false; }
})();

describe.skipIf(!HAS_DOTNET)('RoslynAdapter integration', () => {
  it('batch indexes fixture project - returns symbols for all files');
  it('extracts implements edge (UserService -> IUserRepository)');
  it('extracts extends edge (UserSyncJob -> BaseSyncJob)');
  it('extracts calls edge (UserSyncJob -> UserService.GetUser)');
  it('extracts uses edge (UserService -> User)');
  it('distinguishes extends from implements (no I-prefix heuristic)');
  it('calculates cyclomatic complexity for methods');
  it('handles keep-alive mode - incremental re-index');
  it('outputs progress lines during solution load');
  it('exits cleanly on shutdown');
});
```

### Test Fixture

```
tests/e2e/fixtures/csharp-sample/
  CsharpSample.sln
  CsharpSample/
    CsharpSample.csproj
    Models/User.cs                 # class with properties
    Interfaces/IUserRepository.cs  # interface
    Services/UserService.cs        # implements IUserRepository, uses User
    Jobs/BaseSyncJob.cs            # abstract base class
    Jobs/UserSyncJob.cs            # extends BaseSyncJob, calls UserService
```

The .NET app (`tools/ctxo-roslyn/Program.cs`) is tested indirectly through integration tests - spawn it, feed it the fixture project, validate JSON output.

---

## File Summary

| File | Action | Description |
|---|---|---|
| `src/ports/i-language-adapter.ts` | MODIFY | `Promise<T>` returns, `initialize?`, `dispose?` |
| `src/adapters/language/tree-sitter-adapter.ts` | MODIFY | Wrap sync returns with `Promise.resolve()` |
| `src/adapters/language/ts-morph-adapter.ts` | MODIFY | Wrap sync returns with `Promise.resolve()` |
| `src/cli/index-command.ts` | MODIFY | await + Roslyn registration + shared buildRegistry() |
| `src/cli/watch-command.ts` | MODIFY | await + Roslyn keep-alive |
| `src/cli/init-command.ts` | MODIFY | Project profiling warning |
| `src/adapters/language/roslyn/roslyn-adapter.ts` | NEW | ILanguageAdapter full-tier |
| `src/adapters/language/roslyn/roslyn-process.ts` | NEW | Spawn + read stdout + timeout |
| `src/adapters/language/roslyn/solution-discovery.ts` | NEW | .sln/.csproj + dotnet version check |
| `tools/ctxo-roslyn/ctxo-roslyn.csproj` | NEW | 12-line project file (.NET 8+) |
| `tools/ctxo-roslyn/Program.cs` | NEW | ~400 lines: all Roslyn analysis logic |
| `tests/e2e/fixtures/csharp-sample/` | NEW | C# fixture project |
| `package.json` | MODIFY | No new npm deps needed (child_process only) |

---

## Success Metrics

| Metric | V1.5 (Current) | V2 Target |
|---|---|---|
| Blast radius accuracy (C#) | ~40% (syntax edges) | >90% (semantic) |
| `find_importers` completeness | File-level using only | Solution-wide references |
| Cross-file edge coverage | ~30% | >95% |
| Batch index time (400 files) | N/A (tree-sitter ~2s) | <10s (solution load + extraction) |
| extends vs implements accuracy | ~60% (I-prefix heuristic) | 100% (semantic) |

---

## References

- [scip-dotnet (Sourcegraph)](https://github.com/sourcegraph/scip-dotnet) - Production Roslyn indexer
- [RoslynMCP](https://github.com/carquiza/RoslynMCP) - MCP server with Roslyn API
- [roslyn-mcp](https://github.com/egorpavlikhin/roslyn-mcp) - Lighter MCP server
- [SymbolFinder API](https://learn.microsoft.com/en-us/dotnet/api/microsoft.codeanalysis.findsymbols.symbolfinder)
- [MSBuildWorkspace guide](https://gist.github.com/DustinCampbell/32cd69d04ea1c08a16ae5c4cd21dd3a3)
- [Roslyn performance for large solutions](https://github.com/dotnet/roslyn/blob/main/docs/wiki/Performance-considerations-for-large-solutions.md)
- [Current C# Adapter](../../src/adapters/language/csharp-adapter.ts) (297 lines, syntax tier)
- [ILanguageAdapter Port](../../src/ports/i-language-adapter.ts)
