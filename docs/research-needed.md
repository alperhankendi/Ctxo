# Research Session — LSP Integration & AST Fundamentals

**Date:** 2026-04-01
**Context:** Evaluating whether LSP client support and deeper AST capabilities should be added to Ctxo.

---

## 1. LSP (Language Server Protocol) — Deep Analysis

### What is LSP?

LSP is a protocol developed by Microsoft for communication between IDEs and language servers (`tsserver`, `omnisharp`, and friends). It provides:

- **Go-to-definition** — resolve symbol declarations across files and packages
- **Find all references** — locate every usage of a symbol in the workspace
- **Call hierarchy** — structured caller/callee trees
- **Type resolution** — full type inference including generics, conditional types, mapped types
- **Diagnostics** — compiler errors and type errors as structured data
- **Semantic tokens** — token classification with full semantic context

### Current Ctxo Parsing Stack

Ctxo currently uses **ts-morph** in in-memory isolation mode (`useInMemoryFileSystem: true` at `src/adapters/language/ts-morph-adapter.ts:23`). This means each file is parsed independently — cross-file type resolution is disabled.

| Capability | Current Status | Mechanism |
|---|---|---|
| Symbol inventory (function/class/interface/type/variable/method) | Complete (exported symbols) | ts-morph AST walk |
| Import edges | Reliable for structural edges | `getImportDeclarations()` — relative paths only |
| Inheritance edges (extends, implements) | Complete | AST class/interface declarations |
| Call edges | Incomplete — misses `this.method()`, dynamic calls | `CallExpression` pattern matching |
| Cyclomatic complexity | Solid for exported functions/methods | Branch-counting visitor |
| Type resolution | Heuristic only (name-based fallback) | `inferSymbolKind()` at lines 485-494 |

### Gaps LSP Would Close

| Gap | Description | Impact on Ctxo |
|---|---|---|
| **Edge target kind heuristics** | Imported symbol type guessed by naming convention (`I[A-Z]` = interface, PascalCase = class). `ServiceConfig` might be misclassified. | Edge accuracy in `get_logic_slice` |
| **`this.method()` call edges** | Explicitly skipped at line 349. Internal class call chains are invisible. | Incomplete logic slices for method-level queries |
| **Go/C# semantic analysis** | Zero analysis today. Tree-sitter planned for V1.5 (syntax-tier only). | No semantic-tier for polyglot codebases |
| **Resolved type information** | Generics, mapped types, conditional types cannot be resolved in isolation mode. | Missing type dimension in symbol metadata |

### What LSP Would NOT Help With

- **Git history / intent** — LSP has no git awareness; Ctxo already handles this
- **Anti-pattern detection** — domain logic in Ctxo core, outside LSP scope
- **Blast radius scoring** — graph traversal algorithm, not a language server concern
- **Masking pipeline** — security layer, entirely Ctxo-specific
- **Change intelligence** — complexity x churn scoring, Ctxo domain logic

### Why LSP Should NOT Be Added Now

#### 1. High Operational Complexity
- `tsserver` startup: **3-8 seconds**; `omnisharp`: **30-90 seconds**; general-purpose LSP servers typically fall in this range
- LSP is stateful — requires subprocess lifecycle management, crash recovery, keepalive
- Breaks Ctxo's "zero-config" story: `tsconfig.json`, `go.mod`, `.csproj` become hard prerequisites

#### 2. Port Interface Incompatibility
Current `ILanguageAdapter` is **synchronous and file-scoped**. LSP is **asynchronous and session-scoped**. Integration requires either:
- **Option A:** Convert entire interface to async (breaking change across all adapters, tests, and IndexCommand)
- **Option B:** Introduce new `ISemanticEnrichmentPort` as a separate port (clean but adds architectural surface area)

#### 3. Same Benefits Achievable at Lower Cost

| Improvement | LSP Approach | Better Alternative | Effort |
|---|---|---|---|
| Edge target accuracy | ~900 LOC + runtime dep | Multi-file ts-morph Project | **~50 LOC** |
| `this.method()` call edges | ~900 LOC + runtime dep | Multi-file ts-morph Project | **~80 LOC** |
| Go syntax-tier | LSP adapter ~1000 LOC | tree-sitter adapter (V1.5) | **~400 LOC** |
| Go semantic-tier | Embedded LSP client | Standalone `ctxo-go-analyzer` binary using `go/packages` + `x/tools/go/ssa` + `callgraph/cha` (delivered v0.8.0-alpha.0) | **~1500 LOC** |
| C# syntax-tier | omnisharp LSP ~1000 LOC | tree-sitter adapter (V1.5) | **~350 LOC** |

### Recommended Path Forward

**Short Term (Now):** Remove `useInMemoryFileSystem: true` constraint and construct a **multi-file ts-morph Project** during `IndexCommand`. This single change:
- Replaces edge target kind heuristics with real type lookups
- Enables `this.method()` call edge extraction
- ~130 LOC change, zero new dependencies

**Medium Term (V1.5):** Tree-sitter adapter for Go/C# syntax-tier analysis — symbol inventory + import edges.

**Long Term (V2): Delivered in v0.8.0-alpha.0** via a standalone `ctxo-go-analyzer` Go binary bundled inside `@ctxo/lang-go` (see [ADR-013](architecture/ADR/adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md)). Uses `go/packages` + `go/types` + `x/tools/go/ssa` + `callgraph/cha` for batch type-aware analysis — single-pass over the whole module rather than an LSP round-trip per file.

---

## 2. AST (Abstract Syntax Tree) — Fundamentals

### What is an AST?

An Abstract Syntax Tree is a tree representation of source code structure. A parser reads code, analyzes syntax, and places each expression as a node in the tree.

Example — this code:

```typescript
function greet(name: string) {
  return "Hello " + name;
}
```

Produces this tree:

```
FunctionDeclaration (greet)
  Parameter (name: string)
  Block
    ReturnStatement
      BinaryExpression (+)
        StringLiteral ("Hello ")
        Identifier (name)
```

### AST Tools in Ctxo

| Tool | Scope | Depth | Speed | Status |
|---|---|---|---|---|
| **ts-morph** | TypeScript/JavaScript | Full-tier (types, generics, decorators) | Medium | Active — primary parser |
| **tree-sitter** | Multi-language (Go, C#, Python...) | Syntax-tier (structure only) | Fast | Planned for V1.5 |

### AST vs Other Approaches

| Approach | Capability | Context Awareness | Used in Ctxo? |
|---|---|---|---|
| **Regex/string matching** | Text search — fragile, no structural understanding | None | No |
| **AST (syntax tree)** | Understands code structure — knows function vs variable vs class | Structural | **Yes** (ts-morph + tree-sitter) |
| **LSP (semantic analysis)** | AST + type system — cross-file type resolution | Semantic | Not currently |

### Why AST is Critical for Ctxo

All 5 MCP tools depend on AST-derived data:

```
Source Code -> [AST Parser] -> SymbolNode[] + GraphEdge[]
                                      |
                                SQLite Index
                                      |
              +-------------------+---+-------------------+
              |                   |                       |
      get_logic_slice     get_blast_radius        get_why_context
      (symbol + deps)     (impact analysis)       (git intent + AST)
              |                                           |
      get_change_intelligence              get_architectural_overlay
      (complexity x churn)                 (layer classification)
```

Without AST, Ctxo cannot extract symbols, build dependency graphs, calculate blast radius, or construct logic slices. AST is the foundational layer that makes all other analysis possible.

---

## 3. Action Items

- [x] **P1:** Remove `useInMemoryFileSystem: true` from TsMorphAdapter — multi-file Project with `loadProjectSources`/`clearProjectSources` — fixed in `2e33cdc`
- [x] **P1:** Enable `this.method()` call edge extraction — `resolveThisMethodCall` helper — fixed in `2e33cdc`
- [x] **P2:** Tree-sitter adapter for Go/C# — `GoAdapter`, `CSharpAdapter` with graceful degradation — fixed in `e43db17`
- [x] **P3:** Go semantic-tier — delivered v0.8.0-alpha.0 via standalone `ctxo-go-analyzer` binary (ADR-013)
- [ ] **P3:** Evaluate OmniSharp LSP adapter for C# semantic-tier only if tree-sitter proves insufficient based on user feedback
