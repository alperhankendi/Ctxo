# ADR-007: C# Full-Tier Analysis via Roslyn LSP

| Field | Value |
|---|---|
| **Status** | Needs Technical Analysis |
| **Date** | 2026-04-11 |
| **Decision** | Roslyn LSP for C# full-tier, replacing OmniSharp |
| **Relates to** | FR-14, Epic 7 (Story 7.3), Sprint 4 |
| **Priority** | V2 roadmap |

## Problem Statement

The current C# adapter (`tree-sitter-c-sharp`, V1.5) operates at **syntax tier** only. It extracts symbols and basic edges but cannot resolve cross-file dependencies, generic types, or method call graphs. This produces incomplete blast radius analysis and missing dependency edges for C# codebases.

### Observed Symptoms (Production)

When running ctxo on a real-world C# backend project (`CaasBackend`, ~400+ files):

1. **"C# edges not fully resolved"** warning on `get_blast_radius` — the tool falls back to grep
2. **Incomplete `find_importers`** — `using` directives parsed but not resolved to source files
3. **Missing method-level call graph** — `BaseSyncJob` has 34 subclasses, but blast radius only shows direct base_list edges, not transitive callers
4. **Heuristic-based inheritance** — I-prefix pattern matching (`IFoo` = interface) instead of semantic analysis

### Root Cause: Syntax Tier Limitations

| Capability | V1.5 (tree-sitter) | Needed |
|---|---|---|
| Symbol extraction | Classes, methods, interfaces, enums (public only) | All access levels |
| Edge resolution | File-level `using` directives, `base_list` | Cross-project, transitive |
| Type resolution | None | Generics, overloads, implicit types |
| Call graph | Syntactic only | Semantic: actual method calls, async flows |
| Scope | Single file | Solution-wide (.sln/.csproj) |

## Decision

Use **Roslyn LSP** (the official .NET language server) for C# full-tier analysis. OmniSharp is deprecated; Roslyn LSP is the forward path for .NET 6+.

### Architecture

```
Ctxo MCP Server
  │
  ├── ILanguageAdapter (port)
  │     │
  │     ├── TsMorphAdapter       (TS/JS — full tier)     ← V1
  │     ├── TreeSitterAdapter    (Go/C# — syntax tier)   ← V1.5
  │     └── RoslynLspAdapter     (C# — full tier)        ← V2 (this ADR)
  │
  └── Composition Root (src/index.ts)
        └── Selects adapter by file extension + availability
            If dotnet SDK available → RoslynLspAdapter
            Else → TreeSitterAdapter (graceful fallback)
```

### LSP Protocol Usage

Ctxo spawns Roslyn LSP as a subprocess via stdio:

```
dotnet /path/to/Microsoft.CodeAnalysis.LanguageServer.dll
```

LSP methods consumed:

| LSP Method | Ctxo Usage |
|---|---|
| `textDocument/definition` | Cross-file edge resolution |
| `textDocument/references` | `find_importers` reverse lookup |
| `callHierarchy/incomingCalls` | Method-level blast radius |
| `workspace/symbol` | Full solution symbol index |
| `textDocument/documentSymbol` | Per-file symbol extraction |

### Two-Layer Resolution

```
Layer 1: .sln/.csproj parsing → project-level dependency graph
Layer 2: Roslyn LSP → type-level cross-file resolution
```

```typescript
// Layer 1: Parse .sln → project references (no Roslyn needed)
async function parseSolution(slnPath: string): Promise<ProjectGraph> {
  const content = await fs.readFile(slnPath, 'utf-8');
  const projectRefs = extractProjectReferences(content);
  return buildProjectGraph(projectRefs);
}

// Layer 2: Roslyn LSP for semantic resolution
// textDocument/definition, callHierarchy/incomingCalls, etc.
```

## Alternatives Considered

| Option | Verdict | Reason |
|---|---|---|
| **Roslyn LSP** | **Chosen** | Official, maintained, full semantic analysis |
| OmniSharp | Rejected | Deprecated by Microsoft |
| tree-sitter only | Current (V1.5) | Syntax-only, insufficient for production C# |
| Roslyn Compiler API (in-process) | Rejected | Requires hosting .NET runtime inside Node.js |

## V1.5 vs V2 Capability Matrix

| Capability | V1.5 (Current) | V2 (Roslyn LSP) |
|---|---|---|
| Symbol extraction | Syntax: classes, methods, interfaces, enums | + Generics, properties, delegates, events |
| Dependency resolution | File-level (using directives, base_list) | Cross-project (.csproj/.sln), transitive |
| Type resolution | None | Full: generics, overloads, inheritance |
| Call graph | Syntactic only | Semantic: actual method calls, async/await |
| Scope | Public symbols | All symbols (configurable) |
| Cross-file navigation | Import statements | Definition/reference across solution |
| **Prerequisites** | **None** | **.NET SDK** (graceful fallback to V1.5) |
| All 14 MCP tools | Working (limited accuracy) | Enhanced accuracy |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| .NET SDK not installed | Medium | Graceful degradation to V1.5 tree-sitter |
| dotnet SDK version mismatches | Low | Document minimum version, runtime check |
| Roslyn LSP startup latency | Medium | Lazy spawn on first .cs file; keep alive |
| Large solution indexing time | Medium | Incremental indexing, file-level caching |
| OmniSharp deprecated, Roslyn LSP API churn | Low | Pin Roslyn version; abstract behind port |

## Dependencies

- **.NET SDK** (6.0+) installed on developer machine
- `Microsoft.CodeAnalysis.LanguageServer` NuGet package or bundled binary
- Existing `ILanguageAdapter` port (already defined)
- `ctxo doctor` check for .NET SDK availability (extend RuntimeCheck)

## Implementation Plan

### Phase 1: Solution/Project Graph (no Roslyn needed)

- [ ] Parse `.sln` files to discover `.csproj` references
- [ ] Parse `.csproj` files for `<ProjectReference>` edges
- [ ] Build project-level dependency graph
- [ ] Feed into existing blast radius calculator

### Phase 2: Roslyn LSP Adapter

- [ ] Spawn Roslyn LSP subprocess via stdio
- [ ] Implement `ILanguageAdapter` with `tier: 'full'`
- [ ] Map LSP responses to `SymbolNode` and `GraphEdge` types
- [ ] `textDocument/definition` → `imports` edges
- [ ] `textDocument/references` → `find_importers` data
- [ ] `callHierarchy/incomingCalls` → `calls` edges

### Phase 3: Integration

- [ ] Language adapter registry auto-selects Roslyn when available
- [ ] `ctxo doctor` reports Roslyn LSP status
- [ ] `ctxo index` uses Roslyn for .cs files when available
- [ ] Fallback to tree-sitter if .NET SDK missing

### Phase 4: Optimization

- [ ] Incremental indexing (only changed .cs files)
- [ ] Roslyn LSP keep-alive between index runs
- [ ] Performance benchmarks: p95 < 200ms for warm queries

## Success Metrics

| Metric | V1.5 (Current) | V2 Target |
|---|---|---|
| Blast radius accuracy (C#) | ~40% (syntax edges only) | >90% (semantic) |
| `find_importers` completeness | File-level using only | Solution-wide references |
| Cross-file edge coverage | ~30% | >95% |
| Context response time | < 500ms p95 | < 200ms p95 |

## References

- [Technical Stack Research — ADR-7](technical-ctxo-core-stack-research-2026-03-28.md) (lines 1060, 949-975)
- [PRD — V2 Roadmap, FR-14](prd.md) (lines 91-97, 222)
- [Product Brief — Roslyn LSP scope](product-brief-Ctxo.md) (line 106)
- [Architecture Session — FR-14 mapping](../bmad-conversation-sessions/session-log-architecture-2026-03-28.md) (line 206)
- [Epic 7 — Story 7.3: C# Language Adapter](epics.md) (lines 519-527)
- [Current C# Adapter](../../src/adapters/language/csharp-adapter.ts) (297 lines, syntax tier)
