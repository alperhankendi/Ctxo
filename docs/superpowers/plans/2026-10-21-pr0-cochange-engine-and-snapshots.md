# PR 0: Co-change Engine, Incremental Indexing and Snapshot Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make co-change data correct, deep and durable, keep one community snapshot per commit with distinct-commit confidence, and let blast radius and the safe-edit gate use co-change (#157 and Phase 0 of #156).

**Architecture:**
- One git pass (`git log --no-merges -M --name-status`) feeds both per-file `intent[]` and a new pure co-change builder with its own window, so incremental runs recompute the whole matrix from git instead of from the re-indexed files.
- Incremental runs (`--files`, `--commit`) merge with the committed index for everything global (registry, communities, artifacts, SQLite).
- The snapshot writer replaces same-commit snapshots, detectors count distinct commits, and one validated co-change reader feeds every blast-radius caller.

**Tech Stack:** TypeScript (ESM, Node >= 20), simple-git, zod, vitest, pnpm workspace (`packages/cli`).

**Spec:** `docs/superpowers/specs/2026-10-20-domain-knowledge-layer-design.md`, sections 4, 6, 13 and 14 (owner decisions K5, K9, K14, K16).

## Global Constraints

- Work in a git worktree branched from `master` HEAD (created with superpowers:using-git-worktrees). Never touch the staged release files on the main checkout: `.changeset/config.json`, `.changeset/minor-all-packages-2026-10-20.md` and the `packages/lang-*/package.json` peer-range edits.
- Hexagonal rules: `core/` never imports from `adapters/` or `ports/`; `ports/` never imports from `adapters/`; no barrel exports; every adapter implements a port.
- No `console.log` (eslint bans it). CLI human output goes to `console.error`, JSON to `process.stdout.write`, library logs through `createLogger('ctxo:<ns>')`. Adapters warn and continue.
- Tests are co-located in `__tests__/` next to the source; vitest; git-based tests create temp repos with `mkdtempSync(join(tmpdir(), 'ctxo-...'))`, and every git operation that creates commits there (commit, merge, rebase, cherry-pick, amend, revert, tag) passes `-c commit.gpgsign=false -c user.name=Test -c user.email=test@test.com`, plus `-c tag.gpgsign=false` for tags.
- Determinism:
  - Sort with codepoint comparison (`a < b ? -1 : a > b ? 1 : 0`), never `localeCompare`.
  - Analysis results never depend on the wall clock; the co-change window is anchored to HEAD's committer date.
  - Artifacts are rewritten only when their content (ignoring `timestamp`) changed.
- Co-change defaults (spec 6.2, 6.6, K5): `maxCommits: 2000` (or `'all'`), optional `since` (`<n>d|w|m|y`, anchored to HEAD's committer date), `maxFilesPerCommit: 30` (counted after filtering), `minShared: 2`, `include: []`, `exclude: []`, `MIN_FREQUENCY = 0.1`, `frequency = round(shared / min(countA, countB), 3)`.
- Confidence thresholds (spec 6.4): fewer than 3 distinct commits low, 3 to 6 medium, 7 or more high; boundary confidence needs at least 2 distinct commits.
- Blast-radius co-change rule (spec 6.5): a `potential` dependent becomes `likely` when its file co-changes with the root symbol's file at `frequency > 0.5`. `coChangedFiles`: top 10 files with `frequency >= 0.5` and no graph path; informational only.
- Before editing an existing symbol, call `get_blast_radius` and `get_why_context` on it (project rule in CLAUDE.md; the safe-edit guard enforces high-impact ones). The session's ctxo MCP server indexes the main checkout (older code), so `found: false` from either tool for a symbol added on this branch is expected: call the tools as the project rule asks, then proceed.
- Repo text in English, no em dashes, no `Co-Authored-By` lines. No push, PR or publish without the owner's approval.
- Privacy: nothing from the private fixture goes into the repo, tests, docs, commits or PR text; only aggregate numbers.

## Review Focus

1. **Paths with spaces and non-ASCII characters** (for example `src/ödünç kaydı.ts`): git quotes and octal-escapes them by default, so they would silently fall out of co-change and `--commit`. Expected: they are analysed and re-indexed like any other path. Test owned by Task 1.
2. **Git unavailable, no HEAD yet, or a shallow clone:** today a failing git call yields an empty map and the empty matrix is still written. Expected: indexing completes, the existing `co-changes.json` is left untouched, and a shallow clone produces a smaller but valid window. Tests owned by Tasks 1 and 4.
3. **The hook running on a root commit or on a merge commit:** expected no crash; the root commit's files are indexed; a merge commit re-indexes nothing but still refreshes co-change and the snapshot. Test owned by Task 5.
4. **Upgrading an existing install:** an old hook block with user lines around it, and a history folder full of same-SHA duplicates. Expected: the block is replaced in place with user lines preserved, and history reads as one entry per commit without a migration. Tests owned by Tasks 6 and 9.
5. **Windows output:** CRLF line endings and backslashes in git output, and case-only renames. Expected: paths normalised to forward slashes, parsing independent of line endings. Test owned by Task 1 (run on Windows locally; CI covers Linux).

---

### Task 0: Branch setup

- [ ] **Step 1:** Create the worktree with superpowers:using-git-worktrees (branch `feat/cochange-engine-157`, base `master` HEAD).
- [ ] **Step 2:** In the worktree, add the design docs that live under the gitignored `docs/superpowers/`: `git add -f docs/superpowers/specs/2026-10-20-domain-knowledge-layer-design.md docs/superpowers/plans/2026-10-21-pr0-cochange-engine-and-snapshots.md` (copy them from the main checkout first if the worktree lacks them).
- [ ] **Step 3:** Commit: `git commit -m "docs: add domain knowledge layer design spec and PR 0 plan"`.
- [ ] **Step 4:** Run `pnpm install --frozen-lockfile && pnpm -r build` in the worktree. Expected: success (the node_modules in the main checkout are known to be out of date).

---

### Task 1: Change log from git (port + adapter)

**Files:**
- Modify: `packages/cli/src/core/types.ts` (next to `CommitRecord`, line ~219)
- Modify: `packages/cli/src/ports/i-git-port.ts`
- Modify: `packages/cli/src/adapters/git/simple-git-adapter.ts`
- Test: `packages/cli/src/adapters/git/__tests__/simple-git-adapter.change-log.test.ts`

**Interfaces:**
- Produces (types in `core/types.ts`):
  ```ts
  export type FileChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  export interface FileChange { readonly status: FileChangeStatus; readonly path: string; readonly oldPath?: string }
  export interface CommitChangeSet {
    readonly hash: string; readonly message: string; readonly date: string;   // %s, %aI
    readonly author: string; readonly committedAt: number;                     // %an, %ct (unix s)
    readonly changes: readonly FileChange[];
  }
  export interface ChangeLog { readonly head: string; readonly headCommittedAt: number; readonly commits: readonly CommitChangeSet[] }
  ```
- Produces (port, both optional like the existing optional methods):
  - `getChangeLog?(maxCommits: number | 'all'): Promise<ChangeLog | undefined>`: non-merge commits reachable from HEAD, newest first. `head` is the short SHA of HEAD and `headCommittedAt` its committer date, even when HEAD is a merge commit. Returns `undefined` when git fails or there is no HEAD.
  - `getCommitFileChanges?(rev: string): Promise<FileChange[] | undefined>`: changes introduced by one commit (root commits included); `undefined` on failure.

- [ ] **Step 1: Write the failing tests** in the new test file, with a temp repo builder that commits files in sequence:
  - `getChangeLog returns non-merge commits newest first with name-status changes`: three commits, then a merge commit from a side branch. Expect three entries, no merge entry, `commits[0].hash` equal to the third commit, `changes` statuses `A`/`M`.
  - `getChangeLog reports renames with oldPath`: commit `src/a.ts`, then `git mv src/a.ts src/b.ts` and commit. Expect `{ status: 'R', path: 'src/b.ts', oldPath: 'src/a.ts' }`.
  - `getChangeLog keeps paths with spaces and non-ASCII characters intact`: commit `src/ödünç kaydı.ts`. Expect `changes[0].path === 'src/ödünç kaydı.ts'` (Review Focus 1).
  - `getChangeLog honours maxCommits and anchors head to HEAD even when HEAD is a merge`: `maxCommits = 2` gives 2 commits; `head` equals `git rev-parse --short HEAD` of the merge commit.
  - `getChangeLog returns undefined in a repo with no commits`.
  - `getChangeLog handles a case-only rename and returns forward-slash paths` (Review Focus 5): rename `src/Foo.ts` to `src/foo.ts` through a temporary name (`git mv src/Foo.ts src/tmp.ts`, commit, `git mv src/tmp.ts src/foo.ts`, commit). Expect `R` entries ending at `src/foo.ts`, and no path contains `\`.
  - `getCommitFileChanges lists the files of a root commit and of a later commit, including deletions and renames`.
  - `getCommitFileChanges returns an empty list for a merge commit`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/adapters/git/__tests__/simple-git-adapter.change-log.test.ts`. Expected: FAIL (`getChangeLog is not a function`).
- [ ] **Step 3: Implement both methods in `SimpleGitAdapter`.**
  - `getChangeLog`: use `this.git.raw` with `-c core.quotepath=off log --no-merges -M --name-status -z --format=%x1e%H%x1f%aI%x1f%ct%x1f%an%x1f%s [--max-count=N] HEAD`. Split records on `\x1e`. Inside a record, split the NUL-separated name-status tokens: a status token, then the path, or for `R`/`C` an old path and then a new path. Strip the similarity score from `R100`.
  - Read the head with `log -1 --format=%h%x1f%ct HEAD`.
  - Normalise `\` to `/` and tolerate `\r`.
  - `getCommitFileChanges`: `-c core.quotepath=off diff-tree --root --no-commit-id -r -M --name-status -z <rev>`.
- [ ] **Step 4: Run the tests.** Expected: PASS. Also run `pnpm --filter @ctxo/cli exec vitest run src/adapters/git`. Expected: existing adapter tests still pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(git): add change log and commit file changes to the git port"`

---

### Task 2: Canonical history and intent (pure core)

**Files:**
- Create: `packages/cli/src/core/history/change-log.ts`
- Create: `packages/cli/src/core/history/intent-history.ts`
- Test: `packages/cli/src/core/history/__tests__/change-log.test.ts`, `packages/cli/src/core/history/__tests__/intent-history.test.ts`

**Interfaces:**
- Consumes: `CommitChangeSet`, `CommitRecord` (Task 1, existing).
- Produces:
  - `export interface CanonicalCommit { readonly hash: string; readonly message: string; readonly date: string; readonly author: string; readonly committedAt: number; readonly files: readonly string[] }`, where `files` is sorted and de-duplicated.
  - `export function canonicalizeChangeLog(commits: readonly CommitChangeSet[]): CanonicalCommit[]`: walks newest first with a rename map, so every path maps to its newest name (same rule as the oracle: on `R old -> new`, `canon[old] = canon[new] ?? new`). Deleted paths keep their name; the caller filters them.
  - `export function buildIntentHistory(commits: readonly CanonicalCommit[], maxPerFile: number): Map<string, CommitRecord[]>`: per canonical file, the newest `maxPerFile` commits.

- [ ] **Step 1: Write the failing tests.**
  - `canonicalizeChangeLog maps an old path to its newest name across a chain of renames`: changes newest first `R b->c`, `R a->b`, `M a`. Expect files `['c']` for all three commits.
  - `canonicalizeChangeLog keeps a deleted file under its own name`.
  - `canonicalizeChangeLog sorts and de-duplicates files within a commit`.
  - `buildIntentHistory keeps the newest maxPerFile commits per canonical file`: maxPerFile 2, three commits touching `c`. Expect two records, newest first, with `hash`/`message`/`date`/`author`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/history`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the two modules** (pure, no imports from `adapters/` or `ports/`).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): canonical change log and rename-aware intent history"`

---

### Task 3: Co-change builder, window and config

**Files:**
- Modify: `packages/cli/src/core/co-change/co-change-analyzer.ts` (replace `aggregateCoChanges`; keep `loadCoChangeMap`)
- Create: `packages/cli/src/core/co-change/co-change-window.ts`
- Modify: `packages/cli/src/core/types.ts` (`CoChangeMatrix`, new `CoChangeWindowMeta`, new zod `CoChangeMatrixSchema`)
- Modify: `packages/cli/src/core/config/config-schema.ts`, `packages/cli/src/core/config/load-config.ts`
- Test: `packages/cli/src/core/co-change/__tests__/co-change-analyzer.test.ts` (rewrite), `packages/cli/src/core/co-change/__tests__/co-change-window.test.ts`, `packages/cli/src/core/config/__tests__/cochange-config.test.ts`

**Interfaces:**
- Consumes: `CanonicalCommit` (Task 2).
- Produces:
  ```ts
  // core/types.ts
  export interface CoChangeWindowMeta {
    readonly maxCommits: number | 'all'; readonly since?: string; readonly head: string;
    readonly commitsScanned: number; readonly commitsUsed: number; readonly massSkipped: number;
    readonly maxFilesPerCommit: number; readonly minShared: number;
  }
  export interface CoChangeMatrix { readonly version: 1; readonly timestamp: number; readonly window?: CoChangeWindowMeta; readonly entries: readonly CoChangeEntry[] }
  export const CoChangeMatrixSchema;   // zod, entries required, window optional

  // core/co-change/co-change-window.ts
  export interface CoChangeSince { readonly amount: number; readonly unit: 'd' | 'w' | 'm' | 'y' }
  export function parseCoChangeSince(value: string): CoChangeSince | undefined;          // /^(\d+)([dwmy])$/
  export function sinceCutoff(headCommittedAt: number, since: CoChangeSince): number;    // UTC calendar math, unix s
  export function selectWindow(commits: readonly CanonicalCommit[], maxCommits: number | 'all', cutoff?: number): CanonicalCommit[];

  // core/co-change/co-change-analyzer.ts
  export interface CoChangeBuildOptions {
    readonly isIncluded: (path: string) => boolean;
    readonly maxCommits: number | 'all'; readonly since?: string; readonly head: string;
    readonly maxFilesPerCommit: number; readonly minShared: number; readonly timestamp: number;
  }
  // windowed = output of selectWindow; window.commitsScanned = windowed.length
  export function buildCoChangeMatrix(windowed: readonly CanonicalCommit[], options: CoChangeBuildOptions): CoChangeMatrix;

  // core/config/load-config.ts
  export interface ResolvedCoChangeConfig {
    readonly maxCommits: number | 'all'; readonly since?: string; readonly maxFilesPerCommit: number;
    readonly minShared: number; readonly include: readonly string[]; readonly exclude: readonly string[];
  }
  export function resolveCoChangeConfig(config: CtxoConfig, overrides?: { maxCommits?: number | 'all'; since?: string }): ResolvedCoChangeConfig;
  ```

- [ ] **Step 1: Write the failing tests.**
  - `buildCoChangeMatrix counts shared commits only among included files`: two commits each touching `a.ts`, `b.ts`, `README.md`, with `isIncluded` excluding `.md`. Expect one entry `{ file1: 'a.ts', file2: 'b.ts', sharedCommits: 2, frequency: 1 }`.
  - `buildCoChangeMatrix skips commits above maxFilesPerCommit after filtering and counts them as massSkipped`: maxFilesPerCommit 2; a commit with 3 included files plus 10 excluded files. Expect `window.massSkipped === 1`, and the 10 excluded files must not count toward the threshold.
  - `buildCoChangeMatrix ignores commits with no included file and reports commitsUsed`.
  - `buildCoChangeMatrix drops pairs below minShared and below frequency 0.1`.
  - `buildCoChangeMatrix sorts by frequency desc, shared desc, file1, file2 with codepoint order`.
  - `buildCoChangeMatrix is deterministic`: same input twice gives `JSON.stringify`-equal output.
  - `parseCoChangeSince accepts 30d, 2w, 12m, 1y and rejects 12, 12h, -3m`.
  - `sinceCutoff subtracts calendar months from the HEAD date in UTC`: HEAD `2026-03-31T10:00:00Z`, `1m`, expected cutoff `2026-02-28T10:00:00Z` (clamped day).
  - `selectWindow applies maxCommits first, then the since cutoff`.
  - `resolveCoChangeConfig applies defaults 2000/30/2 and CLI overrides win`; `rejects an invalid since through the schema`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/co-change src/core/config`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `CoChangeConfigSchema` to `config-schema.ts` as a `.strict()` object: `maxCommits` (positive int or literal `'all'`), `since` (string matching the regex), `maxFilesPerCommit` (int >= 1), `minShared` (int >= 1), `include` and `exclude` (string arrays).
  - Add `cochange` to `CtxoConfigSchema` and `DEFAULT_CONFIG`.
  - Validate the globs in `load-config.ts` the way `index.ignore` is validated.
  - Delete `aggregateCoChanges` and its old tests.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then `pnpm --filter @ctxo/cli typecheck`. Expected: only the `index-command.ts` import of `aggregateCoChanges` fails (fixed in Task 4).
- [ ] **Step 5: Commit.** `git commit -m "feat(core): windowed co-change builder and cochange config"`

---

### Task 4: Full `ctxo index` uses the change log

**Files:**
- Modify: `packages/cli/src/cli/index-command.ts` (Phase 2 lines 254-269, Phase 2b lines 271-277, `run` options lines 109-117)
- Modify: `packages/cli/src/adapters/storage/json-index-writer.ts` (`writeCoChanges`)
- Modify: `packages/cli/src/adapters/git/simple-git-adapter.ts` and `packages/cli/src/ports/i-git-port.ts` (remove `getBatchHistory` once unused)
- Modify: `packages/cli/src/cli/cli-router.ts` (index flags lines 89-117, `printHelp` lines 292-335)
- Test: `packages/cli/src/cli/__tests__/index-command.cochange.test.ts`, `packages/cli/src/adapters/storage/__tests__/json-index-writer.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces:
  - `JsonIndexWriter.writeCoChanges(matrix: CoChangeMatrix): boolean`: returns false and does not touch the file when the existing file has the same `window` and `entries`.
  - `IndexCommand.run` options gain `cochangeCommits?: number | 'all'` and `cochangeSince?: string`.

- [ ] **Step 1: Write the failing tests** (temp project with the existing `fixtures/sample-project`, then extra commits that touch files together):
  - `full index writes co-changes.json with window metadata`: after three commits that each modify `src/greet.ts` and `src/types.ts`, expect an entry for that pair with `sharedCommits >= 2`, and `window.head` equal to HEAD.
  - `the window is independent of --max-history`: `maxHistory: 1` still yields `sharedCommits >= 2`.
  - `cochange.exclude removes files from the matrix and cochange.include adds non-indexed tracked files`.
  - `intent[] follows renames`: rename `src/greet.ts` to `src/hello.ts` and commit. Expect `hello.ts.json` intent to include the pre-rename commits.
  - `a failing change log leaves an existing co-changes.json untouched` (Review Focus 2): stub `SimpleGitAdapter.prototype.getChangeLog` to resolve `undefined` with `vi.spyOn`; the file bytes are unchanged afterwards.
  - `a shallow clone indexes with a smaller but valid window` (Review Focus 2): `git clone --depth 1 file://<temp repo>`; index the clone. Expect `window.commitsScanned === 1` and no error.
  - `writeCoChanges returns false and keeps the file when only the timestamp differs` (writer test).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/index-command.cochange.test.ts src/adapters/storage/__tests__/json-index-writer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Phase 2: fetch `getChangeLog(max(cochange window commits, maxHistory * 50))` (`'all'` when the co-change window is `'all'`), canonicalize once, and fill `intent`/`antiPatterns` from `buildIntentHistory(canonical, maxHistory)`. When the log is `undefined`, keep the old behaviour of empty intent and skip co-change writing.
  - Phase 2b:
    - The included set is the files of the merged full index (`buildGraphInputIndices`), minus `exclude`, plus tracked files matching `include` (from `git ls-files`).
    - Cutoff comes from `parseCoChangeSince` and `sinceCutoff(log.headCommittedAt, ...)`.
    - Call `selectWindow`, then `buildCoChangeMatrix`, then `writeCoChanges`.
    - Log `Co-change: N pairs from U commits (S mass commits skipped, window W)`.
  - Router:
    - Parse `--cochange-commits <n|all>` and `--cochange-since <dur>`; exit 1 with a message on invalid values.
    - Add both to `printHelp`, and update the `ctxo index` help line ("--max-history N controls intent depth only").
  - Remove `getBatchHistory` from port and adapter, and migrate its tests.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: all pass (fix any test that relied on `aggregateCoChanges` or `getBatchHistory`).
- [ ] **Step 5: Commit.** `git commit -m "feat(index): co-change from one git pass with its own window (#157)"`

---

### Task 5: Incremental indexing with `--files` and `--commit`

**Files:**
- Modify: `packages/cli/src/cli/index-command.ts` (file discovery lines 144-159, registry before Phase 1b, Phase 3 lines 317-337, Phase 2d call line 345, `safeHeadSha` lines 789-802, `buildGraphInputIndices`)
- Modify: `packages/cli/src/cli/cli-router.ts`
- Test: `packages/cli/src/cli/__tests__/index-command.incremental.test.ts`

**Interfaces:**
- Consumes: `getCommitFileChanges` (Task 1), Task 4 pipeline.
- Produces: `IndexCommand.run` options gain `files?: string[]` and `commit?: string`; `file?: string` maps to `files: [file]`.

- [ ] **Step 1: Write the failing tests.**
  - `--files keeps every co-change entry`: run a full index first, then `run({ files: ['src/types.ts'] })`. Expect `co-changes.json` entries equal to the full run's for the same HEAD (#157 acceptance).
  - `--files keeps SQLite complete`: after the incremental run, `SqliteStorageAdapter` (read-only open) lists every indexed file, not just one.
  - `--files resolves edges against the committed registry`: re-index a file that calls a symbol defined in another file. Expect the edge kind to equal the full run's.
  - `--commit HEAD re-indexes changed files, removes deleted ones and follows a rename`: commit a modification, a deletion and a `git mv`. Expect the modified JSON refreshed, the deleted JSON gone, the old rename path gone and the new one present.
  - `--commit HEAD on a root commit indexes its files; on a merge commit re-indexes nothing but refreshes co-change and the snapshot` (Review Focus 3).
  - `boundary-violations.json is computed from the full graph on an incremental run`: its violation count equals the full run's for the same HEAD.
  - `snapshot commitSha is the real short HEAD`: equals `git rev-parse --short HEAD` (the `safeHeadSha` fix).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/index-command.incremental.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Discovery:** `files` are paths relative to the project root; `commit` comes from `getCommitFileChanges(rev)`. Keep only paths with a registered adapter. Collect deletions: `D` paths and the `oldPath` of renames.
  - **Registry before Phase 1b:** for incremental runs, seed `symbolRegistry` with the symbols of every committed index from `JsonIndexReader.readAll()` (minus files being re-indexed or deleted).
  - **Phase 3:**
    - `writer.delete` for deletions.
    - Write the pending JSON.
    - Rebuild SQLite from the merged full index: `initEmpty()` + `bulkWrite(merged)`. Never use `init()`, which re-inserts without clearing.
  - **Phase 2d:** pass the merged full index instead of the pending list.
  - **`safeHeadSha`:** make it async and await `gitAdapter.getHeadSha()`. Fall back to `execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.projectRoot })`.
  - **Router:**
    - `--files <path...>` takes values until the next `--flag`; `--commit <rev>` takes one.
    - `--file <path>` stays as an alias; error when a flag has no value.
    - Add both to `printHelp`.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: all pass, including the existing `--file` community test in `index-command.test.ts`.
- [ ] **Step 5: Commit.** `git commit -m "feat(index): --files and --commit incremental runs that merge with the committed index"`

---

### Task 6: One snapshot per commit

**Files:**
- Modify: `packages/cli/src/adapters/storage/community-snapshot-writer.ts` (`writeSnapshot` lines 54-84, `listHistory` lines 92-109)
- Test: `packages/cli/src/adapters/storage/__tests__/community-snapshot-writer.test.ts`

**Interfaces:**
- Produces: unchanged signatures. Two behaviour changes:
  - `writeSnapshot` overwrites current without archiving when the existing current snapshot has the same `commitSha`.
  - `listHistory` returns at most one snapshot per `commitSha` (the newest file wins), newest first.

- [ ] **Step 1: Write the failing tests.**
  - `writing twice for the same commit replaces current and archives nothing`.
  - `a new commit after same-commit rewrites archives exactly one entry for the old commit`.
  - `listHistory collapses legacy duplicates to one entry per commitSha` (Review Focus 4): pre-seed the history directory with three files for `sha1` and one for `sha2`. Expect `['sha2', 'sha1']` with the newest `sha1` content.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/adapters/storage/__tests__/community-snapshot-writer.test.ts`. Expected: the new tests FAIL; existing ones pass.
- [ ] **Step 3: Implement** the two behaviours. Rotation stays by file count, applied after de-duplication.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "fix(snapshots): keep one community snapshot per commit (#157 comment)"`

---

### Task 7: Confidence by distinct commits

**Files:**
- Modify: `packages/cli/src/core/overlay/drift-detector.ts` (`detect` lines 50-66, `confidenceFor`, `hintFor` lines 214-223)
- Modify: `packages/cli/src/core/overlay/boundary-violation-detector.ts` (lines 15-25, `confidenceFor`, `hintFor` lines 123-132)
- Modify: `packages/cli/src/core/types.ts` (`DriftEventsArtifact`, `BoundaryViolationsArtifact`)
- Modify: `packages/cli/src/cli/index-command.ts` (`writeArchitectureArtifacts` lines 736-753)
- Modify: `packages/cli/src/adapters/mcp/get-why-context.ts` (the `driftSignals` section)
- Modify: `packages/cli/src/adapters/mcp/get-pr-impact.ts` (the `boundaryViolations` section)
- Test: `packages/cli/src/core/overlay/__tests__/drift-detector.test.ts`, `packages/cli/src/core/overlay/__tests__/boundary-violation-detector.test.ts`, `packages/cli/src/adapters/mcp/__tests__/get-why-context.test.ts`, `packages/cli/src/adapters/mcp/__tests__/get-pr-impact.test.ts`

**Interfaces:**
- Produces:
  - `DriftDetectionResult` and `BoundaryViolationDetectionResult` gain `readonly distinctCommits: number`; both artifacts gain `distinctCommits`.
  - `get_why_context` `driftSignals` and `get_pr_impact` `boundaryViolations` copy `distinctCommits` from the detector result, next to `snapshotsAvailable` (spec 6.4: the tools expose the count the confidence is based on).
  - A pure helper `export function distinctCommitCount(history: readonly CommunitySnapshot[], currentSha?: string): number` in a new `packages/cli/src/core/overlay/snapshot-history.ts` (counts SHAs other than `currentSha`).
  - In drift, `previous` is the newest history entry whose `commitSha` differs from `current.commitSha`.

- [ ] **Step 1: Update the test helpers and write the failing tests.**
  - Change `snapshot()` in both test files so every call without an explicit `commitSha` gets a unique one (counter). Existing assertions then keep their meaning.
  - New tests:
    - `confidence is low when ten history snapshots share three commits` (drift): `distinctCommits === 3`, confidence `medium`.
    - `drift skips history entries from the current commit when choosing the previous snapshot`.
    - `boundary confidence counts distinct commits`.
    - `hints no longer mention ctxo index --check`.
    - `get_why_context driftSignals carries distinctCommits` (in `get-why-context.test.ts`, next to the existing `driftSignals` test): a current snapshot `abc1234` and history of three snapshots, two for `sha1` and one for `sha2`. Expect `payload.driftSignals.distinctCommits === 2` and `payload.driftSignals.snapshotsAvailable === 3`.
    - `get_pr_impact boundaryViolations carries distinctCommits` (in `get-pr-impact.test.ts`, next to the existing `boundaryViolations` test): the same history. Expect `payload.boundaryViolations.distinctCommits === 2` and `payload.boundaryViolations.snapshotsAvailable === 3`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/overlay src/adapters/mcp/__tests__/get-why-context.test.ts src/adapters/mcp/__tests__/get-pr-impact.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Confidence uses `distinctCommits` with the thresholds from Global Constraints; `snapshotsAvailable` stays.
  - New hint text, both detectors: "Install the post-commit hook (`ctxo init`) or run `ctxo index` after commits to build history; `ctxo index --check` does not record snapshots."
  - Write `distinctCommits` into both artifacts.
  - Surface it in the tools: in `get-why-context.ts` add `distinctCommits: drift.distinctCommits` to the `driftSignals` object, and in `get-pr-impact.ts` add `distinctCommits: violationResult.distinctCommits` to `boundarySection` (additive field; the other keys stay). Before editing, run `get_blast_radius` and `get_why_context` on `handleGetWhyContext` and `handleGetPrImpact`.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: all pass (the two tools gain only the additive `distinctCommits` field).
- [ ] **Step 5: Commit.** `git commit -m "fix(overlay): drift and boundary confidence count distinct commits"`

---

### Task 8: Every blast-radius caller uses co-change

**Files:**
- Create: `packages/cli/src/adapters/storage/co-change-reader.ts` (+ `packages/cli/src/ports/i-co-change-port.ts` with `ICoChangePort { readCoChangeMap(): Map<string, CoChangeEntry[]> | undefined }`, implemented by a `CoChangeReader` class)
- Create: `packages/cli/src/core/blast-radius/co-changed-files.ts`
- Modify:
  - `packages/cli/src/adapters/mcp/get-blast-radius.ts` (line 83 and body)
  - `packages/cli/src/adapters/mcp/get-pr-impact.ts` (delete `loadCoChanges`, lines 23-32)
  - `packages/cli/src/core/context-assembly/context-assembler.ts` (`assembleForTask`, line 50)
  - `packages/cli/src/adapters/mcp/get-context-for-task.ts`
  - `packages/cli/src/cli/blast-radius-command.ts`, `packages/cli/src/cli/gate-hook-command.ts` (line 74), `packages/cli/src/cli/gate-command.ts` (line 32)
  - `packages/cli/src/index.ts` (get_blast_radius description, wiring)
- Test:
  - `packages/cli/src/adapters/storage/__tests__/co-change-reader.test.ts`
  - `packages/cli/src/core/blast-radius/__tests__/co-changed-files.test.ts`
  - Additions to the existing tests of `get-blast-radius`, `blast-radius-command`, `gate-hook-command`, `gate-command`, `context-assembler`.

**Interfaces:**
- Produces:
  - `class CoChangeReader implements ICoChangePort { constructor(ctxoRoot: string) }`: validates with `CoChangeMatrixSchema`, caches by mtime, returns `undefined` for a missing or invalid file (warns once).
  - `export interface CoChangedFile { readonly file: string; readonly frequency: number; readonly sharedCommits: number }`
  - `export function findCoChangedFiles(coChangeMap: ReadonlyMap<string, readonly CoChangeEntry[]>, rootFile: string, impactedFiles: ReadonlySet<string>, options?: { limit?: number; minFrequency?: number }): CoChangedFile[]`: defaults 10 and 0.5; sorted by frequency desc, shared desc, file.
  - `ContextAssembler.assembleForTask(graph, symbolId, taskType, indices, tokenBudget = DEFAULT_TOKEN_BUDGET, coChangeMap?: Map<string, CoChangeEntry[]>)`.
  - `get_blast_radius` and `ctxo blast-radius` JSON gain `coChangedFiles` (omitted when empty or when there is no matrix).

- [ ] **Step 1: Write the failing tests.**
  - `CoChangeReader returns a map for a valid file, undefined for missing or invalid files, and re-reads after mtime changes`.
  - `findCoChangedFiles excludes files already impacted and applies limit and minFrequency`.
  - In each caller's test, seed a fixture index where `b.ts` imports from `a.ts` (potential) and `co-changes.json` has `{ file1: 'a.ts', file2: 'b.ts', frequency: 0.8, sharedCommits: 4 }`. Expect:
    - `get_blast_radius`: the dependent in `b.ts` is `likely`; `coChangedFiles` lists a co-changing file with no edge.
    - `ctxo blast-radius`: `likelyCount === 1`.
    - `gate-hook`: blocks a symbol that crosses `minDependents` only after the upgrade.
    - `gate --preview`: includes that symbol.
    - `get_context_for_task`: the dependent appears with `likely` confidence.
  - `get_pr_impact` behaviour unchanged (its existing co-change tests pass with the shared reader).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/adapters/storage src/core/blast-radius src/adapters/mcp src/cli/__tests__/blast-radius-command.test.ts src/cli/__tests__/gate-hook-command.test.ts src/cli/__tests__/gate-command.test.ts src/core/context-assembly`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Wire `CoChangeReader` in the composition root (`index.ts`) and pass it to the handlers. CLI commands construct it directly (they are not core).
  - Update the `get_blast_radius` tool description: "likely (co-changed or `uses`)" and the new `coChangedFiles` field.
- [ ] **Step 4: Run the tests.** Expected: PASS; `pnpm --filter @ctxo/cli test:unit` all pass; `pnpm --filter @ctxo/cli lint` clean.
- [ ] **Step 5: Commit.** `git commit -m "feat(blast-radius): co-change in every caller plus coChangedFiles"`

---

### Task 9: Post-commit hook v2, upgrade path and doctor check

**Files:**
- Modify: `packages/cli/src/cli/init-command.ts` (lines 36-57, 155-160, 522-539)
- Modify: `packages/cli/src/adapters/diagnostics/checks/git-check.ts` (new `GitHooksCheck`)
- Modify: `packages/cli/src/cli/doctor-command.ts` (registration lines 47-66)
- Test: `packages/cli/src/cli/__tests__/init-command.test.ts`, `packages/cli/src/adapters/diagnostics/checks/__tests__/git-hooks-check.test.ts`, `packages/cli/src/cli/__tests__/doctor-fix.test.ts`

**Interfaces:**
- Produces:
  - `POST_COMMIT_CONTENT` starts with `# ctxo-start v2` and runs `ctxo index --commit HEAD >/dev/null 2>&1 || true` once (exact block in spec 6.3).
  - `installHook` replaces any existing `# ctxo-start ... # ctxo-end` block in place, so user lines outside it survive.
  - `export function resolveHooksDir(projectRoot: string): string` uses `git rev-parse --git-path hooks`, with `.git/hooks` as the fallback.
  - `class GitHooksCheck implements IHealthCheck { id = 'git_hooks' }`: `warn` when the post-commit block is missing or older than v2, `pass` otherwise. The existing `doctor --fix` mapping for `git_hooks` (`fixHooks`) then runs.

- [ ] **Step 1: Write the failing tests.**
  - `installHooks writes the v2 block calling ctxo index --commit HEAD once`.
  - `installHooks replaces an old v1 block and keeps user lines before and after it` (Review Focus 4).
  - `installHooks is idempotent`: running twice yields identical file content.
  - `installHooks honours core.hooksPath`: set `git config core.hooksPath .githooks`; the hook lands there.
  - `GitHooksCheck warns on a v1 block and passes on v2`.
  - `doctor --fix upgrades a v1 block`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/init-command.test.ts src/adapters/diagnostics src/cli/__tests__/doctor-fix.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Keep the post-merge block unchanged, but give it the same replace-in-place behaviour.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(init): one-run post-commit hook, in-place upgrade and git_hooks doctor check"`

---

### Task 10: ADR-016, docs, help and changeset

**Files:**
- Create: `docs/architecture/ADR/adr-016-co-change-engine-and-snapshot-policy.md`
- Create: `.changeset/cochange-engine-and-snapshots.md`
- Modify:
  - `docs/features/architectural-intelligence.md`
  - `docs/roadmap.md`, `CHANGELOG.md`
  - `llms.txt`, `llms-full.txt`
  - `CLAUDE.md` (Quick Reference, config section)
  - `README.md` (where it lists index flags)
  - `site/docs/cli/index.md` (or the page that documents `ctxo index`), `site/docs/cli/init.md`, `site/docs/cli/doctor.md`
  - `site/docs/reference/config-schema.md`, `site/docs/mcp-tools/get-blast-radius.md`

- [ ] **Step 1: Write ADR-016.** Use the ADR-015 field table. Cover:
  - The decisions: one git pass; window independent of `--max-history` (K5 defaults); merges and mass commits excluded; rename map shared with `intent[]`; `--commit` hook; same-SHA replacement plus read-time de-duplication; distinct-commit confidence; `coChangedFiles` informational; SQLite rebuilt from the merged index on incremental runs.
  - The alternatives rejected: incremental matrix merge; time windows anchored to the wall clock; a per-file `--follow`.
  - The fixture evidence, as aggregate numbers only.
- [ ] **Step 2: Update the docs.**
  - The snapshot cadence section: one snapshot per commit, hook v2; `--check` does not record snapshots.
  - Confidence by distinct commits.
  - The `cochange` config with defaults.
  - The new flags `--files`, `--commit`, `--cochange-commits`, `--cochange-since`.
  - `coChangedFiles` on `get_blast_radius`.
  - The `git_hooks` doctor check.
  - `CHANGELOG.md` `[Unreleased]`: Added / Changed / Fixed with #157.
  - No em dashes: `grep -rnP "\x{2014}"` over the touched docs returns nothing new.
- [ ] **Step 3: Check the CLI help against the code.** Run `pnpm --filter @ctxo/cli build && node packages/cli/dist/index.js --help`. Expected: every new flag appears, and the `ctxo index` line says `--max-history` controls intent depth only.
- [ ] **Step 4: Write the changeset** with `"@ctxo/cli": minor` and a two-sentence release note naming #157.
- [ ] **Step 5: Run the full verification.** `pnpm -r build && pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm --filter @ctxo/cli test:e2e`. Expected: all green, including the CLI tarball size test (if it crosses 1350 KB, raise the limit in this PR with the measured size, per spec section 4).
- [ ] **Step 6: Commit.** `git commit -m "docs: ADR-016, co-change and snapshot docs, CLI help and changeset"`

---

### Task 11: Fixture validation (private, nothing committed)

- [ ] **Step 1:** Build the branch (`pnpm -r build`). In the fixture clone (path from the owner's brief, never the original checkout), write a private `.ctxo/config.yaml` with:
  - `cochange.maxCommits: all`;
  - `cochange.exclude` set to the test folders;
  - `cochange.include: ["**/*.sql"]`.

  Run `node <worktree>/packages/cli/dist/index.js index`. Expected: success.
- [ ] **Step 2:** Run the oracle in the clone with its output in the session scratchpad. Map Ctxo's file pairs to the oracle's units with a scratchpad-only script. Compare `commitsUsed` (oracle 970), `massSkipped` (oracle 3) and unit-pair shared counts. Expected: equal, or every difference explained.
- [ ] **Step 3:** Measure the dev build, never the globally installed released ctxo (it predates `--commit` and the v2 hook, so it would write the old hook and run the old code).
  - Install the v2 hook in the clone only, with the dev build: `node <worktree>/packages/cli/dist/index.js init --tools claude-code -y`.
  - Make a `ctxo` shim: a script named `ctxo` in a scratchpad folder (for example `<scratchpad>/ctxo-shim/ctxo`, `#!/bin/sh` followed by `exec node "<worktree>/packages/cli/dist/index.js" "$@"`, plus a `ctxo.cmd` calling the same on Windows). Put that folder in front of PATH for every command below that commits or runs the hook, and check `command -v ctxo` resolves to the shim, so the hook's `ctxo index --commit HEAD` runs the dev build.
  - Commit a one-file change in the clone, then run by hand `node <worktree>/packages/cli/dist/index.js index --commit HEAD`.
  - Exercise the hook itself: with the shim in front of PATH, run `.git/hooks/post-commit` (or the hooks directory `git rev-parse --git-path hooks` reports).
  - Expected:
    - `co-changes.json` entries unchanged except for pairs that involve the new commit;
    - one new history entry (the manual run and the hook run for the same commit leave one entry between them);
    - drift/boundary `distinctCommits` matches the distinct SHAs in history.
- [ ] **Step 4:** Time the co-change pass and `node <worktree>/packages/cli/dist/index.js index --commit HEAD` (the dev build again, not the global ctxo). Expected: co-change pass at most 3 s; the commit run faster than the old per-file loop.
- [ ] **Step 5:** Write the aggregate numbers and explanations into the PR description draft (in the scratchpad). Nothing from the fixture goes into the repo.
