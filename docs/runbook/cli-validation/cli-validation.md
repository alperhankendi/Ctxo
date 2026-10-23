# Ctxo CLI — Full Validation Runbook

> **Purpose:** Repeatable end-to-end validation of all `ctxo` CLI commands.
> **When to run:** After any CLI change, new command, or before release.
> **Expected duration:** ~3 minutes
> **Version:** v0.8.0 (architectural intelligence)
> **Prerequisite:** Index must exist (run `ctxo index` first, or follow [MCP Validation Runbook](../mcp-validation/mcp-validation.md) Steps 1-2)

All commands assume the monorepo root as cwd. `.ctxo/` is per-project; when validating the ctxo repo itself it lives at the workspace root. `--file src/X.ts` is interpreted relative to the cwd.

***

## Command Reference

| Command | Purpose | Flags |
|---------|---------|-------|
| `ctxo index` | Build codebase index | `--files <path...>` (`--file <path>` alias), `--commit <rev>`, `--check`, `--skip-history`, `--max-history N`, `--skip-community`, `--cochange-commits <n\|all>`, `--cochange-since <duration>` |
| `ctxo sync` | Rebuild SQLite from JSON index | — |
| `ctxo status` | Show index manifest | — |
| `ctxo verify-index` | CI gate: fail if index stale | — |
| `ctxo init` | Install git hooks (post-commit v2 runs `ctxo index --commit HEAD`) | - |
| `ctxo watch` | File watcher for incremental re-index | — |
| `ctxo stats` | Show usage statistics | `--json`, `--days N`, `--clear` |
| `ctxo doctor` | Health check all subsystems | `--json`, `--quiet`, `--fix` |
| `ctxo --help` | Show help (also `ctxo <command> --help`, which runs nothing) | - |

***

## Step 1: Help & Unknown Command

### 1.1 Help Output

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts --help
```

**Verify:**

* [ ] Lists all 8 commands (index, sync, watch, verify-index, status, init, stats, --help)
* [ ] Shows `ctxo stats` with `--json, --days N, --clear` description
* [ ] Shows the index flags `--files`, `--file`, `--commit`, `--cochange-commits`, `--cochange-since`, and the `ctxo index` line says `--max-history N` controls intent depth only
* [ ] Output goes to stderr (not stdout)

### 1.1b Subcommand `--help` Does Not Run the Command

> **Safety:** a subcommand that ignores `--help` would run for real. Do this in a scratch clone, and compare `git status` and `.ctxo/` timestamps before and after.

```bash
node packages/cli/dist/index.js index --help 2>&1; echo "Exit: $?"
node packages/cli/dist/index.js init --help 2>&1; echo "Exit: $?"
node packages/cli/dist/index.js doctor -h 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] Each prints the same help text as `ctxo --help`
* [ ] Each exits 0
* [ ] No index run, no `init` prompt, no hook or file written (`.ctxo/` and `.git/hooks/` are untouched)

### 1.2 Unknown Command

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts unknown-command 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] Shows `Unknown command: "unknown-command"`
* [ ] Exit code is 1

***

## Step 2: `ctxo index`

### 2.1 Full Index Build

```bash
rm -rf .ctxo/.cache/ .ctxo/index/
time pnpm --filter @ctxo/cli exec tsx src/index.ts index
```

**Verify:**

* [ ] Output shows `[ctxo] Index complete: N files indexed`
* [ ] Output shows `[ctxo] Community detection: M clusters (modularity X.XXX)` with modularity ≥ 0.3
* [ ] `.ctxo/index/` contains JSON files
* [ ] `.ctxo/index/communities.json` exists and is valid JSON (version: 1)
* [ ] `.ctxo/index/co-changes.json` exists and its `window` records `maxCommits`, `head`, `commitsScanned`, `commitsUsed`, `massSkipped`, `maxFilesPerCommit` and `minShared`
* [ ] No errors on stderr
* [ ] Build time under 10 seconds

> **Note:** `.ctxo/index/communities.history/<ISO>-<sha>.json` is **not** created on the first run after a wipe, and not by a second run on the same commit either: history holds one snapshot per commit and gains an entry only when a run happens at a new commit. See Step 2.7.

### 2.2 `--check` Flag (CI Gate)

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts index --check 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] Exit code 0 when index is fresh
* [ ] Exit code 1 when index is stale (modify a source file and re-run to test)

### 2.3 `--skip-history` Flag

```bash
rm -rf .ctxo/.cache/ .ctxo/index/
time pnpm --filter @ctxo/cli exec tsx src/index.ts index --skip-history
```

**Verify:**

* [ ] Index builds successfully
* [ ] Faster than full build (no git history read)
* [ ] `intent` arrays are empty in index JSON files
* [ ] `.ctxo/index/co-changes.json` is not refreshed (an existing file keeps its bytes; none is created after the wipe)

### 2.4 `--max-history N` Flag

```bash
rm -rf .ctxo/.cache/ .ctxo/index/
pnpm --filter @ctxo/cli exec tsx src/index.ts index --max-history 3
```

**Verify:**

* [ ] Index builds successfully
* [ ] No file in `.ctxo/index/` has more than 3 entries in its `intent` array
* [ ] `co-changes.json` `window.commitsScanned` is unchanged by `--max-history`: the co-change window has its own settings (Step 2.9)

```bash
node -e "
const fs = require('fs'); const path = require('path');
function walk(dir) { let f=[]; for (const e of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) f.push(...walk(p)); else if(e.name.endsWith('.json')&&e.name!=='co-changes.json') f.push(p); } return f; }
const files=walk('.ctxo/index'); let maxIntent=0;
for(const f of files){const d=JSON.parse(fs.readFileSync(f,'utf8'));if((d.intent||[]).length>maxIntent)maxIntent=(d.intent||[]).length;}
console.log('Max intent entries:', maxIntent, maxIntent <= 3 ? 'PASS' : 'FAIL');
"
```

### 2.5 `--files <path...>` and `--file <path>` (Incremental Re-index)

```bash
cp .ctxo/index/co-changes.json /tmp/co-changes.before.json
pnpm --filter @ctxo/cli exec tsx src/index.ts index --files packages/cli/src/core/types.ts packages/cli/src/core/logger.ts
pnpm --filter @ctxo/cli exec tsx src/index.ts index --file packages/cli/src/core/types.ts
```

**Verify:**

* [ ] Output shows `[ctxo] Incremental re-index: 2 file(s) to index, 0 to remove` for `--files` and 1 file for `--file` (an alias of `--files` with one path)
* [ ] `co-changes.json` is unchanged (same entries as `/tmp/co-changes.before.json`): an incremental run recomputes co-change from git for the whole repository, never from the listed files
* [ ] `.ctxo/.cache/symbols.db` still holds every indexed file (status shows the same symbol count as before), not only the listed ones
* [ ] Only `packages/cli/src/core/types.ts` is re-indexed
* [ ] Output shows `[ctxo] Community detection (incremental, full-graph recompute): N clusters (modularity X.XXX)` — community detection reruns over the full merged graph (new file + existing committed index), not over the 1-file subgraph
* [ ] Output shows 1 file indexed (`[ctxo] Index complete: 1 files indexed`)
* [ ] Other index files are unchanged

### 2.5b `--commit <rev>` (Re-index One Commit)

> Run this in a scratch clone: it needs a commit to point at.

```bash
echo "// touched" >> packages/cli/src/core/types.ts
git add packages/cli/src/core/types.ts && git commit -m "validation: touch types.ts"
pnpm --filter @ctxo/cli exec tsx src/index.ts index --commit HEAD
pnpm --filter @ctxo/cli exec tsx src/index.ts index --commit no-such-rev 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] `--commit HEAD` prints `Incremental re-index: 1 file(s) to index, 0 to remove (commit HEAD)`
* [ ] `communities.json` `commitSha` equals `git rev-parse --short HEAD`
* [ ] `co-changes.json` `window.head` follows the new HEAD and `commitsScanned` grew by 1
* [ ] A commit that deletes or renames a file removes the old index JSON and, for a rename, indexes the new path
* [ ] `--commit no-such-rev` exits 1 with `cannot read the files this commit changed`, and nothing is written
* [ ] `--commit` with no revision exits 1 with `--commit requires a revision`

### 2.6 `--skip-community` Flag (opt out of community detection)

```bash
rm -rf .ctxo/.cache/ .ctxo/index/
time pnpm --filter @ctxo/cli exec tsx src/index.ts index --skip-community
```

**Verify:**

* [ ] Output shows `[ctxo] Index complete: N files indexed`
* [ ] Output does NOT contain `[ctxo] Community detection:` line
* [ ] If a previous `communities.json` exists, output shows `[ctxo] WARN stale communities.json present — --skip-community preserved existing snapshot.`
* [ ] If no previous `communities.json` exists, `.ctxo/index/communities.json` stays absent
* [ ] If a previous `communities.json` exists, its contents are preserved (mtime unchanged, cluster count unchanged) — the flag does NOT regenerate or delete the snapshot
* [ ] Indexing is marginally faster (no Louvain + PageRank pass)

### 2.7 Snapshot History: One Snapshot per Commit

> **Behavior note:** `communities.json` is the snapshot of the current HEAD. The previous commit's snapshot is archived into `communities.history/` only when a run happens at a **new** commit. Running `ctxo index` any number of times on one commit replaces `communities.json` and archives nothing, so history holds at most one snapshot per commit. Run this in a scratch clone (it makes commits).

```bash
rm -rf .ctxo/.cache/ .ctxo/index/
pnpm --filter @ctxo/cli exec tsx src/index.ts index  # run 1: writes communities.json, no history
pnpm --filter @ctxo/cli exec tsx src/index.ts index  # run 2: same commit, replaces communities.json, no history
git commit --allow-empty -m "validation: second commit"
pnpm --filter @ctxo/cli exec tsx src/index.ts index  # run 3: new commit, archives the first commit's snapshot
git commit --allow-empty -m "validation: third commit"
pnpm --filter @ctxo/cli exec tsx src/index.ts index  # run 4
ls .ctxo/index/communities.history/
```

**Verify:**

* [ ] After runs 1 and 2: `communities.history/` is empty (or absent).
* [ ] After run 3: exactly 1 snapshot file exists, named for the previous commit.
* [ ] After run 4: exactly 2 snapshot files exist, with two different commit SHAs.
* [ ] File names are `<ISO-timestamp>-<git-short-sha>.json`, and no two files share a SHA.
* [ ] Max 10 files kept (FIFO eviction by commit; verify by indexing after 11 further commits and confirming the oldest commit's file is removed).
* [ ] `drift-events.json` and `boundary-violations.json` report `distinctCommits` equal to the number of distinct SHAs in `communities.history/` other than the current commit (0 after run 2, 1 after run 3, 2 after run 4), and `confidence` follows it (`low` below 3).
* [ ] Upgrade healing: copy two files of the same SHA into `communities.history/` (a v1 hook leftover), run `ctxo index`; the first write leaves one file for that SHA and nothing else is lost.

### 2.8 `--max-history` Invalid Input

> **Note:** Run these against a **built CLI** (`node packages/cli/dist/index.js ...`) or plain `tsx`.
> The `pnpm --filter ... exec` wrapper injects an `undefined` line into the output stream that
> can make the error assertion noisy — this is a pnpm cosmetics issue, not a CLI bug.

```bash
node packages/cli/dist/index.js index --max-history abc 2>&1; echo "Exit: $?"
node packages/cli/dist/index.js index --max-history 0 2>&1; echo "Exit: $?"
node packages/cli/dist/index.js index --max-history 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] All three show `[ctxo] --max-history requires a positive integer`
* [ ] All three exit with code 1

### 2.9 Co-change Window (`--cochange-commits`, `--cochange-since`, `cochange:` config)

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts index --cochange-commits 50
pnpm --filter @ctxo/cli exec tsx src/index.ts index --cochange-commits all
pnpm --filter @ctxo/cli exec tsx src/index.ts index --cochange-commits 500 --cochange-since 12m
```

**Verify:**

* [ ] `co-changes.json` `window.maxCommits` is `50`, then `"all"`, then `500` with `since: "12m"`
* [ ] With `all`, `window.commitsScanned` equals `git rev-list --no-merges --count HEAD`
* [ ] `commitsUsed + massSkipped` is not larger than `commitsScanned`; merge commits are not in the log, so they are in none of these counts
* [ ] A second run with the same options and HEAD leaves `co-changes.json` byte-identical
* [ ] Setting `cochange.maxFilesPerCommit`, `cochange.minShared`, `cochange.include` and `cochange.exclude` in `.ctxo/config.yaml` changes the matrix (and `window`) accordingly; `exclude` also removes files added by `include`

Invalid input (against the built CLI):

```bash
node packages/cli/dist/index.js index --cochange-commits abc 2>&1; echo "Exit: $?"
node packages/cli/dist/index.js index --cochange-commits 0 2>&1; echo "Exit: $?"
node packages/cli/dist/index.js index --cochange-since 12 2>&1; echo "Exit: $?"
```

* [ ] The first two show `--cochange-commits requires a positive integer or "all"`, the third `--cochange-since requires a duration such as 30d, 2w, 12m or 1y`
* [ ] All three exit 1 and index nothing

***

## Step 3: `ctxo sync`

```bash
rm -rf .ctxo/.cache/
pnpm --filter @ctxo/cli exec tsx src/index.ts sync
```

**Verify:**

* [ ] `.ctxo/.cache/symbols.db` is recreated
* [ ] Output confirms sync completed
* [ ] No errors

### 3.1 Sync When Cache Already Exists

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts sync
```

**Verify:**

* [ ] Runs without error (overwrites existing cache)

***

## Step 4: `ctxo status`

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts status
```

**Verify:**

* [ ] Shows schema version
* [ ] Shows indexed file count matching Step 2
* [ ] Shows total symbols and edges (both > 0)
* [ ] Shows SQLite cache status (`present` or `missing`)
* [ ] Per-file listing with timestamps
* [ ] Orphaned files detected if any (should show `[orphaned]` badge)

### 4.1 Status Without Index

```bash
rm -rf .ctxo/index/
pnpm --filter @ctxo/cli exec tsx src/index.ts status 2>&1
```

**Verify:**

* [ ] Shows `No index found. Run "ctxo index" first.`

```bash
# Restore index for remaining steps
pnpm --filter @ctxo/cli exec tsx src/index.ts index
```

***

## Step 5: `ctxo verify-index`

### 5.1 Fresh Index

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts verify-index 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] Shows `Index is up to date`
* [ ] Exit code 0

### 5.2 Stale Index (Symbol Change)

> **Note:** `verify-index` rebuilds into a temp directory and compares extracted symbols/edges/intent.
> A `touch` or comment-only change will NOT be detected since symbols don't change.
> To trigger staleness, add/remove/rename an actual symbol (type, function, variable, etc.).

```bash
# Add a new exported type to create a symbol diff
echo 'export type VerifyTestDummy = { x: number };' >> packages/cli/src/core/types.ts
pnpm --filter @ctxo/cli exec tsx src/index.ts verify-index 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] Shows `STALE: packages/cli/src/core/types.ts`
* [ ] Exit code 1

```bash
# Restore
git checkout packages/cli/src/core/types.ts
```

### 5.3 Stale Index (mtime-only, via `index --check`)

> **Note:** `index --check` uses fast mtime + content-hash detection without rebuilding.

```bash
touch packages/cli/src/core/types.ts
pnpm --filter @ctxo/cli exec tsx src/index.ts index --check 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] Exit code 0 (hash matches - mtime-only change is not stale)
* [ ] No full rebuild triggered

***

## Step 6: `ctxo init`

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts init
```

**Verify (happy path — say yes to hooks):**

* [ ] Prompt message mentions architectural drift & boundary violation signals when describing hooks
* [ ] Creates the post-commit hook (or updates it) in the hooks directory `git rev-parse --git-path hooks` names (`.git/hooks`, or the directory `core.hooksPath` points at)
* [ ] Creates the post-merge hook (or updates it) in the same directory
* [ ] The post-commit block is `# ctxo-start v2` ... `# ctxo-end`, guarded by `[ -d .ctxo ]`, and runs `ctxo index --commit HEAD` once (not `--file`)
* [ ] Re-running `ctxo init` leaves the hook byte-identical; an old unversioned block is replaced in place and the lines around it are kept; duplicate ctxo blocks collapse into one
* [ ] With `core.hooksPath` in the **global** or **system** git config, init writes no hook, prints the two blocks to add by hand and continues (use a throwaway `GIT_CONFIG_GLOBAL` file; scope detection needs git 2.26+)
* [ ] `ctxo init --dry-run` names the resolved hooks directory (or says the shared directory is skipped)

**Verify (opt-out path — say no to hooks):**

* [ ] Init prints a `⚠` warning that drift + boundary signals depend on snapshot cadence
* [ ] Warning lists fallback options: `ctxo watch`, `ctxo index --commit HEAD` after commits (it states that `ctxo index --check` records no snapshot), re-run `ctxo init` later
* [ ] Setup still completes successfully (only hook step skipped)

```bash
cat .git/hooks/post-commit
cat .git/hooks/post-merge
```

***

## Step 7: `ctxo watch`

```bash
# Start watcher in background, wait 3 seconds, then kill
pnpm --filter @ctxo/cli exec tsx src/index.ts watch &
WATCH_PID=$!
sleep 3
kill $WATCH_PID 2>/dev/null
```

**Verify:**

* [ ] Shows `[ctxo] Watching for changes...` or similar
* [ ] No errors on startup
* [ ] Exits cleanly on kill

### 7.1 Watch community snapshot refresh (longer run)

```bash
# Start watcher, touch a source file, wait ~8 seconds for debounced snapshot
pnpm --filter @ctxo/cli exec tsx src/index.ts watch &
WATCH_PID=$!
sleep 2
touch packages/cli/src/core/types.ts
sleep 8
kill $WATCH_PID 2>/dev/null
```

**Verify:**

* [ ] Console shows `[ctxo] Community snapshot refreshed (modularity X.XXX)` after ~5 s debounce
* [ ] `.ctxo/index/communities.json` mtime is recent
* [ ] `communities.json` is rewritten; on the same commit no new file appears in `.ctxo/index/communities.history/` (watch replaces the current snapshot like any other run). After a new commit, the next watch snapshot archives the previous commit's snapshot (hook-less users get one snapshot per commit via watch)

***

## Step 8: `ctxo stats`

### Prerequisite

Stats requires MCP tool calls to have been recorded. For a clean test, we simulate events directly:

```bash
node -e "
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function seed() {
  const SQL = await initSqlJs();
  const dbPath = path.join('.ctxo', '.cache', 'symbols.db');
  const buf = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  const db = buf ? new SQL.Database(buf) : new SQL.Database();

  db.run(\`CREATE TABLE IF NOT EXISTS session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    tool TEXT NOT NULL,
    symbol_id TEXT,
    detail_level TEXT,
    response_tokens INTEGER,
    response_bytes INTEGER,
    latency_ms REAL,
    truncated BOOLEAN DEFAULT 0
  )\`);
  db.run('CREATE INDEX IF NOT EXISTS idx_session_timestamp ON session_events(timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_session_tool ON session_events(tool)');

  const tools = ['get_logic_slice','get_blast_radius','search_symbols','get_why_context','get_ranked_context'];
  const symbols = ['packages/cli/src/core/types.ts::SymbolNode::type','packages/cli/src/core/graph/symbol-graph.ts::SymbolGraph::class','packages/cli/src/adapters/storage/sqlite-storage-adapter.ts::SqliteStorageAdapter::class',null];
  const levels = ['L1','L2','L3','L4',null];

  for (let i = 0; i < 50; i++) {
    db.run('INSERT INTO session_events (tool, symbol_id, detail_level, response_tokens, response_bytes, latency_ms, truncated) VALUES (?,?,?,?,?,?,?)',
      [tools[i%5], symbols[i%4], levels[i%5], 200+i*10, 800+i*40, 5+Math.random()*20, 0]);
  }

  fs.mkdirSync(path.dirname(dbPath), {recursive:true});
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  console.log('Seeded 50 session events');
}
seed();
"
```

### 8.1 Default Output (All Time)

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats
```

**Verify:**

* [ ] Shows `Usage Summary (all time)`
* [ ] Shows `Total tool calls: 50`
* [ ] Shows `Total tokens served` with formatted number
* [ ] Shows `Top Tools` section with up to 5 tools
* [ ] Shows `Top Queried Symbols` section
* [ ] Shows `Detail Level Distribution` with bar charts (█░)
* [ ] Output goes to stderr

**Record output:**

| Metric | Value |
|--------|-------|
| Total calls | \_\_\_ |
| Total tokens | \_\_\_ |
| Top tool | \_\_\_ |
| Top symbol | \_\_\_ |

### 8.2 `--json` Flag

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats --json
```

**Verify:**

* [ ] Output is valid JSON on stdout
* [ ] Contains `timeRange.daysFilter: null`
* [ ] Contains `summary.totalCalls: 50`
* [ ] Contains `topTools` array (length <= 5)
* [ ] Contains `topSymbols` array with `symbolId` and `name`
* [ ] Contains `detailLevelDistribution` with `level`, `count`, `percentage`

```bash
# Validate JSON schema
pnpm --filter @ctxo/cli exec tsx src/index.ts stats --json | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const checks = [
  ['timeRange exists', !!d.timeRange],
  ['summary.totalCalls > 0', d.summary.totalCalls > 0],
  ['topTools is array', Array.isArray(d.topTools)],
  ['topTools[0] has tool,calls,avgTokens', d.topTools[0] && 'tool' in d.topTools[0] && 'calls' in d.topTools[0] && 'avgTokens' in d.topTools[0]],
  ['topSymbols is array', Array.isArray(d.topSymbols)],
  ['detailLevelDistribution is array', Array.isArray(d.detailLevelDistribution)],
  ['daysFilter is null', d.timeRange.daysFilter === null],
];
checks.forEach(([name,ok]) => console.log(ok ? 'PASS' : 'FAIL', name));
"
```

### 8.3 `--days N` Flag

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats --days 7
```

**Verify:**

* [ ] Shows `Usage Summary (last 7 days)`
* [ ] Shows data (events were just seeded, so they are within 7 days)

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats --days 7 --json | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('daysFilter:', d.timeRange.daysFilter === 7 ? 'PASS' : 'FAIL');
console.log('from is set:', d.timeRange.from !== null ? 'PASS' : 'FAIL');
"
```

### 8.4 `--days` Invalid Input

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats --days 0 2>&1; echo "Exit: $?"
pnpm --filter @ctxo/cli exec tsx src/index.ts stats --days -5 2>&1; echo "Exit: $?"
```

**Verify:**

* [ ] Both show `--days must be a positive integer`
* [ ] Both exit with code 1

### 8.5 `--clear` Flag

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats --clear
```

**Verify:**

* [ ] Shows `Session data cleared.`

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats
```

* [ ] Shows `No usage data yet. Start using Ctxo MCP tools to collect stats.`

### 8.6 Empty State (No DB)

```bash
rm -f .ctxo/.cache/symbols.db
pnpm --filter @ctxo/cli exec tsx src/index.ts stats
```

**Verify:**

* [ ] Shows `No usage data yet. Start using Ctxo MCP tools to collect stats.`
* [ ] No crash, no stack trace

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats --json
```

* [ ] Outputs valid JSON with `totalCalls: 0`

### 8.7 `stats.enabled: false` Config

```bash
echo -e "stats:\n  enabled: false" > .ctxo/config.yaml
pnpm --filter @ctxo/cli exec tsx src/index.ts stats
```

**Verify:**

* [ ] Shows `Stats collection is disabled in .ctxo/config.yaml`

```bash
# Clean up
rm -f .ctxo/config.yaml
```

### 8.8 Restore DB

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts sync
```

***

## Step 9: `ctxo doctor`

### 9.1 Default Output (Human-Readable)

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts doctor
```

**Expected:**
- Header: `ctxo doctor — Health Check`
- ≥10 check lines with `✓`, `⚠`, or `✗` icons
- `TsMorphCheck` title is now `TypeScript plugin (@ctxo/lang-typescript)`
- `TreeSitterCheck` title is now `Go / C# plugins (@ctxo/lang-go, @ctxo/lang-csharp)`
- Summary line: `N passed, N warnings, N failures`
- Exit code 0 if no failures: `echo $?` → `0`

### 9.2 JSON Output

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts doctor --json
```

**Expected:**
- Valid JSON on stdout
- `checks` array with objects containing `name`, `status`, `value`, `message`
- `summary` with `pass`, `warn`, `fail` counts
- `summary.pass + summary.warn + summary.fail === checks.length`
- `exitCode` field matching actual exit code

### 9.3 Quiet Output

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts doctor --quiet
```

**Expected:**
- Only WARN/FAIL lines shown (no PASS lines)
- Summary line still present
- No `ctxo doctor — Health Check` header

### 9.4 Doctor on Missing Index

```bash
rm -rf /tmp/ctxo-test-empty && mkdir /tmp/ctxo-test-empty && cd /tmp/ctxo-test-empty
pnpm --filter @ctxo/cli exec tsx /path/to/ctxo/packages/cli/src/index.ts doctor --json 2>/dev/null
```

**Expected:**
- Multiple checks with `"status": "fail"` (index_directory, index_freshness, etc.)
- `exitCode: 1`

### 9.5 Exit Code Verification

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts doctor; echo "Exit: $?"
```

**Expected:**
- Exit 0 if all checks pass/warn
- Exit 1 if any check fails

***

### 9.6 `git_hooks` Check and `--fix`

> Use a scratch clone with a repository-local hooks directory. Never run `doctor --fix` where `core.hooksPath` is shared by other repositories.

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts doctor --json | jq '.checks[] | select(.name == "git_hooks")'
```

**Verify:**

* [ ] With the v2 block installed: `pass` ("ctxo post-commit hook v2")
* [ ] With no ctxo block, a v1 (unversioned) block, or more than one ctxo block: `warn`, and the fix text names `ctxo doctor --fix`
* [ ] `ctxo doctor --fix --dry-run` lists the hooks step and leaves the hook untouched; `ctxo doctor --fix --yes` upgrades it to v2 in place and the check passes
* [ ] With a global or system `core.hooksPath` and no current block (missing, outdated or duplicated): `warn` ("Shared hooks directory ... ctxo does not write there"), and `--fix` reports the hooks step as skipped, not failed, with the hook files untouched
* [ ] With a global or system `core.hooksPath` that already holds exactly one current (v2) block added by hand: `pass`
* [ ] Outside a git repository the check passes ("Not a git repository"); `git_repo` carries the failure

***

## Step 10: Cross-Command Integration

### 10.1 Index → Status → Verify Round-trip

> Assumes the index from Step 2.1 is still fresh — no rebuild here. Just confirm staleness remains false via `--check` and inspect the round-trip.

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts index --check 2>&1; echo "Exit: $?"
pnpm --filter @ctxo/cli exec tsx src/index.ts status 2>&1 | head -6
```

**Verify:**

* [ ] `--check` exits 0 (index fresh) → status shows matching count from Step 2.1

### 10.2 Index → Sync → Status Round-trip

```bash
rm -rf .ctxo/.cache/
pnpm --filter @ctxo/cli exec tsx src/index.ts sync
pnpm --filter @ctxo/cli exec tsx src/index.ts status 2>&1 | grep "SQLite cache"
```

**Verify:**

* [ ] After sync, status shows `SQLite cache: present`

### 10.3 Stats Recording via MCP

After running MCP validation (see [MCP Validation Runbook](../mcp-validation/mcp-validation.md)), verify that stats were recorded:

```bash
pnpm --filter @ctxo/cli exec tsx src/index.ts stats
```

**Verify:**

* [ ] `Total tool calls` > 0 (MCP calls were recorded)
* [ ] `Top Tools` includes tools used during MCP validation
* [ ] Recording happened automatically — no extra configuration needed

***

## Step 11: Run CLI Unit Tests

> **Note:** `pnpm --filter @ctxo/cli exec` runs with `cwd = packages/cli/`, so test paths
> are relative to that cwd — NOT the repo root. Use `src/...`, not `packages/cli/src/...`.

```bash
pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/ 2>&1 | tail -5
```

**Verify:**

* [ ] All CLI tests pass (including stats-command tests)
* [ ] No failures or errors

```bash
pnpm --filter @ctxo/cli exec vitest run src/adapters/stats/__tests__/ 2>&1 | tail -5
```

**Verify:**

* [ ] All stats adapter tests pass (session-recorder-adapter + with-recording)

***

## Summary Checklist

| # | Command | Tested | Pass |
|---|---------|--------|------|
| 1 | `ctxo --help` | Help output, subcommand --help runs nothing, unknown command | [ ] |
| 2 | `ctxo index` | Full, --check, --skip-history, --max-history, --files/--file, --commit, snapshot per commit, co-change window, invalid input | [ ] |
| 3 | `ctxo sync` | Fresh sync, re-sync | [ ] |
| 4 | `ctxo status` | Normal, without index | [ ] |
| 5 | `ctxo verify-index` | Fresh, stale | [ ] |
| 6 | `ctxo init` | Hook creation, v2 block, in-place upgrade, shared hooks directory | [ ] |
| 7 | `ctxo watch` | Startup, clean exit | [ ] |
| 8 | `ctxo stats` | Default, --json, --days, --clear, empty, disabled | [ ] |
| 9 | `ctxo doctor` | Default, --json, --quiet, missing index, exit codes, git_hooks check and --fix | [ ] |
| 10 | Cross-command | Index→Status→Verify, Index→Sync→Status, MCP→Stats | [ ] |
| 11 | Unit tests | CLI + stats + diagnostics adapter tests | [ ] |

**Total checks: 59** (plus the checks added for #157 in Steps 1.1b, 2.5, 2.5b, 2.7, 2.9, 6 and 9.6)

***

## Step 12: Generate Validation Report

After completing all steps, create a validation result file to record outcomes.

```bash
# Create the report file
cat > docs/runbook/cli-validation/validation-result-vN.md <<'TEMPLATE'
# CLI Validation Result — vN

> **Date:** YYYY-MM-DD
> **Ctxo Version:** v0.7.0-alpha.0
> **Platform:** (OS and shell)
> **Node.js:** (version)
> **Result:** **X/54 PASS, Y FAIL, Z NUANCE**

(Fill in each step's results below, using [x] for pass and [ ] for fail)
TEMPLATE
```

**Instructions:**

1. Copy the Summary Checklist above into the report, marking each step as `[x]` (pass) or `[ ]` (fail)
2. For each step, record the actual command output (key lines only — not full file listings)
3. Note any nuances or unexpected behaviors with explanation
4. Record key metrics:

| Metric | Value |
|--------|-------|
| Indexed files | \_\_\_ |
| Total symbols | \_\_\_ |
| Total edges | \_\_\_ |
| Index build time | \_\_\_ |
| CLI tests passed | \_\_\_ |
| Stats tests passed | \_\_\_ |

5. Save as `validation-result-vN.md` where N is the next sequential version number
6. Reference the [latest validation result](validation-result-v1.md) for format example

**Naming convention:** `validation-result-v1.md`, `validation-result-v2.md`, etc.
