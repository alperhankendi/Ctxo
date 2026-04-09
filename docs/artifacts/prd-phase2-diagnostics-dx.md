# PRD: Diagnostics & Developer Experience (Phase 2)

**Author:** Alper Hankendi
**Date:** 2026-04-08
**Status:** Draft
**Epic:** Diagnostics & DX
**Depends on:** V1.1 (current — all existing tools functional)
**Estimated effort:** 3-5 days

---

## 1. Executive Summary

Ctxo has no way to answer "is my setup healthy?" in a single command. When something goes wrong — git not available, index stale, SQLite cache missing, ts-morph failing silently — the developer must manually check multiple subsystems to diagnose the issue. The existing `ctxo status` command only shows index file counts; it cannot detect broken dependencies, runtime mismatches, or configuration problems.

**This PRD introduces three capabilities:**

1. **`ctxo doctor`** — a single diagnostic command that checks every subsystem and reports a pass/warn/fail health status
2. **`--stats` response enrichment** — optional token usage and performance metrics in MCP tool responses, enabling AI assistants to make informed decisions about detail levels and token budgets
3. **Context savings reporting** — the detail-level formatter reports how much context was saved by using L1/L2 vs L3/L4, helping AI assistants self-optimize

The goal: **zero support burden**. When a developer reports "Ctxo isn't working," the first response is `ctxo doctor` — and the output tells them exactly what to fix.

---

## 2. Problem Statement

### 2.1 No Unified Health Check

Current diagnostic surface area is fragmented:

| What to check | How to check today | UX |
|--------------|-------------------|-----|
| Git available? | Run `git --version` manually | Manual |
| Index exists? | `ls .ctxo/index/` | Manual |
| Index stale? | `ctxo index --check` (slow — hashes all files) | Slow, exits non-zero |
| SQLite cache present? | `ctxo status` shows "present/missing" | Partial |
| SQLite integrity? | No way to check | Impossible |
| Node.js version? | `node --version` manually | Manual |
| ts-morph working? | Try indexing and see if it fails | Trial and error |
| tree-sitter available? | Try indexing a .go/.cs file | Trial and error |
| Config valid? | No validation | Impossible |
| Disk usage? | `du -sh .ctxo/` manually | Manual |

A developer on a fresh clone, a CI pipeline, or a team member picking up the project has no fast way to verify the full setup.

### 2.2 Blind Token Budgets

AI assistants calling Ctxo tools have no visibility into:

- How many tokens the response actually consumed
- How much context was saved by using L2 vs L4
- Whether truncation occurred and how much data was lost
- How long the query took (latency budget awareness)

The `_meta` field in response-envelope.ts tracks `totalBytes` and `truncated`, but not:
- Estimated token count
- Potential token count at other detail levels
- Query latency
- Per-component timing (graph load, query, masking)

Without this data, AI assistants cannot self-optimize. They either always use L3 (wasteful) or always use L1 (too sparse), with no feedback loop.

### 2.3 No Detail-Level Guidance

The DetailFormatter applies L1-L4 formatting but never tells the caller what the cost difference is. An AI assistant choosing between L2 and L4 has no information about the token trade-off for the specific symbol being queried.

---

## 3. Success Criteria

### 3.1 `ctxo doctor`

| Metric | Target |
|--------|--------|
| Time to run | < 3 seconds (all checks) |
| Checks performed | ≥ 10 distinct subsystem checks |
| Output clarity | Each check shows PASS/WARN/FAIL with actionable fix message |
| Exit code | 0 if all pass/warn, 1 if any fail |
| CI-friendly | Machine-parseable output with `--json` flag |
| Zero false positives | FAIL only for genuinely broken states |

### 3.2 `--stats` Response Enrichment

| Metric | Target |
|--------|--------|
| Token estimation accuracy | Within ±15% of actual tokenizer output |
| Latency overhead | < 5ms additional per tool call |
| Opt-in | Stats only present when requested (no response bloat by default) |

### 3.3 Context Savings Reporting

| Metric | Target |
|--------|--------|
| Savings accuracy | Exact byte/token difference between requested level and L3 baseline |
| Coverage | All 4 detail levels report savings vs L3 |

---

## 4. Detailed Requirements

### 4.1 `ctxo doctor` Command

#### FR-D1: Check Registry

| # | Check | PASS | WARN | FAIL |
|---|-------|------|------|------|
| 1 | **Node.js version** | ≥ 20.x | 18.x or 19.x | < 18.x or not found |
| 2 | **Git available** | `git --version` succeeds | — | git not in PATH |
| 3 | **Git repository** | `.git/` exists in project root or parent | — | Not a git repo |
| 4 | **Index directory** | `.ctxo/index/` exists with ≥ 1 JSON file | — | Missing or empty |
| 5 | **Index freshness** | All indexed files have matching mtime | ≤ 10% stale files | > 10% stale or index older than 7 days |
| 6 | **SQLite cache** | `.ctxo/.cache/symbols.db` exists and integrity_check passes | Missing (rebuildable via `ctxo sync`) | Exists but corrupt |
| 7 | **Config file** | `.ctxo/config.yaml` valid YAML (if exists) | Missing (uses defaults) | Exists but invalid YAML |
| 8 | **ts-morph available** | Can import ts-morph | — | Import fails |
| 9 | **tree-sitter available** | Can import tree-sitter + language pack | Missing (Go/C# indexing disabled) | — |
| 10 | **Disk usage** | `.ctxo/` total < 100MB | 100-500MB | > 500MB |
| 11 | **Symbol count** | > 0 symbols indexed | — | 0 symbols (index empty) |
| 12 | **Edge count** | > 0 edges indexed | 0 edges (possible isolated files) | — |
| 13 | **Orphaned index files** | No index files for deleted source files | ≤ 5 orphaned files | > 5 orphaned files |
| 14 | **Co-changes cache** | `.ctxo/index/co-changes.json` exists | Missing (co-change analysis disabled) | — |
| 15 | **Schema version** | Matches current version | — | Mismatch (migration needed) |

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

**Machine-readable (`ctxo doctor --json`):**
```json
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

| Code | Meaning |
|------|---------|
| 0 | All checks passed or warned |
| 1 | At least one check failed |

#### FR-D4: CLI Integration

| ID | Requirement | Priority |
|----|------------|----------|
| FR-D4.1 | Register `ctxo doctor` in CLI router | P0 |
| FR-D4.2 | Support `--json` flag for machine-readable output | P1 |
| FR-D4.3 | Support `--fix` flag that auto-repairs what it can (run sync, delete orphans) | P2 |
| FR-D4.4 | Update `ctxo --help` to include doctor command | P0 |

---

### 4.2 MCP Response Stats (`_stats` Field)

#### FR-S1: Stats Schema

```typescript
interface ResponseStats {
  /** Estimated token count of this response */
  estimatedTokens: number;
  /** Response size in bytes (after masking, before transport) */
  responseBytes: number;
  /** Total query latency in milliseconds */
  latencyMs: number;
  /** Per-component timing breakdown */
  timing: {
    graphLoadMs: number;
    queryMs: number;
    maskingMs: number;
    envelopeMs: number;
  };
  /** For logic-slice: token cost at each detail level */
  detailLevelCosts?: {
    L1: number;
    L2: number;
    L3: number;
    L4: number;
    current: number;
    savings: string; // e.g. "L2 saved ~3,200 tokens vs L3"
  };
}
```

#### FR-S2: Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-S2.1 | Add `_stats` field to MCP tool responses when `includeStats: true` is passed | P0 |
| FR-S2.2 | `_stats` is **never** included by default (opt-in only) | P0 |
| FR-S2.3 | Token estimation uses byte-offset when available, line-count fallback | P0 |
| FR-S2.4 | Latency tracked via `performance.now()` at handler entry/exit | P0 |
| FR-S2.5 | Per-component timing for graph load, query execution, masking | P1 |
| FR-S2.6 | Token estimation overhead < 2ms | P0 |
| FR-S2.7 | Add `includeStats` parameter to all MCP tool input schemas | P0 |

#### FR-S3: Token Estimation

```typescript
function estimateTokens(text: string): number {
  // Approximation: 1 token ≈ 4 characters for English/code
  // More accurate: count whitespace-separated words + punctuation
  const byteLength = Buffer.byteLength(text, 'utf-8');
  return Math.ceil(byteLength / 4);
}
```

This matches the existing estimation in `DetailFormatter.estimateTokens()` and `ContextAssembler.estimateTokens()`.

---

### 4.3 Detail-Level Savings Reporting

#### FR-C1: Savings in Logic-Slice Response

When `get_logic_slice` is called with `includeStats: true`, the `_stats.detailLevelCosts` field shows token cost at each level:

```json
{
  "root": { "symbolId": "...", "name": "BlastRadiusCalculator" },
  "dependencies": [ ... ],
  "level": 2,
  "levelDescription": "L2: Root + direct dependencies (depth 1)",
  "_stats": {
    "estimatedTokens": 820,
    "responseBytes": 3280,
    "latencyMs": 14,
    "timing": { "graphLoadMs": 8, "queryMs": 4, "maskingMs": 1, "envelopeMs": 1 },
    "detailLevelCosts": {
      "L1": 180,
      "L2": 820,
      "L3": 4200,
      "L4": 4200,
      "current": 820,
      "savings": "L2 saved ~3,380 tokens vs L3"
    }
  }
}
```

#### FR-C2: Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-C2.1 | Compute token cost at all 4 detail levels for the queried symbol | P0 |
| FR-C2.2 | Include `savings` as human-readable string comparing current level vs L3 | P0 |
| FR-C2.3 | Only compute when `includeStats: true` (no cost for normal queries) | P0 |
| FR-C2.4 | L3 is the baseline (full closure) — savings are always relative to L3 | P0 |
| FR-C2.5 | If current level = L3 or L4, savings = "0" or "L4 enforced 8K budget, saved ~N tokens vs unbounded L3" | P1 |

---

## 5. Non-Functional Requirements

### NFR-1: Performance

| ID | Requirement |
|----|------------|
| NFR-1.1 | `ctxo doctor` completes in < 3 seconds for typical codebases |
| NFR-1.2 | Index freshness check in doctor uses mtime only (no content hashing) — fast path |
| NFR-1.3 | `_stats` computation adds < 5ms overhead per MCP tool call |
| NFR-1.4 | Detail-level cost computation adds < 10ms (formats all 4 levels, measures sizes) |

### NFR-2: Compatibility

| ID | Requirement |
|----|------------|
| NFR-2.1 | `ctxo doctor` works without `.ctxo/` directory (reports "index missing") |
| NFR-2.2 | `ctxo doctor` works without git (reports "git not available") |
| NFR-2.3 | `_stats` field does not break existing MCP clients (additive schema change) |
| NFR-2.4 | `includeStats` parameter is optional with default `false` in all tool schemas |

### NFR-3: Observability

| ID | Requirement |
|----|------------|
| NFR-3.1 | Doctor check results logged to stderr: `[ctxo:doctor] node_version: PASS (v22.1.0)` |
| NFR-3.2 | Stats timing logged to stderr when `DEBUG=ctxo:stats` enabled |

---

## 6. Architecture

### 6.1 Doctor Command Architecture

```
ctxo doctor [--json] [--fix]
      │
      ▼
  DoctorCommand
      │
      ├──→ HealthChecker (orchestrator)
      │         │
      │         ├──→ RuntimeCheck      (Node version, ts-morph, tree-sitter)
      │         ├──→ GitCheck          (git binary, .git/ directory)
      │         ├──→ IndexCheck        (directory, freshness, orphans, schema)
      │         ├──→ StorageCheck      (SQLite existence, integrity)
      │         ├──→ ConfigCheck       (config.yaml validation)
      │         └──→ DiskCheck         (disk usage computation)
      │
      ▼
  DoctorReporter
      ├──→ Human-readable format (default)
      └──→ JSON format (--json)
```

### 6.2 Stats Enrichment Architecture

```
MCP Tool Handler
      │
      ├──→ [start timer]
      │
      ├──→ Graph load ──→ [record graphLoadMs]
      ├──→ Query exec ──→ [record queryMs]
      ├──→ Masking     ──→ [record maskingMs]
      ├──→ Envelope    ──→ [record envelopeMs]
      │
      ├──→ [if includeStats]
      │         │
      │         ├──→ Token estimation
      │         ├──→ Detail-level cost computation (logic-slice only)
      │         └──→ Attach _stats to response
      │
      └──→ Return response
```

### 6.3 Timing Tracker Utility

A lightweight utility class used across all MCP handlers:

```typescript
class QueryTimer {
  private marks = new Map<string, number>();
  
  mark(label: string): void {
    this.marks.set(label, performance.now());
  }
  
  elapsed(from: string, to: string): number {
    const start = this.marks.get(from);
    const end = this.marks.get(to);
    if (start === undefined || end === undefined) return 0;
    return Math.round(end - start);
  }
  
  toTiming(): ResponseStats['timing'] {
    return {
      graphLoadMs: this.elapsed('graphLoad_start', 'graphLoad_end'),
      queryMs: this.elapsed('query_start', 'query_end'),
      maskingMs: this.elapsed('masking_start', 'masking_end'),
      envelopeMs: this.elapsed('envelope_start', 'envelope_end'),
    };
  }
}
```

---

## 7. File Inventory

### New Files

| File | Purpose |
|------|---------|
| `src/cli/doctor-command.ts` | `ctxo doctor` command entry point |
| `src/core/diagnostics/health-checker.ts` | Orchestrator — runs all checks, collects results |
| `src/core/diagnostics/checks/runtime-check.ts` | Node.js version, ts-morph, tree-sitter availability |
| `src/core/diagnostics/checks/git-check.ts` | Git binary, .git directory |
| `src/core/diagnostics/checks/index-check.ts` | Index dir, freshness, orphans, symbol/edge counts, schema version |
| `src/core/diagnostics/checks/storage-check.ts` | SQLite existence, integrity_check |
| `src/core/diagnostics/checks/config-check.ts` | config.yaml validation |
| `src/core/diagnostics/checks/disk-check.ts` | .ctxo/ directory size |
| `src/core/diagnostics/doctor-reporter.ts` | Human-readable and JSON output formatting |
| `src/core/diagnostics/types.ts` | `CheckResult`, `CheckStatus`, `DoctorReport` types |
| `src/core/stats/query-timer.ts` | Lightweight timing tracker |
| `src/core/stats/token-estimator.ts` | Centralized token estimation utility |
| `src/core/stats/stats-builder.ts` | Builds `_stats` object from timing + token data |
| `src/core/diagnostics/__tests__/health-checker.test.ts` | Unit tests |
| `src/core/diagnostics/__tests__/doctor-reporter.test.ts` | Output format tests |
| `src/core/stats/__tests__/query-timer.test.ts` | Timer tests |
| `src/core/stats/__tests__/stats-builder.test.ts` | Stats builder tests |

### Modified Files

| File | Change |
|------|--------|
| `src/cli/cli-router.ts` | Register `doctor` command, update help text |
| `src/adapters/mcp/get-logic-slice.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-blast-radius.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-ranked-context.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-why-context.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-change-intelligence.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-context-for-task.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/search-symbols.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/find-importers.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-class-hierarchy.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-symbol-importance.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/find-dead-code.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-changed-symbols.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-architectural-overlay.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/adapters/mcp/get-pr-impact.ts` | Add `includeStats` param, timing marks, `_stats` field |
| `src/core/detail-levels/detail-formatter.ts` | Add `computeAllLevelCosts()` method |

---

## 8. Check Implementation Details

### Check 1: Node.js Version

```typescript
const version = process.version; // e.g. "v22.1.0"
const major = parseInt(version.slice(1).split('.')[0], 10);
if (major >= 20) return pass(`Node.js ${version} (required: ≥20)`);
if (major >= 18) return warn(`Node.js ${version} — v20+ recommended`);
return fail(`Node.js ${version} — v20+ required`);
```

### Check 2-3: Git

```typescript
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

```typescript
const indexDir = join(ctxoRoot, 'index');
if (!existsSync(indexDir)) return fail('No index directory. Run "ctxo index"');

const indices = reader.readAll();
if (indices.length === 0) return fail('Index directory empty. Run "ctxo index"');

// Freshness — mtime only (fast path)
const staleCount = staleness.countStaleFiles(indices);
const pct = staleCount / indices.length;
if (pct === 0) return pass(`All ${indices.length} files fresh`);
if (pct <= 0.1) return warn(`${staleCount} of ${indices.length} files stale`);
return fail(`${staleCount} of ${indices.length} files stale (${Math.round(pct * 100)}%)`);
```

### Check 6: SQLite

```typescript
const dbPath = join(ctxoRoot, '.cache', 'symbols.db');
if (!existsSync(dbPath)) return warn('SQLite cache missing. Run "ctxo sync" to rebuild');

try {
  const db = new Database(dbPath);
  const result = db.pragma('integrity_check');
  db.close();
  if (result[0]?.integrity_check === 'ok') return pass('integrity_check passed');
  return fail(`SQLite corrupt: ${result[0]?.integrity_check}`);
} catch (err) {
  return fail(`SQLite unreadable: ${(err as Error).message}`);
}
```

### Check 7: Config

```typescript
const configPath = join(ctxoRoot, 'config.yaml');
if (!existsSync(configPath)) return warn('No config.yaml (using defaults)');

try {
  const content = readFileSync(configPath, 'utf-8');
  YAML.parse(content); // Throws on invalid YAML
  return pass('.ctxo/config.yaml valid');
} catch (err) {
  return fail(`Invalid config.yaml: ${(err as Error).message}`);
}
```

### Check 8-9: Language Adapters

```typescript
// ts-morph
try {
  await import('ts-morph');
  return pass('available');
} catch {
  return fail('ts-morph not installed. Run "npm install"');
}

// tree-sitter
try {
  await import('tree-sitter');
  await import('tree-sitter-language-pack');
  return pass('available');
} catch {
  return warn('tree-sitter not found — Go/C# indexing disabled');
}
```

### Check 10: Disk Usage

```typescript
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

---

## 9. Test Plan

### Unit Tests

| Test Suite | Scope | Count (est.) |
|-----------|-------|-------------|
| RuntimeCheck | Node version parsing, edge cases (NaN, missing) | 8 |
| GitCheck | git found/not found, .git exists/missing | 6 |
| IndexCheck | exists/empty/fresh/stale/orphaned, threshold boundaries | 12 |
| StorageCheck | exists/missing/corrupt/ok | 6 |
| ConfigCheck | valid/invalid/missing YAML | 5 |
| DiskCheck | small/medium/large size thresholds | 5 |
| HealthChecker | Orchestration, result aggregation, exit code logic | 8 |
| DoctorReporter | Human format, JSON format, edge cases | 8 |
| QueryTimer | mark/elapsed/toTiming accuracy | 6 |
| StatsBuilder | Token estimation, detail-level costs, savings string | 10 |
| TokenEstimator | Byte-based, line-based, edge cases | 5 |

**Total:** ~79 tests

### Integration Tests

| Test | Description |
|------|------------|
| Doctor on clean project | All checks pass on a fresh `ctxo index` |
| Doctor on missing index | Correct FAIL for index checks |
| Doctor on stale index | Correct WARN for freshness |
| Doctor JSON output | Valid JSON, all fields present |
| Stats in logic-slice | `includeStats: true` returns `_stats` with timing and costs |
| Stats in blast-radius | `includeStats: true` returns `_stats` with timing |
| Stats default off | `includeStats` omitted → no `_stats` field |
| Detail-level costs | L1 < L2 < L3 ≤ L4 token cost ordering |

### Edge Case Tests

| Test | Description |
|------|------------|
| Doctor without git | Gracefully reports git checks as FAIL, continues other checks |
| Doctor without .ctxo/ | Reports index/storage as FAIL, continues runtime checks |
| Doctor with corrupt SQLite | FAIL with specific message, does not crash |
| Stats with empty graph | Returns `_stats` with zero tokens, zero latency |
| Stats with massive response | Token estimate scales correctly for large payloads |

---

## 10. Implementation Sequence

### Step 1: Types & Infrastructure (Day 1)

- Define `CheckResult`, `CheckStatus`, `DoctorReport` types
- Implement `QueryTimer` utility
- Implement `TokenEstimator` utility (consolidate existing `estimateTokens` logic)
- Unit tests for timer and estimator

### Step 2: Individual Health Checks (Day 1-2)

- Implement all 15 checks as separate modules in `src/core/diagnostics/checks/`
- Each check is a pure function: `(projectRoot: string) => Promise<CheckResult>`
- Unit test each check with mocked filesystem/git

### Step 3: HealthChecker Orchestrator + DoctorReporter (Day 2)

- Implement `HealthChecker` that runs all checks and collects results
- Implement `DoctorReporter` with human-readable and JSON formatters
- Integration test: full doctor run on test project

### Step 4: CLI Wiring (Day 2-3)

- Create `DoctorCommand` class
- Register in `CliRouter` (`case 'doctor':`)
- Add `--json` flag parsing
- Update help text
- Manual smoke test

### Step 5: Stats Builder + MCP Integration (Day 3-4)

- Implement `StatsBuilder` class
- Add `includeStats` parameter to all MCP tool input schemas (Zod)
- Add timing marks to `get-logic-slice.ts` as reference implementation
- Add `_stats` field attachment when `includeStats: true`
- Test stats round-trip

### Step 6: Roll Out Stats to All Tools (Day 4)

- Apply the same timing + stats pattern to remaining 13 MCP handlers
- Each handler: add `includeStats` to schema, add timing marks, attach `_stats`
- Integration tests for 3-4 representative tools

### Step 7: Detail-Level Cost Computation (Day 4-5)

- Add `computeAllLevelCosts()` to `DetailFormatter`
- Returns `{ L1: number, L2: number, L3: number, L4: number }` token estimates
- Wire into `get-logic-slice` handler's `_stats.detailLevelCosts`
- Generate `savings` string
- Test with symbols of varying size

### Step 8: Polish & Documentation (Day 5)

- Update CLAUDE.md CLI commands section
- Update help text
- Final integration test pass
- Verify `ctxo doctor` works on Windows, macOS, Linux

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `import('ts-morph')` slow in doctor (loads TS compiler) | Medium | Low | Use `require.resolve()` for existence check instead of full import |
| Disk usage calculation slow on large `.ctxo/` directories | Low | Low | Use `readdirSync` with `recursive: true` (Node 20+), cap at 10K entries |
| SQLite `integrity_check` slow on large DBs | Low | Medium | Set 5s timeout; skip if DB > 100MB and report size instead |
| Stats timing inaccurate due to event loop jitter | Medium | Low | Use `performance.now()` (monotonic clock); note ±5ms accuracy in docs |
| Adding `includeStats` to all 14 tools is repetitive | High | Low | Extract shared `withStats()` wrapper function to reduce boilerplate |

---

## 12. Out of Scope

- **Auto-fix mode** (`--fix`) — deferred to future iteration. Doctor reports, doesn't heal (except trivially: `ctxo sync` for missing cache).
- **Remote diagnostics** — no telemetry, no phone-home. All checks are local.
- **Historical stats tracking** — no persistent stats database. Stats are per-request only.
- **Cost estimation in dollars** — token counts only, no pricing lookups.
- **Benchmark mode** — `ctxo doctor` does not run performance benchmarks. It checks health, not speed.

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| **Doctor** | Diagnostic command that checks all subsystems and reports health status |
| **Check** | A single diagnostic test that returns PASS, WARN, or FAIL |
| **HealthChecker** | Orchestrator that runs all checks and aggregates results |
| **QueryTimer** | Lightweight utility that tracks timing marks for per-component latency |
| **TokenEstimator** | Utility that estimates LLM token count from byte length |
| **Detail-level cost** | Token count of a logic-slice response at each detail level (L1-L4) |
| **`_stats`** | Optional response field containing performance and token metrics |
| **`_meta`** | Existing response field containing truncation and size metadata |
