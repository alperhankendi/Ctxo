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

**Record metrics:**

| Metric        | Value          |
| ------------- | -------------- |
| Files indexed | \_\_\_         |
| Build time    | \_\_\_ seconds |

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

**Record:**

| Metric                | Value              |
| --------------------- | ------------------ |
| Commits returned      | \_\_\_             |
| Anti-pattern warnings | \_\_\_             |
| Hash masking status   | Redacted / Visible |

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

## Step 9: Staleness Detection Check

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

### 12.6 Comparison Table

Fill in after completing both MCP and manual runs:

| Tool                        | MCP Tokens | MCP Calls | Manual Tokens | Manual Calls | Token Savings | Call Savings |
| --------------------------- | ---------- | --------- | ------------- | ------------ | ------------- | ------------ |
| `get_logic_slice`           | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_blast_radius`          | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_architectural_overlay` | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_why_context`           | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| `get_change_intelligence`   | \_\_\_     | 1         | \_\_\_        | \_\_\_       | \_\_\_x       | \_\_\_x      |
| **TOTAL**                   | **\_\_\_** | **5**     | **\_\_\_**    | **\_\_\_**   | **\_\_\_x**   | **\_\_\_x**  |

### 12.7 Context Window Budget

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
| 9  | `get_change_intelligence` — complexity > 0, valid band              |           |
| 10 | Staleness detection — no false positive on fresh index              |           |
| 11 | Unit tests pass                                                     |           |
| 12 | Git hash masking — visible or redacted (log status)                 |           |
| 13 | Manual vs MCP comparison table filled with measured data            |           |
| 14 | Token savings > 10x for aggregate                                   |           |
| 15 | Context budget chart shows MCP uses < 1% of 1M window               |           |

**Result:** \_\_\_/15 checks passed

***

## Appendix: Quick One-Liner Smoke Test

For fast validation without filling the full checklist:

```Shell
# 1. Clean + rebuild
rm -rf .ctxo/.cache/ .ctxo/index/ && npx tsx src/index.ts index

# 2. Run tests
npx vitest run
```

Then invoke these 5 MCP calls in parallel:

* `get_logic_slice` — `src/core/logic-slice/logic-slice-query.ts::LogicSliceQuery::class`, level 3
* `get_blast_radius` — `src/core/types.ts::SymbolNode::type`
* `get_architectural_overlay` — no params
* `get_why_context` — `src/core/masking/masking-pipeline.ts::MaskingPipeline::class`
* `get_change_intelligence` — `src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class`

**Quick pass criteria:** All 5 return data (not errors), dependencies/dependents non-empty, 3 layers present.
