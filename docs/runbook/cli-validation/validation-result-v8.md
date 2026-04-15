# CLI Validation Result - v8

> **Date:** 2026-04-16
> **Ctxo Version:** v0.7.2 (HEAD of `feat/architectural-intelligence`, commit 190f929)
> **Platform:** Windows 11 Pro 10.0.26200 / Git Bash (MINGW)
> **Node.js:** v24.3.0
> **Result:** **59/59 PASS, 0 FAIL, 3 NUANCE**

---

## Environment

- Driven via `pnpm --filter @ctxo/cli exec tsx src/index.ts ...` from workspace root.
- Workspace-root `.ctxo/` is clean at start (no stash required).
- Index covers **284 files** (256 TS/JS, 22 Go, 6 C#) - two more than v7, matching the current HEAD.

---

## Step 1: Help & Unknown Command - PASS
- [x] 1.1 Help prints on stderr with full command list.
- [x] 1.2 `Unknown command: "nonsense"`, exit 1.

## Step 2: ctxo index - PASS

### 2.1 Full build - PASS
- [x] `Index complete: 284 files indexed`
- [x] `Co-change analysis: 324 file pairs detected`
- [x] `Community detection: 399 clusters (modularity 0.727)` (>= 0.3)
- [x] `.ctxo/index/communities.json` created
- [x] Build time **3.8s**

### 2.2 --check fresh - PASS
- [x] `Index is up to date`, exit 0

### 2.3 --skip-history - PASS
- [x] 256 TS + 22 Go + 6 C# = 284 files, 3.4s
- [x] Files with non-empty intent: 0

### 2.4 --max-history 3 - PASS
- [x] Max intent entries: 3

### 2.5 --file <path> - PASS (improvement confirmed)
- [x] Output: `Community detection (incremental, full-graph recompute): 399 clusters (modularity 0.727)`
- [x] `--file` mode now does a proper full-graph recompute instead of running over a 1-file subgraph or just warning. This is a strict improvement over the v7 WARN-only behavior.

### 2.6 --skip-community - PASS
- [x] Clean run: `Index complete: 284 files indexed`, no `Community detection:` line, no `communities.json`.

### 2.7 Snapshot history rotation - PASS (with nuance)
- [x] Second `ctxo index` run creates `.ctxo/index/communities.history/2026-04-15T22-47-28-128Z-190f929.json`.
- NUANCE: First post-wipe index run still does NOT create a history entry - rotation only kicks in from run 2 onward. Runbook Step 2.1 assertion about history-on-first-run should move to Step 2.7.

### 2.8 --max-history invalid - PASS
- [x] `abc`, `0`, missing arg: all print `[ctxo] --max-history requires a positive integer`, exit 1.

## Step 3: ctxo sync - PASS
- [x] Recreates `symbols.db` from JSON index; re-sync idempotent.

## Step 4: ctxo status - PASS
- [x] Schema 1.0.0, **284 files, 816 symbols, 1959 edges**, SQLite cache: present.
- [x] 4.1 Without index: `No index found. Run "ctxo index" first.`

## Step 5: ctxo verify-index - PASS

### 5.1 Fresh - PASS
- [x] `Index is up to date`

### 5.2 Stale (symbol appended) - PASS
- [x] `STALE: packages/cli/src/core/types.ts`, exit 1 (pnpm wrapper surfaces `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`).

### 5.3 mtime-only via `index --check` - PASS
- [x] After pure `touch`, `index --check` returns `Index is up to date` (exit 0). Clean run - no fragility observed this time.

## Step 6: ctxo init - PASS (dry-run)
- [x] `--dry-run` lists: `.ctxo/index/`, CLAUDE.md (append), `.cursor/rules/ctxo.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, AGENTS.md, augment-guidelines.md, `.amazonq/rules/ctxo.md`, `.git/hooks/post-commit`, `.git/hooks/post-merge`.

## Step 7: ctxo watch - PASS
- [x] `Watching for file changes... (Ctrl+C to stop)`, clean shutdown on kill.

## Step 8: ctxo stats - PASS

Seeded 50 session events via sql.js.

- [x] 8.1 Default: 50 calls, 22.3K tokens, 5 tools x 10 calls (avg 425-465 tokens).
- [x] 8.2 --json schema: calls=50, topTools=5, topSymbols=3, detailLevelDistribution=4, daysFilter=null.
- [x] 8.3 --days 7: `Usage Summary (last 7 days)`.
- [x] 8.4 --days 0 / -5: `[ctxo] --days must be a positive integer`, exit 1.
- [x] 8.5 --clear -> `Session data cleared.`; subsequent call -> `No usage data yet.`
- [x] 8.6 Missing DB -> `No usage data yet.`; `--json` returns `{totalCalls: 0, ...}`.
- [x] 8.7 `stats.enabled: false` -> `Stats collection is disabled in .ctxo/config.yaml`.
- [x] 8.8 Restore via sync.

## Step 9: ctxo doctor - PASS
- [x] 9.1 Default: 17 checks, **15 passed, 2 warnings, 0 failures**, exit 0.
- [x] 9.2 --json: `checks: 17, pass: 15, warn: 2, fail: 0, exitCode: 0, sum-eq: true`.
- [x] 9.3 --quiet: only the 2 warn lines + summary shown; `✓` lines suppressed.
- NUANCE: `[ctxo:doctor]` namespace logger stream still prints under `--quiet` (reporter is filtered, logger is not).

## Step 10: Cross-command integration - PASS
- [x] 10.1 Index -> `--check` (exit 0) -> status 284 files.
- [x] 10.2 Remove `.ctxo/.cache`, `sync`, `status` -> `SQLite cache: present`.

## Step 11: Unit tests - PASS

```
pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/
  Test Files  16 passed (16)
  Tests       138 passed (138)

pnpm --filter @ctxo/cli exec vitest run src/adapters/stats/__tests__/
  Test Files  2 passed (2)
  Tests       32 passed (32)
```

---

## Summary Checklist

| # | Command | Tested | Pass |
|---|---------|--------|------|
| 1 | `ctxo --help` | Help, unknown cmd | [x] |
| 2 | `ctxo index` | Full, --check, --skip-history, --max-history, --file, --skip-community, invalid | [x] |
| 3 | `ctxo sync` | Fresh, re-sync | [x] |
| 4 | `ctxo status` | Normal, without index | [x] |
| 5 | `ctxo verify-index` | Fresh, stale symbol, mtime-only | [x] |
| 6 | `ctxo init` | --dry-run | [x] |
| 7 | `ctxo watch` | Startup, clean exit | [x] |
| 8 | `ctxo stats` | Default, --json, --days, --clear, empty, disabled | [x] |
| 9 | `ctxo doctor` | Default, --json, --quiet, exit codes | [x] |
| 10 | Cross-command | Index->Status->Verify, Index->Sync->Status | [x] |
| 11 | Unit tests | CLI + stats adapter | [x] |

## Key Metrics

| Metric | Value |
|--------|-------|
| Indexed files | 284 |
| Total symbols | 816 |
| Total edges | 1959 |
| Full build time | 3.8s |
| --skip-history time | 3.4s |
| Co-change pairs | 324 |
| Communities detected | 399 (modularity 0.727) |
| CLI tests passed | 138 |
| Stats tests passed | 32 |

## Failures Summary

None.

## Nuances

1. **2.5 improvement confirmed.** `--file` now runs a full-graph recompute (`Community detection (incremental, full-graph recompute)`) instead of warning or running over a 1-file subgraph. Compared to v7 this is a strict behavior upgrade. Runbook Step 2.5 expected-output text is stale.
2. **2.7** First post-wipe `ctxo index` writes `communities.json` but no `communities.history/` entry; rotation only kicks in from run 2 onward. Update runbook Step 2.1.
3. **9.3** `--quiet` does not suppress the `[ctxo:doctor]` namespace debug logger stream. Minor.

## Deltas vs v7

| Metric | v7 | v8 |
|--------|----|----|
| Indexed files | 282 | 284 |
| Symbols | 814 | 816 |
| Edges | 1948 | 1959 |
| Co-change pairs | 52 (partial) | 324 |
| Communities | 399 (modularity 0.731) | 399 (modularity 0.727) |
| CLI tests | 138 | 138 |
| 2.5 behavior | WARN only | Full-graph recompute |
| 5.3 fragility | Observed | Not reproduced (clean run) |
