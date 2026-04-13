# Ctxo MCP Validation Result — V7

> **Date:** 2026-04-08
> **Commit:** `5dc06da` + uncommitted tree-sitter/Go/C# feature (master)
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

## Index Build (Steps 1-3)

| Metric | V7 | V6 | V4 (baseline) |
|---|---|---|---|
| Files indexed | 126 | 126 | 121 |
| Build time | 4.4s | 4.5s | 4.7s |
| Symbols | 293 | 293 | 261 |
| Edges | 843 | 842 | 780 |
| Intents | 331 | 322 | 317 |
| AntiPatterns | 4 | 4 | 4 |
| Byte offsets | 293 (100%) | 293 (100%) | 261 (100%) |
| typeOnly | 158 | 158 | 146 |
| imports | 388 | 388 | 372 |
| calls | 267 | 266 | 237 |
| uses | 181 | 181 | 167 |
| implements | 5 | 5 | 4 |
| extends | 2 | 2 | 0 |

`--max-history 5`: PASS

---

## Tool Validation Summary (Steps 4-16)

| Step | Tool | Status | Key Metric |
|---|---|---|---|
| 4 | `get_logic_slice` L1-L4 | PASS | L1(0) < L2(8) < L3(12) |
| 5 | `get_blast_radius` | PASS | impact=42, confirmed=39, potential=3 |
| 6 | `get_architectural_overlay` | PASS | 6 layers, no violations |
| 7 | `get_why_context` | PASS | 6/3/1 commits, hash masking FP |
| 8 | `get_change_intelligence` | PASS | complexity=0.444, churn=0.667, band=low |
| 9 | `find_dead_code` | PASS | 65 dead (23.6%), 75 incl. tests (25.6%) |
| 10 | `get_context_for_task` | PASS | understand/refactor scored correctly |
| 11 | `get_ranked_context` | PASS | masking→IMaskingPort(0.735), budget 500→492 |
| 12 | `search_symbols` | PASS | SymbolGraph=11, ^handle=13, interface=33 |
| 13 | `get_changed_symbols` | PASS | 0 (uncommitted) |
| 14 | `find_importers` | PASS | direct=20, transitive=42 |
| 15 | `get_class_hierarchy` | PASS | 11 classes, 7 edges |
| 16 | `get_symbol_importance` | PASS | converged iter=34, damping=0.85/0.5 |

---

## Infrastructure (Steps 17-19)

| Check | Status | Detail |
|---|---|---|
| Staleness detection | PASS | VerifyCommand test validates |
| Edge kinds | PASS | imports=388, calls=267, uses=181, impl=5, ext=2 |
| Cross-file resolution | PASS | type=77, class=151, iface=76, fn=74 |
| Intra-class calls | PASS | 194 |
| Unit tests | **PASS** | **58 files, 654 tests, 0 failures, 4.61s** |

---

## Version History

| | V4 | V5 | V6 | V7 |
|---|---|---|---|---|
| Symbols | 261 | 291 | 293 | 293 |
| Edges | 780 | 848 | 842 | 843 |
| Intents | 317 | 322 | 322 | **331** |
| Blast radius | 38 | 41 | 42 | 42 |
| Tests | 594 | 646 | 646 | **654** |
| extends | 0 | 2 | 2 | 2 |
| Failures | 0 | 0 | 0 | 0 |

---

## Known Issues

1. **Git hash masking false positive** — `get_why_context` redacts commit hashes as `[REDACTED:AWS_SECRET]`. Pre-existing (Bug #3).
