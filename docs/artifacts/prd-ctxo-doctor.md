# PRD: `ctxo doctor` — Health Check Command

**Author:** Alper Hankendi
**Date:** 2026-04-08
**Status:** Draft
**Epic:** Diagnostics & DX
**Depends on:** V1.1 (current — all existing tools functional)
**Estimated effort:** 2-3 days

***

## 1. Executive Summary

Ctxo has no way to answer "is my setup healthy?" in a single command. When something goes wrong — git not available, index stale, SQLite cache missing, ts-morph failing silently — the developer must manually check multiple subsystems to diagnose the issue. The existing `ctxo status` command only shows index file counts; it cannot detect broken dependencies, runtime mismatches, or configuration problems.

**This PRD introduces one capability:**

1. **`ctxo doctor`** — a single diagnostic command that checks every subsystem and reports a pass/warn/fail health status

The goal: **zero support burden**. When a developer reports "Ctxo isn't working," the first response is `ctxo doctor` — and the output tells them exactly what to fix.

> **Removed from scope:** `_stats` response enrichment and detail-level savings reporting were evaluated and removed. Per-response token/latency metrics add overhead to all 14 handlers without actionable value — AI assistants don't adapt detail levels based on per-call feedback. Aggregate usage stats are already available via `ctxo stats`.

***

## 2. Problem Statement

### 2.1 No Unified Health Check

Current diagnostic surface area is fragmented:

| What to check          | How to check today                             | UX                   |
| ---------------------- | ---------------------------------------------- | -------------------- |
| Git available?         | Run `git --version` manually                   | Manual               |
| Index exists?          | `ls .ctxo/index/`                              | Manual               |
| Index stale?           | `ctxo index --check` (slow — hashes all files) | Slow, exits non-zero |
| SQLite cache present?  | `ctxo status` shows "present/missing"          | Partial              |
| SQLite integrity?      | No way to check                                | Impossible           |
| Node.js version?       | `node --version` manually                      | Manual               |
| ts-morph working?      | Try indexing and see if it fails               | Trial and error      |
| tree-sitter available? | Try indexing a .go/.cs file                    | Trial and error      |
| Config valid?          | No validation                                  | Impossible           |
| Disk usage?            | `du -sh .ctxo/` manually                       | Manual               |

A developer on a fresh clone, a CI pipeline, or a team member picking up the project has no fast way to verify the full setup.

***

## 3. Success Criteria

### 3.1 `ctxo doctor`

| Metric               | Target                                                      |
| -------------------- | ----------------------------------------------------------- |
| Time to run          | < 3 seconds (all checks)                                    |
| Checks performed     | ≥ 10 distinct subsystem checks                              |
| Output clarity       | Each check shows PASS/WARN/FAIL with actionable fix message |
| Exit code            | 0 if all pass/warn, 1 if any fail                           |
| CI-friendly          | Machine-parseable output with `--json` flag                 |
| Zero false positives | FAIL only for genuinely broken states                       |

***

## 4. Detailed Requirements

### 4.1 `ctxo doctor` Command

#### FR-D1: Check Registry

| #  | Check                     | PASS                                                         | WARN                                  | FAIL                                   |
| -- | ------------------------- | ------------------------------------------------------------ | ------------------------------------- | -------------------------------------- |
| 1  | **Node.js version**       | ≥ 20.x                                                       | 18.x or 19.x                          | < 18.x or not found                    |
| 2  | **Git available**         | `git --version` succeeds                                     | —                                     | git not in PATH                        |
| 3  | **Git repository**        | `.git/` exists in project root or parent                     | —                                     | Not a git repo                         |
| 4  | **Index directory**       | `.ctxo/index/` exists with ≥ 1 JSON file                     | —                                     | Missing or empty                       |
| 5  | **Index freshness**       | All indexed files have matching mtime                        | ≤ 10% stale files                     | > 10% stale or index older than 7 days |
| 6  | **SQLite cache**          | `.ctxo/.cache/symbols.db` exists and integrity\_check passes | Missing (rebuildable via `ctxo sync`) | Exists but corrupt                     |
| 7  | **Config file**           | `.ctxo/config.yaml` valid YAML (if exists)                   | Missing (uses defaults)               | Exists but invalid YAML                |
| 8  | **ts-morph available**    | Can import ts-morph                                          | —                                     | Import fails                           |
| 9  | **tree-sitter available** | Can import tree-sitter + language pack                       | Missing (Go/C# indexing disabled)     | —                                      |
| 10 | **Disk usage**            | `.ctxo/` total < 100MB                                       | 100-500MB                             | > 500MB                                |
| 11 | **Symbol count**          | > 0 symbols indexed                                          | —                                     | 0 symbols (index empty)                |
| 12 | **Edge count**            | > 0 edges indexed                                            | 0 edges (possible isolated files)     | —                                      |
| 13 | **Orphaned index files**  | No index files for deleted source files                      | ≤ 5 orphaned files                    | > 5 orphaned files                     |
| 14 | **Co-changes cache**      | `.ctxo/index/co-changes.json` exists                         | Missing (co-change analysis disabled) | —                                      |
| 15 | **Schema version**        | Matches current version                                      | —                                     | Mismatch (migration needed)            |

#### FR-D2: Output Format

**Human-readable (default):**

```
ctxo doctor — Health Check

  ✓ Node.js version          v22.1.0 (required: ≥20)
  ✓ Git available             v2.44.0
  ✓ Git repository            d:\workspace\Ctxo
  ✓ Index directory            47 files indexed
  ⚠ Index freshness           3 of 47 files stale (run "ctxo index")
  ✓ SQLite cache              integrity_check passed
  ✓ Config file               .ctxo/config.yaml valid
  ✓ ts-morph                  available
  ⚠ tree-sitter               not found (Go/C# indexing disabled)
  ✓ Disk usage                 12.4 MB
  ✓ Symbol count               1,247 symbols
  ✓ Edge count                 3,891 edges
  ✓ Orphaned index files       none
  ✓ Co-changes cache           present (last updated 2026-04-07)
  ✓ Schema version             1.0.0 (current)

  Summary: 13 passed, 2 warnings, 0 failures
```

**Quiet mode (`ctxo doctor --quiet`) — CI-friendly, shows only FAIL/WARN:**

```
  ⚠ Index freshness           3 of 47 files stale (run "ctxo index")
  ⚠ tree-sitter               not found (Go/C# indexing disabled)

  Summary: 13 passed, 2 warnings, 0 failures
```

**Machine-readable (`ctxo doctor --json`):**

```JSON
{
  "checks": [
    {
      "name": "node_version",
      "status": "pass",
      "value": "v22.1.0",
      "message": "Node.js v22.1.0 (required: ≥20)"
    },
    {
      "name": "index_freshness",
      "status": "warn",
      "value": "3/47 stale",
      "message": "3 of 47 files stale",
      "fix": "Run \"ctxo index\" to refresh"
    }
  ],
  "summary": {
    "pass": 13,
    "warn": 2,
    "fail": 0
  },
  "exitCode": 0
}
```

#### FR-D3: Exit Codes

| Code | Meaning                     |
| ---- | --------------------------- |
| 0    | All checks passed or warned |
| 1    | At least one check failed   |

#### FR-D4: CLI Integration

| ID      | Requirement                                                            | Priority |
| ------- | ---------------------------------------------------------------------- | -------- |
| FR-D4.1 | Register `ctxo doctor` in CLI router                                   | P0       |
| FR-D4.2 | Support `--json` flag for machine-readable output                      | P0       |
| FR-D4.3 | Support `--quiet` flag (show only WARN/FAIL results + summary, for CI) | P1       |
| FR-D4.4 | Update `ctxo --help` to include doctor command                         | P0       |

***

## 5. Non-Functional Requirements

### NFR-1: Performance

| ID      | Requirement                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-1.1 | `ctxo doctor` completes in < 3 seconds for typical codebases                                                                                                                     |
| NFR-1.2 | Index freshness check in doctor uses mtime only (no content hashing) — fast path                                                                                                 |
| NFR-1.3 | I/O-bound checks run in parallel via `Promise.allSettled()` — fault-tolerant, a failing check never blocks others. CPU-bound checks (Node version) are instant and can run in either order. |

### NFR-2: Compatibility

| ID      | Requirement                                                              |
| ------- | ------------------------------------------------------------------------ |
| NFR-2.1 | `ctxo doctor` works without `.ctxo/` directory (reports "index missing") |
| NFR-2.2 | `ctxo doctor` works without git (reports "git not available")            |

### NFR-3: Observability

| ID      | Requirement                                                                         |
| ------- | ----------------------------------------------------------------------------------- |
| NFR-3.1 | Doctor check results logged to stderr: `[ctxo:doctor] node_version: PASS (v22.1.0)` |

***

## 6. Architecture

### 6.1 Design: Hybrid — Interface + Flat Registration

**Pattern choice:** Option C (Hybrid) — each check implements a shared `IHealthCheck` interface, but registration is a flat explicit array in `DoctorCommand` (no auto-discovery, no decorators, no DI container). This matches the project's existing convention (manual wiring, no framework magic) while providing type safety and test isolation.

**Key decisions:**
- `Promise.allSettled()` (not `Promise.all`) — a failing/throwing check never blocks other checks from running and reporting
- Constructor injection — `HealthChecker` receives `IHealthCheck[]` via constructor, making it trivially testable with mock checks
- Class-based checks implementing `IHealthCheck` — compile-time contract enforcement via `implements`

### 6.2 Doctor Command Architecture

```
ctxo doctor [--json] [--quiet]
      │
      ▼
  DoctorCommand (src/cli/)
      │  creates IHealthCheck[] array (flat, explicit)
      │
      ├──→ HealthChecker (src/adapters/diagnostics/)
      │         │  constructor(checks: IHealthCheck[])
      │         │  runAll(ctx) → Promise.allSettled() → DoctorReport
      │         │
      │         │  checks: IHealthCheck[] (all implement same interface)
      │         ├──→ NodeVersionCheck
      │         ├──→ GitBinaryCheck
      │         ├──→ GitRepoCheck
      │         ├──→ IndexDirectoryCheck
      │         ├──→ IndexFreshnessCheck
      │         ├──→ SqliteCacheCheck
      │         ├──→ ConfigFileCheck
      │         ├──→ TsMorphCheck
      │         ├──→ TreeSitterCheck
      │         ├──→ DiskUsageCheck
      │         ├──→ SymbolCountCheck
      │         ├──→ EdgeCountCheck
      │         ├──→ OrphanedFilesCheck
      │         ├──→ CoChangesCacheCheck
      │         └──→ SchemaVersionCheck
      │
      ▼
  DoctorReporter (src/adapters/diagnostics/)
      ├──→ Human-readable format (default)
      ├──→ JSON format (--json)
      └──→ WARN/FAIL-only format (--quiet)
```

**Layer rationale:** Checks access external resources (fs, git, SQLite) — they are adapters, not core domain logic. Only `types.ts` (pure data structures + `IHealthCheck` interface) lives in `src/core/diagnostics/`.

***

## 7. File Inventory

### New Files

Types live in `core/` (pure data structures, no I/O). Checks live in `adapters/` (they access fs, git, SQLite — adapter-level concerns per hexagonal rules).

| File                                                         | Layer   | Purpose                                                           |
| ------------------------------------------------------------ | ------- | ----------------------------------------------------------------- |
| `src/core/diagnostics/types.ts`                              | Core    | `IHealthCheck` interface, `CheckResult`, `CheckStatus`, `CheckContext`, `DoctorReport` types |
| `src/adapters/diagnostics/health-checker.ts`                 | Adapter | Orchestrator — `constructor(checks: IHealthCheck[])`, runs via `Promise.allSettled()` |
| `src/adapters/diagnostics/checks/runtime-check.ts`           | Adapter | `NodeVersionCheck`, `TsMorphCheck`, `TreeSitterCheck` classes (`implements IHealthCheck`) |
| `src/adapters/diagnostics/checks/git-check.ts`               | Adapter | `GitBinaryCheck`, `GitRepoCheck` classes |
| `src/adapters/diagnostics/checks/index-check.ts`             | Adapter | `IndexDirectoryCheck`, `IndexFreshnessCheck`, `SymbolCountCheck`, `EdgeCountCheck`, `OrphanedFilesCheck`, `CoChangesCacheCheck`, `SchemaVersionCheck` classes |
| `src/adapters/diagnostics/checks/storage-check.ts`           | Adapter | `SqliteCacheCheck` class |
| `src/adapters/diagnostics/checks/config-check.ts`            | Adapter | `ConfigFileCheck` class |
| `src/adapters/diagnostics/checks/disk-check.ts`              | Adapter | `DiskUsageCheck` class |
| `src/adapters/diagnostics/doctor-reporter.ts`                | Adapter | Human-readable, JSON, and quiet output formatting |
| `src/cli/doctor-command.ts`                                  | CLI     | Composes `IHealthCheck[]` array, wires `HealthChecker` + `DoctorReporter` |
| `src/adapters/diagnostics/__tests__/runtime-check.test.ts`   | Test    | Node version, ts-morph, tree-sitter (8 tests)                     |
| `src/adapters/diagnostics/__tests__/git-check.test.ts`       | Test    | Git binary, .git directory (6 tests)                              |
| `src/adapters/diagnostics/__tests__/index-check.test.ts`     | Test    | Index exists/empty/fresh/stale/orphaned (12 tests)                |
| `src/adapters/diagnostics/__tests__/storage-check.test.ts`   | Test    | SQLite exists/missing/corrupt (6 tests)                           |
| `src/adapters/diagnostics/__tests__/config-check.test.ts`    | Test    | YAML valid/invalid/missing (5 tests)                              |
| `src/adapters/diagnostics/__tests__/disk-check.test.ts`      | Test    | Size thresholds (5 tests)                                         |
| `src/adapters/diagnostics/__tests__/health-checker.test.ts`  | Test    | Orchestration, aggregation, exit code (8 tests)                   |
| `src/adapters/diagnostics/__tests__/doctor-reporter.test.ts` | Test    | Human, JSON, quiet format (8 tests)                               |
| `src/cli/__tests__/doctor-command.test.ts`                   | Test    | CLI wiring, flag parsing, exit codes                              |

### Modified Files

| File                                   | Change                                      |
| -------------------------------------- | ------------------------------------------- |
| `src/cli/cli-router.ts`                | Register `doctor` command, update help text |
| `src/cli/__tests__/cli-router.test.ts` | Add doctor command routing test             |

### Reused Existing Components

| Component                                              | Used by Check                         | How                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `StalenessDetector.check()`                            | #5 Index freshness                    | mtime comparison already implemented                                                                                                      |
| `SqliteStorageAdapter.verifyIntegrity()`               | #6 SQLite integrity                   | `PRAGMA integrity_check` already implemented                                                                                              |
| `SchemaManager.readStoredVersion()` / `isCompatible()` | #15 Schema version                    | Version check already implemented                                                                                                         |
| `JsonIndexReader.readAll()`                            | #4, #11, #12 Index/symbol/edge counts | Already reads and counts                                                                                                                  |
| `StatusCommand.getSourceFiles()`                       | #13 Orphaned files                    | Currently private — extract to shared util (e.g., `src/adapters/git/get-source-files.ts`) or duplicate the 5-line pattern in orphan check |

***

## 8. Check Implementation Details

### Check 1: Node.js Version

```TypeScript
const version = process.version; // e.g. "v22.1.0"
const major = parseInt(version.slice(1).split('.')[0], 10);
if (major >= 20) return pass(`Node.js ${version} (required: ≥20)`);
if (major >= 18) return warn(`Node.js ${version} — v20+ recommended`);
return fail(`Node.js ${version} — v20+ required`);
```

### Check 2-3: Git

```TypeScript
// Git binary
try {
  const version = execFileSync('git', ['--version'], { encoding: 'utf-8' }).trim();
  return pass(version);
} catch {
  return fail('git not found in PATH');
}

// Git repo
const gitDir = existsSync(join(projectRoot, '.git'));
if (gitDir) return pass(projectRoot);
return fail('Not a git repository');
```

### Check 4-5: Index

```TypeScript
const indexDir = join(ctxoRoot, 'index');
if (!existsSync(indexDir)) return fail('No index directory. Run "ctxo index"');

const reader = new JsonIndexReader(ctxoRoot);
const indices = reader.readAll();
if (indices.length === 0) return fail('Index directory empty. Run "ctxo index"');

// Freshness — uses StalenessDetector.check() which compares mtime (fast path)
const indexedFiles = indices.map(idx => idx.file);
const staleness = new StalenessDetector(projectRoot, ctxoRoot);
const warning = staleness.check(indexedFiles);
// warning is undefined if fresh, { staleFiles: string[], message: string } if stale
if (!warning) return pass(`All ${indices.length} files fresh`);
const staleCount = warning.staleFiles.length;
const pct = staleCount / indices.length;
if (pct <= 0.1) return warn(`${staleCount} of ${indices.length} files stale (run "ctxo index")`);
return fail(`${staleCount} of ${indices.length} files stale (${Math.round(pct * 100)}%)`);
```

### Check 6: SQLite

Uses sql.js (WASM SQLite), same API as `SqliteStorageAdapter.verifyIntegrity()`:

```TypeScript
const dbPath = join(ctxoRoot, '.cache', 'symbols.db');
if (!existsSync(dbPath)) return warn('SQLite cache missing. Run "ctxo sync" to rebuild');

try {
  const SQL = await initSqlJs();
  const buffer = readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  const result = db.exec('PRAGMA integrity_check');
  db.close();
  const firstRow = result[0]?.values[0];
  if (firstRow && firstRow[0] === 'ok') return pass('integrity_check passed');
  return fail('SQLite corrupt: ' + String(firstRow?.[0]));
} catch (err) {
  return fail('SQLite unreadable: ' + (err as Error).message);
}
```

### Check 7: Config

**Validation scope:** Parse-only — checks that the file is valid YAML syntax. No schema validation of keys/values (Ctxo has no formal config schema yet). A file with unknown keys passes; a file with broken YAML syntax fails.

```TypeScript
const configPath = join(ctxoRoot, 'config.yaml');
if (!existsSync(configPath)) return warn('No config.yaml (using defaults)');

try {
  const content = readFileSync(configPath, 'utf-8');
  YAML.parse(content); // Throws on invalid YAML syntax
  return pass('.ctxo/config.yaml valid');
} catch (err) {
  return fail(`Invalid config.yaml: ${(err as Error).message}`);
}
```

### Check 8-9: Language Adapters

Uses `createRequire` + `require.resolve()` instead of `import()` to avoid loading the full TS compiler (\~500ms). Required because the project is ESM-first (`"type": "module"`):

```TypeScript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ts-morph — required for TypeScript/JavaScript indexing
try {
  require.resolve('ts-morph');
  return pass('available');
} catch {
  return fail('ts-morph not installed. Run "npm install"');
}

// tree-sitter — optional, enables Go/C# support
try {
  require.resolve('tree-sitter');
  require.resolve('tree-sitter-language-pack');
  return pass('available');
} catch {
  return warn('tree-sitter not found — Go/C# indexing disabled');
}
```

### Check 10: Disk Usage

```TypeScript
function getDirSize(dirPath: string): number {
  let total = 0;
  const entries = readdirSync(dirPath, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      total += statSync(join(entry.parentPath ?? entry.path, entry.name)).size;
    }
  }
  return total;
}

const bytes = getDirSize(ctxoRoot);
const mb = bytes / (1024 * 1024);
const formatted = mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;

if (mb < 100) return pass(formatted);
if (mb < 500) return warn(`${formatted} — consider pruning orphaned index files`);
return fail(`${formatted} — unusually large. Check for stale data`);
```

***

## 9. Test Plan

### Test Conventions

Following existing project patterns:

* **Co-located** in `__tests__/` adjacent to source files
* **Framework:** `vitest`
* **No mocks for I/O** — use real temp directories (`mkdtempSync`), not `vi.mock('fs')`. Create actual files, dirs, and corrupt DBs in temp dir.
* **Output capture:** `vi.spyOn(console, 'error').mockImplementation(() => {})` for stderr, `vi.spyOn(process.stdout, 'write').mockImplementation(() => true)` for stdout. Assert via `spy.mock.calls.map(c => c[0]).join('\n')`.
* **Exit code testing:** `vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); })` — assert exit code value and catch the throw.
* **Fixture strategy:** Each check test creates its own temp dir with the minimum files needed. Helper functions for common setups:
  * `createCtxoDir(tempDir)` — creates `.ctxo/index/` and `.ctxo/.cache/`
  * `seedIndex(tempDir, files)` — writes minimal index JSON files
  * `createCorruptDb(tempDir)` — writes invalid bytes to `symbols.db`
  * `seedValidDb(tempDir)` — creates a valid sql.js DB with tables

### Unit Tests

| Test Suite     | File                                                         | Scope                                                                                                                                                   | Count |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| RuntimeCheck   | `src/adapters/diagnostics/__tests__/runtime-check.test.ts`   | Node version ≥20/18/17, NaN version, `createRequire.resolve` found/not found for ts-morph and tree-sitter                                               | 8     |
| GitCheck       | `src/adapters/diagnostics/__tests__/git-check.test.ts`       | git binary found/not found (execFileSync), `.git/` exists/missing                                                                                       | 6     |
| IndexCheck     | `src/adapters/diagnostics/__tests__/index-check.test.ts`     | Dir exists/missing/empty, freshness 0%/5%/50% stale, orphan 0/3/10 files, symbol count 0/N, edge count 0/N, schema match/mismatch                       | 12    |
| StorageCheck   | `src/adapters/diagnostics/__tests__/storage-check.test.ts`   | DB exists+ok, missing (WARN), corrupt bytes (FAIL), valid but empty tables                                                                              | 6     |
| ConfigCheck    | `src/adapters/diagnostics/__tests__/config-check.test.ts`    | Valid YAML, invalid syntax, missing file (WARN), empty file, YAML with unknown keys (still PASS)                                                        | 5     |
| DiskCheck      | `src/adapters/diagnostics/__tests__/disk-check.test.ts`      | <100MB (PASS), 100-500MB (WARN), >500MB (FAIL), empty dir, missing dir                                                                                  | 5     |
| HealthChecker  | `src/adapters/diagnostics/__tests__/health-checker.test.ts`  | Runs all checks, aggregates results, exit code 0 (all pass/warn), exit code 1 (any fail), parallel execution, single check failure doesn't block others | 8     |
| DoctorReporter | `src/adapters/diagnostics/__tests__/doctor-reporter.test.ts` | Human format with ✓/⚠/✗ symbols, JSON format valid + schema check, quiet mode shows only WARN/FAIL, summary line counts match, empty checks array       | 8     |

**Unit total: \~58 tests**

### Integration Tests

| Test                     | File                                       | Description                                                                                                                                            |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Doctor on clean project  | `src/cli/__tests__/doctor-command.test.ts` | All checks pass on a fresh temp project with index                                                                                                     |
| Doctor on missing index  | `src/cli/__tests__/doctor-command.test.ts` | Correct FAIL for index checks, other checks still run                                                                                                  |
| Doctor on stale index    | `src/cli/__tests__/doctor-command.test.ts` | Correct WARN for freshness                                                                                                                             |
| Doctor `--json` output   | `src/cli/__tests__/doctor-command.test.ts` | Valid JSON on stdout, schema: `checks[]` each has `name`, `status`, `value`, `message`; `summary.pass + summary.warn + summary.fail === checks.length` |
| Doctor `--quiet` output  | `src/cli/__tests__/doctor-command.test.ts` | Only WARN/FAIL lines shown, PASS lines omitted, summary still present                                                                                  |
| Doctor exit code 0       | `src/cli/__tests__/doctor-command.test.ts` | All pass/warn → exit 0                                                                                                                                 |
| Doctor exit code 1       | `src/cli/__tests__/doctor-command.test.ts` | Any fail → exit 1 (via `vi.spyOn(process, 'exit')`)                                                                                                    |
| CLI router routes doctor | `src/cli/__tests__/cli-router.test.ts`     | `['doctor']` routes to DoctorCommand, `['doctor', '--json']` passes flag                                                                               |

### Edge Case Tests

| Test                          | Description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| Doctor without git            | Gracefully reports git checks as FAIL, continues other checks |
| Doctor without .ctxo/         | Reports index/storage as FAIL, continues runtime checks       |
| Doctor with corrupt SQLite    | FAIL with specific message, does not crash                    |
| Doctor with unreadable config | FAIL with error message (file exists but invalid content)     |
| Doctor on empty project       | All index/storage checks FAIL, runtime checks still PASS      |

**Total: \~71 tests** (58 unit + 8 integration + 5 edge case)

***

## 10. Implementation Sequence

### Step 1: Types & Interface (Day 1)

* Define `IHealthCheck` interface, `CheckResult`, `CheckStatus`, `CheckContext`, `DoctorReport` in `src/core/diagnostics/types.ts`
* `IHealthCheck`: `{ readonly id: string; readonly title: string; run(ctx: CheckContext): Promise<CheckResult> }`
* `CheckContext`: `{ readonly projectRoot: string; readonly ctxoRoot: string }`

### Step 2: Individual Health Check Classes (Day 1-2)

* Implement 15 check classes in `src/adapters/diagnostics/checks/`, each `implements IHealthCheck`
* Each class has `readonly id`, `readonly title`, and `async run(ctx): Promise<CheckResult>`
* Reuse existing components (StalenessDetector, SchemaManager, verifyIntegrity, JsonIndexReader)
* Use `createRequire(import.meta.url).resolve()` for ts-morph/tree-sitter checks (ESM-compatible)
* Extract `getSourceFiles()` from StatusCommand to shared util or duplicate pattern
* Unit test each check with real temp directories (project convention — no vi.mock for fs/git)

### Step 3: HealthChecker Orchestrator + DoctorReporter (Day 2)

* Implement `HealthChecker` with `constructor(checks: IHealthCheck[])` — accepts flat array via injection
* `runAll(ctx)` uses `Promise.allSettled()` — a throwing check produces a FAIL result, never blocks others
* Implement `DoctorReporter` with human-readable, JSON, and quiet formatters
* Integration test: full doctor run on test project

### Step 4: CLI Wiring + Polish (Day 2-3)

* Create `DoctorCommand` class
* Register in `CliRouter` (`case 'doctor':`)
* Add `--json` and `--quiet` flag parsing
* Update help text and CLAUDE.md
* Add to CLI validation runbook
* Verify `ctxo doctor` works on Windows, macOS, Linux

***

## 11. Risks & Mitigations

| Risk                                                      | Likelihood | Impact | Mitigation                                                                                          |
| --------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------- |
| `import('ts-morph')` slow in doctor (loads TS compiler)   | Medium     | Low    | Use `createRequire(import.meta.url).resolve()` for existence check (ESM-compatible, no full import) |
| Disk usage calculation slow on large `.ctxo/` directories | Low        | Low    | Use `readdirSync` with `recursive: true` (Node 20+), cap at 10K entries                             |
| SQLite `integrity_check` slow on large DBs                | Low        | Medium | Set 5s timeout; skip if DB > 100MB and report size instead                                          |

***

## 12. Out of Scope

* **Auto-fix mode** (`--fix`) — deferred to future iteration. Doctor reports, doesn't heal (except trivially: `ctxo sync` for missing cache).
* **Remote diagnostics** — no telemetry, no phone-home. All checks are local.
* **`_stats`** **response enrichment** — evaluated and removed. Per-response token/latency metrics add overhead to all 14 handlers without actionable value. Aggregate usage stats are available via `ctxo stats`.
* **Context savings reporting** — evaluated and removed. Computing all 4 detail levels per call adds 4x formatting overhead for information AI assistants don't act on.
* **MCP tool exposure** — `get_health_check` MCP tool for AI assistants to query health programmatically. Deferred — doctor is human-facing first, MCP exposure can wrap the same HealthChecker later.
* **Benchmark mode** — `ctxo doctor` does not run performance benchmarks. It checks health, not speed.

***

## 13. Glossary

| Term               | Definition                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| **Doctor**         | Diagnostic command that checks all subsystems and reports health status |
| **Check**          | A single diagnostic test that returns PASS, WARN, or FAIL               |
| **HealthChecker**  | Orchestrator that runs all checks and aggregates results                |
| **DoctorReporter** | Formatter that renders check results as human-readable or JSON output   |
| **`_meta`**        | Existing response field containing truncation and size metadata         |

