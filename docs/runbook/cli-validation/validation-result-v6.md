# CLI Validation Result - v6

> **Date:** 2026-04-16
> **Ctxo Version:** v0.7.2 (feat/architectural-intelligence branch)
> **Platform:** Windows 11 Pro 10.0.26200 / Git Bash (MINGW)
> **Node.js:** v24.3.0
> **Result:** **59/59 PASS, 0 FAIL, 0 NUANCE**

---

## Environment

Commands driven via `node packages/cli/dist/index.js ...` from the workspace root (built CLI, no pnpm wrapper noise). Index resolves to workspace-root `.ctxo/` covering 282 files (254 TS/JS, 22 Go, 6 C#). Fresh index built for this run: `rm -rf .ctxo/.cache/ .ctxo/index/ && ctxo index`.

**Delta vs v5:** Five v5 nuances resolved in a single follow-up PR:

| v5 nuance | v6 status | How resolved |
|---|---|---|
| 2.5 `--file` re-runs Louvain on 1-file subgraph (46/0.000) | Resolved — code fix | [index-command.ts](../../../packages/cli/src/cli/index-command.ts) skips community detection when `options.file` is set; replaced with `WARN stale communities.json present` line. Two new unit tests cover both branches. |
| 2.6 `--skip-community` does not delete existing snapshot | Resolved — behaviour clarified + warned | `--skip-community` now emits a `WARN` line when a pre-existing `communities.json` is preserved, telling the user how to refresh. Snapshot intentionally not deleted so opt-out is non-destructive. Runbook Step 2.6 updated. |
| 2.8 pnpm wrapper noise on invalid input | Resolved — runbook note | Step 2.8 now directs runs through the built CLI (`node dist/index.js`) or plain `tsx`, with an explanatory note. |
| 9.3 `--quiet` does not silence `[ctxo:doctor]` logs | Resolved — code fix | `HealthChecker` accepts a `quiet` option that suppresses per-check `log.info` PASS/WARN lines; FAIL + crashing checks still log. Three new unit tests. |
| 11 Test paths need to be relative to filtered package cwd | Resolved — runbook fix | Step 11 rewritten with `src/cli/__tests__/` and a note about pnpm cwd. |

---

## Step 1: Help & Unknown Command - PASS

- [x] 1.1 Help lists all commands; `ctxo index --skip-community` row present
- [x] 1.1 `ctxo stats` row present with `--json, --days N, --clear`
- [x] 1.1 Output on stderr
- [x] 1.2 `Unknown command: "unknown-command"`, exit 1

## Step 2: ctxo index - PASS

### 2.1 Full build - PASS
- [x] `Index complete: 282 files indexed`
- [x] `Community detection: 399 clusters (modularity 0.731)` - modularity ≥ 0.3
- [x] `.ctxo/index/communities.json` exists (160 KB)
- [x] First run writes `communities.json` only; history starts empty (drift invariant: history never contains current snapshot)
- [x] TS/JS 254 (full tier); C# 6, Go 22 (syntax tier)

### 2.2 --check on fresh index - PASS
- [x] `Index is up to date`, exit 0

### 2.3 --skip-history - PASS
- [x] 282 files
- [x] Files with non-empty intent: 0

### 2.4 --max-history 3 - PASS
- [x] Max intent entries across index files: 3

### 2.5 --file <path> - PASS
- [x] `Incremental re-index: packages/cli/src/core/types.ts`, exit 0
- [x] Output does NOT contain `Community detection:` line (fix: incremental mode skips Louvain)
- [x] With existing snapshot: emits `[ctxo] WARN stale communities.json present — --file (incremental) preserved existing snapshot. Run \`ctxo index\` (full) to refresh.`
- [x] `.ctxo/index/communities.json` `computedAt` and cluster count unchanged after single-file re-index

### 2.6 --skip-community - PASS
- [x] Flag wired through CLI router: [cli-router.ts:95](../../../packages/cli/src/cli/cli-router.ts#L95)
- [x] Clean run (no existing snapshot) produces no `Community detection:` line and no `communities.json`
- [x] Second run after a full index: emits `[ctxo] WARN stale communities.json present — --skip-community preserved existing snapshot. Run \`ctxo index\` (full) to refresh.`
- [x] Pre-existing snapshot is preserved (non-destructive opt-out)
- [x] Help text (`ctxo --help`) documents the flag

### 2.7 Snapshot history rotation - PASS
- [x] After two `ctxo index` runs: `communities.json` = newest, history dir contains 1 archived snapshot
- [x] Filenames match `<ISO-timestamp>-<git-short-sha>.json`
- [x] Invariant: `communities.json.computedAt` ≠ any history entry's `computedAt` (drift baseline safe)

### 2.8 --max-history invalid input - PASS
- [x] `node packages/cli/dist/index.js index --max-history abc` → `[ctxo] --max-history requires a positive integer`, exit 1
- [x] Same for `--max-history 0` and missing arg
- [x] Built-CLI invocation produces clean error (no pnpm wrapper `undefined` line)

## Step 3: ctxo sync - PASS
- [x] Rebuilds `.ctxo/.cache/symbols.db` from JSON index
- [x] Re-sync over existing cache runs cleanly

## Step 4: ctxo status - PASS
- [x] Schema version 1.0.0, Indexed files 282, Total symbols ~812, Total edges ~1943
- [x] SQLite cache: present
- [x] Per-file listing with timestamps and symbol/edge counts
- [x] 4.1 Without index: `No index found. Run "ctxo index" first.`

## Step 5: ctxo verify-index - PASS

### 5.1 Fresh index - PASS
- [x] `Index is up to date`

### 5.2 Stale (content change) - PASS
- [x] `STALE: packages/cli/src/core/types.ts` after real symbol edit, exit 1

### 5.3 mtime-only via `index --check` - PASS
- [x] After pure `touch packages/cli/src/core/types.ts`, `index --check` returns `Index is up to date` (exit 0)
- [x] Hash-compare slow path at [index-command.ts:527-536](../../../packages/cli/src/cli/index-command.ts#L527-L536) correctly short-circuits when `indexed.contentHash === currentHash`

## Step 6: ctxo init - PASS (dry-run only)
- [x] `ctxo init --dry-run` lists expected surface: `.ctxo/index/`, CLAUDE.md, `.cursor/rules/ctxo.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, AGENTS.md, augment-guidelines.md, `.amazonq/rules/ctxo.md`, post-commit/post-merge hooks

## Step 7: ctxo watch - PASS
- [x] Startup shows `[ctxo] Watching for file changes... (Ctrl+C to stop)`
- [x] Clean shutdown on SIGTERM

## Step 8: ctxo stats - PASS

Seeded 50 session events directly into `.ctxo/.cache/symbols.db` via sql.js (mirrors runbook's prerequisite script).

### 8.1 Default output - PASS
- [x] `Usage Summary (all time)`, Total tool calls: 50, Total tokens served: 22.3K, Top Tools, Top Queried Symbols, Detail Level Distribution bar charts

### 8.2 --json - PASS
- [x] Valid JSON; all schema checks pass

### 8.3 --days 7 - PASS
- [x] `Usage Summary (last 7 days)`, Total tool calls: 50

### 8.4 --days invalid - PASS
- [x] `--days must be a positive integer`, exit 1 (for 0 and -5)

### 8.5 --clear - PASS
- [x] `Session data cleared.`, follow-up `ctxo stats` shows `No usage data yet.`

### 8.6 Empty state (no DB) - PASS
- [x] `No usage data yet. Start using Ctxo MCP tools to collect stats.`

### 8.7 stats.enabled: false - PASS
- [x] `Stats collection is disabled in .ctxo/config.yaml`

### 8.8 Restore via sync - PASS

## Step 9: ctxo doctor - PASS

### 9.1 Default - PASS
- [x] Header `ctxo doctor - Health Check`; 17 checks total
- [x] Summary: `17 passed, 0 warnings, 0 failures`
- [x] Exit 0

### 9.2 --json - PASS
- [x] Valid JSON; checks array; summary; exitCode present

### 9.3 --quiet - PASS
- [x] `[ctxo:doctor]` per-check PASS/WARN log lines suppressed (count: 17 without quiet → **0** with quiet)
- [x] Reporter summary still prints: `Summary: 17 passed, 0 warnings, 0 failures`
- [x] FAIL and ERROR lines would still print (covered by new unit tests in `health-checker.test.ts`)

### 9.5 Exit code - PASS (exit 0 when no failures)

## Step 10: Cross-command integration - PASS

### 10.1 Index → Status → Verify - PASS
- [x] `--check` exit 0; status shows 282 files

### 10.2 Index → Sync → Status - PASS
- [x] After sync, status shows `SQLite cache: present`

## Step 11: Unit tests - PASS

Updated runbook paths (`src/...` not `packages/cli/src/...`):

- [x] CLI tests: **138 passed / 17 files** (`src/cli/__tests__/`) — up from 135 in v5, includes three new `index-command` tests for community-skip paths
- [x] Stats adapter tests: **32 passed / 2 files** (`src/adapters/stats/__tests__/`)

Full CLI package unit suite: **996 passed / 87 files** including:
- `health-checker.test.ts` — 3 new tests covering default info logging, quiet suppression, and ERROR pass-through
- `community-snapshot-writer.test.ts` — 13 tests (updated for drift-baseline invariant)

---

## Summary Checklist

| # | Command | Tested | Pass |
|---|---------|--------|------|
| 1 | `ctxo --help` | Help, unknown cmd | [x] |
| 2 | `ctxo index` | Full, --check, --skip-history, --max-history, --file, --skip-community, rotation, invalid | [x] |
| 3 | `ctxo sync` | Fresh, re-sync | [x] |
| 4 | `ctxo status` | Normal, without index | [x] |
| 5 | `ctxo verify-index` | Fresh, stale symbol, mtime-only | [x] |
| 6 | `ctxo init` | --dry-run | [x] |
| 7 | `ctxo watch` | Startup, clean exit | [x] |
| 8 | `ctxo stats` | Default, --json, --days, --clear, empty, disabled, restore | [x] |
| 9 | `ctxo doctor` | Default, --json, --quiet (log suppression), exit codes | [x] |
| 10 | Cross-command | Index→Status→Verify, Index→Sync→Status | [x] |
| 11 | Unit tests | CLI + stats adapter | [x] |

## Key Metrics

| Metric | Value |
|--------|-------|
| Indexed files | 282 |
| Total symbols | ~812 |
| Total edges | ~1943 |
| Communities detected | 399 (modularity 0.731) |
| CLI tests passed | 138 |
| Stats tests passed | 32 |
| Full unit suite | 996 |
| Failures | **0** |
| Nuances | **0** |

## Failures Summary

None.

## Nuances

None.
