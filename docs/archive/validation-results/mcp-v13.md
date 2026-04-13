# Ctxo MCP Validation Result — V13

> **Date:** 2026-04-08
> **Commit:** `c02da4f` (master) — Add dedup regression tests and update runbook checklist (#22)
> **Overall:** PASS (1 known issue)

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

## Index Metrics

| Metric | V13 | V12 | V4 (baseline) |
|---|---|---|---|
| Files | 134 | 134 | 121 |
| Symbols | 304 | 304 | 261 |
| Edges | 945 | 945 | 780 |
| Intents | 347 | 343 | 317 |
| Co-change pairs | 127 | 127 | — |
| imports | 432 | 432 | 372 |
| calls | 295 | 295 | 237 |
| uses | 211 | 211 | 167 |
| implements | 5 | 5 | 4 |
| extends | 2 | 2 | 0 |
| Cross-file fn | 100 | 100 | 74 |
| Intra-class calls | 196 | 196 | 167 |
| Build time | 4.5s | 2.5s | 4.7s |

---

## Tool Validation — All 14 Tools PASS

| # | Tool | Status | Key Metric |
|---|---|---|---|
| 1 | `get_logic_slice` | PASS | L1(0) < L3(12), `_meta` present |
| 2 | `get_blast_radius` | PASS | impact=43, 3-tier (11/29/3), `edgeKinds` |
| 3 | `get_architectural_overlay` | PASS | 6 layers, all files classified |
| 4 | `get_why_context` | PASS | 6 commits, hash masking FP |
| 5 | `get_change_intelligence` | PASS | complexity=0.444, churn=0.500, band=low |
| 6 | `find_dead_code` | PASS | 67 dead (23.3%), truncation active |
| 7 | `get_context_for_task` | PASS | CC=23, `_meta` present |
| 8 | `get_ranked_context` | PASS | `wrapResponse` #2 importance (0.919) |
| 9 | `search_symbols` | PASS | 14 handlers, 36 interfaces |
| 10 | `get_changed_symbols` | PASS | `_meta` present |
| 11 | `find_importers` | PASS | transitive maxDepth=1=11, `_meta` present |
| 12 | `get_class_hierarchy` | PASS | 11 classes, 7 edges |
| 13 | `get_symbol_importance` | PASS | converged iter=34 |
| 14 | `get_pr_impact` | PASS | changedFiles=0 (correct) |

---

## Bug Status

| # | Issue | V12 | V13 |
|---|---|---|---|
| 1 | Git hash masking FP | Open | **Open** |
| 6 | `find_importers` dedup (#22) | Open | **FIXED** (committed `137f9b2`, unit tests `c02da4f`) |
| 7 | `get_pr_impact` changedFiles (#23) | Potentially fixed | **FIXED** (changedFiles=0) |

**Note:** Bug #6 fix is in source code and verified via unit test (708 pass). MCP server process still runs old code — will take effect after server restart.

---

## Unit Tests

```
62 test files | 708 tests passed | 0 failures | 4.57s
```

---

## Version History

| | V4 | V9 | V11 | V12 | **V13** |
|---|---|---|---|---|---|
| Files | 121 | 130 | 130 | 134 | **134** |
| Symbols | 261 | 299 | 301 | 304 | **304** |
| Edges | 780 | 889 | 892 | 945 | **945** |
| Tests | 594 | 675 | 678 | 706 | **708** |
| MCP Tools | 13 | 14 | 14 | 14 | **14** |
| Open Bugs | — | — | 2 | 1 | **0** |
| Known Issues | 1 | 1 | 1 | 1 | **1** (hash masking) |
| Failures | 0 | 0 | 0 | 0 | **0** |

---

## Known Issues

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Git hash masking FP (`[REDACTED:AWS_SECRET]`) | Medium | Open (pre-existing) |
