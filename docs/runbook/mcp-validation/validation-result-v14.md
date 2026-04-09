# Ctxo MCP Validation Result — V14

> **Date:** 2026-04-08
> **Commit:** `c02da4f` (master)
> **Overall:** PASS (1 known issue, 0 open bugs)

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

## Bug #6 Fix Verified LIVE

| Mode | Before Fix | After Fix |
|---|---|---|
| `find_importers` direct | importerCount=**20** | importerCount=**11** |
| `find_importers` transitive maxDepth=1 | importerCount=**11** | importerCount=**11** |
| **Match** | NO | **YES** |

---

## Index & Tests

| Metric | Value |
|---|---|
| Files | 134 |
| Symbols | 304 |
| Edges | 945 |
| Tests | **708** (0 failures) |
| Build time | 2.7s |

## All 14 Tools PASS

| # | Tool | Key Result |
|---|---|---|
| 1 | `get_logic_slice` | L1(0) < L3(12), `_meta` present |
| 2 | `get_blast_radius` | impact=43, 3-tier (11/29/3) |
| 3 | `get_architectural_overlay` | 6 layers |
| 4 | `get_why_context` | 6 commits, hash masking FP |
| 5 | `get_change_intelligence` | band=low |
| 6 | `find_dead_code` | 67 dead (23.3%), truncation active |
| 7 | `get_context_for_task` | CC=23 |
| 8 | `get_ranked_context` | wrapResponse #2 importance |
| 9 | `search_symbols` | 14 handlers, 36 interfaces |
| 10 | `get_changed_symbols` | 0 (correct) |
| 11 | `find_importers` | **direct=11 = transitive=11** |
| 12 | `get_class_hierarchy` | 11 classes, 7 edges |
| 13 | `get_symbol_importance` | converged iter=34 |
| 14 | `get_pr_impact` | changedFiles=0 (correct) |

## Known Issues

| # | Issue | Status |
|---|---|---|
| 1 | Git hash masking FP | Open (pre-existing) |
| 6 | `find_importers` dedup (#22) | **CLOSED** |
| 7 | `get_pr_impact` changedFiles (#23) | **CLOSED** |
