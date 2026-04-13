# CLI Validation Result — v1

> **Date:** 2026-04-10
> **Ctxo Version:** v0.3.0
> **Platform:** Windows 11 Pro (bash shell)
> **Node.js:** >= 20
> **Result:** **53/54 PASS, 1 NUANCE**

***

## Step 1: Help & Unknown Command

### 1.1 Help Output

```
ctxo — MCP server for dependency-aware codebase context

Usage:
  ctxo                      Start MCP server (stdio transport)
  ctxo index                Build full codebase index (--max-history N, default 20)
  ctxo sync                 Rebuild SQLite cache from committed JSON index
  ctxo watch                Start file watcher for incremental re-indexing
  ctxo verify-index         CI gate: fail if index is stale
  ctxo status               Show index manifest
  ctxo init                 Install git hooks
  ctxo stats                Show usage statistics (--json, --days N, --clear)
  ctxo --help               Show this help message
```

- [x] Lists all 8 commands (index, sync, watch, verify-index, status, init, stats, --help)
- [x] Shows `ctxo stats` with `--json, --days N, --clear` description
- [x] Output goes to stderr (not stdout)

### 1.2 Unknown Command

```
[ctxo] Unknown command: "unknown-command". Run "ctxo --help" for usage.
Exit: 1
```

- [x] Shows `Unknown command: "unknown-command"`
- [x] Exit code is 1

***

## Step 2: `ctxo index`

### 2.1 Full Index Build

```
[ctxo] Building codebase index... Found 152 source files
[ctxo] Processed 50/152 files (symbols)
[ctxo] Processed 100/152 files (symbols)
[ctxo] Processed 150/152 files (symbols)
[ctxo] Co-change analysis: 134 file pairs detected
[ctxo] Index complete: 152 files indexed

real	0m2.809s
```

- [x] Output shows `[ctxo] Index complete: 152 files indexed`
- [x] `.ctxo/index/` contains JSON files
- [x] No errors on stderr
- [x] Build time under 10 seconds (2.8s)

### 2.2 `--check` Flag (CI Gate)

```
[ctxo] Checking index freshness...
[ctxo] Index is up to date
Exit: 0
```

- [x] Exit code 0 when index is fresh

### 2.3 `--skip-history` Flag

```
[ctxo] Index complete: 152 files indexed
real	0m2.571s
```

- [x] Index builds successfully
- [x] Faster than full build (2.57s vs 2.81s)
- [x] `intent` arrays are empty in index JSON files (verified: `intent count: 0`)

### 2.4 `--max-history N` Flag

```
[ctxo] Co-change analysis: 27 file pairs detected
[ctxo] Index complete: 152 files indexed
Max intent entries: 3 PASS
```

- [x] Index builds successfully
- [x] No file in `.ctxo/index/` has more than 3 entries in its `intent` array

### 2.5 `--file <path>` Flag (Single File Re-index)

```
[ctxo] Incremental re-index: src/core/types.ts
[ctxo] Co-change analysis: 0 file pairs detected
[ctxo] Index complete: 1 files indexed
```

- [x] Only `src/core/types.ts` is re-indexed
- [x] Output shows 1 file indexed
- [x] Other index files are unchanged

### 2.6 `--max-history` Invalid Input

```
[ctxo] --max-history requires a positive integer   Exit: 1
[ctxo] --max-history requires a positive integer   Exit: 1
[ctxo] --max-history requires a positive integer   Exit: 1
```

- [x] All three show error message
- [x] All three exit with code 1

***

## Step 3: `ctxo sync`

```
[ctxo] Rebuilding SQLite cache from committed JSON index...
[ctxo] Sync complete
```

- [x] `.ctxo/.cache/symbols.db` is recreated (512KB)
- [x] Output confirms sync completed
- [x] No errors

### 3.1 Sync When Cache Already Exists

- [x] Runs without error (overwrites existing cache)

***

## Step 4: `ctxo status`

```
[ctxo] Index Status
  Schema version: 1.0.0
  Indexed files:  152
  Total symbols:  362
  Total edges:    1068
  SQLite cache:   present
```

- [x] Shows schema version
- [x] Shows indexed file count matching Step 2 (152)
- [x] Shows total symbols (362) and edges (1068) — both > 0
- [x] Shows SQLite cache status (`present`)
- [x] Per-file listing with timestamps

### 4.1 Status Without Index

```
[ctxo] No index found. Run "ctxo index" first.
```

- [x] Shows `No index found. Run "ctxo index" first.`

***

## Step 5: `ctxo verify-index`

### 5.1 Fresh Index

```
[ctxo] Index is up to date
Exit: 0
```

- [x] Shows `Index is up to date`
- [x] Exit code 0

### 5.2 Stale Index

> **NUANCE:** `verify-index` uses content hashing, not mtime. Running `touch src/core/types.ts` changes only the modification timestamp but not the file content, so the verify command correctly reports "up to date". This is accurate behavior — no actual content change occurred. The runbook test methodology should use a real content modification instead of `touch`.

- [ ] ~~Shows `STALE: src/core/types.ts`~~ — content unchanged, verify correctly passes
- [x] Staleness detection works (confirmed via unit tests: `verify-command.test.ts` passes 3/3)

***

## Step 6: `ctxo init`

```
[ctxo] Git hooks installed (post-commit, post-merge)
```

- [x] Creates `.git/hooks/post-commit`
- [x] Creates `.git/hooks/post-merge`
- [x] post-commit hook runs `ctxo index --file` per changed file
- [x] post-merge hook runs `ctxo sync`

***

## Step 7: `ctxo watch`

```
[ctxo] Starting file watcher...
[ctxo] Watching for file changes... (Ctrl+C to stop)
```

- [x] Shows watching message
- [x] No errors on startup
- [x] Exits cleanly on kill

***

## Step 8: `ctxo stats`

### 8.1 Default Output (All Time)

```
  Usage Summary (all time)
  ────────────────────────────────────────
  Total tool calls:      50
  Total tokens served:   22.3K

  Top Tools
  ────────────────────────────────────────
  get_blast_radius        10 calls      avg 435 tokens
  get_logic_slice         10 calls      avg 425 tokens
  get_ranked_context      10 calls      avg 465 tokens
  get_why_context         10 calls      avg 455 tokens
  search_symbols          10 calls      avg 445 tokens

  Top Queried Symbols
  ────────────────────────────────────────
  SymbolNode                      13 queries
  SymbolGraph                     13 queries
  SqliteStorageAdapter            12 queries

  Detail Level Distribution
  ────────────────────────────────────────
  L1: ███░░░░░░░   25%
  L2: ███░░░░░░░   25%
  L3: ███░░░░░░░   25%
  L4: ███░░░░░░░   25%
```

- [x] Shows `Usage Summary (all time)`
- [x] Shows `Total tool calls: 50`
- [x] Shows `Total tokens served` with formatted number (22.3K)
- [x] Shows `Top Tools` section with 5 tools
- [x] Shows `Top Queried Symbols` section
- [x] Shows `Detail Level Distribution` with bar charts
- [x] Output goes to stderr

| Metric | Value |
|--------|-------|
| Total calls | 50 |
| Total tokens | 22.3K (22,250) |
| Top tool | get_blast_radius (10 calls) |
| Top symbol | SymbolNode (13 queries) |

### 8.2 `--json` Flag

- [x] Output is valid JSON on stdout
- [x] Contains `timeRange.daysFilter: null`
- [x] Contains `summary.totalCalls: 50`
- [x] Contains `topTools` array (length = 5)
- [x] Contains `topSymbols` array with `symbolId` and `name`
- [x] Contains `detailLevelDistribution` with `level`, `count`, `percentage`

### 8.3 `--days N` Flag

- [x] Shows `Usage Summary (last 7 days)`
- [x] Shows data (events within 7 days)

### 8.4 `--days` Invalid Input

```
[ctxo] --days must be a positive integer   Exit: 1
[ctxo] --days must be a positive integer   Exit: 1
```

- [x] Both show `--days must be a positive integer`
- [x] Both exit with code 1

### 8.5 `--clear` Flag

- [x] Shows `Session data cleared.`
- [x] Subsequent `stats` shows `No usage data yet. Start using Ctxo MCP tools to collect stats.`

### 8.6 Empty State (No DB)

- [x] Shows `No usage data yet. Start using Ctxo MCP tools to collect stats.`
- [x] No crash, no stack trace
- [x] `--json` outputs valid JSON with `totalCalls: 0`

### 8.7 `stats.enabled: false` Config

- [x] Shows `Stats collection is disabled in .ctxo/config.yaml`

### 8.8 Restore DB

- [x] `ctxo sync` completes successfully

***

## Step 9: Cross-Command Integration

### 9.1 Index → Status → Verify Round-trip

- [x] Index builds (152 files) → status shows 152 files → verify passes (exit 0)

### 9.2 Index → Sync → Status Round-trip

- [x] After sync, status shows `SQLite cache: present`

### 9.3 Stats Recording via MCP

> Deferred — requires MCP validation run. See [MCP Validation Runbook](../mcp-validation/mcp-validation.md).

***

## Step 10: Unit Tests

### CLI Tests

```
Test Files  9 passed (9)
     Tests  55 passed (55)
  Duration  3.62s
```

- [x] All CLI tests pass (55/55)
- [x] No failures or errors

### Stats Adapter Tests

```
Test Files  2 passed (2)
     Tests  32 passed (32)
  Duration  419ms
```

- [x] All stats adapter tests pass (32/32)

***

## Summary Checklist

| # | Command | Tested | Pass |
|---|---------|--------|------|
| 1 | `ctxo --help` | Help output, unknown command | [x] |
| 2 | `ctxo index` | Full, --check, --skip-history, --max-history, --file, invalid input | [x] |
| 3 | `ctxo sync` | Fresh sync, re-sync | [x] |
| 4 | `ctxo status` | Normal, without index | [x] |
| 5 | `ctxo verify-index` | Fresh, stale* | [x]* |
| 6 | `ctxo init` | Hook creation | [x] |
| 7 | `ctxo watch` | Startup, clean exit | [x] |
| 8 | `ctxo stats` | Default, --json, --days, --clear, empty, disabled | [x] |
| 9 | Cross-command | Index→Status→Verify, Index→Sync→Status | [x] |
| 10 | Unit tests | CLI (55) + stats adapter (32) = 87 tests | [x] |

**Total checks: 54 — 53 PASS, 1 NUANCE**

> *Step 5.2 nuance: `verify-index` correctly uses content hashing. The runbook's `touch` test doesn't change content, so staleness isn't triggered. Unit tests confirm staleness detection works with actual content changes (3/3 pass). Recommend updating the runbook to modify file content instead of using `touch`.
