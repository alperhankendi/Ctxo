# CLI Validation Result - v4

> **Date:** 2026-04-14
> **Ctxo Version:** v0.7.0-alpha.0
> **Platform:** Windows 11 Pro 10.0.26200 / Git Bash
> **Node.js:** v24.3.0
> **Result:** **56/59 PASS, 0 FAIL, 3 NUANCE**

---

## Environment Nuance (applies to all steps)

Commands driven via `pnpm --filter @ctxo/cli exec tsx src/index.ts ...`. Unlike v3, the index now resolves to the **workspace root `.ctxo/`** (not `packages/cli/.ctxo/`). Index build covered **267 files** across the full monorepo (239 TS/JS, 22 Go, 6 C#) = the expected workspace-wide scope.

Working tree has uncommitted files (`packages/cli/src/core/config/`, modified `plugin-loader.ts`, `config-check.ts`, etc.). This causes verify-index/index --check to flag staleness against the committed `.ctxo/index/` - documented as NUANCE below.

---

## Step 1: Help & Unknown Command - PASS

- [x] 1.1 Help lists all commands (index, sync, watch, verify-index, status, init, stats, doctor, visualize, install, --version, --help)
- [x] 1.1 `ctxo stats` row present with `--json, --days N, --clear`
- [x] 1.1 Output on stderr
- [x] 1.2 `Unknown command: "unknown-command"`, exit 1

## Step 2: ctxo index - PASS

### 2.1 Full build - PASS
- [x] `Index complete: 267 files indexed`
- [x] Build time ~4.2s (under 10s)
- [x] No errors on stderr
- [x] TS/JS: 239 full tier; Go: 22 syntax tier; C#: 6 syntax tier

### 2.2 --check on fresh index - PASS
- [x] Exit 0, `Index is up to date`

### 2.3 --skip-history - PASS
- [x] 267 files, ~3.3s (faster than full)
- [x] Files with non-empty intent: 0 / 267

### 2.4 --max-history 3 - PASS
- [x] 267 files indexed
- [x] Max intent entries across index files: 3

### 2.5 --file <path> - PASS
- [x] `Incremental re-index: packages/cli/src/core/types.ts`
- [x] `Index complete: 1 files indexed`

### 2.6 --max-history invalid - PASS
- [x] `abc`, `0`, missing arg all print `--max-history requires a positive integer`, exit 1

## Step 3: ctxo sync - PASS
- [x] Removed `.ctxo/.cache/`, sync recreated `symbols.db` (~1 MB)
- [x] Re-sync over existing cache runs cleanly

## Step 4: ctxo status - PASS
- [x] Schema version 1.0.0, Indexed files 267, Total symbols 766, Total edges 1797
- [x] SQLite cache: present
- [x] Per-file listing with timestamps and (symbols, edges) counts
- [x] 4.1 Without index: `No index found. Run "ctxo index" first.`

**Nuance:** First `status` invocation after renaming `.ctxo/index` emitted a transient tsx transform error referencing `plugin-loader.ts:98:36` (`"await" can only be used inside an "async" function`). Retry succeeded. Inspecting [plugin-loader.ts:95-100](packages/cli/src/cli/plugin-loader.ts#L95-L100) shows an IIFE arrow function that uses `await` without being marked `async`:

```ts
const shouldSkipSpecifier = ignoreProjectPatterns.length === 0
  ? undefined
  : (() => {
      const { makeGlobMatcher } = await import('...'); // ← await in non-async arrow
      return makeGlobMatcher(...);
    })();
```

This is a latent bug in uncommitted working-tree code; only fires when tsx re-transforms the file on certain cold paths. Fix: mark the IIFE `async`.

## Step 5: ctxo verify-index - PASS (with NUANCE)

### 5.1 Fresh index - PASS (after reindex)
- [x] After `ctxo index` run, `verify-index` exits 0 with `Index is up to date`
- Nuance: initial run flagged STALE for `plugin-loader.ts` and `config-check.ts` because of uncommitted local edits vs committed `.ctxo/index/`. Re-indexing into the workspace index makes it pass.

### 5.2 Stale index (symbol change) - PASS
- [x] Appending `export type VerifyTestDummy` triggered `STALE: packages/cli/src/core/types.ts`, exit 1
- Also flagged untracked test file `packages/cli/src/core/config/__tests__/load-config.test.ts` (expected)

### 5.3 Stale index (mtime-only via `index --check`) - NUANCE
- `--check` reports `NOT INDEXED` for untracked test files (e.g. `src/cli/__tests__/index-command-ignore.test.ts`) rather than exit 0
- Not a real failure: the untracked files legitimately aren't in the committed index yet. Runbook assumption (clean tree) doesn't hold in dev branch. mtime-only hash check on existing files still works correctly (no rebuild triggered for previously indexed file).

## Step 6: ctxo init - PASS
- [x] `init --dry-run` lists `.git/hooks/post-commit`, `.git/hooks/post-merge` among planned changes
- [x] Existing hooks already contain `ctxo` invocation (confirmed via grep)
- Interactive init not executed here to avoid mutating repo state; dry-run covers the hook-install plan.

## Step 7: ctxo watch - PASS
- [x] Startup banner: `Starting file watcher...` -> `Watching for file changes... (Ctrl+C to stop)`
- [x] Plugins loaded (csharp, go, typescript)
- [x] Exits cleanly on SIGTERM (exit 143 = SIGTERM via timeout)

## Step 8: ctxo stats - PASS

Seeded 50 session events into `.ctxo/.cache/symbols.db` (sql.js).

### 8.1 Default output - PASS
- [x] `Usage Summary (all time)`, `Total tool calls: 50`, `Total tokens served: 22.3K`
- [x] Top Tools (5), Top Queried Symbols (3), Detail Level Distribution with bar chart
- Top tool: get_blast_radius (10, avg 435 tokens). Top symbol: SymbolNode (13 queries).

### 8.2 --json - PASS
All 7 schema assertions PASS (timeRange, totalCalls>0, topTools array, topTools[0] has tool/calls/avgTokens, topSymbols array, detailLevelDistribution array, daysFilter null).

### 8.3 --days 7 - PASS
- [x] `Usage Summary (last 7 days)` with seeded data visible

### 8.4 --days invalid - PASS
- [x] `--days 0` and `--days -5` both print `--days must be a positive integer`, exit 1

### 8.5 --clear - PASS
- [x] `Session data cleared.`; subsequent `stats` shows `No usage data yet...`

### 8.6 Empty state (no DB) - PASS
- [x] Human output: `No usage data yet...`; --json: `totalCalls: 0`; no crash

### 8.7 stats.enabled: false - PASS
- [x] `Stats collection is disabled in .ctxo/config.yaml`

### 8.8 Restore via sync - PASS

## Step 9: ctxo doctor - PASS

### 9.1 Default output - PASS
- [x] Header present, 17 checks, Summary: `16 passed, 1 warnings, 0 failures`
- [x] Exit 0
- [x] `TypeScript plugin (@ctxo/lang-typescript) available`, `Go / C# plugins ... both plugins available`
- Single warning: index freshness (1 of 268 files stale) - expected given dirty working tree

### 9.2 --json - PASS
- [x] Valid JSON on stdout; 17 checks; pass(16) + warn(1) + fail(0) == length; exitCode: 0

### 9.3 --quiet - PASS
- [x] Only the ⚠ line and Summary shown; no `ctxo doctor - Health Check` header

### 9.4 Doctor on empty dir - PASS
- [x] 5 failures: `git_repo, index_directory, index_freshness, symbol_count, schema_version`
- [x] exitCode: 1
- Note: runbook's `pnpm --filter ... -C` invocation from outside repo doesn't work (pnpm workspace glob mismatch); substituted `node .../tsx/dist/cli.mjs src/index.ts doctor --json` which is equivalent.

### 9.5 Exit code - PASS

## Step 10: Cross-Command Integration - PASS
- [x] 10.1 After reindex, `--check` exits 0 and `status` shows matching count
- [x] 10.2 After `rm -rf .cache/ && sync`, `status` reports `SQLite cache: present`
- 10.3 Stats-via-MCP not exercised in this run (requires MCP validation session).

## Step 11: Unit Tests - PASS
- [x] `src/cli/__tests__/` - 134 tests, 16 files, all passed (4.75s)
- [x] `src/adapters/stats/__tests__/` - 32 tests, 2 files, all passed (446ms)

---

## Summary Checklist

| # | Command | Tested | Result |
|---|---------|--------|--------|
| 1 | `ctxo --help` | Help output, unknown command | PASS |
| 2 | `ctxo index` | Full, --check, --skip-history, --max-history, --file, invalid | PASS |
| 3 | `ctxo sync` | Fresh, re-sync | PASS |
| 4 | `ctxo status` | Normal, without index | PASS (+1 transient transform-error nuance) |
| 5 | `ctxo verify-index` | Fresh, stale, mtime | PASS (5.3 nuance vs dirty tree) |
| 6 | `ctxo init` | Hook plan via --dry-run | PASS |
| 7 | `ctxo watch` | Startup, clean exit | PASS |
| 8 | `ctxo stats` | Default, --json, --days, invalid, --clear, empty, disabled | PASS |
| 9 | `ctxo doctor` | Default, --json, --quiet, empty dir, exit codes | PASS |
| 10 | Cross-command | index -> status -> verify, index -> sync -> status | PASS |
| 11 | Unit tests | CLI (134) + stats adapter (32) | PASS |

**Total: 56 PASS / 0 FAIL / 3 NUANCE**

## Key Metrics

| Metric | Value |
|--------|-------|
| Indexed files | 267 (full workspace) / 269 (after retouch) |
| Total symbols | 766 |
| Total edges | 1797 |
| Index build time | ~4.2s |
| CLI tests passed | 134 / 134 |
| Stats tests passed | 32 / 32 |
| Doctor checks | 17 (16 pass, 1 warn) |

## Observations vs v3

1. **Index scope enlarged:** v3 indexed only `packages/cli/` (187 files); v4 indexes the whole monorepo (267 files). The CLI now resolves `.ctxo/` at the workspace/git root. Commit f93feac (noted in v3) is live.
2. **New nuance - plugin-loader.ts async bug:** Uncommitted code in [packages/cli/src/cli/plugin-loader.ts:95-100](packages/cli/src/cli/plugin-loader.ts#L95-L100) uses `await` inside a non-async IIFE arrow. Surfaces intermittently as a tsx transform error. Recommend marking the IIFE `async` before commit.
3. **Doctor check count grew 15 -> 17** (added index_freshness, versions).
