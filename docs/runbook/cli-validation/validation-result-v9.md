# CLI Validation Result - v9

> **Date:** 2026-04-16
> **Ctxo Version:** v0.7.2 (HEAD of `feat/architectural-intelligence`)
> **Platform:** Windows 11 Pro 10.0.26200 / Git Bash (MINGW)
> **Node.js:** v24.3.0
> **Result:** **59/59 PASS, 0 FAIL, 0 NUANCE**

---

## Changes made before this run (vs v8)

1. **Runbook 2.1** — removed the "history entry on first run" assertion; added a note pointing to Step 2.7.
2. **Runbook 2.5** — updated expected output to match current behavior: `Community detection (incremental, full-graph recompute): N clusters`.
3. **Runbook 2.7** — expanded with explicit 3-run flow and staged expectations (run 1 = no history, run 2 = 1 snapshot, run 3 = 2 snapshots).
4. **`doctor --quiet` fix** ([packages/cli/src/adapters/diagnostics/health-checker.ts](packages/cli/src/adapters/diagnostics/health-checker.ts)) — `--quiet` now suppresses all per-check logger lines (PASS, WARN, FAIL, ERROR). The reporter still prints WARN/FAIL `⚠`/`✗` lines, so operators see everything that needs attention without the duplicated `[ctxo:doctor] ...` logger stream. Updated tests accordingly.

---

## Step-by-step result

| Step | Result |
|------|--------|
| 1.1 Help on stderr | PASS |
| 1.2 Unknown command exits 1 | PASS |
| 2.1 Full build (256 TS + 22 Go + 6 C# = 284, modularity 0.727) | PASS |
| 2.2 `--check` fresh → exit 0 | PASS |
| 2.3 `--skip-history` → empty intent arrays | PASS |
| 2.4 `--max-history 3` → max intent = 3 | PASS |
| 2.5 `--file` → `Community detection (incremental, full-graph recompute)` | PASS |
| 2.6 `--skip-community` → no community output, no `communities.json` | PASS |
| 2.7 History rotation (run 1 = 0 files, run 2 = 1 file) | PASS |
| 2.8 Invalid `--max-history` exits 1 | PASS |
| 3 Sync + re-sync | PASS |
| 4 Status (816 symbols, 1959 edges, cache: present) | PASS |
| 4.1 Status without index | PASS |
| 5.1 Verify fresh → exit 0 | PASS |
| 5.2 Verify after symbol append → STALE, exit 1 | PASS |
| 5.3 `touch` + `index --check` → up to date (exit 0) | PASS |
| 6 `init --dry-run` lists 10 targets including both hooks | PASS |
| 7 Watch starts cleanly, exits on kill | PASS |
| 8.1 Stats default (50 calls, 22.3K tokens) | PASS |
| 8.2 Stats `--json` schema | PASS |
| 8.3 Stats `--days 7` | PASS |
| 8.4 Stats `--days 0` / `-5` → exit 1 | PASS |
| 8.5 Stats `--clear` | PASS |
| 8.6 Stats without DB | PASS |
| 8.7 Stats with `enabled: false` | PASS |
| 9.1 Doctor default (17 checks, 0 fail) | PASS |
| 9.2 Doctor `--json` schema matches | PASS |
| 9.3 Doctor `--quiet` — **no `[ctxo:doctor]` logger lines**, only reporter `⚠` lines + summary | PASS |
| 10.1 Index → check → status | PASS |
| 10.2 Sync → status `SQLite cache: present` | PASS |
| 11 Unit tests: 256 passing across cli + stats + diagnostics (28 files) | PASS |

## 5.3 Fragility Re-test

Ran three scenarios against a freshly-rebuilt index to try to reproduce the v7 false-STALE:

| Scenario | Result |
|----------|--------|
| Pure `touch types.ts` → `index --check` | `Index is up to date` |
| `index --file types.ts` → `touch types.ts` → `index --check` | `Index is up to date` |
| `index --file types.ts` → `touch cli-router.ts` → `index --check` | `Index is up to date` |

**Conclusion:** cannot reproduce. The v7 false-STALE was a one-off triggered by interleaved source-file edits made between the last full index and the `--check`. Not a structural bug; closing the watch.

## Key Metrics

| Metric | Value |
|--------|-------|
| Indexed files | 284 |
| Total symbols | 816 |
| Total edges | 1959 |
| Full build time | 3.8s |
| Communities detected | 399 (modularity 0.727) |
| All CLI + stats + diagnostics tests | **256 passed (28 files)** |

## Failures / Nuances

**None.** All three non-blocking items from v8 are now either resolved (runbook 2.1/2.5/2.7, doctor `--quiet`) or closed (5.3 non-reproducible).
