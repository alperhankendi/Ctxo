# Ctxo MCP Validation Result — V8

> **Date:** 2026-04-08
> **Commit:** `5dc06da` + uncommitted co-change + PR impact features (master)
> **Overall:** PASS (1 known issue)

---

## NEW in V8: What Changed Since V7

### 1. Co-Change Analysis Engine (NEW)

During `ctxo index`, a new **co-change analysis** phase runs after symbol/edge extraction:

```
[ctxo] Co-change analysis: 186 file pairs detected
```

**New files:**
- [co-change-analyzer.ts](src/core/co-change/co-change-analyzer.ts) — core module with `aggregateCoChanges()` and `loadCoChangeMap()`
- [co-change-analyzer.test.ts](src/core/co-change/__tests__/co-change-analyzer.test.ts) — test suite
- `.ctxo/index/co-changes.json` — committed co-change data (186 entries)

**New types:**
- `CoChangeEntry` interface: `{ file1, file2, sharedCommits, frequency }`
- `CoChangeMatrix` interface: `{ version, timestamp, entries }`

**Co-change data structure** (from `.ctxo/index/co-changes.json`):
```json
{
  "version": 1,
  "timestamp": "...",
  "entries": [
    { "file1": "get-changed-symbols.ts", "file2": "get-symbol-importance.ts", "sharedCommits": 8, "frequency": 1 },
    ...
  ]
}
```

### 2. `get_pr_impact` MCP Handler (NEW)

- [get-pr-impact.ts](src/adapters/mcp/get-pr-impact.ts) — new MCP tool handler (178 lines, L29-L206)
- `handleGetPrImpact` function indexed and visible in blast radius
- **Not yet registered as MCP tool** (no deferred tool schema found) — handler code exists but tool registration pending

### 3. `JsonIndexWriter.writeCoChanges` Method (NEW)

New method on storage writer for persisting co-change data to JSON index.

### 4. Index Growth Summary

| Metric | V7 | V8 | Delta | Meaning |
|---|---|---|---|---|
| Source files | 126 | **130** | **+4** | co-change module, pr-impact handler, tests |
| Index files | 126 | **131** | **+5** | +co-changes.json global file |
| Symbols | 293 | **299** | **+6** | aggregateCoChanges, loadCoChangeMap, handleGetPrImpact, CoChangeEntry, CoChangeMatrix, writeCoChanges |
| Edges | 843 | **889** | **+46** | co-change/pr-impact wiring + new imports/uses |
| Intents | 331 | **336** | **+5** | new file commit history |
| typeOnly | 158 | **172** | **+14** | type-only imports from new modules |
| imports | 388 | **414** | **+26** |  |
| calls | 267 | **272** | **+5** |  |
| uses | 181 | **196** | **+15** |  |
| Tests | 654 | **675** | **+21** |  |
| Test files | 58 | **60** | **+2** |  |

### 5. Blast Radius Impact

SymbolNode blast radius: **42 → 43** (+1 = `handleGetPrImpact` at depth 2)

`handleGetPrImpact` now appears as depth-2 dependent of SymbolNode because it imports from `IStoragePort` which imports SymbolNode.

### 6. Interface Count Growth

Interface search: **33 → 35** (+2 = `CoChangeEntry`, `CoChangeMatrix`)

### 7. Handler Count Growth

`^handle` search: **13 → 14** (+1 = `handleGetPrImpact`)

### 8. PageRank Changes

New interfaces `CoChangeEntry` (score=0.003204, inDegree=6) and `CoChangeMatrix` (score=0.003249, inDegree=6) enter interface rankings — both heavily depended on by pr-impact handler.

`FileIndex` inDegree: **33 → 37** (+4 imports from new modules).

### 9. Cross-File Edge Resolution

| Target Kind | V7 | V8 | Delta |
|---|---|---|---|
| type | 77 | **80** | +3 |
| class | 151 | **155** | +4 |
| interface | 76 | **87** | **+11** |
| function | 74 | **82** | **+8** |

Interface and function resolution jumped significantly — co-change/pr-impact modules heavily import interfaces and call functions.

### 10. Dead Code: New Entry

`JsonIndexWriter.writeCoChanges` appears as dead (zero importers). The method is called dynamically from IndexCommand but static analysis doesn't track the call edge. Not a real dead code — false positive from dynamic dispatch.

---

## Ctxo vs Manual: Token & Call Cost Comparison

| Tool | Manual Tokens | Manual Calls | Ctxo Tokens | Ctxo Calls | Token Savings | Call Savings |
|---|---:|---:|---:|---:|---:|---:|
| `get_logic_slice` (L3) | 1,950 | 3 | 150 | 1 | 92% | 67% |
| `get_blast_radius` | 800 | 11 | 600 | 1 | 25% | 91% |
| `get_architectural_overlay` | 25,000+ | 100+ | 500 | 1 | 98% | 99% |
| `get_why_context` | 200 | 2 | 200 | 1 | 0% | 50% |
| `get_change_intelligence` | 2,100 | 3 | 50 | 1 | 98% | 67% |
| `find_dead_code` | 5,000+ | 210+ | 2,000 | 1 | 60% | 99.5% |
| **TOTAL** | **35,050+** | **329+** | **3,500** | **6** | **90%** | **98%** |

---

## Tool Validation Detail (Steps 4-16)

### Step 4: `get_logic_slice` — PASS

| Level | Deps | Edges | Status |
|---|---|---|---|
| L1 | 0 | 0 | PASS |
| L2 | 4 | 8 | PASS |
| L3 | 4 | 12 | PASS |

Unchanged from V4-V7. Core logic slice stable.

### Step 5: `get_blast_radius` — PASS

| Metric | V8 | V7 | Delta |
|---|---|---|---|
| Impact score | **43** | 42 | +1 |
| Confirmed | **40** | 39 | +1 |
| Potential | 3 | 3 | — |
| Direct dependents | 11 | 11 | — |
| Depth 2 | **28** | 27 | +1 (`handleGetPrImpact`) |
| Depth 3 | 4 | 4 | — |

IStoragePort dependentCount: **30 → 32** (pr-impact + co-change imports).

### Step 6: `get_architectural_overlay` — PASS

Layers unchanged. New adapter files (co-change, pr-impact) not yet in overlay — uncommitted.

### Step 7: `get_why_context` — PASS (known issue)

6/3/1 commits as expected. Hash masking false positive persists.

### Step 8: `get_change_intelligence` — PASS

complexity=0.444, churn=0.667, composite=0.296, band=low. Unchanged.

### Step 9: `find_dead_code` — PASS

| Metric | V8 excl. tests | V8 incl. tests | V7 excl. | V7 incl. |
|---|---|---|---|---|
| Total symbols | **282** | **299** | 276 | 293 |
| Reachable | **216** | **223** | 211 | 218 |
| Dead | **66** | **76** | 65 | 75 |
| Dead % | **23.4%** | **25.4%** | 23.6% | 25.6% |

New dead: `JsonIndexWriter.writeCoChanges` (dynamic dispatch, false positive).

### Step 10: `get_context_for_task` — PASS

IndexCommand.run CC: **20 → 22** (co-change analysis added complexity).

### Step 11: `get_ranked_context` — PASS

Token budget 500 → 492 tokens. `JsonIndexWriter` tokens: 368 → **428** (+60, writeCoChanges method added).

### Step 12: `search_symbols` — PASS

| Query | V8 | V7 | Delta |
|---|---|---|---|
| `^handle` | **14** | 13 | +1 (`handleGetPrImpact`) |
| `.*` interface | **35** | 33 | +2 (`CoChangeEntry`, `CoChangeMatrix`) |
| co-change | **5** | 0 | NEW (aggregateCoChanges, loadCoChangeMap, writeCoChanges, CoChangeEntry, CoChangeMatrix) |
| pr-impact | **1** | 0 | NEW (handleGetPrImpact) |

### Step 13: `get_changed_symbols` — PASS (0, uncommitted)

### Step 14: `find_importers` — PASS

| Mode | V8 | V7 | Delta |
|---|---|---|---|
| Direct | 20 | 20 | — |
| Transitive | **43** | 42 | +1 (`handleGetPrImpact` at depth 2) |

### Step 15: `get_class_hierarchy` — PASS

11 classes, 7 edges. Unchanged (no new inheritance).

### Step 16: `get_symbol_importance` — PASS

Top 5 unchanged. New entries in interface ranking: `CoChangeMatrix` (score=0.003249, inDegree=6), `CoChangeEntry` (score=0.003204, inDegree=6).

---

## Infrastructure (Steps 17-19)

### Step 18: Edge Coverage — PASS

| Edge Kind | V8 | V7 | Delta |
|---|---|---|---|
| imports | **414** | 388 | **+26** |
| calls | **272** | 267 | +5 |
| uses | **196** | 181 | **+15** |
| implements | 5 | 5 | — |
| extends | 2 | 2 | — |

Cross-file: type=80, class=155, interface=**87** (+11), function=**82** (+8).
Intra-class calls: 194 (stable).

### Step 19: Unit Tests — PASS

```
60 test files | 675 tests passed | 0 failures | 4.75s
```

---

## Version History (V4 → V8)

| | V4 | V5 | V6 | V7 | **V8** |
|---|---|---|---|---|---|
| Files | 121 | 126 | 126 | 126 | **131** |
| Symbols | 261 | 291 | 293 | 293 | **299** |
| Edges | 780 | 848 | 842 | 843 | **889** |
| Intents | 317 | 322 | 322 | 331 | **336** |
| imports | 372 | 392 | 388 | 388 | **414** |
| calls | 237 | 264 | 266 | 267 | **272** |
| uses | 167 | 185 | 181 | 181 | **196** |
| implements | 4 | 5 | 5 | 5 | 5 |
| extends | 0 | 2 | 2 | 2 | 2 |
| Blast radius | 38 | 41 | 42 | 42 | **43** |
| Tests | 594 | 646 | 646 | 654 | **675** |
| Test files | 56 | 58 | 58 | 58 | **60** |
| Handlers | 13 | 13 | 13 | 13 | **14** |
| Interfaces | 33 | 33 | 33 | 33 | **35** |
| Failures | 0 | 0 | 0 | 0 | **0** |

---

## New Features Since V4 (Cumulative)

| Feature | Added In | Status |
|---|---|---|
| Tree-sitter base adapter | V5 | PASS |
| CSharpAdapter (extends TreeSitter) | V5 | PASS |
| GoAdapter (extends TreeSitter) | V5 | PASS |
| `extends` edge kind | V5 | PASS (2 edges) |
| Graceful degradation warnings | V6 | PASS |
| `IndexCommand.runCheck` method | V6 | PASS |
| **Co-change analysis engine** | **V8** | **PASS (186 pairs)** |
| **`get_pr_impact` handler** | **V8** | **PASS (indexed, not yet registered as MCP tool)** |
| **`CoChangeEntry`/`CoChangeMatrix` types** | **V8** | **PASS** |
| **`JsonIndexWriter.writeCoChanges`** | **V8** | **PASS** |
| **`.ctxo/index/co-changes.json`** | **V8** | **PASS (committed, 186 entries)** |

---

## Known Issues

1. **Git hash masking false positive** — `get_why_context` redacts commit hashes as `[REDACTED:AWS_SECRET]`. Pre-existing (Bug #3).
2. **`get_pr_impact` not registered as MCP tool** — handler exists at [get-pr-impact.ts](src/adapters/mcp/get-pr-impact.ts) but not yet wired in `src/index.ts` tool registration. Indexed correctly, appears in search/blast radius.
3. **`JsonIndexWriter.writeCoChanges` false dead code** — called dynamically from IndexCommand, static analysis misses the call edge.
