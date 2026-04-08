# Ctxo MCP Validation Result — V6

> **Date:** 2026-04-08
> **Commit:** `5dc06da` + uncommitted tree-sitter/Go/C# feature (master)
> **Overall:** PASS (1 known issue)
> **New in V6:** Graceful degradation warnings for missing tree-sitter grammars, `IndexCommand.runCheck` method detected

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

## Index Build (Steps 1-3)

| Metric | V6 | V5 | V4 |
|---|---|---|---|
| Files indexed | 126 | 126 | 121 |
| Build time | 4.5s | 4.5s | 4.7s |
| Symbols | 293 | 291 | 261 |
| Edges | 842 | 848 | 780 |
| Intents | 322 | 322 | 317 |
| AntiPatterns | 4 | 4 | 4 |
| Byte offsets | 293 (100%) | 291 (100%) | 261 (100%) |
| typeOnly edges | 158 | 158 | 146 |
| imports | 388 | 392 | 372 |
| calls | 266 | 264 | 237 |
| uses | 181 | 185 | 167 |
| implements | 5 | 5 | 4 |
| extends | 2 | 2 | 0 |

**New:** Graceful degradation: `Go adapter unavailable (tree-sitter-go not installed)`, `C# adapter unavailable (tree-sitter-c-sharp not installed)` — logged to stderr, indexing continues normally.

`--max-history 5`: PASS

---

## Tool Validation (Steps 4-16)

| Step | Tool | Status | Key Metric |
|---|---|---|---|
| 4 | `get_logic_slice` L1-L4 | PASS | L1(0) < L2(8) < L3(12) progressive |
| 5 | `get_blast_radius` | PASS | impact=42, confirmed=39, potential=3, depth 1-3 |
| 6 | `get_architectural_overlay` | PASS | 6 layers, no cross-layer violations |
| 7 | `get_why_context` | PASS | 6/3/1 commits, maxCommits works, hash masking FP |
| 8 | `get_change_intelligence` | PASS | complexity=0.444, churn=0.667, band=low |
| 9 | `find_dead_code` | PASS | 276 total, 65 dead (23.6%), 75 incl. tests (25.6%) |
| 10 | `get_context_for_task` | PASS | 4 task types, different scoring weights |
| 11 | `get_ranked_context` | PASS | masking→IMaskingPort(0.735), budget 500→492 tokens |
| 12 | `search_symbols` | PASS | SymbolGraph=11, ^handle=13, interfaces=33 |
| 13 | `get_changed_symbols` | PASS | 0 (uncommitted, correct) |
| 14 | `find_importers` | PASS | direct=20, transitive=42, implements=0 |
| 15 | `get_class_hierarchy` | PASS | 11 classes, 7 edges (5 implements + 2 extends) |
| 16 | `get_symbol_importance` | PASS | converged iter=34, damping=0.85 |

### Blast Radius Detail (Step 5)

| Depth | Count | riskScore | New in V6 |
|---|---|---|---|
| 1 | 11 | 1.000 | CSharpAdapter, GoAdapter, TreeSitterAdapter |
| 2 | 27 | 0.616 | IndexCommand.runCheck (NEW method) |
| 3 | 4 | 0.463 | — |

### Class Hierarchy (Step 15)

```
ILanguageAdapter (interface)
├── TreeSitterAdapter (implements)
│   ├── CSharpAdapter (extends)
│   └── GoAdapter (extends)
└── TsMorphAdapter (implements)

IGitPort → SimpleGitAdapter (implements)
IStoragePort → SqliteStorageAdapter (implements)
IWatcherPort → ChokidarWatcherAdapter (implements)
```

### PageRank Top 5 (Step 16)

| # | Symbol | Score | InDegree |
|---|---|---|---|
| 1 | SqliteStorageAdapter.database | 0.0233 | 13 |
| 2 | TsMorphAdapter.buildSymbolId | 0.0123 | 14 |
| 3 | CSharpAdapter.isPublic | 0.0101 | 4 |
| 4 | TsMorphAdapter.isExported | 0.0094 | 11 |
| 5 | FileIndex | 0.0083 | 33 |

---

## Infrastructure Checks (Steps 17-19)

### Step 17: Staleness Detection — PASS

### Step 18: Edge Kind Coverage — PASS

| Edge Kind | Count | Minimum | Status |
|---|---|---|---|
| imports | 388 | 200+ | PASS |
| calls | 266 | 1+ | PASS |
| uses | 181 | 1+ | PASS |
| implements | 5 | 1+ | PASS |
| extends | 2 | 0 | PASS |

Cross-file resolution: type=77, class=151, interface=76, function=74 — all > 0.
Intra-class `this.method()` calls: **194**

### Step 19: Unit Tests — PASS

```
58 test files | 646 tests passed | 0 failures | 4.76s
```

---

## V5 → V6 Delta

| Metric | V5 | V6 | Change |
|---|---|---|---|
| Symbols | 291 | 293 | +2 |
| Edges | 848 | 842 | -6 |
| Blast radius (SymbolNode) | 41 | 42 | +1 (IndexCommand.runCheck) |
| Direct importers | 20 | 20 | — |
| Transitive importers | 41 | 42 | +1 |
| Intra-class calls | 190 | 194 | +4 |
| Dead symbols (excl. tests) | 65 | 65 | — |
| Tests | 646 | 646 | — |

Minor changes due to code evolution between runs. All tools stable.

---

## Known Issues

1. **Git hash masking false positive** — `get_why_context` redacts commit hashes as `[REDACTED:AWS_SECRET]`. Pre-existing (Bug #3).

---

## Validation Checklist

| Step | Status |
|---|---|
| 1-3: Index build + metrics | PASS |
| 4: get_logic_slice (L1-L4) | PASS |
| 5: get_blast_radius + risk + confirmed/potential | PASS |
| 6: get_architectural_overlay | PASS |
| 7: get_why_context + maxCommits | PASS (known: hash masking) |
| 8: get_change_intelligence | PASS |
| 9: find_dead_code + includeTests | PASS |
| 10: get_context_for_task (4 types) | PASS |
| 11: get_ranked_context (3 strategies) | PASS |
| 12: search_symbols (5 queries) | PASS |
| 13: get_changed_symbols | PASS |
| 14: find_importers (direct + transitive) | PASS |
| 15: get_class_hierarchy | PASS |
| 16: get_symbol_importance (PageRank) | PASS |
| 17: Staleness detection | PASS |
| 18: Edge kind coverage + cross-file | PASS |
| 19: Unit tests (646) | PASS |
| 20: Ctxo vs Manual comparison | 90% token savings, 98% fewer calls |
