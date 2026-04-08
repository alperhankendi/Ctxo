# Ctxo MCP Server — Full Validation Runbook

> **Purpose:** Repeatable end-to-end validation of Ctxo MCP server after any code change.
> **When to run:** After every fix, feature addition, or before any release.
> **Expected duration:** \~2 minutes (including index build)

***

## Step 1: Clean Slate — Delete Index & Cache

Delete all generated data to ensure a fresh build from zero.

```Shell
cd d:/workspace/Ctxo
rm -rf .ctxo/.cache/ .ctxo/index/
```

**Expected:** Both directories removed. No leftover state.

***

## Step 2: Rebuild Index from Zero

```Shell
time npx tsx src/index.ts index
```

**Verify:**

* [ ] Output shows `[ctxo] Index complete: N files indexed`
* [ ] No errors on stderr
* [ ] Build time under 10 seconds
* [ ] Default `--max-history 20` applied (each file stores at most 20 commits)
* [ ] Two-pass indexing: Phase 1a (symbols + registry), Phase 1b (edges with registry)
* [ ] Multi-file project preloading: all sources loaded before Phase 1b for cross-file resolution
* [ ] Sources cleared after Phase 1b (memory released)
* [ ] Multi-language adapters registered: TsMorphAdapter (.ts/.tsx/.js/.jsx) + GoAdapter (.go) + CSharpAdapter (.cs)
* [ ] Dynamic extension filter active via `registry.getSupportedExtensions()`

**Record metrics:**

| Metric        | Value          |
| ------------- | -------------- |
| Files indexed | \_\_\_         |
| Build time    | \_\_\_ seconds |
| Languages     | TS/JS: \_\_\_, Go: \_\_\_, C#: \_\_\_ |

### 2.1 Custom `--max-history` Override

```Shell
rm -rf .ctxo/.cache/ .ctxo/index/
time npx tsx src/index.ts index --max-history 5
```

**Verify:**

* [ ] Index builds successfully
* [ ] No file in `.ctxo/index/` has more than 5 entries in its `intent` array

```Shell
node -e "
const fs = require('fs'); const path = require('path');
function walk(dir) { let f=[]; for (const e of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) f.push(...walk(p)); else if(e.name.endsWith('.json')) f.push(p); } return f; }
const files=walk('.ctxo/index'); let maxIntent=0;
for(const f of files){const d=JSON.parse(fs.readFileSync(f,'utf8'));if((d.intent||[]).length>maxIntent)maxIntent=(d.intent||[]).length;}
console.log('Max intent entries per file:', maxIntent);
console.log(maxIntent <= 5 ? 'PASS: --max-history 5 respected' : 'FAIL: intent exceeds 5');
"
```

* [ ] Max intent entries per file <= 5

***

## Step 3: Collect Index Metrics

```Shell
node -e "
const fs = require('fs'); const path = require('path');
function walk(dir) { let f=[]; for (const e of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) f.push(...walk(p)); else if(e.name.endsWith('.json')) f.push(p); } return f; }
const files=walk('.ctxo/index'); let s=0,ed=0,i=0,a=0,bo=0,ek={},to=0;
for(const f of files){const d=JSON.parse(fs.readFileSync(f,'utf8'));s+=(d.symbols||[]).length;ed+=(d.edges||[]).length;i+=(d.intent||[]).length;a+=(d.antiPatterns||[]).length;for(const e of(d.edges||[]))ek[e.kind]=(ek[e.kind]||0)+1;for(const sym of(d.symbols||[]))if(sym.startOffset!==undefined)bo++;for(const e of(d.edges||[]))if(e.typeOnly)to++;}
console.log(JSON.stringify({files:files.length,symbols:s,edges:ed,intents:i,antiPatterns:a,symbolsWithByteOffset:bo,typeOnlyEdges:to,edgeKinds:ek},null,2));
"
```

**Verify:**

* [ ] `files` matches Step 2 count
* [ ] `symbols` > 0
* [ ] `edges` > 0
* [ ] `intents` > 0 (git intent is indexed)
* [ ] `antiPatterns` >= 0 (may be 0 if no reverts detected)
* [ ] `edgeKinds` contains `imports`, `calls`, `implements`, `uses`
* [ ] `symbolsWithByteOffset` > 0 (byte offset indexing active)
* [ ] `symbolsWithByteOffset` equals `symbols` count (all symbols have offsets)
* [ ] `typeOnlyEdges` >= 0 (`import type` edges flagged)

**Record metrics:**

| Metric                 | Value                                                  |
| ---------------------- | ------------------------------------------------------ |
| Symbols                | \_\_\_                                                 |
| Edges                  | \_\_\_                                                 |
| Intents                | \_\_\_                                                 |
| AntiPatterns           | \_\_\_                                                 |
| Symbols w/ byte offset | \_\_\_                                                 |
| typeOnly edges         | \_\_\_                                                 |
| Edge kinds             | imports=\_\_\_ calls=\_\_\_ implements=\_\_\_ uses=\_\_\_ |

***

## Step 4: Test `get_logic_slice`

Test with LogicSliceQuery at all 4 levels to verify progressive detail.

**Symbol:** `src/core/logic-slice/logic-slice-query.ts::LogicSliceQuery::class`

| Call   | Level      | Expected                                                                |
| ------ | ---------- | ----------------------------------------------------------------------- |
| Call 1 | `level: 1` | `dependencies: [], edges: []` — root metadata only                      |
| Call 2 | `level: 2` | `dependencies: [4 items], edges: [4 direct only]` — no transitive       |
| Call 3 | `level: 3` | `dependencies: [4 items], edges: [6 = 4 direct + 2 transitive]`         |
| Call 4 | `level: 4` | `dependencies: [4 items], edges: [6]` — same as L3 (+ source in future) |

**Verify:**

* [ ] Root symbol found with correct `name`, `kind`, `startLine`, `endLine`
* [ ] L1 returns empty deps/edges
* [ ] L2 returns deps with direct edges only (4 edges)
* [ ] L3 returns deps with transitive edges (6 edges)
* [ ] L2 edge count < L3 edge count (progressive detail works)

**Expected dependency tree at L3:**

```
LogicSliceQuery
├── SymbolNode (types.ts)          — direct
├── GraphEdge (types.ts)           — direct
├── LogicSliceResult (types.ts)    — direct
└── SymbolGraph (symbol-graph.ts)  — direct
    ├── SymbolNode                 — transitive
    └── GraphEdge                  — transitive
```

***

## Step 5: Test `get_blast_radius`

Test with a high-impact core type to verify multi-depth traversal, risk scoring, and confirmed/potential split.

**Symbol:** `src/core/types.ts::SymbolNode::type`

### 5.1 Basic Blast Radius

**Verify:**

* [ ] `impactScore` > 10 (SymbolNode is used across every layer)
* [ ] `impactedSymbols` array is non-empty
* [ ] Depth 1 dependents include: TsMorphAdapter, SqliteStorageAdapter, SymbolGraph, LogicSliceQuery, IStoragePort, ILanguageAdapter, DetailFormatter
* [ ] Depth 2 dependents include: IndexCommand, BlastRadiusCalculator, handleGetBlastRadius, handleGetWhyContext, etc.
* [ ] Depth 3 dependents include: CliRouter, VerifyCommand

### 5.2 Risk Scoring

**Verify:**

* [ ] `overallRiskScore` is between 0.0 and 1.0
* [ ] `directDependentsCount` matches count of depth-1 entries
* [ ] Each entry has `riskScore` field (number > 0)
* [ ] Depth 1 entries have `riskScore` = 1.000 (1/1^0.7)
* [ ] Depth 2 entries have `riskScore` ≈ 0.616 (1/2^0.7)
* [ ] Deeper entries have progressively lower `riskScore`

### 5.3 3-Tier Confidence Model (Semgrep/Endor Labs aligned)

**Verify:**

* [ ] `confirmedCount` + `likelyCount` + `potentialCount` = `impactScore`
* [ ] Each entry has `confidence` field: `"confirmed"`, `"likely"`, or `"potential"`
* [ ] Entries with edge kind `calls`, `extends`, `implements` → `"confirmed"`
* [ ] Entries with edge kind `uses` (import + body reference) → `"likely"`
* [ ] Entries with edge kind `imports` only → `"potential"`
* [ ] `likelyCount` present in response (new field)

### 5.4 edgeKinds per Entry

**Verify:**

* [ ] Each entry has `edgeKinds` array (non-empty)
* [ ] Mixed edges shown: e.g., `["imports", "calls"]` → confidence: `"confirmed"` (strongest wins)
* [ ] `["imports", "uses"]` → confidence: `"likely"`
* [ ] `["imports"]` alone → confidence: `"potential"`

### 5.5 Confidence Filter

**Verify:**

* [ ] `get_blast_radius({symbolId, confidence: "confirmed"})` returns only confirmed entries
* [ ] `get_blast_radius({symbolId, confidence: "likely"})` returns only likely entries
* [ ] `get_blast_radius({symbolId, confidence: "potential"})` returns only potential entries
* [ ] No `confidence` param → all entries returned (backward compat)
* [ ] Filtered `impactScore` matches filtered array length

### 5.6 Edge Cases

* [ ] Leaf symbol (no dependents) returns `impactScore: 0`, `confirmedCount: 0`, `likelyCount: 0`, `potentialCount: 0`
* [ ] Non-existent symbol returns `{ found: false }`
* [ ] Circular dependency does not cause infinite loop

**Record:**

| Metric             | Value  |
| ------------------ | ------ |
| Impact score       | \_\_\_ |
| Confirmed count    | \_\_\_ |
| Likely count       | \_\_\_ |
| Potential count    | \_\_\_ |
| Overall risk score | \_\_\_ |
| Depth 1 count      | \_\_\_ |
| Depth 2 count      | \_\_\_ |
| Depth 3 count      | \_\_\_ |

***

## Step 6: Test `get_architectural_overlay`

Call with no parameters for full project scan.

**Verify:**

* [ ] Response contains `layers` object with up to 6 keys: `Domain`, `Adapter`, `Test`, `Composition`, `Configuration`, `Unknown`
* [ ] `Domain` includes: `src/core/`, `src/ports/` files
* [ ] `Adapter` includes: `src/adapters/`, `src/cli/` files
* [ ] `Test` includes: `__tests__/`, `.test.ts`, `tests/`, `fixtures/` files
* [ ] `Composition` includes: `src/index.ts`
* [ ] `Configuration` includes: `*.config.ts`, `*.config.js` files
* [ ] `Unknown` includes: remaining unclassified files
* [ ] Total file count across all layers matches Step 2 indexed count
* [ ] No `src/core/` file appears in Adapter layer (hexagonal architecture rule)
* [ ] No `src/adapters/` file appears in Domain layer

**Record:**

| Layer         | File Count |
| ------------- | ---------- |
| Domain        | \_\_\_     |
| Adapter       | \_\_\_     |
| Test          | \_\_\_     |
| Composition   | \_\_\_     |
| Configuration | \_\_\_     |
| Unknown       | \_\_\_     |
| Total         | \_\_\_     |

***

## Step 7: Test `get_why_context`

**Symbol:** `src/core/masking/masking-pipeline.ts::MaskingPipeline::class`

**Verify:**

* [ ] `commitHistory` is non-empty array
* [ ] Each commit has `hash`, `message`, `date`, `kind` fields
* [ ] `kind` is `"commit"` for all entries
* [ ] Commits are in reverse chronological order (newest first)
* [ ] `antiPatternWarnings` is an array (may be empty or have entries)
* [ ] If anti-patterns found: `warningBadge` field is present
* [ ] Response does NOT contain `changeIntelligence` field (separation of concerns — removed in c174261)

**Known issue check — Git hash masking:**

* [ ] Check if `hash` values are actual hex strings or `[REDACTED:AWS_SECRET]`
* If redacted: masking false positive still present — log as known issue

### 7.1 `maxCommits` Query-Time Limit

Call `get_why_context` with `{ symbolId: "src/core/masking/masking-pipeline.ts::MaskingPipeline::class", maxCommits: 3 }`:

**Verify:**

* [ ] `commitHistory` array has at most 3 entries
* [ ] Entries are the 3 most recent commits (newest first)
* [ ] `antiPatternWarnings` still includes all detected anti-patterns (not sliced)

Call again WITHOUT `maxCommits`:

* [ ] `commitHistory` returns all indexed commits (up to build-time `--max-history` default of 20)
* [ ] Count is >= the `maxCommits: 3` result above

### 7.2 `maxCommits` Edge Cases

* [ ] `maxCommits: 1` returns exactly 1 commit
* [ ] `maxCommits` larger than total commits returns all commits (no error)
* [ ] Omitting `maxCommits` returns full history (default behavior)

**Record:**

| Metric                          | Value              |
| ------------------------------- | ------------------ |
| Commits returned (no limit)     | \_\_\_             |
| Commits returned (maxCommits=3) | \_\_\_             |
| Anti-pattern warnings           | \_\_\_             |
| Hash masking status             | Redacted / Visible |

***

## Step 8: Test `get_change_intelligence`

**Symbol:** `src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class`

**Verify:**

* [ ] `symbolId` matches input
* [ ] `complexity` is a number between 0 and 1
* [ ] `churn` is a number between 0 and 1
* [ ] `composite` is a number between 0 and 1
* [ ] `band` is one of: `"low"`, `"medium"`, `"high"`, `"critical"`
* [ ] `complexity` > 0 (355-line file with 13+ branches should not be zero)

**Record:**

| Metric     | Value  |
| ---------- | ------ |
| Complexity | \_\_\_ |
| Churn      | \_\_\_ |
| Composite  | \_\_\_ |
| Band       | \_\_\_ |

***

## Step 9: Test `find_dead_code`

Call with default parameters (excludes test/config files).

### 9.1 Basic Dead Code Detection

**Verify:**

* [ ] `totalSymbols` > 0 (candidate symbols analyzed)
* [ ] `reachableSymbols` > 0 (entry points + their transitive deps)
* [ ] `deadCodePercentage` is between 0 and 100
* [ ] Response contains `deadSymbols` array and `deadFiles` array

### 9.2 Dead Symbol Details

**Verify:**

* [ ] Each dead symbol has `symbolId`, `file`, `name`, `kind` fields
* [ ] Each dead symbol has `confidence` field: 1.0, 0.9, or 0.7
* [ ] Each dead symbol has `reason` field (human-readable explanation)
* [ ] Confidence 1.0 symbols have reason containing "Zero importers"
* [ ] Confidence 0.7 symbols have reason containing "cascading"

### 9.3 Dead Files

**Verify:**

* [ ] `deadFiles` lists files where ALL symbols are dead
* [ ] No actively-used source file appears in `deadFiles`
* [ ] Test files (`__tests__/`, `.test.ts`) are NOT in `deadFiles` (excluded by default)
* [ ] Config files (`*.config.ts`) are NOT in `deadFiles` (excluded by default)

### 9.4 Include Tests Mode

Call with `{ includeTests: true }`:

* [ ] `totalSymbols` increases (test files now counted)
* [ ] Test file symbols may appear in `deadSymbols` if truly isolated

### 9.5 Edge Cases

* [ ] Circular dependency islands (A→B→C→A, all unreachable from entry points) are detected as dead
* [ ] Composition root (`src/index.ts`) symbols are NOT dead (they are entry points)
* [ ] CLI command symbols are NOT dead (they have outgoing deps)

### 9.6 Dynamic Entry Point Detection

* [ ] Entry points are auto-detected (symbols with zero reverse edges + outgoing deps)
* [ ] No manual configuration required
* [ ] Language-agnostic — works for any language adapter

### 9.7 Unused Exports Detection

* [ ] `unusedExports` array is present in response
* [ ] Unused exports are symbols that are exported, reachable (entry points), but never imported by any other file
* [ ] Dead symbols do NOT appear in `unusedExports` (mutually exclusive)
* [ ] Symbols that ARE imported by other files do NOT appear in `unusedExports`
* [ ] Composition root symbols may appear (they export but nobody imports them)

### 9.8 Cascading Dead Code

* [ ] Dead symbols have optional `cascadeDepth` field (0 = root dead, 1+ = cascading)
* [ ] Symbols in circular dead islands all get cascadeDepth
* [ ] Confidence 0.7 assigned to symbols whose ALL importers are dead

### 9.9 Framework Awareness

* [ ] `main` function is NOT flagged as dead (framework lifecycle symbol)
* [ ] Symbols ending with `Schema` are NOT flagged (Zod convention)
* [ ] `registerTool`, `connect`, `close` are NOT flagged (MCP SDK lifecycle)
* [ ] `describe`, `it`, `expect` are NOT flagged (vitest lifecycle)

### 9.10 Scaffolding Detection

* [ ] `scaffolding` array is present in response
* [ ] TODO/FIXME/HACK/PLACEHOLDER/XXX markers detected in source files
* [ ] "not yet implemented" patterns detected
* [ ] "temporary" / "temp fix" patterns detected
* [ ] Test files excluded from scaffolding scan
* [ ] Each entry has: `file`, `line`, `pattern`, `text`

**Note:** Scaffolding detection requires `sourceContents` to be passed. The MCP handler reads source files from disk when available.

**Record:**

| Metric             | Value  |
| ------------------ | ------ |
| Total symbols      | \_\_\_ |
| Reachable symbols  | \_\_\_ |
| Dead symbols       | \_\_\_ |
| Dead files         | \_\_\_ |
| Dead code %        | \_\_\_ |
| Unused exports     | \_\_\_ |
| Confidence 1.0     | \_\_\_ |
| Confidence 0.9     | \_\_\_ |
| Confidence 0.7     | \_\_\_ |

***

## Step 10: Test `get_context_for_task`

Test task-aware context assembly with different task types.

**Symbol:** `src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class`

### 10.1 Understand Task

Call with `{ symbolId: "...", taskType: "understand" }`:

**Verify:**

* [ ] Response contains `target` with correct symbolId
* [ ] `taskType` is `"understand"`
* [ ] `context` array is non-empty
* [ ] Each context entry has: `symbolId`, `name`, `kind`, `file`, `relevanceScore`, `reason`, `lines`, `tokens`
* [ ] Direct dependencies score highest (IStoragePort, SymbolNode, GraphEdge, etc.)
* [ ] Interface/type definitions included (relevanceScore > 0 for types)
* [ ] `totalTokens` <= `tokenBudget`

### 10.2 Fix Task

Call with `{ symbolId: "...", taskType: "fix" }`:

**Verify:**

* [ ] `context` array is non-empty
* [ ] Direct dependency scores differ from "understand" (fix uses lower base, boosted by anti-patterns)
* [ ] `warnings` array present (may contain anti-pattern warnings if symbol has reverts in history)

**Anti-pattern verification** — use a symbol with known anti-patterns (e.g., `MaskingPipeline`):

* [ ] Call `get_context_for_task` with `MaskingPipeline` + `taskType: "fix"`
* [ ] `warnings` array contains anti-pattern warning message

### 10.3 Refactor Task

Call with `{ symbolId: "...", taskType: "refactor" }`:

**Verify:**

* [ ] Blast radius dependents included (symbols that import/use this symbol)
* [ ] Dependents have `reason` containing "blast radius"

### 10.4 Extend Task

Call with `{ symbolId: "...", taskType: "extend" }`:

**Verify:**

* [ ] Interfaces and type definitions score highest
* [ ] `reason` contains "type/interface" for relevant entries

### 10.5 Token Budget

Call with `{ symbolId: "...", taskType: "understand", tokenBudget: 200 }`:

* [ ] `totalTokens` <= 200
* [ ] Fewer context entries than default (4000) budget

### 10.6 Edge Cases

* [ ] Non-existent symbol returns `{ found: false }`
* [ ] Empty symbolId returns `{ error: true }`

**Record:**

| Task Type  | Context Entries | Total Tokens | Top Reason           |
| ---------- | --------------- | ------------ | -------------------- |
| understand | \_\_\_          | \_\_\_       | \_\_\_               |
| fix        | \_\_\_          | \_\_\_       | \_\_\_               |
| refactor   | \_\_\_          | \_\_\_       | \_\_\_               |
| extend     | \_\_\_          | \_\_\_       | \_\_\_               |

***

## Step 11: Test `get_ranked_context`

Test query-based context ranking with different strategies.

### 11.1 Combined Strategy (default)

Call with `{ query: "masking" }`:

**Verify:**

* [ ] Results array is non-empty
* [ ] `MaskingPipeline` appears near top (exact/partial match)
* [ ] Each result has: `symbolId`, `name`, `kind`, `file`, `relevanceScore`, `importanceScore`, `combinedScore`, `tokens`
* [ ] Results sorted by `combinedScore` descending
* [ ] `totalTokens` <= `tokenBudget` (default 4000)

### 11.2 Importance Strategy

Call with `{ query: "", strategy: "importance" }`:

**Verify:**

* [ ] Results ranked by `importanceScore` (reverse edge count / normalized)
* [ ] Most-depended-on symbols appear first (e.g., FileIndex, SymbolNode — actual ranking depends on import graph)
* [ ] `relevanceScore` may be 0 (no text match when query is empty)

### 11.3 Custom Token Budget

Call with `{ query: "adapter", tokenBudget: 500 }`:

* [ ] `totalTokens` <= 500
* [ ] Fewer results than default budget

### 11.4 Edge Cases

* [ ] Empty query with `strategy: "importance"` returns importance-ranked symbols
* [ ] Very long query returns empty or low-relevance results
* [ ] Empty symbolId returns `{ error: true }`

**Record:**

| Query     | Strategy   | Results Count | Top Symbol         | Top Score |
| --------- | ---------- | ------------- | ------------------ | --------- |
| "masking" | combined   | \_\_\_        | \_\_\_             | \_\_\_    |
| ""        | importance | \_\_\_        | \_\_\_             | \_\_\_    |
| "adapter" | combined   | \_\_\_        | \_\_\_             | \_\_\_    |

***

## Step 12: Test `search_symbols`

Test symbol search by name, regex, kind filter, and file filter.

**Symbol index must be built (Step 2).**

### 12.1 Exact Name Search

Call with `{ pattern: "SymbolGraph" }`:

**Verify:**

* [ ] `totalMatches` >= 1
* [ ] First result has `name: "SymbolGraph"`, `kind: "class"`
* [ ] Each result has: `symbolId`, `name`, `kind`, `file`, `startLine`, `endLine`

### 12.2 Regex Pattern Search

Call with `{ pattern: "^handle" }`:

**Verify:**

* [ ] Results include all MCP handler functions (handleGetLogicSlice, handleGetBlastRadius, etc.)
* [ ] `totalMatches` > 5

### 12.3 Kind Filter

Call with `{ pattern: ".*", kind: "interface" }`:

**Verify:**

* [ ] All results have `kind: "interface"`
* [ ] Results include IStoragePort, ILanguageAdapter, IGitPort, IMaskingPort, IWatcherPort

### 12.4 File Pattern Filter

Call with `{ pattern: ".*", filePattern: "core/graph" }`:

* [ ] All results have `file` containing `core/graph`
* [ ] Results include SymbolGraph and its methods

### 12.5 Limit Enforcement

Call with `{ pattern: ".*", limit: 3 }`:

* [ ] `results` array has at most 3 entries
* [ ] `totalMatches` is greater than 3 (showing total available)

### 12.6 Edge Cases

* [ ] Invalid regex (e.g. `[invalid`) does not crash — falls back to literal substring
* [ ] Empty pattern returns `{ error: true }`
* [ ] Pattern with no matches returns `{ totalMatches: 0, results: [] }`

**Record:**

| Query              | Kind Filter | Results | Top Match          |
| ------------------ | ----------- | ------- | ------------------ |
| "SymbolGraph"      | —           | \_\_\_  | \_\_\_             |
| "^handle"          | —           | \_\_\_  | \_\_\_             |
| ".*"               | interface   | \_\_\_  | \_\_\_             |
| ".*"               | class       | \_\_\_  | \_\_\_             |

***

## Step 13: Test `get_changed_symbols`

Test git-diff-based symbol discovery.

### 13.1 Default (HEAD~1)

Call with `{}` (defaults to `since: "HEAD~1"`):

**Verify:**

* [ ] `since` is `"HEAD~1"`
* [ ] `changedFiles` >= 0 (depends on last commit)
* [ ] `changedSymbols` >= 0
* [ ] `files` is an array, each entry has `file` and `symbols` array
* [ ] Each symbol has: `symbolId`, `name`, `kind`, `startLine`, `endLine`

### 13.2 Custom Git Ref

Call with `{ since: "HEAD~5" }`:

**Verify:**

* [ ] `since` is `"HEAD~5"`
* [ ] `changedFiles` >= result from 13.1 (more commits = more changes)
* [ ] Changed files map to indexed symbols only (unindexed files omitted)

### 13.3 maxFiles Limit

Call with `{ since: "HEAD~10", maxFiles: 2 }`:

* [ ] `changedFiles` <= 2
* [ ] Only first 2 files from git diff are processed

### 13.4 Edge Cases

* [ ] Invalid git ref (e.g. `"nonexistent-branch"`) returns graceful error, not crash
* [ ] No changes since ref returns `{ changedFiles: 0, changedSymbols: 0, files: [] }`

**Record:**

| Since     | Changed Files | Changed Symbols | Top File           |
| --------- | ------------- | --------------- | ------------------ |
| HEAD\~1   | \_\_\_        | \_\_\_          | \_\_\_             |
| HEAD\~5   | \_\_\_        | \_\_\_          | \_\_\_             |
| HEAD\~10  | \_\_\_        | \_\_\_          | \_\_\_             |

***

## Step 14: Test `find_importers`

Test reverse dependency lookup (who imports a given symbol).

**Symbol:** `src/core/types.ts::SymbolNode::type` (widely used across the codebase)

### 14.1 Direct Importers

Call with `{ symbolId: "src/core/types.ts::SymbolNode::type" }`:

**Verify:**

* [ ] `importerCount` > 5 (SymbolNode is used across every layer)
* [ ] Each importer has: `symbolId`, `name`, `kind`, `file`, `edgeKind`, `depth`
* [ ] All entries have `depth: 1` (direct only)
* [ ] `edgeKind` is one of: `imports`, `calls`, `extends`, `implements`, `uses`

### 14.2 Transitive Importers

Call with `{ symbolId: "src/core/types.ts::SymbolNode::type", transitive: true }`:

**Verify:**

* [ ] `importerCount` > direct count from 14.1 (transitive adds more)
* [ ] Entries at depth 2+ exist (e.g., CLI commands importing adapters that import types)
* [ ] Results sorted by depth ascending
* [ ] No duplicate symbolIds in the result

### 14.3 Edge Kind Filter

Call with `{ symbolId: "src/core/types.ts::SymbolNode::type", edgeKinds: ["implements"] }`:

* [ ] Only importers connected via `implements` edge are returned
* [ ] `importerCount` <= count from 14.1

### 14.4 Max Depth Limit

Call with `{ symbolId: "src/core/types.ts::SymbolNode::type", transitive: true, maxDepth: 1 }`:

* [ ] All entries have `depth: 1` only
* [ ] Count matches direct-only result from 14.1

### 14.5 Edge Cases

* [ ] Non-existent symbol returns `{ found: false }`
* [ ] Symbol with no importers returns `{ importerCount: 0, importers: [] }`
* [ ] Empty symbolId returns `{ error: true }`
* [ ] Circular dependencies do not cause infinite loop

**Record:**

| Mode                  | Importer Count | Max Depth | Top Importer       |
| --------------------- | -------------- | --------- | ------------------ |
| Direct                | \_\_\_         | 1         | \_\_\_             |
| Transitive            | \_\_\_         | \_\_\_    | \_\_\_             |
| edgeKinds=implements  | \_\_\_         | 1         | \_\_\_             |

***

## Step 15: Test `get_class_hierarchy`

Test class/interface inheritance tree traversal.

### 15.1 Full Project Hierarchy

Call with `{}` (no symbolId — returns all extends/implements trees):

**Verify:**

* [ ] `hierarchies` is a non-empty array
* [ ] `totalClasses` > 0 (nodes involved in extends/implements)
* [ ] `totalEdges` > 0
* [ ] Each hierarchy root has: `symbolId`, `name`, `kind`, `file`, `children`
* [ ] Children have `edgeKind` field (`"extends"` or `"implements"`)

### 15.2 Rooted — Ancestors (extends/implements chain upward)

Find a class that implements an interface (e.g., `SqliteStorageAdapter implements IStoragePort`).

Call with `{ symbolId: "src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class", direction: "ancestors" }`:

**Verify:**

* [ ] `ancestors` is non-empty
* [ ] At least one ancestor has `edgeKind: "implements"` and is an interface
* [ ] `descendants` is NOT present in response (direction=ancestors)
* [ ] Each ancestor has `depth` field (1 = direct parent)

### 15.3 Rooted — Descendants (who extends/implements this)

Call with `{ symbolId: "<interface-symbolId>", direction: "descendants" }`:

Use an interface like `IStoragePort` that is implemented by adapters.

**Verify:**

* [ ] `descendants` includes implementing classes
* [ ] `ancestors` is NOT present in response (direction=descendants)
* [ ] `edgeKind` is `"implements"` for each descendant

### 15.4 Rooted — Both Directions

Call with `{ symbolId: "...", direction: "both" }`:

* [ ] Both `ancestors` and `descendants` arrays are present
* [ ] Counts match sum of 15.2 + 15.3 individual calls

### 15.5 Edge Cases

* [ ] Non-existent symbol returns `{ found: false }`
* [ ] Symbol with no extends/implements returns empty `ancestors` and `descendants`
* [ ] Only `extends` and `implements` edges are traversed — `imports`, `calls`, `uses` are excluded

**Record:**

| Mode          | Symbol              | Ancestors | Descendants | Total Edges |
| ------------- | ------------------- | --------- | ----------- | ----------- |
| Full          | (all)               | —         | —           | \_\_\_      |
| ancestors     | SqliteStorageAdapter| \_\_\_    | —           | \_\_\_      |
| descendants   | IStoragePort        | —         | \_\_\_      | \_\_\_      |
| both          | \_\_\_              | \_\_\_    | \_\_\_      | \_\_\_      |

***

## Step 16: Test `get_symbol_importance`

Test PageRank centrality ranking on the dependency graph.

### 16.1 Default Rankings

Call with `{}` (defaults: damping=0.85, limit=25):

**Verify:**

* [ ] `totalSymbols` > 0
* [ ] `converged` is `true`
* [ ] `iterations` > 0 and <= 100
* [ ] `damping` is `0.85`
* [ ] `rankings` is non-empty array sorted by `score` descending
* [ ] Each entry has: `symbolId`, `name`, `kind`, `file`, `score`, `inDegree`, `outDegree`
* [ ] Top-ranked symbol is a widely-depended-on type (e.g., `SymbolNode`, `GraphEdge`, `FileIndex`)
* [ ] All scores are between 0 and 1

### 16.2 Kind Filter

Call with `{ kind: "interface" }`:

* [ ] All results have `kind: "interface"`
* [ ] Port interfaces (IStoragePort, IGitPort, etc.) appear in results

### 16.3 File Pattern Filter

Call with `{ filePattern: "core/" }`:

* [ ] All results have `file` containing `core/`
* [ ] Core types rank higher than adapter types

### 16.4 Custom Damping Factor

Call with `{ damping: 0.5 }`:

* [ ] `damping` is `0.5` in response
* [ ] Rankings differ from default (0.85) — lower damping reduces link-following weight

### 16.5 Limit

Call with `{ limit: 5 }`:

* [ ] `rankings` has at most 5 entries
* [ ] `totalSymbols` shows full count (greater than 5)

### 16.6 Edge Cases

* [ ] Single-node graph returns score of 1.0
* [ ] Circular dependency does not cause infinite loop — converges normally
* [ ] Dangling nodes (no outgoing edges) still have score > 0

**Record:**

| Rank | Symbol             | Score  | InDegree | OutDegree |
| ---- | ------------------ | ------ | -------- | --------- |
| 1    | \_\_\_             | \_\_\_ | \_\_\_   | \_\_\_    |
| 2    | \_\_\_             | \_\_\_ | \_\_\_   | \_\_\_    |
| 3    | \_\_\_             | \_\_\_ | \_\_\_   | \_\_\_    |
| 4    | \_\_\_             | \_\_\_ | \_\_\_   | \_\_\_    |
| 5    | \_\_\_             | \_\_\_ | \_\_\_   | \_\_\_    |

***

## Step 17: Multi-Language Adapter Validation (Epic 7)

Verify that tree-sitter adapters for Go and C# are registered and functional.

### 17.1 Go Adapter — Symbol Extraction

Create a temporary Go file and verify indexing:

```Shell
mkdir -p /tmp/ctxo-go-test && cat > /tmp/ctxo-go-test/main.go << 'GOEOF'
package main

import "fmt"

type Config struct {
    Host string
    Port int
}

type Handler interface {
    Handle()
}

func NewConfig() Config {
    return Config{Host: "localhost", Port: 8080}
}

func (c Config) String() string {
    return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

func helper() {}
GOEOF
```

```Shell
node -e "
const { GoAdapter } = require('./dist/index.js');
// Or test directly:
const fs = require('fs');
const source = fs.readFileSync('/tmp/ctxo-go-test/main.go', 'utf-8');
const adapter = new (require('./src/adapters/language/go-adapter.js').GoAdapter)();
const symbols = adapter.extractSymbols('main.go', source);
const edges = adapter.extractEdges('main.go', source);
console.log('Symbols:', symbols.map(s => s.name + ' (' + s.kind + ')'));
console.log('Edges:', edges.length, 'import edges');
console.log('Exported only:', !symbols.some(s => s.name === 'helper'));
"
```

**Verify:**

* [ ] `Config` extracted as `class` (struct → class mapping)
* [ ] `Handler` extracted as `interface`
* [ ] `NewConfig` extracted as `function`
* [ ] `Config.String` extracted as `method` (receiver type in name)
* [ ] `helper` NOT extracted (unexported — lowercase)
* [ ] Import edge for `fmt` present
* [ ] All symbols have byte offsets
* [ ] Adapter `tier` is `'syntax'`

### 17.2 C# Adapter — Symbol Extraction

```Shell
mkdir -p /tmp/ctxo-cs-test && cat > /tmp/ctxo-cs-test/Service.cs << 'CSEOF'
using System;

namespace MyApp.Services
{
    public interface IService
    {
        void Execute();
    }

    public class ServiceImpl : IService
    {
        public void Execute()
        {
            if (DateTime.Now.Hour > 12)
                Console.WriteLine("PM");
        }

        private void Log(string msg) {}
    }

    public enum Status { Active, Inactive }
}
CSEOF
```

**Verify:**

* [ ] `MyApp.Services.IService` extracted as `interface`
* [ ] `MyApp.Services.ServiceImpl` extracted as `class`
* [ ] `MyApp.Services.ServiceImpl.Execute` extracted as `method`
* [ ] `MyApp.Services.Status` extracted as `type` (enum)
* [ ] `Log` NOT extracted (private)
* [ ] `using System` → import edge
* [ ] `ServiceImpl : IService` → implements edge
* [ ] Namespace qualification in all symbol names
* [ ] Adapter `tier` is `'syntax'`

### 17.3 Adapter Registry — Dynamic Extension Support

```Shell
node -e "
const { LanguageAdapterRegistry } = require('./src/adapters/language/language-adapter-registry.js');
const { TsMorphAdapter } = require('./src/adapters/language/ts-morph-adapter.js');
const { GoAdapter } = require('./src/adapters/language/go-adapter.js');
const { CSharpAdapter } = require('./src/adapters/language/csharp-adapter.js');
const reg = new LanguageAdapterRegistry();
reg.register(new TsMorphAdapter());
reg.register(new GoAdapter());
reg.register(new CSharpAdapter());
const exts = reg.getSupportedExtensions();
console.log('Supported:', [...exts].sort().join(', '));
console.log('.go adapter:', reg.getAdapter('main.go')?.tier);
console.log('.cs adapter:', reg.getAdapter('App.cs')?.tier);
console.log('.ts adapter:', reg.getAdapter('index.ts')?.tier);
console.log('.py adapter:', reg.getAdapter('main.py')?.tier ?? 'none');
"
```

**Verify:**

* [ ] Supported extensions include `.go` and `.cs` alongside `.ts`, `.tsx`, `.js`, `.jsx`
* [ ] `.go` → `syntax` tier (GoAdapter)
* [ ] `.cs` → `syntax` tier (CSharpAdapter)
* [ ] `.ts` → `full` tier (TsMorphAdapter)
* [ ] `.py` → `none` (unsupported)

### 17.4 Complexity Metrics — Go & C#

**Verify:**

* [ ] Go: `if`, `for`, `expression_switch_statement`, `expression_case` counted as branches
* [ ] C#: `if`, `for`, `foreach`, `while`, `do`, `switch_section`, `catch_clause`, `conditional_expression` counted
* [ ] Base complexity = 1 for branchless functions/methods
* [ ] Only exported/public symbols get complexity metrics

### 17.5 Graceful Degradation — tree-sitter Not Installed

Verify that TypeScript indexing still works when tree-sitter native modules are missing.

**Verify:**

* [ ] `registerTreeSitterAdapters()` uses lazy `require()` with try/catch — no top-level imports
* [ ] If `tree-sitter-go` is not installed, stderr logs `Go adapter unavailable` and TypeScript indexing continues
* [ ] If `tree-sitter-c-sharp` is not installed, stderr logs `C# adapter unavailable` and TypeScript indexing continues
* [ ] `ctxo index --check` registers adapters and uses dynamic extension filter (not hardcoded)
* [ ] Watch command uses local `const supportedExtensions` (no mutable module-level global)

***

## Step 18: Co-Change Analysis Validation

### 18.1 Co-Change Matrix Generation

After indexing, verify `.ctxo/index/co-changes.json` exists:

```Shell
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('.ctxo/index/co-changes.json', 'utf8'));
console.log('Version:', data.version);
console.log('Entries:', data.entries.length);
console.log('Top 5 by frequency:');
data.entries.slice(0, 5).forEach(e => console.log('  ' + e.file1 + ' <-> ' + e.file2 + ' freq=' + e.frequency + ' shared=' + e.sharedCommits));
"
```

**Verify:**

* [ ] `co-changes.json` exists in `.ctxo/index/`
* [ ] `version` is `1`
* [ ] `entries` array contains file pairs
* [ ] Each entry has `file1`, `file2`, `sharedCommits`, `frequency`
* [ ] `frequency` values between 0.1 and 1.0
* [ ] `sharedCommits` >= 2 for all entries
* [ ] Pairs sorted by frequency descending

### 18.2 Co-Change Blast Radius Boost

**Verify:**

* [ ] Blast radius entries with high co-change frequency (> 0.5) have `coChangeFrequency` field
* [ ] Imports-only entries with co-change > 0.5 upgraded from `potential` → `likely`
* [ ] `confirmed` entries NOT affected by co-change (no downgrade)
* [ ] Entries without co-change data have `coChangeFrequency: undefined`

***

## Step 19: Test `get_pr_impact`

Test the PR impact analysis tool:

```Shell
# Assuming recent changes exist
npx tsx -e "
const { handleGetPrImpact } = require('./src/adapters/mcp/get-pr-impact.js');
// Or call via MCP:
// get_pr_impact({ since: 'HEAD~3' })
"
```

**Verify:**

* [ ] Returns `changedFiles`, `changedSymbols`, `totalImpact` counts
* [ ] `riskLevel` is `low`, `medium`, or `high`
* [ ] Each changed file has `symbols` array with blast radius per symbol
* [ ] Each symbol blast includes `impactScore`, `confirmedCount`, `likelyCount`, `potentialCount`
* [ ] `topImpacted` array contains top 10 impacted entries by riskScore
* [ ] `coChangedWith` array present for files with co-change data
* [ ] `summary.confirmedTotal + summary.likelyTotal + summary.potentialTotal = totalImpact`
* [ ] `confidence` filter restricts results to specified tier
* [ ] Empty diff returns `changedFiles: 0, riskLevel: "low"`

**Record:**

| Metric | Value |
|---|---|
| Changed files | \_\_\_ |
| Changed symbols | \_\_\_ |
| Total impact | \_\_\_ |
| Risk level | \_\_\_ |
| Confirmed total | \_\_\_ |
| Likely total | \_\_\_ |
| Potential total | \_\_\_ |

***

## Step 20: Staleness Detection Check

Run any tool immediately after a fresh index build.

**Verify:**

* [ ] No `"⚠️ Index may be stale"` warning in response
* [ ] If you modify a source file and re-run without re-indexing, stale warning SHOULD appear

***

## Step 21: Edge Kind Coverage Check

From Step 3 metrics, verify edge kind diversity.

**Verify:**

* [ ] `imports` > 0 (primary edge kind)
* [ ] `calls` > 0 (function call edges — includes `this.method()` intra-class calls)
* [ ] `implements` > 0 (interface implementation edges)
* [ ] Optional: `extends` and `uses` (may be 0 depending on codebase patterns)

**Expected minimums:**

| Edge Kind    | Minimum | Spec Status                    |
| ------------ | ------- | ------------------------------ |
| `imports`    | 200+    | Required                       |
| `calls`      | 1+      | Required (includes `this.method()` intra-class calls) |
| `implements` | 1+      | Required                       |
| `extends`    | 0       | Optional (depends on codebase) |
| `uses`       | 1+      | Required (likely-tier blast radius) |

### 18.1 Cross-File Edge Resolution Accuracy

Verify that import edge targets use real type lookups (not heuristic fallback).

```Shell
node -e "
const fs = require('fs'); const path = require('path');
function walk(dir) { let f=[]; for (const e of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) f.push(...walk(p)); else if(e.name.endsWith('.json')) f.push(p); } return f; }
const files=walk('.ctxo/index'); let typeEdges=0, classEdges=0, ifaceEdges=0, fnEdges=0;
for(const f of files){const d=JSON.parse(fs.readFileSync(f,'utf8'));for(const e of(d.edges||[])){if(e.kind!=='imports')continue;if(e.to.endsWith('::type'))typeEdges++;else if(e.to.endsWith('::class'))classEdges++;else if(e.to.endsWith('::interface'))ifaceEdges++;else if(e.to.endsWith('::function'))fnEdges++;}}
console.log(JSON.stringify({importEdgesByTargetKind:{type:typeEdges,class:classEdges,interface:ifaceEdges,function:fnEdges}},null,2));
"
```

**Verify:**

* [ ] `type` > 0 (types resolved via multi-file project, not heuristic)
* [ ] `interface` > 0 (interfaces resolved via multi-file project)
* [ ] `function` > 0 (functions resolved via multi-file project)
* [ ] Heuristic misclassifications reduced (e.g., `ServiceConfig` correctly resolves to `::interface`, not `::class`)

### 18.2 this.method() Intra-Class Call Edges

Verify that `this.method()` calls within classes produce `calls` edges.

```Shell
node -e "
const fs = require('fs'); const path = require('path');
function walk(dir) { let f=[]; for (const e of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) f.push(...walk(p)); else if(e.name.endsWith('.json')) f.push(p); } return f; }
const files=walk('.ctxo/index'); let intraClassCalls=0;
for(const f of files){const d=JSON.parse(fs.readFileSync(f,'utf8'));for(const e of(d.edges||[])){if(e.kind==='calls'&&e.from.includes('::method')&&e.to.includes('::method')){const fromCls=e.from.split('::')[1].split('.')[0];const toCls=e.to.split('::')[1].split('.')[0];if(fromCls===toCls)intraClassCalls++;}}}
console.log('Intra-class this.method() call edges:', intraClassCalls);
console.log(intraClassCalls > 0 ? 'PASS: this.method() edges detected' : 'INFO: no intra-class calls in codebase (expected if classes use external calls only)');
"
```

**Verify:**

* [ ] Intra-class call edges >= 0 (depends on codebase class patterns)
* [ ] No false edges to non-existent methods (spot-check a few edges manually)

***

## Step 22: Run Unit Tests

```Shell
npx vitest run 2>&1 | tail -10
```

**Verify:**

* [ ] All tests pass
* [ ] No test failures or errors

***

## Step 23: Manual vs MCP Tool Comparison

For each tool, manually replicate the same result using standard AI assistant tools (Read, Grep, Glob, Bash). Measure the cost and compare.

### 23.1 Manual: Logic Slice — LogicSliceQuery

Replicate `get_logic_slice` L3 result manually:

1. **Read** `src/core/logic-slice/logic-slice-query.ts` — note all imports
2. **Read** each imported file (`src/core/types.ts`, `src/core/graph/symbol-graph.ts`)
3. For each dependency, **Read** its imports to find transitive deps
4. Compile the full dependency tree

**Record:**

| Metric                    | Value                                       |
| ------------------------- | ------------------------------------------- |
| Tool calls used           | \_\_\_                                      |
| Files read                | \_\_\_                                      |
| Total lines read          | \_\_\_                                      |
| Estimated tokens consumed | \_\_\_ (lines x \~5 tokens/line + overhead) |

***

### 23.2 Manual: Blast Radius — SymbolNode

Replicate `get_blast_radius` result manually:

1. **Grep** all files importing from `types.ts` or referencing `SymbolNode`
2. **Read** each importing file to confirm usage
3. For each depth-1 dependent, **Grep** for files importing from THAT file
4. Repeat for depth-3
5. Count total dependents and compute impact score

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Files read                | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.3 Manual: Architectural Overlay

Replicate `get_architectural_overlay` result manually:

1. **Glob** `src/**/*.ts` to list all source files
2. **Read** each file's imports to determine layer classification
3. Classify: files importing only from `core/` → Domain; files importing from adapters → Adapter; rest → Unknown

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Files read                | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.4 Manual: Why Context — MaskingPipeline

Replicate `get_why_context` result manually:

1. **Bash** `git log --format="%H|%s|%ai" -- src/core/masking/masking-pipeline.ts`
2. **Bash** `git show [hash] -- src/core/masking/masking-pipeline.ts` for each commit
3. **Bash** `git log --grep="revert" -i -- src/core/masking/masking-pipeline.ts`

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Bash commands run         | \_\_\_ |
| Total diff output lines   | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.5 Manual: Change Intelligence — SqliteStorageAdapter

Replicate `get_change_intelligence` result manually:

1. **Read** `src/adapters/storage/sqlite-storage-adapter.ts` fully
2. Count cyclomatic complexity (if/else/switch/catch/&&/||/ternary)
3. **Bash** `git log --oneline -- src/adapters/storage/sqlite-storage-adapter.ts`
4. **Bash** `git log --format="%ai" -- src/adapters/storage/sqlite-storage-adapter.ts`
5. Compute churn rate, normalize, classify band

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.6 Manual: Dead Code Detection

Replicate `find_dead_code` result manually:

1. **Glob** `src/**/*.ts` to list all non-test source files
2. For each file, **Grep** for its exports (functions, classes, interfaces, types)
3. For each exported symbol, **Grep** across all other files to check if it's imported/referenced
4. Symbols with zero external references → dead candidates
5. For files where ALL symbols are dead → dead files
6. Classify confidence: zero importers (1.0), test-only importers (0.9), cascading (0.7)

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Files read                | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.7 Manual: Search Symbols

Replicate `search_symbols` result manually:

1. **Grep** `"^export (function|class|interface|type)"` across all `.ts` files
2. Filter results by name pattern
3. For kind filter, parse the matched export keyword
4. Collect file, name, kind for each match

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Files read                | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.8 Manual: Changed Symbols

Replicate `get_changed_symbols` result manually:

1. **Bash** `git diff --name-only HEAD~3` to list changed files
2. For each changed `.ts` file, **Read** the file to identify exported symbols
3. Parse export statements to extract symbol names, kinds, line numbers

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Files read                | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.9 Manual: Find Importers

Replicate `find_importers` result manually:

1. **Grep** all files for imports referencing the target symbol's file
2. **Read** each importing file to confirm symbol usage (not just file import)
3. For transitive: repeat steps 1-2 for each depth-1 importer
4. Track depth per result, deduplicate

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Files read                | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.10 Manual: Class Hierarchy

Replicate `get_class_hierarchy` result manually:

1. **Grep** `"extends|implements"` across all `.ts` files
2. **Read** each matched file to confirm class/interface relationships
3. Build parent-child tree manually from grep results
4. Traverse upward/downward from a given class

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Files read                | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.11 Comparison Table

Fill in after completing both MCP and manual runs:

| Tool                        | MCP Tokens | MCP Calls | Manual Tokens | Manual Calls | Token Savings | Call Savings |
| --------------------------- | ---------- | --------- | ------------- | ------------ | ------------- | ------------ |
| `get_logic_slice`           | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_blast_radius`          | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_architectural_overlay` | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_why_context`           | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_change_intelligence`   | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `find_dead_code`            | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_context_for_task`      | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_ranked_context`        | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `search_symbols`            | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_changed_symbols`       | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `find_importers`            | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_class_hierarchy`       | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_symbol_importance`     | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_pr_impact`             | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| **TOTAL**                   | **\_\_\_** | **14**    | **\_\_\_**    | **\_\_\_**   | **\_\_\_x**   | **\_\_\_x**  |

### 23.13 Manual: Symbol Importance

Replicate `get_symbol_importance` result manually:

1. **Grep** all `import` statements across `src/**/*.ts` files
2. Count how many files import each symbol (in-degree)
3. For each symbol, count its own imports (out-degree)
4. Manually compute iterative PageRank: score = (1-0.85)/N + 0.85 * sum(score(importer)/outDegree(importer))
5. Repeat until convergence (~20 iterations)
6. Sort by score descending

**Record:**

| Metric                    | Value  |
| ------------------------- | ------ |
| Tool calls used           | \_\_\_ |
| Files read                | \_\_\_ |
| Total lines read          | \_\_\_ |
| Estimated tokens consumed | \_\_\_ |

***

### 23.14 Context Window Budget

```
Manual approach:
[████████████████░░░░░░░░░░░░░░░░░░░░░░░░]  ___K / 1M   (__%)

MCP Tool approach:
[░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  ___K / 1M   (__%)

Savings: ___K tokens preserved per query set
Queries before context pressure: Manual=___ vs MCP=___
```

***

## Summary Checklist

After completing all steps, fill in:

| #  | Check                                                               | Pass/Fail |
| -- | ------------------------------------------------------------------- | --------- |
| 1  | Index builds from zero without errors                               |           |
| 2  | Index metrics: symbols > 0, edges > 0, intents > 0                  |           |
| 2a | All symbols have byte offsets (startOffset/endOffset)                |           |
| 2b | `typeOnly` edges flagged for `import type` statements               |           |
| 2c | `uses` edges present (likely-tier blast radius)                      |           |
| 2d | Multi-file project preloading active during indexing                 |           |
| 2e | Import edge target kinds resolved via cross-file lookup              |           |
| 2f | `this.method()` intra-class call edges extracted                     |           |
| 3  | Edge kinds include imports + calls + implements + uses              |           |
| 4  | `get_logic_slice` — progressive detail L1 < L2 < L3                 |           |
| 5  | `get_logic_slice` — transitive dependencies resolved                |           |
| 6  | `get_blast_radius` — impactScore > 0, multi-depth dependents        |           |
| 6a | `get_blast_radius` — riskScore per entry, overallRiskScore 0-1      |           |
| 6b | `get_blast_radius` — 3-tier: confirmed + likely + potential = impactScore |      |
| 6c | `get_blast_radius` — edgeKinds array per entry (non-empty)           |           |
| 6d | `get_blast_radius` — confidence filter returns only matching tier    |           |
| 7  | `get_architectural_overlay` — 6 layers, correct classification      |           |
| 8  | `get_why_context` — commits returned, no changeIntelligence overlap |           |
| 8a | `get_why_context` — `maxCommits` slices commitHistory correctly     |           |
| 8b | `--max-history` limits intent entries per file during indexing       |           |
| 9  | `get_change_intelligence` — complexity > 0, valid band              |           |
| 10 | `find_dead_code` — deadSymbols detected, confidence scoring works   |           |
| 10a| `find_dead_code` — deadFiles lists fully-dead files                 |           |
| 10b| `find_dead_code` — circular islands detected as dead                |           |
| 10c| `find_dead_code` — test/config files excluded by default            |           |
| 10d| `find_dead_code` — unusedExports detected (exported but never imported) |        |
| 10e| `find_dead_code` — cascadeDepth tracked for dead chains              |           |
| 10f| `find_dead_code` — framework symbols (main, Schema) NOT flagged      |           |
| 10g| `find_dead_code` — scaffolding markers detected (TODO/FIXME/HACK)    |           |
| 11 | `get_context_for_task` — context entries with relevanceScore        |           |
| 11a| `get_context_for_task` — taskType affects ranking (fix vs extend)   |           |
| 11b| `get_context_for_task` — tokenBudget respected                      |           |
| 11c| `get_context_for_task` — warnings for anti-patterns                 |           |
| 12 | `get_ranked_context` — results ranked by combinedScore              |           |
| 12a| `get_ranked_context` — exact name match scores 1.0                  |           |
| 12b| `get_ranked_context` — importance strategy works                    |           |
| 12c| `get_ranked_context` — tokenBudget respected                        |           |
| 13 | `search_symbols` — exact, regex, substring all return results       |           |
| 13a| `search_symbols` — kind and filePattern filters work               |           |
| 13b| `search_symbols` — limit caps results, totalMatches shows full count|           |
| 13c| `search_symbols` — invalid regex falls back to literal (no crash)  |           |
| 14 | `get_changed_symbols` — returns symbols grouped by changed file     |           |
| 14a| `get_changed_symbols` — custom since ref returns more changes      |           |
| 14b| `get_changed_symbols` — maxFiles limits processed files            |           |
| 14c| `get_changed_symbols` — invalid git ref returns graceful error     |           |
| 15 | `find_importers` — direct importers returned with depth=1          |           |
| 15a| `find_importers` — transitive mode returns multi-depth BFS         |           |
| 15b| `find_importers` — edgeKinds filter restricts edge types           |           |
| 15c| `find_importers` — maxDepth caps transitive traversal              |           |
| 15d| `find_importers` — circular deps do not cause infinite loop        |           |
| 16 | `get_class_hierarchy` — full project returns hierarchy trees        |           |
| 16a| `get_class_hierarchy` — ancestors returns extends/implements chain |           |
| 16b| `get_class_hierarchy` — descendants returns implementing classes   |           |
| 16c| `get_class_hierarchy` — only extends/implements edges traversed    |           |
| 17 | `get_symbol_importance` — rankings sorted by PageRank score desc   |           |
| 17a| `get_symbol_importance` — top symbol is widely-depended-on type    |           |
| 17b| `get_symbol_importance` — kind and filePattern filters work        |           |
| 17c| `get_symbol_importance` — converged=true, iterations reasonable    |           |
| 17d| `get_symbol_importance` — limit caps results count                 |           |
| 17 | Go adapter: struct→class, interface, function, method extracted      |           |
| 17a| Go adapter: unexported (lowercase) symbols skipped                   |           |
| 17b| Go adapter: import edges extracted from `import` declarations        |           |
| 17c| C# adapter: class, interface, method, enum, constructor extracted    |           |
| 17d| C# adapter: private methods skipped, namespace qualification correct |           |
| 17e| C# adapter: using→imports, base_list→extends/implements edges        |           |
| 17f| Registry: `.go`→syntax, `.cs`→syntax, `.ts`→full, `.py`→none        |           |
| 17g| Dynamic extension filter: `getSupportedExtensions()` includes all    |           |
| 17h| Graceful degradation: TS indexing works without tree-sitter installed |           |
| 17i| `runCheck()` uses registry + dynamic extensions (not hardcoded)       |           |
| 17j| Watch command uses local scoped extensions (no mutable global)        |           |
| 18 | Co-change matrix generated during indexing                           |           |
| 18a| Co-change entries filtered (freq >= 0.1, shared >= 2)               |           |
| 18b| Co-change boost: potential → likely when frequency > 0.5            |           |
| 19 | `get_pr_impact` — returns risk assessment for changed files         |           |
| 19a| `get_pr_impact` — riskLevel low/medium/high                         |           |
| 19b| `get_pr_impact` — coChangedWith array per file                      |           |
| 19c| `get_pr_impact` — confidence filter works                           |           |
| 20 | Staleness detection — no false positive on fresh index              |           |
| 21 | Unit tests pass (675+)                                              |           |
| 22 | Git hash masking — visible or redacted (log status)                 |           |
| 23 | Manual vs MCP comparison table filled with measured data            |           |
| 24 | Token savings > 10x for aggregate                                   |           |
| 25 | Context budget chart shows MCP uses < 1% of 1M window               |           |

**Result:** \_\_\_/83 checks passed

***

## Appendix A: Automated Smoke Test

Run all 14 MCP tool calls automatically via InMemoryTransport:

```Shell
# 1. Clean + rebuild index
rm -rf .ctxo/.cache/ .ctxo/index/ && npx tsx src/index.ts index

# 2. Run unit tests
npx vitest run

# 3. Run MCP validation (14 tool calls, expects 14/14 PASS)
npx tsx docs/runbook/mcp-validation/mcp-validation-test.ts
```

**What it does:**
- Boots the full MCP server in-process using `InMemoryTransport` (no stdio)
- Registers all 14 tools with the same wiring as `src/index.ts`
- Calls each tool with representative arguments and parses the response
- Prints `PASS | <key metrics>` or `FAIL` per tool
- Exits with code 0 if 14/14 pass, code 1 otherwise

**Expected output (all green):**

```
get_logic_slice:          PASS | root=LogicSliceQuery deps=4 edges=12
get_blast_radius:         PASS | impact=38 conf=35 pot=3 risk=1.000
get_architectural_overlay:PASS | Configuration=3 Test=62 Adapter=28 Domain=23 ...
get_why_context:          PASS | commits=6 anti=1
get_change_intelligence:  PASS | cx=0.44 churn=0.67 comp=0.30 band=low
find_dead_code:           PASS | total=241 reach=93 dead=148 pct=61.4% ...
get_context_for_task:     PASS | ctx=8 tok=3970
get_ranked_context:       PASS | res=22 tok=1999 top=IMaskingPort
search_symbols:           PASS | match=13 top=handleFindImporters
get_changed_symbols:      PASS | files=0 syms=0
find_importers:           PASS | imp=38 maxD=3
get_class_hierarchy:      PASS | hier=4 cls=8 edges=4
get_symbol_importance:    PASS | syms=258 conv=true iter=30 top=FileIndex
get_pr_impact:            PASS | files=N risk=low

=== RESULT: 14/14 passed, 0 failed ===
```

**Source:** [`mcp-validation-test.ts`](mcp-validation-test.ts)

***

## Appendix B: Manual Smoke Test

For manual validation without the automated script:

```Shell
# 1. Clean + rebuild
rm -rf .ctxo/.cache/ .ctxo/index/ && npx tsx src/index.ts index

# 2. Run tests
npx vitest run
```

Then invoke these 14 MCP calls:

* `get_logic_slice` — `src/core/logic-slice/logic-slice-query.ts::LogicSliceQuery::class`, level 3
* `get_blast_radius` — `src/core/types.ts::SymbolNode::type`
* `get_architectural_overlay` — no params
* `get_why_context` — `src/core/masking/masking-pipeline.ts::MaskingPipeline::class` (also test with `maxCommits: 3`)
* `get_change_intelligence` — `src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class`
* `find_dead_code` — no params (default: exclude tests)
* `get_context_for_task` — `src/core/graph/symbol-graph.ts::SymbolGraph::class`, taskType: "understand"
* `get_ranked_context` — query: "masking", tokenBudget: 2000
* `search_symbols` — pattern: "^handle", kind: "function"
* `get_changed_symbols` — since: "HEAD~3"
* `find_importers` — `src/core/types.ts::SymbolNode::type`, transitive: true
* `get_class_hierarchy` — no params (full project hierarchy)
* `get_symbol_importance` — limit: 10
* `get_pr_impact` — since: "HEAD~3"

**Quick pass criteria:** All 14 return data (not errors), dependencies/dependents non-empty, 6 layers present, dead code has totalSymbols > 0, context has entries with scores, search returns matches, importers non-empty, hierarchy has trees, importance rankings sorted by score descending with converged=true, PR impact returns riskLevel.
