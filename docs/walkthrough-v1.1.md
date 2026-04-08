# Ctxo V1.1 Development Walkthrough

> Post-V1 feature development based on [research-needed.md](research-needed.md) analysis.
> Builds on [V1 walkthrough](walkthrough-v1.md) — 354 tests → 654 tests.

***

## Feature 1: Multi-File Cross-File Resolution

**Commit:** `2e33cdc` — Enable multi-file cross-file resolution and this.method() call edges

### Problem

TsMorphAdapter used `useInMemoryFileSystem: true` with per-file cleanup — each file parsed in isolation. This meant:

- `resolveImportTarget()` could never look up symbols in other files
- Always fell back to `inferSymbolKind()` heuristic (regex: `I[A-Z]` → interface, PascalCase → class)
- `ServiceConfig` type could be misclassified as `class`
- `this.method()` calls explicitly skipped — intra-class call chains invisible to graph

### Solution

**Multi-file Project preloading:**

| Component | Change |
|---|---|
| `TsMorphAdapter.loadProjectSources(files)` | Pre-loads all source files into in-memory ts-morph Project before edge extraction |
| `TsMorphAdapter.clearProjectSources()` | Releases all pre-loaded files after Phase 1b |
| `projectPreloaded` flag | Controls cleanup behavior — when preloaded, `extractEdges()` keeps files for cross-file lookups |
| `parseSource()` | Reuses pre-loaded file instead of remove+recreate when preloaded |

**`this.method()` call edges:**

| Component | Change |
|---|---|
| `resolveThisMethodCall()` | New helper — resolves `this.foo()` to `ClassName.foo::method` within the same class |
| `extractCallEdges()` | Replaced `continue` skips with resolution logic for `this.method()` calls |

**IndexCommand wiring:**

- Phase 1a: Extract symbols (unchanged)
- **NEW:** Pre-load all sources into ts-morph Project
- Phase 1b: Extract edges (now with cross-file resolution active)
- **NEW:** Clear pre-loaded sources (memory released)

### Impact

- Import edge targets now resolve via real type lookups (not heuristic)
- `inferSymbolKind()` becomes a rare fallback for files not in the project
- Intra-class method call chains visible in dependency graph
- Logic slices for method-level queries now include `this.method()` paths

**Tests:** +28 = 594 total

***

## Feature 2: Tree-Sitter Adapters for Go & C# (Epic 7)

**Commit:** `e43db17` — Add tree-sitter adapters for Go and C# with graceful degradation

### Problem

Ctxo only supported TypeScript/JavaScript. Go and C# codebases were invisible to all MCP tools. Epic 7 in the roadmap called for syntax-tier parsing via tree-sitter.

### Architecture

Three-layer adapter design:

```
TreeSitterAdapter (abstract base)
├── GoAdapter (.go files)
└── CSharpAdapter (.cs files)
```

All adapters implement `ILanguageAdapter` interface with `tier: 'syntax'` (vs TsMorphAdapter's `tier: 'full'`).

### TreeSitterAdapter — Base Class

Shared tree-sitter logic:

| Method | Purpose |
|---|---|
| `parse(source)` | Parse source into tree-sitter Tree |
| `buildSymbolId(file, name, kind)` | Same `"file::name::kind"` format as TsMorphAdapter |
| `nodeToLineRange(node)` | Convert tree-sitter positions to 0-based line numbers + byte offsets |
| `countCyclomaticComplexity(node, branchTypes)` | Generic branch counting — subclasses pass language-specific branch node types |

### GoAdapter

| Feature | Implementation |
|---|---|
| **Symbol extraction** | `function_declaration` → function, `method_declaration` → method (with receiver type), `type_spec` → struct=class / interface / type |
| **Export detection** | Go capitalization rule — first letter uppercase = exported |
| **Edge extraction** | `import_spec` → imports edges |
| **Complexity** | `if_statement`, `for_statement`, `expression_switch_statement`, `expression_case`, `select_statement`, `communication_case` |
| **Symbol ID format** | `"cmd/server.go::Config.String::method"` |

### CSharpAdapter

| Feature | Implementation |
|---|---|
| **Symbol extraction** | `class_declaration`, `struct_declaration`, `record_declaration` → class; `interface_declaration` → interface; `enum_declaration` → type; `method_declaration`, `constructor_declaration` → method |
| **Export detection** | `public` modifier check |
| **Namespace qualification** | Extracted from `namespace_declaration` ancestor — `"Namespace.ClassName"` |
| **Edge extraction** | `using_directive` → imports; `base_list` → extends/implements (I-prefix heuristic for interfaces) |
| **Complexity** | `if_statement`, `for_statement`, `foreach_statement`, `while_statement`, `do_statement`, `switch_section`, `catch_clause`, `conditional_expression` |
| **Symbol ID format** | `"Services/Payment.cs::Payment.CardProcessor.Process::method"` |

### Graceful Degradation

Tree-sitter adapters are **lazy-loaded** via `require()` in try/catch — not top-level ESM imports:

```typescript
private registerTreeSitterAdapters(registry: LanguageAdapterRegistry): void {
  try {
    const { GoAdapter } = require('../adapters/language/go-adapter.js');
    registry.register(new GoAdapter());
  } catch {
    console.error('[ctxo] Go adapter unavailable (tree-sitter-go not installed)');
  }
  // ...same for CSharpAdapter
}
```

**Why:** If tree-sitter native modules fail to load (not installed, wrong Node version, missing binary), TypeScript indexing continues unaffected. Without lazy-loading, the entire `index-command.ts` module would fail to import.

### Dynamic Extension Filtering

- `LanguageAdapterRegistry.getSupportedExtensions()` — returns all registered extensions
- `IndexCommand.isSupportedExtension()` — uses registry-derived set (not hardcoded)
- `runCheck()` — now registers adapters and uses dynamic filter (was hardcoded to `.ts/.tsx/.js/.jsx`)
- `WatchCommand` — local scoped `const supportedExtensions` (was mutable module-level global)

### Runtime Bug Fixes

| Bug | Severity | Fix |
|---|---|---|
| Top-level tree-sitter import crashes all indexing | CRITICAL | Lazy `require()` with try/catch |
| `runCheck()` hardcoded extensions (ignores .go/.cs) | HIGH | Registry-driven dynamic filter |
| `runCheck()` never registers adapters | HIGH | Added registry setup at start |
| `WatchCommand` mutable global `SUPPORTED_EXTENSIONS` | MEDIUM | Local scoped const |
| `WatchCommand` redundant extension check | MEDIUM | Removed — `registry.getAdapter()` is sufficient |

**Dependencies added:** `tree-sitter@^0.21.1`, `tree-sitter-go@0.23.4`, `tree-sitter-c-sharp@0.23.1`

**Tests:** +52 = 646 total (18 Go + 20 C# + 14 edge cases)

***

## Feature 3: 3-Tier Blast Radius Confidence Model

**Commit:** (pending)

### Problem

Blast radius had 2-tier confidence (confirmed/potential). Industry standard tools (Semgrep, Endor Labs) use 3-tier. The `uses` edge kind (import + body reference) was lumped with `calls`/`extends`/`implements` as "confirmed" — but it's less certain. AI agents couldn't see **why** an entry was confirmed or filter results by confidence.

### Research Findings

| Tool | Confidence Model | Key Insight |
|---|---|---|
| **Semgrep** | reachable / conditionally reachable / unreachable | AST parameter usage differentiates confirmed from conditional |
| **Endor Labs** | reachable / potentially reachable / unreachable | Function-level call graph + dataflow tracing |
| **SYKE** | 0-1 composite (fan-in + stability + complexity + cascade + PageRank) | Multi-signal scoring with threshold decisions |
| **ops-codegraph** | Blast radius + co-change analysis | Git history enriches static analysis |
| **NDepend** | Afferent/Efferent coupling → Instability metric | Coupling direction matters for impact |
| **code-review-graph** | Blast radius for file selection | AI reads only impacted files — 6.8x fewer tokens |

### Solution — 3-Tier Model

| Confidence | Edge Kinds | Meaning | Semgrep Equivalent |
|---|---|---|---|
| `confirmed` | `calls`, `extends`, `implements` | Direct code execution path — definitely affected | Reachable |
| `likely` | `uses` | Import + body reference — high probability affected | Conditionally Reachable |
| `potential` | `imports` | File-level dependency only — may not use the symbol | Unreachable |

### Changes

**BlastRadiusCalculator:**

- `ImpactConfidence` type: `'confirmed' | 'likely' | 'potential'`
- `CONFIRMED_KINDS`: `calls`, `extends`, `implements` (removed `uses`)
- `LIKELY_KINDS`: `uses` (new set)
- BFS `bestByNode`: now tracks `{ confidence, kinds: Set<string> }` per node
- Strongest wins: confirmed > likely > potential (via `CONFIDENCE_RANK` lookup)
- `likelyCount` added to `BlastRadiusResult`

**BlastRadiusEntry — new `edgeKinds` field:**

```typescript
interface BlastRadiusEntry {
  symbolId: string;
  depth: number;
  dependentCount: number;
  riskScore: number;
  confidence: 'confirmed' | 'likely' | 'potential';
  edgeKinds: string[];  // NEW — which edge kinds connect this dependent
}
```

AI agents can now see `edgeKinds: ["imports", "calls"]` → "this symbol both imports and directly calls the target" vs `edgeKinds: ["imports"]` → "file-level dependency only".

**MCP handler — confidence filter:**

```typescript
get_blast_radius({
  symbolId: "src/types.ts::SymbolNode::type",
  confidence: "confirmed"  // optional — filter to only confirmed entries
})
```

- `confidence: 'confirmed'` → only entries where calls/extends/implements edges exist
- `confidence: 'likely'` → only entries with uses edges
- `confidence: 'potential'` → only imports-only entries
- No filter → all entries (backward compatible)

Filtered response recalculates `impactScore`, `confirmedCount`, `likelyCount`, `potentialCount` from filtered array.

### Example Output

```json
{
  "symbolId": "src/types.ts::SymbolNode::type",
  "impactScore": 38,
  "confirmedCount": 12,
  "likelyCount": 23,
  "potentialCount": 3,
  "overallRiskScore": 1.0,
  "impactedSymbols": [
    {
      "symbolId": "src/core/graph/symbol-graph.ts::SymbolGraph::class",
      "depth": 1,
      "riskScore": 1.0,
      "confidence": "confirmed",
      "edgeKinds": ["imports", "uses"],
      "dependentCount": 5
    },
    {
      "symbolId": "src/cli/index-command.ts::IndexCommand::class",
      "depth": 2,
      "riskScore": 0.616,
      "confidence": "likely",
      "edgeKinds": ["uses"],
      "dependentCount": 1
    }
  ]
}
```

**Tests:** +8 = 654 total

***

## Feature 4: Co-Change Analysis

**Commit:** (pending)

### Problem

Blast radius only used static dependency edges. Competitors (SYKE, ops-codegraph) mine git history to find files that frequently change together — adding ~85% confidence signal that static analysis misses.

### Solution: Mine During Indexing (Zero Extra Git Calls)

IndexCommand Phase 2 already fetches `getCommitHistory()` for every file. Each `fileIndex.intent` contains commit hashes. The co-change matrix is built as a side-effect:

1. Build `Map<commitHash, Set<filePath>>` from all intent arrays
2. For each commit touching 2+ files, enumerate file pairs
3. Count shared commits per pair
4. Calculate `frequency = sharedCommits / min(commits_A, commits_B)`
5. Filter: `frequency >= 0.1` AND `sharedCommits >= 2`
6. Write to `.ctxo/index/co-changes.json`

### Blast Radius Integration

`BlastRadiusCalculator.calculate()` accepts optional `coChangeMap` parameter:
- If co-change frequency > 0.5 between source file and dependent file, confidence upgrades from `potential` → `likely`
- `coChangeFrequency?: number` field added to `BlastRadiusEntry` for transparency
- Conservative: only upgrades, never downgrades

### Files

| File | Purpose |
|---|---|
| `src/core/co-change/co-change-analyzer.ts` | `aggregateCoChanges()` + `loadCoChangeMap()` |
| `src/core/types.ts` | `CoChangeEntry`, `CoChangeMatrix` types |
| `src/cli/index-command.ts` | Phase 2b — aggregate after git history |
| `src/adapters/storage/json-index-writer.ts` | `writeCoChanges()` method |
| `src/adapters/storage/json-index-reader.ts` | Skip `co-changes.json` in `readAll()` |
| `src/core/blast-radius/blast-radius-calculator.ts` | Optional `coChangeMap` param, boost logic |

**Tests:** +14 (10 co-change analyzer + 4 blast radius co-change boost)

***

## Feature 5: `get_pr_impact` MCP Tool (14th Tool)

**Commit:** (pending)

### Problem

AI agents calling `get_changed_symbols` + `get_blast_radius` separately for PR review — multiple round trips, manual aggregation. Competitors (ops-codegraph `diff-impact`, trace-mcp PR reports) offer this in one call.

### Solution

Single `get_pr_impact` MCP tool call:

```
get_pr_impact({ since: "HEAD~3", confidence: "confirmed" })
```

**Flow:**
1. `git.getChangedFiles(since)` → changed file list
2. `buildGraphFromJsonIndex()` → dependency graph
3. `loadCoChanges()` → co-change matrix (if available)
4. For each changed file → find symbols → run blast radius per symbol
5. Aggregate: `riskLevel` (low/medium/high), `summary` totals, `coChangedWith` per file

### Output Shape

```json
{
  "since": "HEAD~3",
  "changedFiles": 5,
  "changedSymbols": 12,
  "totalImpact": 47,
  "riskLevel": "high",
  "files": [{
    "file": "src/core/types.ts",
    "symbols": [{
      "symbolId": "src/core/types.ts::SymbolNode::type",
      "blast": {
        "impactScore": 38,
        "confirmedCount": 12,
        "likelyCount": 23,
        "potentialCount": 3,
        "riskScore": 1.0,
        "topImpacted": [...]
      }
    }],
    "coChangedWith": ["src/core/graph/symbol-graph.ts"]
  }],
  "summary": {
    "confirmedTotal": 25,
    "likelyTotal": 15,
    "potentialTotal": 7,
    "highRiskSymbols": ["src/core/types.ts::SymbolNode::type"]
  }
}
```

### Files

| File | Purpose |
|---|---|
| `src/adapters/mcp/get-pr-impact.ts` | MCP tool handler |
| `src/index.ts` | Registration with zod schema |

**Tests:** +7 (impact analysis, blast per symbol, confidence filter, co-change, empty result, error)

***

## Cumulative Statistics

| Metric | V1 | V1.1 | Delta |
|---|---|---|---|
| Tests | 354 | 675 | +321 |
| Test files | 43 | 60 | +17 |
| Source files | ~45 | ~55 | +10 new files |
| MCP tools | 5 (later 13) | 14 | +1 (get_pr_impact) |
| Languages supported | TS/JS | TS/JS + Go + C# | +2 |
| Blast radius tiers | 2 | 3 | +1 (likely) |
| Blast radius signals | Static edges only | Static + co-change | +1 signal |
| Edge kind accuracy | Heuristic | Cross-file lookup | Major improvement |
| Statement coverage | ~90% | ~91% | Stable |

***

## Dependencies Added

| Package | Version | Purpose |
|---|---|---|
| `tree-sitter` | ^0.21.1 | Parser engine for Go/C# syntax analysis |
| `tree-sitter-go` | 0.23.4 | Go language grammar |
| `tree-sitter-c-sharp` | 0.23.1 | C# language grammar |
