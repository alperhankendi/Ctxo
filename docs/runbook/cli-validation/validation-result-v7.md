# CLI Validation Result - v7

> **Date:** 2026-04-16
> **Ctxo Version:** v0.7.2 (HEAD of `feat/architectural-intelligence`)
> **Platform:** Windows 11 Pro 10.0.26200 / Git Bash (MINGW)
> **Node.js:** v24.3.0
> **Result:** **59/59 PASS, 0 FAIL, 4 NUANCE**

---

## Environment

- All commands driven via `pnpm --filter @ctxo/cli exec tsx src/index.ts ...` from the workspace root.
- Index resolves to workspace-root `.ctxo/` covering **282 files** (254 TS/JS, 22 Go, 6 C#).
- In-progress `.ctxo/` working-tree changes stashed for the run (`git stash push -u -- .ctxo/`).
- Source under test includes the uncommitted `--skip-community` and incremental `--file` community-detection work on `feat/architectural-intelligence` (visible in `git diff packages/cli/src/cli/index-command.ts`).

---

## Step 1: Help & Unknown Command - PASS
- [x] 1.1 Help shows all commands; output on stderr.
- [x] 1.2 `Unknown command: "foo"`, exit 1.

## Step 2: ctxo index - PASS

### 2.1 Full build - PASS
- [x] `Index complete: 282 files indexed`
- [x] `Community detection: 399 clusters (modularity 0.731)` (>=0.3)
- [x] `.ctxo/index/communities.json` created
- [x] Build time 3.8s
- [x] No stderr errors

### 2.2 --check fresh - PASS
- [x] `Index is up to date`, exit 0

### 2.3 --skip-history - PASS
- [x] 282 files, 3.9s; files with non-empty intent: 0/283

### 2.4 --max-history 3 - PASS
- [x] Max intent entries: 3

### 2.5 --file <path> - PASS
- [x] Incremental re-index of 1 file.
- [x] `--file` branch prints `WARN stale communities.json present — --file (incremental) preserved existing snapshot. Run \`ctxo index\` (full) to refresh.` instead of running community detection over a 1-file subgraph. No more `46 clusters (modularity 0.000)` noise.

### 2.6 --skip-community (clean) - PASS
- [x] Clean `rm -rf .ctxo/index/ && ctxo index --skip-community`: no `Community detection:` line, no `communities.json`.

### 2.7 Snapshot history rotation - PASS
- [x] Second `ctxo index` run produces `<ISO>-<sha>.json` in `communities.history/`.

### 2.8 --max-history invalid - PASS
- [x] `abc`, `0`, missing arg: all print `[ctxo] --max-history requires a positive integer`, exit 1.

## Step 3: ctxo sync - PASS
- [x] Rebuilds `.ctxo/.cache/symbols.db`, `Sync complete`.
- [x] Re-sync over existing cache runs cleanly.

## Step 4: ctxo status - PASS
- [x] Schema 1.0.0, Indexed files 282, Total symbols 814, Total edges 1948, SQLite cache: present.
- [x] 4.1 Without index: `No index found. Run "ctxo index" first.`

## Step 5: ctxo verify-index - PASS

### 5.1 Fresh - PASS
- [x] `Index is up to date`

### 5.2 Stale (symbol appended) - PASS
- [x] `STALE: packages/cli/src/core/types.ts`, exit 1.

### 5.3 mtime-only via `index --check` - PASS
- [x] After `touch packages/cli/src/core/types.ts`, `index --check` → `Index is up to date` (exit 0).

## Step 6: ctxo init - PASS (dry-run)
- [x] `--dry-run` lists: CLAUDE.md (append), `.cursor/rules/ctxo.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, AGENTS.md, augment-guidelines.md, `.amazonq/rules/ctxo.md`, `.git/hooks/post-commit`, `.git/hooks/post-merge`.

## Step 7: ctxo watch - PASS
- [x] `Watching for file changes... (Ctrl+C to stop)`, clean shutdown on kill.

## Step 8: ctxo stats - PASS

- [x] 8.1 Default: 50 calls, 22.3K tokens, 5 tools, 3 symbols, L1-L4 25% each.
- [x] 8.2 --json schema: calls=50, topTools=5, topSymbols=3, detailLevelDistribution=4.
- [x] 8.3 --days 7: `Usage Summary (last 7 days)`, 50 calls.
- [x] 8.4 --days 0 / -5: `--days must be a positive integer`, exit 1.
- [x] 8.5 --clear → `Session data cleared.`; next call → `No usage data yet.`
- [x] 8.6 Missing DB → `No usage data yet.`; `--json` returns `{totalCalls: 0, ...}`.
- [x] 8.7 `stats.enabled: false` → `Stats collection is disabled in .ctxo/config.yaml`.
- [x] 8.8 Restore via sync.

## Step 9: ctxo doctor - PASS
- [x] 9.1 Default: 17 checks, `15 passed, 2 warnings, 0 failures`, exit 0.
- [x] 9.2 --json: `checks: 17, pass: 15, warn: 2, fail: 0, exitCode: 0`.
- [x] 9.3 --quiet: only 2 warn lines + summary shown; `✓` lines suppressed.

## Step 10: Cross-command integration - PASS
- [x] 10.1 Index → `--check` (exit 0) → status 282 files.
- [x] 10.2 Remove `.ctxo/.cache`, `sync`, `status` → `SQLite cache: present`.

## Step 11: Unit tests - PASS

```
pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/
→ 16 files, 138 passed

pnpm --filter @ctxo/cli exec vitest run src/adapters/stats/__tests__/
→ 2 files, 32 passed
```

(CLI test count rose from 135 → 138 since v5; stats adapter still 32.)

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
| Indexed files | 282 |
| Total symbols | 814 |
| Total edges | 1948 |
| Full build time | 3.8s |
| --skip-history time | 3.9s |
| Communities detected | 399 (modularity 0.731) |
| CLI tests passed | 138 |
| Stats tests passed | 32 |

## Failures Summary

None.

## Nuances

1. **2.7** First post-wipe index run writes `communities.json` but no `communities.history/` entry — rotation only kicks in from run 2 onward. Runbook Step 2.1's history-file assertion should move to Step 2.7.
2. **5.3 fragility** `index --check` can spuriously flag STALE if incremental re-indexes / watch events interleave, because the written `contentHash` can diverge from what the verify path recomputes (observed once this run on `index-command.ts` and `types.ts` before a clean rebuild resolved it). Workaround: full `ctxo index`. Follow-up candidate.
3. **9.3** `--quiet` doesn't suppress the `[ctxo:doctor]` namespace logger stream. Minor.
4. **11** Runbook test-path filters must be relative to the filtered package's cwd (`src/cli/__tests__/`, not `packages/cli/src/cli/__tests__/`).
