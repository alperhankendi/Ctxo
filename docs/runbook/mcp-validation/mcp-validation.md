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

**Record metrics:**

| Metric        | Value          |
| ------------- | -------------- |
| Files indexed | \_\_\_         |
| Build time    | \_\_\_ seconds |

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
const files=walk('.ctxo/index'); let s=0,ed=0,i=0,a=0,ek={};
for(const f of files){const d=JSON.parse(fs.readFileSync(f,'utf8'));s+=(d.symbols||[]).length;ed+=(d.edges||[]).length;i+=(d.intent||[]).length;a+=(d.antiPatterns||[]).length;for(const e of(d.edges||[]))ek[e.kind]=(ek[e.kind]||0)+1;}
console.log(JSON.stringify({files:files.length,symbols:s,edges:ed,intents:i,antiPatterns:a,edgeKinds:ek},null,2));
"
```

**Verify:**

* [ ] `files` matches Step 2 count
* [ ] `symbols` > 0
* [ ] `edges` > 0
* [ ] `intents` > 0 (git intent is indexed)
* [ ] `antiPatterns` >= 0 (may be 0 if no reverts detected)
* [ ] `edgeKinds` contains `imports`, `calls`, `implements`

**Record metrics:**

| Metric       | Value                                         |
| ------------ | --------------------------------------------- |
| Symbols      | \_\_\_                                        |
| Edges        | \_\_\_                                        |
| Intents      | \_\_\_                                        |
| AntiPatterns | \_\_\_                                        |
| Edge kinds   | imports=\_\_\_ calls=\_\_\_ implements=\_\_\_ |

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

### 5.3 Confirmed vs Potential Split

**Verify:**

* [ ] `confirmedCount` + `potentialCount` = `impactScore`
* [ ] Each entry has `confidence` field: either `"confirmed"` or `"potential"`
* [ ] Entries with edge kind `calls`, `extends`, `implements`, `uses` → `"confirmed"`
* [ ] Entries with edge kind `imports` → `"potential"`
* [ ] `confirmedCount` >= 0 (may be 0 if all edges are imports)

### 5.4 Edge Cases

* [ ] Leaf symbol (no dependents) returns `impactScore: 0`, `confirmedCount: 0`, `potentialCount: 0`
* [ ] Non-existent symbol returns `{ found: false }`
* [ ] Circular dependency does not cause infinite loop

**Record:**

| Metric             | Value  |
| ------------------ | ------ |
| Impact score       | \_\_\_ |
| Confirmed count    | \_\_\_ |
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

## Step 12: Staleness Detection Check

Run any tool immediately after a fresh index build.

**Verify:**

* [ ] No `"⚠️ Index may be stale"` warning in response
* [ ] If you modify a source file and re-run without re-indexing, stale warning SHOULD appear

***

## Step 10: Edge Kind Coverage Check

From Step 3 metrics, verify edge kind diversity.

**Verify:**

* [ ] `imports` > 0 (primary edge kind)
* [ ] `calls` > 0 (function call edges)
* [ ] `implements` > 0 (interface implementation edges)
* [ ] Optional: `extends` and `uses` (may be 0 depending on codebase patterns)

**Expected minimums:**

| Edge Kind    | Minimum | Spec Status                    |
| ------------ | ------- | ------------------------------ |
| `imports`    | 200+    | Required                       |
| `calls`      | 1+      | Required                       |
| `implements` | 1+      | Required                       |
| `extends`    | 0       | Optional (depends on codebase) |
| `uses`       | 0       | Optional (V1.5)                |

***

## Step 11: Run Unit Tests

```Shell
npx vitest run 2>&1 | tail -10
```

**Verify:**

* [ ] All tests pass
* [ ] No test failures or errors

***

## Step 12: Manual vs MCP Tool Comparison

For each tool, manually replicate the same result using standard AI assistant tools (Read, Grep, Glob, Bash). Measure the cost and compare.

### 12.1 Manual: Logic Slice — LogicSliceQuery

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

### 12.2 Manual: Blast Radius — SymbolNode

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

### 12.3 Manual: Architectural Overlay

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

### 12.4 Manual: Why Context — MaskingPipeline

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

### 12.5 Manual: Change Intelligence — SqliteStorageAdapter

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

### 12.6 Manual: Dead Code Detection

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

### 12.7 Comparison Table

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
| **TOTAL**                   | **\_\_\_** | **8**     | **\_\_\_**    | **\_\_\_**   | **\_\_\_x**   | **\_\_\_x**  |

### 12.8 Context Window Budget

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
| 3  | Edge kinds include imports + calls + implements                     |           |
| 4  | `get_logic_slice` — progressive detail L1 < L2 < L3                 |           |
| 5  | `get_logic_slice` — transitive dependencies resolved                |           |
| 6  | `get_blast_radius` — impactScore > 0, multi-depth dependents        |           |
| 6a | `get_blast_radius` — riskScore per entry, overallRiskScore 0-1      |           |
| 6b | `get_blast_radius` — confirmedCount + potentialCount = impactScore   |           |
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
| 13 | Staleness detection — no false positive on fresh index              |           |
| 14 | Unit tests pass                                                     |           |
| 15 | Git hash masking — visible or redacted (log status)                 |           |
| 16 | Manual vs MCP comparison table filled with measured data            |           |
| 17 | Token savings > 10x for aggregate                                   |           |
| 18 | Context budget chart shows MCP uses < 1% of 1M window               |           |

**Result:** \_\_\_/33 checks passed

***

## Appendix: Quick One-Liner Smoke Test

For fast validation without filling the full checklist:

```Shell
# 1. Clean + rebuild
rm -rf .ctxo/.cache/ .ctxo/index/ && npx tsx src/index.ts index

# 2. Run tests
npx vitest run
```

Then invoke these 8 MCP calls:

* `get_logic_slice` — `src/core/logic-slice/logic-slice-query.ts::LogicSliceQuery::class`, level 3
* `get_blast_radius` — `src/core/types.ts::SymbolNode::type`
* `get_architectural_overlay` — no params
* `get_why_context` — `src/core/masking/masking-pipeline.ts::MaskingPipeline::class` (also test with `maxCommits: 3`)
* `get_change_intelligence` — `src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class`
* `find_dead_code` — no params (default: exclude tests)
* `get_context_for_task` — `src/core/graph/symbol-graph.ts::SymbolGraph::class`, taskType: "understand"
* `get_ranked_context` — query: "masking", tokenBudget: 2000

**Quick pass criteria:** All 8 return data (not errors), dependencies/dependents non-empty, 6 layers present, dead code has totalSymbols > 0, context has entries with scores.
