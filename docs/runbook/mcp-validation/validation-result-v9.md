# Ctxo MCP Validation Result — V9

> **Date:** 2026-04-08
> **Commit:** `f2fd79d` (master) — Add co-change analysis and get\_pr\_impact MCP tool (14th tool)
> **Overall:** PASS (1 known issue)
> **Milestone:** 14 MCP tools live, co-change analysis operational, 3-tier blast radius with `likely` tier

***

## Ctxo vs Manual: Token & Call Cost Comparison

| Tool                        | Manual Tokens | Manual Calls | Ctxo Tokens | Ctxo Calls | Token Savings | Call Savings |
| --------------------------- | ------------: | -----------: | ----------: | ---------: | ------------: | -----------: |
| `get_logic_slice` (L3)      |         1,950 |            3 |         150 |          1 |           92% |          67% |
| `get_blast_radius`          |           800 |           11 |         600 |          1 |           25% |          91% |
| `get_architectural_overlay` |       25,000+ |         100+ |         500 |          1 |           98% |          99% |
| `get_why_context`           |           200 |            2 |         200 |          1 |            0% |          50% |
| `get_change_intelligence`   |         2,100 |            3 |          50 |          1 |           98% |          67% |
| `find_dead_code`            |        5,000+ |         210+ |       2,000 |          1 |           60% |        99.5% |
| **TOTAL**                   |   **35,050+** |     **329+** |   **3,500** |      **6** |       **90%** |      **98%** |

***

## NEW in V9

### 1. `get_pr_impact` — 14th MCP Tool (LIVE)

Now registered and callable. Combines changed symbols + blast radius + co-change into single PR risk assessment.

```
get_pr_impact({ since: "HEAD~1" })
→ { changedFiles, changedSymbols, totalImpact, riskLevel, files[], summary }
```

Parameters: `since` (git ref), `confidence` (confirmed/likely/potential filter), `maxFiles`.

Tested with HEAD~~1, HEAD~~5, and confidence=confirmed. All returned valid responses with `riskLevel: "low"` (no uncommitted changes in git).

### 2. 3-Tier Blast Radius with `likely` Tier

Blast radius response now includes **`likelyCount`** alongside confirmed/potential:

| Tier      | Count | Meaning                                         |
| --------- | ----- | ----------------------------------------------- |
| confirmed | 11    | `calls`, `extends`, `implements` edges          |
| likely    | 29    | `imports` + `uses` combined (co-change boosted) |
| potential | 3     | `imports`-only edges                            |

**V8 had:** confirmed=40, potential=3 (2-tier).
**V9 has:** confirmed=11, likely=29, potential=3 (3-tier).

The split is more granular now — `uses` edges moved from confirmed to `likely` tier.

### 3. `edgeKinds` per Blast Radius Entry

Each impacted symbol now reports which edge kinds connect it:

```JSON
{ "edgeKinds": ["imports", "uses"], "confidence": "likely" }
{ "edgeKinds": ["calls"], "confidence": "confirmed" }
```

### 4. Co-Change Analysis: 192 Pairs

Index output: `[ctxo] Co-change analysis: 192 file pairs detected`
Stored in `.ctxo/index/co-changes.json` (version 1, 192 entries).

### 5. Overlay Now Shows New Files

New adapter files visible in Adapter layer:

* `csharp-adapter.ts`, `go-adapter.ts`, `tree-sitter-adapter.ts`, `get-pr-impact.ts`

New domain file in Domain layer:

* `co-change-analyzer.ts`

New test files:

* `csharp-adapter.test.ts`, `go-adapter.test.ts`, `co-change-analyzer.test.ts`, `get-pr-impact.test.ts`

***

## Index Metrics (Steps 1-3)

| Metric          | V9      | V8  | V7  | V4 (baseline) |
| --------------- | ------- | --- | --- | ------------- |
| Source files    | 130     | 130 | 126 | 121           |
| Index files     | 130     | 131 | 126 | 121           |
| Symbols         | 299     | 299 | 293 | 261           |
| Edges           | 889     | 889 | 843 | 780           |
| Intents         | **347** | 336 | 331 | 317           |
| Co-change pairs | **192** | 186 | —   | —             |
| imports         | 414     | 414 | 388 | 372           |
| calls           | 272     | 272 | 267 | 237           |
| uses            | 196     | 196 | 181 | 167           |
| implements      | 5       | 5   | 5   | 4             |
| extends         | 2       | 2   | 2   | 0             |
| typeOnly        | 172     | 172 | 158 | 146           |

`--max-history 5`: PASS

***

## Tool Validation (Steps 4-16) — All 14 Tools

| #      | Tool                        | Status   | Key V9 Observation                                                    |
| ------ | --------------------------- | -------- | --------------------------------------------------------------------- |
| 1      | `get_logic_slice`           | PASS     | L1(0) < L3(12), stable since V4                                       |
| 2      | `get_blast_radius`          | PASS     | **3-tier: confirmed=11, likely=29, potential=3**, edgeKinds per entry |
| 3      | `get_architectural_overlay` | PASS     | New files classified correctly (adapter/domain/test)                  |
| 4      | `get_why_context`           | PASS     | 6 commits, hash masking FP persists                                   |
| 5      | `get_change_intelligence`   | PASS     | complexity=0.444, churn=0.625, band=low                               |
| 6      | `find_dead_code`            | PASS     | 66 dead (23.4%), 76 incl. tests (25.4%)                               |
| 7      | `get_context_for_task`      | PASS     | CC=22 for IndexCommand.run                                            |
| 8      | `get_ranked_context`        | PASS     | masking→IMaskingPort(0.723), budget 500→492                           |
| 9      | `search_symbols`            | PASS     | **14 handlers** (+1), **35 interfaces** (+2)                          |
| 10     | `get_changed_symbols`       | PASS     | 0 (uncommitted)                                                       |
| 11     | `find_importers`            | PASS     | direct=20, **transitive=43** (+1)                                     |
| 12     | `get_class_hierarchy`       | PASS     | 11 classes, 7 edges                                                   |
| 13     | `get_symbol_importance`     | PASS     | CoChangeEntry/Matrix in interface rankings                            |
| **14** | **`get_pr_impact`**         | **PASS** | **NEW — riskLevel, summary, confidence filter**                       |

### `get_pr_impact` Detail

| Call     | since   | confidence | changedFiles | riskLevel |
| -------- | ------- | ---------- | ------------ | --------- |
| Default  | HEAD\~1 | all        | 50           | low       |
| Extended | HEAD\~5 | all        | 50           | low       |
| Filtered | HEAD\~1 | confirmed  | 50           | low       |

Response structure validated:

* [x] `since`, `changedFiles`, `changedSymbols`, `totalImpact`, `riskLevel`
* [x] `files[]` array (empty — all uncommitted)
* [x] `summary.confirmedTotal`, `likelyTotal`, `potentialTotal`, `highRiskSymbols[]`
* [x] `confidence` filter parameter works (no error)
* [x] `maxFiles` parameter accepted

***

## Infrastructure (Steps 17-19)

| Check       | Status   | Detail                                          |
| ----------- | -------- | ----------------------------------------------- |
| Edge kinds  | PASS     | imports=414, calls=272, uses=196, impl=5, ext=2 |
| Cross-file  | PASS     | type=80, class=155, iface=87, fn=82             |
| Intra-class | PASS     | 194                                             |
| Tests       | **PASS** | **60 files, 675 tests, 0 failures, 5.74s**      |

***

## Version History (V4 → V9)

|                 | V4     | V5     | V6     | V7     | V8     | **V9**  |
| --------------- | ------ | ------ | ------ | ------ | ------ | ------- |
| Files           | 121    | 126    | 126    | 126    | 131    | **130** |
| Symbols         | 261    | 291    | 293    | 293    | 299    | **299** |
| Edges           | 780    | 848    | 842    | 843    | 889    | **889** |
| Tests           | 594    | 646    | 646    | 654    | 675    | **675** |
| Test files      | 56     | 58     | 58     | 58     | 60     | **60**  |
| **MCP Tools**   | **13** | **13** | **13** | **13** | **13** | **14**  |
| Co-change pairs | —      | —      | —      | —      | 186    | **192** |
| Blast tiers     | 2      | 2      | 2      | 2      | 2      | **3**   |
| Failures        | 0      | 0      | 0      | 0      | 0      | **0**   |

***

## Known Issues

1. **Git hash masking false positive** — `get_why_context` redacts hashes as `[REDACTED:AWS_SECRET]`. Pre-existing (Bug #3).

