# Ctxo MCP Validation Result — V11

> **Date:** 2026-04-08
> **Commit:** `68c213d` (master) — Update committed index and co-changes cache
> **Overall:** PASS (2 open bugs, 1 known issue)

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

## V10 → V11 Delta

| Metric | V10 | V11 | Delta |
|---|---|---|---|
| Build time | 4.5s | **2.6s** | **-42%** |
| Symbols | 299 | **301** | +2 |
| Edges | 889 | **892** | +3 |
| Intents | 347 | **311** | -36 (re-indexed with new commit history) |
| Co-change pairs | 192 | **111** | -81 (threshold/algorithm change) |
| Tests | 675 | **678** | +3 |
| calls edges | 272 | **274** | +2 |
| imports | 414 | **415** | +1 |
| Cross-file fn | 82 | **83** | +1 |
| Intra-class calls | 194 | **196** | +2 |

New: `SimpleGitAdapter.getBatchHistory` symbol detected (+1 new method).
IndexCommand.run CC: 22 → **23**.
IGitPort tokens: 65 → **84** (new method added to port interface).
`get_ranked_context("masking")`: now returns **21 results** (was 14-16) — improved token packing.

---

## Index Metrics

| Metric | Value |
|---|---|
| Files indexed | 130 |
| Index files | 130 |
| Symbols | 301 |
| Edges | 892 |
| Intents | 311 |
| AntiPatterns | 4 |
| Byte offsets | 301 (100%) |
| typeOnly | 172 |
| Co-change pairs | 111 |
| imports=415, calls=274, uses=196, impl=5, ext=2 | |
| Cross-file: type=80, class=155, iface=87, fn=83 | |
| Intra-class calls | 196 |

---

## Tool Validation — All 14 Tools PASS

| # | Tool | Status | Key V11 Observation |
|---|---|---|---|
| 1 | `get_logic_slice` | PASS | L1(0) < L3(12), stable |
| 2 | `get_blast_radius` | PASS | impact=43, 3-tier (11/29/3) |
| 3 | `get_architectural_overlay` | PASS | All new files classified correctly |
| 4 | `get_why_context` | PASS | 6 commits, hash masking FP |
| 5 | `get_change_intelligence` | PASS | complexity=0.444, churn=0.625, band=low |
| 6 | `find_dead_code` | PASS | 66 dead (23.2%), `getBatchHistory` new dead method |
| 7 | `get_context_for_task` | PASS | CC=23 for IndexCommand.run |
| 8 | `get_ranked_context` | PASS | 21 results (improved packing) |
| 9 | `search_symbols` | PASS | 14 handlers, 35 interfaces |
| 10 | `get_changed_symbols` | PASS | 0 (uncommitted) |
| 11 | `find_importers` | PASS | direct=20, transitive=43 |
| 12 | `get_class_hierarchy` | PASS | 11 classes, 7 edges |
| 13 | `get_symbol_importance` | PASS | converged iter=34 |
| 14 | `get_pr_impact` | PASS | changedFiles=50 (Bug #7 open) |

---

## Bug Verification (V10 bugs still open)

| Bug | Issue | Status | V11 Reproduction |
|---|---|---|---|
| #6 | alperhankendi/Ctxo#22 | **Open** | direct=20 vs transitive maxDepth=1=11 (confirmed) |
| #7 | alperhankendi/Ctxo#23 | **Open** | changedFiles=50 vs get_changed_symbols=0 (confirmed) |

---

## Unit Tests

```
60 test files | 678 tests passed | 0 failures | 4.44s
```

---

## Version History

| | V4 | V9 | V10 | **V11** |
|---|---|---|---|---|
| Build time | 4.7s | 4.5s | 4.5s | **2.6s** |
| Files | 121 | 130 | 130 | **130** |
| Symbols | 261 | 299 | 299 | **301** |
| Edges | 780 | 889 | 889 | **892** |
| Tests | 594 | 675 | 675 | **678** |
| MCP Tools | 13 | 14 | 14 | **14** |
| Bugs found | — | — | 2 | **2 (open)** |
| Failures | 0 | 0 | 0 | **0** |

---

## Known Issues

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Git hash masking FP | Medium | Open (pre-existing) |
| 6 | `find_importers` double-count (alperhankendi/Ctxo#22) | Medium | Open |
| 7 | `get_pr_impact` changedFiles semantics (alperhankendi/Ctxo#23) | Medium | Open |
