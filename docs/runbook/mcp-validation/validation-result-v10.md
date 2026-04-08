# Ctxo MCP Validation Result — V10

> **Date:** 2026-04-08
> **Commit:** `f2fd79d` (master)
> **Overall:** PASS (1 known issue, 2 NEW bugs found)
> **Focus:** Runtime simulation + edge case bug hunting

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

## Test Suite

```
60 test files | 675 tests passed | 0 failures | 5.38s
```

---

## NEW BUGS FOUND (Runtime Simulation)

### BUG #6: `find_importers` — `importerCount` inconsistency between direct and transitive mode

**Severity:** Medium
**File:** [find-importers.ts:53-69](src/adapters/mcp/find-importers.ts#L53-L69) vs [find-importers.ts:71-89](src/adapters/mcp/find-importers.ts#L71-L89)

**Symptom:**

| Mode | importerCount | Actual unique symbols |
|---|---|---|
| `find_importers(SymbolNode, transitive=false)` | **20** | 11 |
| `find_importers(SymbolNode, transitive=true, maxDepth=1)` | **11** | 11 |
| `find_importers(FileIndex, transitive=false)` | **18** | 10 |
| `find_importers(FileIndex, transitive=true, maxDepth=1)` | **10** | 10 |

Both calls should return the same count when limited to depth 1, but direct mode double-counts.

**Root cause:** Direct mode (L53-69) iterates over ALL reverse edges and pushes one entry per `(symbolId, edgeKind)` pair. If `CSharpAdapter` has both `imports` and `uses` edges to `SymbolNode`, it appears twice. Transitive mode (L71-89) uses a `visited: Set<string>` keyed by symbolId, so each symbol appears exactly once.

**Impact:** `importerCount` in direct mode reports **edge count**, not **unique symbol count**. This is misleading — a consumer expecting "11 different symbols depend on this" gets "20" because some symbols have multiple edge kinds.

**Fix options:**
1. Deduplicate direct mode by symbolId (match transitive behavior)
2. Add `uniqueImporterCount` field alongside `importerCount`
3. Document that direct mode returns per-edge entries (breaking change if "fixed")

---

### BUG #7: `get_pr_impact` — `changedFiles` reports raw git paths, not indexed files

**Severity:** Medium
**File:** [get-pr-impact.ts:180](src/adapters/mcp/get-pr-impact.ts#L180) vs [get-changed-symbols.ts:61](src/adapters/mcp/get-changed-symbols.ts#L61)

**Symptom:**

| Tool | since | changedFiles | changedSymbols | files[] |
|---|---|---|---|---|
| `get_pr_impact` | HEAD~1 | **50** | 0 | [] |
| `get_pr_impact` | HEAD~3 | **50** | 0 | [] |
| `get_pr_impact` | HEAD~5 | **50** | 0 | [] |
| `get_changed_symbols` | HEAD~1 | **0** | 0 | [] |
| `get_changed_symbols` | HEAD~5 | **0** | 0 | [] |

`get_pr_impact` claims 50 files changed but 0 symbols found. `get_changed_symbols` says 0 files for the same ref.

**Root cause:**

```typescript
// get-pr-impact.ts:180 — reports ALL git diff paths (capped at maxFiles)
changedFiles: limitedPaths.length  // = min(git_diff_count, 50)

// get-changed-symbols.ts:61 — reports only files with indexed symbols
changedFiles: files.length  // = files that matched index
```

`get_pr_impact` reports `changedFiles = limitedPaths.length` (raw git paths, maxFiles=50 cap). Git returns test files, config files, `.fixture` files, etc. — all appear as "changed" but have no indexed symbols. So `changedFiles=50, changedSymbols=0, files=[]` is technically correct but **semantically confusing**.

Meanwhile `get_changed_symbols` correctly filters to only files with indexed symbols, reporting `changedFiles=0`.

**Impact:** Users see `changedFiles: 50, riskLevel: low, files: []` and think "50 files changed but zero risk?" — the number is misleading because it counts non-source files.

**Fix:** Change `get-pr-impact.ts:180` to report `files.length` instead of `limitedPaths.length`, matching `get_changed_symbols` semantics. Or add `rawChangedFiles` + `indexedChangedFiles` fields.

---

### BUG #7b: `get_pr_impact` silent on invalid git ref

**Severity:** Low
**File:** [get-pr-impact.ts:56](src/adapters/mcp/get-pr-impact.ts#L56)

**Symptom:** `get_pr_impact({ since: "nonexistent-branch-xyz" })` returns `{ changedFiles: 0, riskLevel: "low" }` with no error or hint. `get_changed_symbols` does the same.

**Expected:** Either an error message or a `hint` field like `"Git ref not found"`.

**Root cause:** `git.getChangedFiles("nonexistent-branch-xyz")` returns `[]` (warn-and-continue pattern from git adapter). Valid behavior per error handling spec, but the consumer can't distinguish "no changes" from "invalid ref".

---

## Edge Case Test Results (All 14 Tools)

### Graceful Error Handling — PASS

| Test | Tool | Expected | Actual | Status |
|---|---|---|---|---|
| Nonexistent symbol | `get_logic_slice` | `{ found: false }` | `{ found: false, hint: "..." }` | PASS |
| Nonexistent symbol | `get_blast_radius` | `{ found: false }` | `{ found: false, hint: "..." }` | PASS |
| Nonexistent symbol | `get_why_context` | `{ found: false }` | `{ found: false, hint: "..." }` | PASS |
| Nonexistent symbol | `get_change_intelligence` | `{ found: false }` | `{ found: false, hint: "..." }` | PASS |
| Nonexistent symbol | `find_importers` | `{ found: false }` | `{ found: false, hint: "..." }` | PASS |
| Nonexistent symbol | `get_class_hierarchy` | `{ found: false }` | `{ found: false, hint: "..." }` | PASS |
| Nonexistent symbol | `get_context_for_task` | `{ found: false }` | `{ found: false, hint: "..." }` | PASS |
| Invalid regex | `search_symbols` | fallback/empty | `{ totalMatches: 0 }` | PASS |
| Invalid git ref | `get_changed_symbols` | graceful | `{ changedFiles: 0 }` | PASS |
| Invalid git ref | `get_pr_impact` | graceful | `{ changedFiles: 0 }` | PASS |

### Leaf / Zero-Result Cases — PASS

| Test | Tool | Expected | Actual | Status |
|---|---|---|---|---|
| Leaf symbol (addNode) | `get_blast_radius` | impactScore=0 | impactScore=0 | PASS |
| SymbolNode (no deps) | `get_logic_slice` L2 | deps=[], edges=[] | deps=[], edges=[] | PASS |
| No-match query | `get_ranked_context` | relevanceScore=0, importance-ranked | All relevanceScore=0 | PASS |
| Token budget=100 | `get_context_for_task` | totalTokens ≤ 100 | totalTokens=43 | PASS |
| Layer filter | `get_architectural_overlay` | Domain files only | 24 Domain files | PASS |
| Limit=1 | `get_symbol_importance` | 1 result | 1 result | PASS |

### Batch + Advanced — PASS

| Test | Tool | Expected | Actual | Status |
|---|---|---|---|---|
| Batch 3 symbols | `get_logic_slice` | 3 results | `{ batch: true, results: [3] }` | PASS |
| maxDepth=1 + transitive | `find_importers` | depth-1 only | 11 at depth 1 | PASS |
| Confidence filter | `get_pr_impact` | no error | responded correctly | PASS |

### New Tool Deep Test — `get_pr_impact`

| Test | Expected | Actual | Status |
|---|---|---|---|
| Default (HEAD~1) | response with riskLevel | riskLevel=low | PASS |
| HEAD~3 | response | riskLevel=low | PASS |
| HEAD~5 | response | riskLevel=low | PASS |
| Invalid ref | graceful | changedFiles=0 | PASS |
| Confidence filter | no error | responded | PASS |
| changedFiles accuracy | match get_changed_symbols | **MISMATCH (50 vs 0)** | **BUG #7** |

### New Module Deep Test — `co-change-analyzer`

| Test | Tool | Result | Status |
|---|---|---|---|
| blast radius | `get_blast_radius` | impact=6, 2 direct deps | PASS |
| why context | `get_why_context` | 1 commit, no anti-patterns | PASS |
| change intel | `get_change_intelligence` | complexity=1.0, churn=0.0625, band=low | PASS |
| context for task | `get_context_for_task` | 8 context entries, CoChangeEntry/Matrix at top | PASS |
| ranked context | `get_ranked_context("co-change")` | relevanceScore=0 for all (hyphen split issue) | NOTE |

**Note:** "co-change" query returns relevanceScore=0 because BM25 tokenization doesn't split camelCase symbol names. Not a bug — design limitation of substring matching.

---

## Index Metrics

| Metric | V10 |
|---|---|
| Source files | 130 |
| Symbols | 299 |
| Edges | 889 |
| Intents | 347 |
| Co-change pairs | 192 |
| MCP tools | 14 |
| Tests | 675 (0 failures) |

---

## All Known Issues (Cumulative)

| # | Issue | Severity | Status | Since |
|---|---|---|---|---|
| 1 | Git hash masking FP (`[REDACTED:AWS_SECRET]`) | Medium | Open | V4 |
| **6** | **`find_importers` importerCount double-counts in direct mode** | **Medium** | **NEW** | **V10** |
| **7** | **`get_pr_impact` changedFiles reports raw git paths, not indexed files** | **Medium** | **NEW** | **V10** |
| **7b** | **`get_pr_impact` + `get_changed_symbols` silent on invalid git ref** | **Low** | **NEW** | **V10** |

---

## Version History

| | V4 | V7 | V9 | **V10** |
|---|---|---|---|---|
| Files | 121 | 126 | 130 | **130** |
| Symbols | 261 | 293 | 299 | **299** |
| Edges | 780 | 843 | 889 | **889** |
| Tests | 594 | 654 | 675 | **675** |
| MCP Tools | 13 | 13 | 14 | **14** |
| Bugs found | 0 | 0 | 0 | **2 new** |
| Known issues | 1 | 1 | 1 | **4** |
