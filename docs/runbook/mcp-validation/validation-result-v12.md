# Ctxo MCP Validation Result — V12

> **Date:** 2026-04-08
> **Overall:** PASS (1 known issue, 1 open bug, 1 bug potentially fixed)

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

## NEW in V12

### 1. Response Envelope with `_meta` (NEW)

All MCP tool responses now include a `_meta` field:
```json
{
  "_meta": {
    "totalItems": 43,
    "returnedItems": 43,
    "truncated": false,
    "totalBytes": 7822
  }
}
```

New files:
- [response-envelope.ts](src/core/response-envelope.ts) — `wrapResponse()` function + `ResponseMeta` interface
- [response-envelope.test.ts](src/core/response-envelope/__tests__/response-envelope.test.ts) (inferred from +2 test files)

`wrapResponse` ranks **#2 in PageRank** (score=0.919) — called by every MCP handler.

### 2. Response Truncation (NEW)

`find_dead_code` now truncates large responses:
```json
{
  "unusedExports": [/* 1 entry shown */],
  "_meta": { "totalItems": 73, "returnedItems": 1, "truncated": true, "totalBytes": 30869, "hint": "Use find_importers to check specific symbols." }
}
```

### 3. Bug #7 Potentially Fixed

`get_pr_impact({ since: "HEAD~3" })` now returns `changedFiles: 0` (was 50 in V11). The fix appears to correctly filter to indexed files only.

### 4. Edge Growth: +53 Edges, +17 Cross-File Functions

| Metric | V11 | V12 | Delta |
|---|---|---|---|
| Files | 130 | **134** | +4 |
| Symbols | 301 | **304** | +3 |
| Edges | 892 | **945** | **+53** |
| Tests | 678 | **706** | **+28** |
| Test files | 60 | **62** | +2 |
| imports | 415 | **432** | +17 |
| calls | 274 | **295** | **+21** |
| uses | 196 | **211** | +15 |
| Cross-file fn | 83 | **100** | **+17** |
| Interfaces | 35 | **36** | +1 (ResponseMeta) |
| Handlers | 14 | 14 | — |

---

## Index Metrics

| Metric | Value |
|---|---|
| Files | 134 |
| Symbols | 304 |
| Edges | 945 |
| Intents | 343 |
| Byte offsets | 304 (100%) |
| Co-change pairs | 127 |
| typeOnly | 172 |
| Build time | 2.5s |

---

## Tool Validation — All 14 Tools PASS

| # | Tool | Status | Key V12 Observation |
|---|---|---|---|
| 1 | `get_logic_slice` | PASS | L1(0) < L3(12), `_meta` added |
| 2 | `get_blast_radius` | PASS | impact=43, 3-tier, `_meta` added |
| 3 | `get_architectural_overlay` | PASS | All layers correct |
| 4 | `get_why_context` | PASS | 6 commits, hash masking FP |
| 5 | `get_change_intelligence` | PASS | churn=0.556 (was 0.625) |
| 6 | `find_dead_code` | PASS | **truncation active**, 67 dead (23.3%) |
| 7 | `get_context_for_task` | PASS | `_meta` added |
| 8 | `get_ranked_context` | PASS | `wrapResponse` at #2 importance |
| 9 | `search_symbols` | PASS | 14 handlers, **36 interfaces** (+1) |
| 10 | `get_changed_symbols` | PASS | `_meta` added |
| 11 | `find_importers` | PASS | direct=20, transitive=43, `_meta` with truncation hint |
| 12 | `get_class_hierarchy` | PASS | 11 classes, 7 edges |
| 13 | `get_symbol_importance` | PASS | `_meta` added |
| 14 | `get_pr_impact` | PASS | **changedFiles=0 (Bug #7 fix candidate)** |

---

## Bug Status

| # | Issue | Severity | V11 | V12 |
|---|---|---|---|---|
| 1 | Git hash masking FP | Medium | Open | **Open** |
| 6 | `find_importers` double-count (alperhankendi/Ctxo#22) | Medium | Open | **Open** (direct=20 vs transitive maxDepth=1=11) |
| 7 | `get_pr_impact` changedFiles (alperhankendi/Ctxo#23) | Medium | Open | **Potentially Fixed** (now returns 0) |

---

## Unit Tests

```
62 test files | 706 tests passed | 0 failures | 4.51s
```

---

## Version History

| | V4 | V9 | V11 | **V12** |
|---|---|---|---|---|
| Build time | 4.7s | 4.5s | 2.6s | **2.5s** |
| Files | 121 | 130 | 130 | **134** |
| Symbols | 261 | 299 | 301 | **304** |
| Edges | 780 | 889 | 892 | **945** |
| Tests | 594 | 675 | 678 | **706** |
| MCP Tools | 13 | 14 | 14 | **14** |
| Failures | 0 | 0 | 0 | **0** |
