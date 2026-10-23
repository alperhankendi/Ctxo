# PR 1A: Contexts View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute an as-is map of candidate contexts at `ctxo index` time (file-level dependency and co-change clusters with hub damping, top terms and type-name collisions), serve it through `get_architectural_overlay({ mode: "contexts" })` and `ctxo contexts`, register the MCP parameters that clients cannot send today, and measure a merge-based change-set unit for co-change (Phase 1 of #156, K4, K20).

**Architecture:**
- Pure core modules in `packages/cli/src/core/contexts-view/` build the view from the merged full index, `co-changes.json` and this run's community snapshot: the file graph and hubs (`file-graph.ts`), terms and collisions (`context-terms.ts`), clustering and folding (`candidate-groups.ts`, on Louvain helpers extracted from `CommunityDetector`) and assembly (`contexts-view-builder.ts`).
- `ctxo index` computes the view right after community detection (same opt-out, `--skip-community`) and writes `.ctxo/index/contexts-view.json` only when its content changed. MCP and CLI read it through a new `IContextsViewPort`.
- A shared test-file classifier, the `communities:`, `contextsView:` and `index.tests` config, and `cochange.unit` (first-parent change sets read through the git port) complete the PR.

**Tech Stack:** TypeScript (ESM, Node >= 20), graphology + graphology-communities-louvain, zod 4, picomatch, simple-git, @modelcontextprotocol/sdk, vitest, pnpm workspace (`packages/cli`).

**Spec:** `docs/superpowers/specs/2026-10-20-domain-knowledge-layer-design.md`, section 7 (7.1 to 7.5, including 7.4a), with sections 3, 4, 5, 13, 14 and 18 (owner decisions K4, K14, K20; the PR 1A calls in 18).

## Global Constraints

- **Base:** a new worktree and branch `feat/contexts-view-156`, stacked on the finished PR 0 branch `feat/cochange-engine-157`. From PR 0 this plan consumes `CoChangeReader` (`packages/cli/src/adapters/storage/co-change-reader.ts`, `readCoChangeMap(): Map<string, CoChangeEntry[]> | undefined`), `IndexCommand.run({ files, commit })`, one snapshot per commit and ADR-016. Code that PR 0 changes is referenced by name, not line.
- **Hexagonal rules** in `@ctxo/cli`: `core/` never imports `adapters/` or `ports/`; `ports/` never imports `adapters/`; `adapters/mcp/` imports only `core/` and `ports/`; only `packages/cli/src/index.ts` wires adapters to ports; no barrel exports; every adapter implements a port.
- **Output channels:** never `console.log` (stdout is JSON-RPC). CLI human output to `console.error`, machine JSON to `process.stdout.write`, library logs through `createLogger('ctxo:<ns>')`. Adapters warn and continue; MCP handlers never throw; every MCP payload passes through `wrapResponse` and `masking.mask`.
- **Determinism (spec 13.1):** sort with `compareCodepoint` (`packages/cli/src/core/compare-codepoint.ts`), never `localeCompare`; no wall-clock value inside `contexts-view.json`; no randomness; rewrite an artifact only when its content changed; the same input twice gives a byte-identical `contexts-view.json`.
- **Test globs (spec 7.1), verbatim and in this order:** `**/__tests__/**`, `**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`, `**/*_test.go`, `**/src/test/**`, `**/*.Tests/**`, `**/*.Test/**`, `**/*Tests.cs`, `**/*Test.cs`, `**/test_*.py`, `**/*_test.py`, plus `index.tests`.
- **File graph (spec 7.2, K4):** nodes are indexed non-test files minus `index.ignore` and `contextsView.exclude`; kind weight 1.0 for `calls`, `extends`, `implements`, `uses` and 0.5 for `imports`; `dep = log2(1 + count) / log2(1 + maxCount)`; `co` is the pair's `frequency` in `co-changes.json` (0 if absent); `w = weights.dependency * dep + weights.coChange * co` (defaults 1.0 and 1.0).
- **Hubs (spec 7.2):** a file is a hub when it holds a god node from `communities.json`, or when its count of distinct dependent files is in the top `hubs.topPercent` (default 1) and at least `hubs.minDependents` (default 10); every edge touching a hub is multiplied by `1 / log2(2 + dependents)`; files matching `hubs.paths` lose all their edges (weight 0); hubs are reported separately and assigned to the candidate of their strongest remaining edge, if any.
- **Clustering (spec 7.2):** Louvain with `resolution` (default 1.0) and the `CommunityDetector` determinism measures (sorted nodes, `randomWalk: false`, codepoint ordering, its `splitDisconnectedCommunities`); candidates with fewer than `minCandidateFiles` (default 3) files fold into the neighbouring candidate with the strongest total weight; isolated small groups go to `unclustered`.
- **Identity (spec 7.2):** candidate IDs are sequential by size desc, then label; `fingerprint` is a hash of the sorted members; the label is the longest common directory prefix of the members or, when that is the repo root, the directory of the member with the highest file-level PageRank. No automatic domain naming.
- **Per candidate (spec 7.2):** `id`, `label`, `fingerprint`, `files` (capped list plus count on the surfaces), `cohesion` (internal weight / (internal + boundary weight)), `topTerms`, `crossEdges` (counts by kind), `coChangePairs` crossing candidates (top N). `sharedTables` belongs to PR 1B and is not emitted. Output: `{ candidates, unclustered, hubs, settings, coverage: { files, covered, ratio } }`, plus `collisions` (7.3).
- **Terms (spec 7.3):** type names (`class`, `interface`, `type`, enum types) and enum members, tokenized with `SymbolTokenizer` (camelCase, PascalCase, snake_case), minus stop words, the technical words `Service`, `Repository`, `Controller`, `Handler`, `Manager`, `Dto`, `Impl`, `Async` and the interface `I` prefix; ranked by number of files; top 10 with counts. A collision is the same case-insensitive type name in two candidates whose member-name sets have Jaccard similarity below 0.5.
- **Config (spec 7.4), defaults verbatim:**
  ```yaml
  communities:            # wires CommunityDetectorOptions (symbol-level Louvain)
    resolution: 1.0
    godNodeMinBridged: 3
    godNodeMaxResults: 25
  contextsView:
    weights: { dependency: 1.0, coChange: 1.0 }
    exclude: []
    hubs: { auto: true, topPercent: 1, minDependents: 10, paths: [] }
    resolution: 1.0
    minCandidateFiles: 3
  index:
    tests: []             # extra test globs
  ```
- **K20 (spec 7.4a):** `cochange.unit: commit | merge`, default `commit`. In `merge` mode first-parent history defines change sets with git only (no hosting API): a merge commit `M` is one change set with the files of `git diff M^1 M`; a squash-merged commit is its own change set; commits without a recoverable boundary (rebase, fast-forward) stay single change sets; the mass threshold and every other rule apply per change set. The owner decides after measurement; no GitHub issue without the owner's approval.
- **Tests:** vitest, co-located in `__tests__/`; temp repos come from `mkdtempSync(join(tmpdir(), 'ctxo-...'))`, and every git operation that creates commits in them (commit, merge, rebase, cherry-pick, amend, revert, tag) passes `-c commit.gpgsign=false -c user.name=Test -c user.email=test@test.com`, plus `-c tag.gpgsign=false` for tags (the machine has a global `commit.gpgsign=true`).
- **Git on the branch:** each task's commit stages exactly the paths in its Files block (`git add <path>...`, never `-A` or `.`), and never `.ctxo/` or `.claude/settings.local.json`. Branch commits are GPG-signed through the user's own config: never pass `--no-gpg-sign` or `-c commit.gpgsign=false` there, and on a signing failure stop and report BLOCKED. The post-commit hook may take minutes; wait for the commit to return.
- **Before editing an existing symbol,** call the ctxo MCP tools `get_blast_radius` and `get_why_context` on it (CLAUDE.md rule; the safe-edit guard enforces high-impact symbols). The session's ctxo MCP server indexes the main checkout (older code), so `found: false` from either tool for a symbol added on these branches is expected: call the tools as the project rule asks, then proceed.
- **Text:** English only, no em dashes, no `Co-Authored-By` or AI attribution lines. No push, PR, publish or issue without the owner's approval.
- **Tarball:** the CLI limit is 1350 KB (`packages/cli/tests/e2e/release-packaging.test.ts`); when crossed, raise it with the measured size and the reason in the PR description (sourcemaps keep shipping).
- **Privacy:** nothing from the private fixture (code, paths, names, table names, business rules) goes into the repo, tests, docs, commits or PR text. Fixture work happens only in the private fixture clone (path in the owner's brief); comparison scripts and raw outputs stay in the session scratchpad; only aggregate numbers leave it.

## Review Focus

1. **A typo or out-of-range value in a new config section** (for example `contextsView.hubs.minDependent: 5`): `loadConfig` falls back to all defaults (known issue in spec 19, not fixed here), which silently drops `index.ignore` as well. Expected: `ctxo doctor` fails `config_file` and names the offending key. Test owned by Task 3.
2. **Clients and prompts that still send `fuzzy: true`** to `get_ranked_context` (the site docs advertised it): expected a normal answer with the argument ignored, never a validation error. Test owned by Task 7.
3. **Tiny, edge-less or fully excluded repos** (a fresh repo, a syntax-tier language with few edges, `contextsView.exclude: ["**"]`): expected a valid view with every node in `unclustered` or no node at all, `coverage.ratio` 0 rather than NaN, and MCP and CLI rendering it. Tests owned by Tasks 5 and 8.
4. **A stale, hand-edited or merge-conflicted `contexts-view.json`** (it is committed, so conflicts happen): expected the reader to reject it with one warning, `mode: "contexts"` and `ctxo contexts` to answer with the "run ctxo index" hint, and the next `ctxo index` to replace the file. Tests owned by Tasks 6, 7 and 8.
5. **Paths with spaces, non-ASCII characters or backslashes** (index entries, config globs, labels): expected the classifier and globs to match after normalisation, labels to keep the original spelling, and order and fingerprints to be identical across runs and input orders. Tests owned by Tasks 1 and 5.

## Designer calls (spec gaps decided here; the owner may override)

1. **Nodes:** non-indexed files present in `co-changes.json` (brought in by `cochange.include`) are nodes too, which gives the "co-change-only contexts view" of spec 13.2; files missing from the working tree are never nodes (a full run keeps the JSON of deleted files).
2. **File-level PageRank:** the sum of the file's symbol PageRank scores from the run that feeds community detection.
3. **Hub details:** the fan-in cut is `k = max(1, ceil(nodes * topPercent / 100))` and includes every file tied with the k-th; an edge between two hubs takes both factors; a configured hub has damping 0 even when it also qualifies automatically; hubs leave their Louvain group before the disconnected split and the folding; a hub's candidate comes from its strongest neighbour that sits in a candidate (ties: neighbour path).
4. **Folding order:** the smallest small group first (ties: first member), into the neighbour with the largest total weight (ties: larger group, then first member), repeated until no small group has a neighbour.
5. **Identity details:** IDs start at 1; ties after size and label go to the first member; labels may repeat; the repo root label is `.`; `fingerprint` is the first 16 hex characters of SHA-256 over the members joined by `\n`.
6. **Artifact shape:** full member lists on disk (`fileCount` plus `files`, `unclustered: { count, files }`); MCP caps both lists at 15 (the communities preview size); `ctxo contexts --json` prints the full artifact; no `computedAt` (only `commitSha`), so the bytes depend only on the input. Edge weights are rounded to 6 decimals before Louvain (cross-machine stability); `cohesion`, `ratio`, `damping` and `minJaccard` to 3 decimals.
7. **Edges and pairs:** `crossEdges` count outgoing distinct symbol edges by kind; `coChangePairs` keep the top 10 per candidate.
8. **Terms:** the technical-word list is `contextsView.technicalTerms` (replaces the default list) and drops a word anywhere in the name, not only as a suffix; tokens shorter than 2 characters (which removes the interface `I` prefix, split off by the tokenizer) and all-digit tokens are dropped; enum members are `variable` symbols named `<type>.<member>` under a `type` symbol; a collision's member set is every symbol name one level below the type in the same file; two empty member sets count as identical.
9. **Registration test:** an e2e test lists the tools of the built server over stdio and compares them with each handler's exported `InputSchema` (property names, `required`, enum values), so `index.ts` keeps its structure.
10. **K20:** `merge` reads HEAD's first-parent history (anchored to HEAD like K5; on the default branch this is the spec's definition) with `git log --first-parent --diff-merges=first-parent` (git 2.31 or later); `maxCommits` counts change sets; `window.unit` is written only for `merge`; config only, no CLI flag; `intent[]` keeps the non-merge log, so `merge` costs a second git pass. The measurement also runs on a scratch clone of the Ctxo repo (public numbers).
11. **Smaller calls:** `ctxo watch` honours `communities:` but does not refresh the contexts view; candidate labels go through the cluster label masker in MCP; `detectGodNodes` ties move from `localeCompare` to code point order (god nodes feed hubs); `TRUNCATABLE_FIELDS` gains `candidates`, `collisions` and `hubs`; `ctxo contexts` without a view exits 0 with `found: false`, like `ctxo blast-radius`; the contexts-view defaults and their evidence go into an ADR-016 addendum.

---

### Task 0: Branch setup

- [ ] **Step 1:** Create the worktree with superpowers:using-git-worktrees: branch `feat/contexts-view-156` from the head of `feat/cochange-engine-157` once every PR 0 task is committed.
- [ ] **Step 2:** Copy this plan into the worktree if it is missing, then `git add -f docs/superpowers/plans/2026-10-21-pr1a-contexts-view.md` (`docs/superpowers/` is gitignored).
- [ ] **Step 3:** Commit: `git commit -m "docs: add PR 1A contexts view plan"`.
- [ ] **Step 4:** Run `pnpm install --frozen-lockfile && pnpm -r build && pnpm --filter @ctxo/cli test:unit`. Expected: all green (the baseline every later task compares against).

---

### Task 1: Shared test-file classifier and `index.tests`

**Files:**
- Create: `packages/cli/src/core/test-files/test-file-classifier.ts`
- Modify: `packages/cli/src/core/config/config-schema.ts` (`IndexConfigSchema`), `packages/cli/src/core/config/load-config.ts` (`loadConfig` glob validation, new `indexTestPatterns`)
- Test: `packages/cli/src/core/test-files/__tests__/test-file-classifier.test.ts`, `packages/cli/src/core/config/__tests__/load-config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // core/test-files/test-file-classifier.ts
  export const DEFAULT_TEST_GLOBS: readonly string[];          // the 13 spec globs, spec order
  export type TestFileClassifier = (path: string) => boolean;  // repo-relative, either separator
  export function createTestFileClassifier(extraGlobs?: readonly string[]): TestFileClassifier;
  // core/config/load-config.ts
  export function indexTestPatterns(config: CtxoConfig): string[];   // valid index.tests globs only
  ```
- Not wired into `dead-code-detector.ts` or `architectural-overlay.ts` (spec 7.1 leaves that for later).

- [ ] **Step 1: Write the failing tests.**
  - `classifies a path matched by each default glob as a test file`: `it.each` over `src/__tests__/a.ts`, `src/a.test.ts`, `web/a.spec.js`, `test/a.ts`, `tests/e2e/a.ts`, `pkg/store_test.go`, `src/test/java/AT.java`, `src/Billing.Tests/A.cs`, `src/Billing.Test/A.cs`, `src/LoanTests.cs`, `src/LoanTest.cs`, `app/test_models.py`, `app/models_test.py`; each returns `true`.
  - `leaves look-alike production paths alone`: `src/latest.ts`, `src/contest/a.ts`, `src/Testing.cs`, `src/attestation.go`, `src/testing_utils.py` return `false`.
  - `matches backslash paths and paths with spaces or non-ASCII characters` (Review Focus 5): `src\\ödünç kaydı\\__tests__\\a.ts` and `src/ödünç kaydı/b.test.ts` return `true`.
  - `adds index.tests globs to the defaults`: `createTestFileClassifier(['**/Characterization/**'])` returns `true` for `src/Characterization/A.cs` and still `true` for `src/a.test.ts`.
  - In `load-config.test.ts`: `index.tests keeps valid globs and reports invalid ones`: config `index.tests: ['**/it/**', <'a'.repeat(65_537)>]` (picomatch rejects only patterns above 65536 characters) gives `indexTestPatterns(config)` equal to `['**/it/**']` and `invalidGlobs` containing `index.tests: <that pattern>`; `index still rejects an unknown key`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/test-files src/core/config`. Expected: FAIL (module not found, `indexTestPatterns` missing).
- [ ] **Step 3: Implement.** Build the classifier on `makeGlobMatcher` (picomatch with `dot: true`, backslashes normalised). Add `tests: z.array(z.string().min(1)).optional()` to `IndexConfigSchema` and validate `index.tests` in `loadConfig` the way `index.ignore` is validated.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): shared test-file classifier and index.tests globs (#156)"`

---

### Task 2: `communities:` config wired into both Louvain runs

**Files:**
- Modify: `packages/cli/src/core/config/config-schema.ts` (new `CommunitiesConfigSchema`, `CtxoConfigSchema.communities`), `packages/cli/src/core/config/load-config.ts` (new `communityDetectorOptions`)
- Modify: `packages/cli/src/cli/index-command.ts` (`IndexCommand.buildCommunitySnapshot` and its Phase 2c call)
- Modify: `packages/cli/src/cli/watch-command.ts` (`buildWatchCommunitySnapshot`, lines 243-269, and its caller in `WatchCommand.run`)
- Test: `packages/cli/src/core/config/__tests__/communities-config.test.ts`, `packages/cli/src/cli/__tests__/index-command.test.ts`, `packages/cli/src/cli/__tests__/watch-command.test.ts`

**Interfaces:**
- Consumes: `CommunityDetectorOptions` (`core/overlay/community-detector.ts`, unchanged).
- Produces:
  - `CommunitiesConfigSchema` (strict, all optional): `resolution` (number > 0), `godNodeMinBridged` (int >= 1), `godNodeMaxResults` (int >= 0).
  - `export function communityDetectorOptions(config: CtxoConfig): CommunityDetectorOptions`: only valid configured values; the detector keeps its own defaults (1.0, 3, 25).
  - `buildCommunitySnapshot(indices, tiers, gitAdapter, detectorOptions: CommunityDetectorOptions)`.
  - `export function buildWatchCommunitySnapshot(storage: SqliteStorageAdapter, detectorOptions: CommunityDetectorOptions): CommunitySnapshot | undefined` (exported for its test).

- [ ] **Step 1: Write the failing tests.**
  - `communityDetectorOptions returns the configured values`: `communities: { resolution: 0.5, godNodeMinBridged: 4, godNodeMaxResults: 5 }` gives exactly that object.
  - `communityDetectorOptions is empty when the section is absent`.
  - `the schema rejects resolution 0, godNodeMinBridged 0 and an unknown key under communities`: each gives a `loadConfig` error whose text starts with `communities`.
  - `ctxo index builds communities with the configured options`: a temp project with `.ctxo/config.yaml` holding `communities: { resolution: 0.5, godNodeMaxResults: 1 }`; `vi.spyOn(detectorModule, 'CommunityDetector')` wraps the real class in a function expression (as the router tests do) and records constructor arguments. After `run({})` the recorded arguments equal `[{ resolution: 0.5, godNodeMaxResults: 1 }]`.
  - `the watch snapshot uses the given options`: the same spy around `buildWatchCommunitySnapshot(storage, { resolution: 0.5 })` with a temp storage holding two linked symbols.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/config src/cli/__tests__/index-command.test.ts src/cli/__tests__/watch-command.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `IndexCommand.run` passes `communityDetectorOptions(ignore.config)`; `WatchCommand.run` passes it from the config it already loads for `snapshotMinFileChanges`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(config): communities section sets the Louvain detector options (#156)"`

---

### Task 3: `contextsView:` config, file graph and hub damping

**Files:**
- Modify: `packages/cli/src/core/config/config-schema.ts` (`ContextsViewConfigSchema`, `CtxoConfigSchema.contextsView`, default constants), `packages/cli/src/core/config/load-config.ts` (`resolveContextsViewConfig`, glob validation)
- Create: `packages/cli/src/core/contexts-view/file-graph.ts`
- Test: `packages/cli/src/core/config/__tests__/contexts-view-config.test.ts`, `packages/cli/src/core/contexts-view/__tests__/file-graph.test.ts`, `packages/cli/src/adapters/diagnostics/__tests__/config-check.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // config-schema.ts
  export const DEFAULT_TECHNICAL_TERMS: readonly string[];  // Service, Repository, Controller, Handler, Manager, Dto, Impl, Async
  // load-config.ts
  export interface ResolvedContextsViewConfig {
    readonly weights: { readonly dependency: number; readonly coChange: number };
    readonly exclude: readonly string[];
    readonly hubs: { readonly auto: boolean; readonly topPercent: number; readonly minDependents: number; readonly paths: readonly string[] };
    readonly resolution: number;
    readonly minCandidateFiles: number;
    readonly technicalTerms: readonly string[];
  }
  export function resolveContextsViewConfig(config: CtxoConfig): ResolvedContextsViewConfig;
  // core/contexts-view/file-graph.ts
  export const EDGE_KIND_WEIGHTS: Readonly<Record<EdgeKind, number>>;  // calls/extends/implements/uses 1, imports 0.5
  export interface FileEdgeCount { readonly from: string; readonly to: string; readonly kind: EdgeKind; readonly count: number }
  export interface FilePair { readonly a: string; readonly b: string; readonly dependency: number; readonly coChange: number; readonly weight: number } // a < b
  export interface FileGraph {
    readonly files: readonly string[];                 // nodes, code point order
    readonly pairs: readonly FilePair[];               // weight > 0, sorted by a, then b
    readonly edgeCounts: readonly FileEdgeCount[];     // directed distinct symbol edges per file pair and kind
    readonly dependents: ReadonlyMap<string, number>;  // distinct dependent node files
  }
  export interface FileGraphInput {
    readonly indices: readonly FileIndex[];
    readonly isNode: (file: string) => boolean;
    readonly coChangeMap?: ReadonlyMap<string, readonly CoChangeEntry[]>;
    readonly weights: ResolvedContextsViewConfig['weights'];
  }
  export function buildFileGraph(input: FileGraphInput): FileGraph;
  export type HubReason = 'configured' | 'fan-in' | 'god-node';
  export interface HubDecision { readonly file: string; readonly reasons: readonly HubReason[]; readonly dependents: number; readonly damping: number }
  export function detectHubs(graph: FileGraph, options: { readonly hubs: ResolvedContextsViewConfig['hubs']; readonly godNodeFiles: ReadonlySet<string> }): HubDecision[];   // sorted by file
  export function applyHubDamping(pairs: readonly FilePair[], hubs: readonly HubDecision[]): FilePair[];  // zero weights dropped
  ```
- Schema bounds (strict at every level, all optional): weights >= 0; `topPercent` > 0 and <= 100; `minDependents` int >= 1; `resolution` > 0; `minCandidateFiles` int >= 1; `exclude`, `hubs.paths` and `technicalTerms` are string arrays; `exclude` and `hubs.paths` are glob-validated in `loadConfig`.

- [ ] **Step 1: Write the failing tests.**
  - Config: `resolveContextsViewConfig returns the spec defaults when the section is absent` (exact object, `technicalTerms` equal to `DEFAULT_TECHNICAL_TERMS`); `resolveContextsViewConfig takes configured values and drops invalid globs`; `the schema rejects resolution 0, a negative weight, topPercent 0 or 101, minCandidateFiles 0 and unknown keys`.
  - Review Focus 1, in `config-check.test.ts`: `ConfigFileCheck fails and names the key for a typo under contextsView.hubs`: `contextsView: { hubs: { minDependent: 5 } }` gives `status: 'fail'` and a message containing `contextsView.hubs`.
  - `buildFileGraph sums kind weights of distinct symbol edges per pair in both directions`: `a.ts` has two `calls` to two symbols of `b.ts` and one `imports` of `b.ts`, `b.ts` has one `uses` of `a.ts`, and `c.ts` has one `imports` of `d.ts`. Expect pair `(a.ts, b.ts)` `dependency` 1 (count 3.5 is the maximum) and pair `(c.ts, d.ts)` `dependency` `toBeCloseTo(Math.log2(1.5) / Math.log2(4.5), 5)` (`dependency` and `weight` are rounded to 6 decimals).
  - `buildFileGraph counts a repeated symbol edge once`.
  - `buildFileGraph ignores intra-file edges, edges into non-node files and unresolved targets`.
  - `buildFileGraph resolves a 2-part name reference through the symbol graph`: an edge to `Bar::class` with a single `Bar` class in `b.ts` yields pair `(a.ts, b.ts)`.
  - `buildFileGraph adds co-change frequency and keeps pairs that only co-change`: co-change entry `(a.ts, e.ts, frequency 0.8)` without symbol edges gives weight 0.8; with weights `{ dependency: 0.5, coChange: 2 }` the weights scale accordingly.
  - `buildFileGraph makes co-change-only files nodes when isNode accepts them`: `db/schema.sql` from the co-change map appears in `files`.
  - `buildFileGraph counts distinct dependent files`: `b.ts` depended on by `a.ts` (three edges) and `c.ts` has dependents 2.
  - `buildFileGraph does not depend on input order`: reversed `indices` give a deep-equal graph.
  - `detectHubs marks god-node files and top fan-in files with at least minDependents dependents`: twelve files depend on `src/shared/db.ts` (`topPercent: 1`, `minDependents: 10`), giving `{ file: 'src/shared/db.ts', reasons: ['fan-in'], dependents: 12, damping: 1 / Math.log2(14) }`; a file in `godNodeFiles` gets `reasons: ['god-node']`.
  - `detectHubs includes every file tied with the top-percent cut` and `detectHubs with auto false keeps only hubs.paths matches with damping 0`.
  - `applyHubDamping multiplies edges touching a hub by its damping, once per hub endpoint, and drops configured-hub edges`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/config src/core/contexts-view src/adapters/diagnostics/__tests__/config-check.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `buildFileGraph` adds the symbols and edges of the indices, sorted by `file`, to one `SymbolGraph` (it resolves 2-part targets on insert, and insertion order decides its last-wins name map), then aggregates `graph.allEdges()` to node-file pairs. Rounding per Designer call 6. `detectHubs` builds the `hubs.paths` matcher with `makeGlobMatcher`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(contexts-view): file graph with co-change weight and hub damping (#156)"`

---

### Task 4: Term harvest and type-name collisions

**Files:**
- Create: `packages/cli/src/core/contexts-view/context-terms.ts`
- Test: `packages/cli/src/core/contexts-view/__tests__/context-terms.test.ts`

**Interfaces:**
- Consumes: `SymbolTokenizer.splitName`, `SymbolTokenizer.isStopWord` (`core/search/symbol-tokenizer.ts`), `SymbolNode`.
- Produces:
  ```ts
  export interface ContextTerm { readonly term: string; readonly files: number }
  export interface TermOccurrence { readonly candidate: number; readonly file: string; readonly symbolId: string; readonly members: readonly string[] }
  export interface TermCollision { readonly name: string; readonly minJaccard: number; readonly occurrences: readonly TermOccurrence[] }
  export interface TermSource { readonly id: number; readonly files: readonly string[] }
  export function harvestTopTerms(files: readonly string[], symbolsByFile: ReadonlyMap<string, readonly SymbolNode[]>, technicalTerms: readonly string[], limit?: number): ContextTerm[];   // limit 10
  export function findTermCollisions(candidates: readonly TermSource[], symbolsByFile: ReadonlyMap<string, readonly SymbolNode[]>): TermCollision[];
  ```
- A type's short name is the last `.` segment of its `name` (C# names are namespace-qualified). Terms sort by `files` desc, then `term`; collisions by `name` (lowercase); occurrences by `candidate`, then `symbolId`.

- [ ] **Step 1: Write the failing tests.**
  - `harvestTopTerms ranks type-name tokens by number of files`: `LoanPolicy` (class) in f1, `LoanLimit` (type) in f2, `MemberAccount` (interface) in f3 give `[{ term: 'loan', files: 2 }, account, limit, member, policy]`, each of the last four with `files: 1`.
  - `harvestTopTerms drops stop words, technical words, the interface I prefix and short or numeric tokens`: `ILoanRepository` (interface) and `LoanService` (class) yield only `loan`; `GetHandler2` yields nothing.
  - `harvestTopTerms includes enum members of type symbols`: `Ns.LoanStatus` (type) with `Ns.LoanStatus.Overdue` (variable) yields `loan`, `status` and `overdue`.
  - `harvestTopTerms keeps the top 10 with code point tie-breaks`.
  - `findTermCollisions reports a name whose shapes differ across candidates`: `Lending.Account` in candidate 1 with members `Borrow`, `Limit`, `MemberId` and `Billing.Account` in candidate 2 with `Charge`, `Limit`, `PayerId` give one collision `{ name: 'account', minJaccard: 0.2 }` with both occurrences and their sorted member sets.
  - `findTermCollisions ignores Jaccard >= 0.5, names inside a single candidate and two empty member sets`.
  - `findTermCollisions matches names case-insensitively` (`Account` and `ACCOUNT`).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/contexts-view/__tests__/context-terms.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions (pure; Designer call 8).
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(contexts-view): term harvest and type-name collisions (#156)"`

---

### Task 5: Shared Louvain helpers, clustering and view assembly

**Files:**
- Create: `packages/cli/src/core/overlay/louvain.ts`
- Modify: `packages/cli/src/core/overlay/community-detector.ts` (Louvain call lines 105-110, `splitDisconnectedCommunities` lines 148-184, `detectGodNodes` sort lines 266-271). Before editing: `get_blast_radius` and `get_why_context` on `CommunityDetector`.
- Create: `packages/cli/src/core/contexts-view/candidate-groups.ts`, `packages/cli/src/core/contexts-view/contexts-view-builder.ts`
- Test: `packages/cli/src/core/overlay/__tests__/louvain.test.ts`, `packages/cli/src/core/overlay/__tests__/community-detector.test.ts`, `packages/cli/src/core/contexts-view/__tests__/candidate-groups.test.ts`, `packages/cli/src/core/contexts-view/__tests__/contexts-view-builder.test.ts`

**Interfaces:**
- Consumes: Task 3 (`buildFileGraph`, `detectHubs`, `applyHubDamping`, `HubReason`, `FilePair`, `ResolvedContextsViewConfig`), Task 4 (`harvestTopTerms`, `findTermCollisions`, `ContextTerm`, `TermCollision`).
- Produces:
  ```ts
  // core/overlay/louvain.ts (the CJS default-export normalisation moves here too)
  export function runLouvain(graph: UndirectedGraph, resolution: number): { readonly communities: Record<string, number>; readonly modularity: number };
  export function splitDisconnectedCommunities(graph: UndirectedGraph, assignments: Readonly<Record<string, number>>): Map<string, number>;
  // core/contexts-view/candidate-groups.ts
  export type WeightLookup = ReadonlyMap<string, ReadonlyMap<string, number>>;   // symmetric adjacency of final weights
  export function clusterFiles(files: readonly string[], pairs: readonly FilePair[], hubFiles: ReadonlySet<string>, resolution: number): string[][];
  export function foldSmallGroups(groups: readonly (readonly string[])[], adjacency: WeightLookup, minFiles: number): { readonly groups: string[][]; readonly unclustered: string[] };
  // core/contexts-view/contexts-view-builder.ts
  export interface CandidateCrossEdges { readonly candidate: number; readonly total: number; readonly byKind: Readonly<Partial<Record<EdgeKind, number>>> }
  export interface CandidateCoChangePair { readonly file: string; readonly otherFile: string; readonly otherCandidate: number; readonly frequency: number; readonly sharedCommits: number }
  export interface ContextCandidate {
    readonly id: number; readonly label: string; readonly fingerprint: string;
    readonly fileCount: number; readonly files: readonly string[]; readonly cohesion: number;
    readonly topTerms: readonly ContextTerm[]; readonly crossEdges: readonly CandidateCrossEdges[];
    readonly coChangePairs: readonly CandidateCoChangePair[];
  }
  export interface ContextHub { readonly file: string; readonly reasons: readonly HubReason[]; readonly dependents: number; readonly damping: number; readonly candidate?: number }
  export interface ContextsView {
    readonly version: 1; readonly commitSha: string; readonly settings: ResolvedContextsViewConfig;
    readonly coverage: { readonly files: number; readonly covered: number; readonly ratio: number };
    readonly candidates: readonly ContextCandidate[]; readonly hubs: readonly ContextHub[];
    readonly unclustered: { readonly count: number; readonly files: readonly string[] };
    readonly collisions: readonly TermCollision[];
  }
  export interface ContextsViewInput {
    readonly indices: readonly FileIndex[]; readonly isNode: (file: string) => boolean;
    readonly coChangeMap?: ReadonlyMap<string, readonly CoChangeEntry[]>;
    readonly godNodeFiles: ReadonlySet<string>; readonly filePageRank: ReadonlyMap<string, number>;
    readonly settings: ResolvedContextsViewConfig; readonly commitSha: string;
  }
  export function buildContextsView(input: ContextsViewInput): ContextsView;
  ```
- `clusterFiles` adds sorted nodes and sorted pairs to an `UndirectedGraph`, runs Louvain over all nodes (hubs included, so their damped edges count), drops hubs, splits the rest with `splitDisconnectedCommunities`, and returns sorted groups; with no edge it returns singletons without calling Louvain. `foldSmallGroups` receives the final weights without hub endpoints. `coverage.covered` counts candidate files plus hubs that have a candidate; `ratio` is 0 when there is no node.

- [ ] **Step 1: Write the failing tests.**
  - `splitDisconnectedCommunities gives each connected part its own id in sorted start order` and `runLouvain returns the same assignment for the same graph`.
  - `god nodes with equal centrality are ordered and capped by code point` (community-detector): two bridging symbols `hub/B.ts::B::class` and `hub/a.ts::a::class` with equal bridged counts under a uniform PageRank map, `godNodeMinBridged: 2`, `godNodeMaxResults: 1`, keep only `hub/B.ts::B::class`. The golden test (`community-detector.golden.test.ts`) stays unchanged.
  - `foldSmallGroups merges a small group into the neighbour with the strongest total weight`: groups of 5 and 4 files and a pair `{x, y}` with total weight 0.3 to the first and 0.9 to the second; the pair joins the second.
  - `foldSmallGroups breaks equal weights by the larger group, then the first member`; `foldSmallGroups keeps folding small groups into small groups until none has a neighbour`; `foldSmallGroups sends isolated small groups to unclustered`.
  - `clusterFiles splits a community held together only by a hub`: chains `a1-a2-a3` and `b1-b2-b3` at weight 0.1, each of the six linked to `h` at weight 5, `hubFiles = {h}`; result `[[a1, a2, a3], [b1, b2, b3]]`.
  - Spec 7.5 hub acceptance, `buildContextsView separates two areas that share only a hub and merges them with hub damping off`: `src/billing/b1.ts` to `b5.ts` and `src/shipping/s1.ts` to `s5.ts`, each area a chain of one `imports` edge per neighbour; each of the ten files has 40 distinct `calls` edges into the 40 functions of `src/shared/db.ts`; default settings. Expect two 5-file candidates, `src/billing` with id 1 and `src/shipping` with id 2 (equal sizes, so the label orders the IDs), and `hubs` equal to `[{ file: 'src/shared/db.ts', reasons: ['fan-in'], dependents: 10, damping: 0.279, candidate: 1 }]` (equal spokes, the first neighbour path wins). With `hubs.auto: false`: one candidate with all 11 files. (Undamped, a hub edge weighs about 9 times an internal edge, log2(41) against log2(1.5), so one community has the highest modularity; damped by 1/log2(12) it weighs about 2.6 times, and the split wins.)
  - `configured hubs lose every edge and are reported without a candidate`.
  - `ids are sequential by size desc, then label, and fingerprints hash the sorted members`: `fingerprint === createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 16)`.
  - `labels use the longest common directory, else the directory of the top-PageRank member`: `src/billing/a.ts` with `src/billing/sub/b.ts` gives `src/billing`; `lib/x.ts` with `src/y.ts`, where `y` ranks higher, gives `src`; root files give `.`.
  - `cohesion is internal weight over internal plus boundary weight`, `crossEdges count symbol edges to other candidates by kind`, `coChangePairs keep the top 10 crossing pairs`, `coverage counts candidate files plus assigned hubs over all nodes`.
  - Spec 7.5 determinism, `the same input in reversed order gives byte-identical JSON`: `JSON.stringify` of both views is equal, with indices and each file's symbols reversed.
  - Review Focus 3: `an index without edges puts every node in unclustered` (`coverage` `{ files: 3, covered: 0, ratio: 0 }`) and `no node gives an empty view with ratio 0`.
  - Review Focus 5: `a candidate under a non-ASCII directory with spaces keeps that spelling as its label and the same fingerprint across runs` (`src/ödünç kaydı/*.ts`).
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/core/overlay src/core/contexts-view`. Expected: the new tests FAIL; existing overlay tests pass.
- [ ] **Step 3: Implement.** Move the Louvain call and `splitDisconnectedCommunities` out of `CommunityDetector` unchanged and call them from there; use `compareCodepoint` in the `detectGodNodes` tie-break; write the two contexts-view modules (pipeline order: file graph, hubs, damping, `clusterFiles`, `foldSmallGroups`, hub assignment, IDs and labels, per-candidate fields, collisions, coverage).
- [ ] **Step 4: Run them.** Expected: PASS, including both golden tests. Then `pnpm --filter @ctxo/cli test:unit`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(contexts-view): file-level Louvain candidates with folding, labels and fingerprints (#156)"`

---

### Task 6: `contexts-view.json` at index time

**Files:**
- Create: `packages/cli/src/core/contexts-view/contexts-view-schema.ts`, `packages/cli/src/ports/i-contexts-view-port.ts`, `packages/cli/src/adapters/storage/contexts-view-reader.ts`, `packages/cli/src/cli/index-contexts-view.ts`
- Modify: `packages/cli/src/adapters/storage/architecture-artifacts-writer.ts` (new `writeContextsView`)
- Modify: `packages/cli/src/adapters/storage/json-index-reader.ts` (`collectJsonFiles` skip list, lines 123-131). Before editing: `get_blast_radius` and `get_why_context` on `JsonIndexReader` (22 direct dependents).
- Modify: `packages/cli/src/cli/index-command.ts` (`buildCommunitySnapshot` returns PageRank too; Phase 2d calls the new step)
- Move: the temp-project helper (`createProject`, `TempProject`, `IDENTITY`) from `packages/cli/src/cli/__tests__/index-command.cochange.test.ts` into `packages/cli/src/cli/__tests__/helpers/temp-project.ts` with a cleanup export, unless PR 0 already shares it.
- Test: `packages/cli/src/adapters/storage/__tests__/contexts-view-reader.test.ts`, `architecture-artifacts-writer.test.ts`, `json-index-reader.test.ts` (same folder), `packages/cli/src/cli/__tests__/index-command.contexts-view.test.ts`

**Interfaces:**
- Consumes: `buildContextsView` (Task 5), `createTestFileClassifier` and `indexTestPatterns` (Task 1), `resolveContextsViewConfig` (Task 3), PR 0 `CoChangeReader`.
- Produces:
  ```ts
  export const ContextsViewSchema: z.ZodType<ContextsView>;                      // core/contexts-view/contexts-view-schema.ts
  export interface IContextsViewPort { readContextsView(): ContextsView | undefined }   // ports/i-contexts-view-port.ts
  export class ContextsViewReader implements IContextsViewPort { constructor(ctxoRoot: string) }  // validates, caches by mtime, warns once per bad file version
  // ArchitectureArtifactsWriter
  writeContextsView(view: ContextsView): boolean;   // JSON.stringify(view, null, 2); false and untouched when identical
  // cli/index-contexts-view.ts
  export interface ContextsViewStepOptions {
    readonly projectRoot: string; readonly ctxoRoot: string; readonly config: CtxoConfig;
    readonly indices: readonly FileIndex[];          // the merged full index
    readonly snapshot: CommunitySnapshot;            // this run's snapshot: god nodes and commitSha
    readonly symbolPageRank: ReadonlyMap<string, number>;
  }
  export function computeAndWriteContextsView(options: ContextsViewStepOptions): ContextsView;
  ```
- `isNode(file)` = not a test file, not `index.ignore`, not `contextsView.exclude`, and present in the working tree. `godNodeFiles` are the file parts of `snapshot.godNodes`. `filePageRank` sums `symbolPageRank` per file. The step logs `[ctxo] Contexts view: N candidates cover C/F files (P%), H hubs, U unclustered`. Phase 2d runs it whenever a snapshot was built, so `--skip-community` skips it and incremental runs use the merged full index; a failure logs `[ctxo] Contexts view skipped: <message>` and never stops the index.

- [ ] **Step 1: Write the failing tests.**
  - Reader: `returns the view for a valid file and undefined for a missing one`; Review Focus 4: `returns undefined and warns once for an invalid or conflict-marked file, then reads the repaired file after it changes`.
  - Writer: `writeContextsView writes once and returns false without touching an identical file` (bytes and `mtimeMs` unchanged).
  - JSON reader: `readAll skips contexts-view.json without logging a schema error` (spy on `console.error`; a real index file next to it is still read).
  - Index (temp project from the sample fixture plus `src/billing/a.ts`, `b.ts`, `c.ts`, each importing and calling the next, and `src/billing/__tests__/a.test.ts`):
    - `ctxo index writes contexts-view.json with the billing candidate and no test file`: one candidate labelled `src/billing` with exactly the three files; coverage `{ files: 6, covered: 3, ratio: 0.5 }`; the test file appears nowhere.
    - Spec 7.5: `a second index run on the same commit leaves contexts-view.json byte-identical and unwritten`.
    - `--skip-community leaves an existing contexts-view.json untouched`.
    - `contextsView.exclude and index.tests remove files from the view`.
    - `a deleted file's committed JSON does not make it a node`: delete `src/billing/c.ts` from the working tree, run a full index, and `src/billing/c.ts` appears nowhere in the view.
    - `an incremental --files run writes the same view as a full run`.
    - Review Focus 4: `ctxo index replaces a conflict-marked contexts-view.json`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/adapters/storage src/cli/__tests__/index-command.contexts-view.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `contexts-view.json` to the reader's skip names; make `buildCommunitySnapshot` return `{ snapshot, pagerank }`; call `computeAndWriteContextsView` in Phase 2d after the architecture artifacts.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(index): write contexts-view.json at index time (#156)"`

---

### Task 7: Overlay `mode: "contexts"`, registered hidden params, registration test

**Files:**
- Modify: `packages/cli/src/adapters/mcp/get-architectural-overlay.ts` (`OVERLAY_MODES` line 12, `InputSchema` lines 14-17, handler lines 85-151)
- Modify: `packages/cli/src/adapters/mcp/get-ranked-context.ts` (`InputSchema` lines 14-20: export it, remove `fuzzy`)
- Modify: the other twelve handlers in `packages/cli/src/adapters/mcp/`: `const InputSchema` becomes `export const InputSchema` (no other change)
- Modify: `packages/cli/src/core/response-envelope.ts` (`TRUNCATABLE_FIELDS`, lines 56-70)
- Modify: `packages/cli/src/index.ts` (registrations of `get_architectural_overlay`, `get_ranked_context`, `search_symbols`; overlay wiring)
- Test: `packages/cli/src/adapters/mcp/__tests__/get-architectural-overlay.test.ts`, `packages/cli/src/adapters/mcp/__tests__/get-ranked-context.test.ts`, `packages/cli/tests/e2e/mcp-tool-registration.test.ts`

**Interfaces:**
- Consumes: `IContextsViewPort` and `ContextsViewReader` (Task 6), `ContextsView` (Task 5), `ClusterLabelMasker.mask`.
- Produces:
  - `export const OVERLAY_MODES = ['regex', 'communities', 'both', 'contexts'] as const`, used by the registration in `index.ts` too (`mode: z.enum(OVERLAY_MODES)`).
  - `handleGetArchitecturalOverlay(storage, masking, staleness?, git?, clusterLabelMasker?, contextsView?: IContextsViewPort)`, wired in `index.ts` with `new ContextsViewReader(ctxoRoot)`.
  - `export function buildContextsOverlay(view: ContextsView, options?: { memberPreviewLimit?: number; labelMasker?: ClusterLabelMasker }): Record<string, unknown>`: the view's fields at the top level (`candidates` must be top level to be truncatable), each candidate's `files` and `unclustered.files` capped at 15 (counts kept), labels masked after seeding the masker with the sorted unique labels. With no view the body is `{ hint }` with the text "No contexts view available. Run ctxo index to generate one." `layer` keeps precedence over every mode; `both` stays layers plus communities.
  - `TRUNCATABLE_FIELDS` gains `candidates`, `collisions` and `hubs`, each with the hint "Use ctxo contexts --json for the full contexts view."
  - Registration copy in `index.ts`:
    - `get_architectural_overlay` description: "Get the project architecture map. mode \"both\" (default) returns the regex layer map (Domain, Infrastructure, Adapter, Test, Composition, Configuration) plus data-driven Louvain communities; \"regex\" or \"communities\" returns one of them. mode \"contexts\" returns candidate bounded contexts computed by `ctxo index`: file-level clusters of dependencies and co-change with hub files damped, each with a suggested label, cohesion, top terms, cross-candidate edges and co-change pairs, plus type names whose shapes differ between candidates. Use this when onboarding to a new codebase, validating layer boundaries, or preparing a context map. For symbol-level analysis, use get_logic_slice or get_blast_radius."
    - `mode`: 'View to return: "both" (default) layers plus communities, "regex" layer map, "communities" Louvain clusters, "contexts" candidate contexts (file level)'.
    - `searchMode` on `get_ranked_context`: `z.enum(['fts', 'legacy']).optional().default('fts')`, '"fts" (default): BM25 ranking with camelCase splitting, trigram fallback and typo correction; "legacy": substring matching'.
    - `mode` on `search_symbols`: `z.enum(['regex', 'fts']).optional().default('regex')`, '"regex" (default): case-insensitive regex or substring match on names; "fts": BM25 relevance search'.

- [ ] **Step 1: Write the failing tests.**
  - `mode contexts returns candidates at the top level with files capped at 15 and fileCount kept` (stub port returning a view whose first candidate has 20 files).
  - `mode contexts without a view returns the run ctxo index hint` (port returns `undefined`, which is also what the reader gives for a bad file: Review Focus 4).
  - `mode contexts truncates candidates through the envelope`: `CTXO_RESPONSE_LIMIT=2048` and 40 candidates give `_meta.truncated === true` and a `_meta.hint` containing `ctxo contexts --json`.
  - `mode contexts masks candidate labels that match masking.clusterLabels` (`new ClusterLabelMasker(['src/payment*'])`).
  - `mode both is unchanged and carries no candidates`.
  - Review Focus 2: `get_ranked_context still answers a client that sends the removed fuzzy argument` (`{ query: 'greet', fuzzy: true }` gives results and no `error`).
  - E2e, `tests/e2e/mcp-tool-registration.test.ts`: spawn the built server with `StdioClientTransport({ command: process.execPath, args: [<cli>/dist/index.js], cwd: <empty temp dir>, stderr: 'ignore' })` and call `client.listTools()`.
    - `the server registers exactly the 14 handler tools`.
    - `every tool's properties, required list and enum values match its handler schema`: `z.toJSONSchema(handlerInputSchema, { io: 'input' })` against the registered `inputSchema`, comparing sorted property names, sorted `required`, and sorted `enum` (also `items.enum`) for every property whose handler JSON has one.
    - `overlay mode includes contexts, ranked context has searchMode and no fuzzy, search_symbols has mode`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/adapters/mcp`, then `pnpm --filter @ctxo/cli build && pnpm --filter @ctxo/cli exec vitest run --config vitest.config.e2e.ts tests/e2e/mcp-tool-registration.test.ts`. Expected: FAIL; the e2e test names `get_architectural_overlay`, `get_ranked_context` and `search_symbols`.
- [ ] **Step 3: Implement** the handler mode, the envelope fields, the exports and the three registrations.
- [ ] **Step 4: Run them.** Expected: PASS (rebuild before the e2e run). Then `pnpm --filter @ctxo/cli test:unit` and `pnpm --filter @ctxo/cli lint`. Expected: green.
- [ ] **Step 5: Commit.** `git commit -m "feat(mcp): overlay contexts mode and registered hidden params (#156)"`

---

### Task 8: `ctxo contexts [--json]`

**Files:**
- Create: `packages/cli/src/cli/contexts-command.ts`
- Modify: `packages/cli/src/cli/cli-router.ts` (`route` switch, `printHelp`)
- Test: `packages/cli/src/cli/__tests__/contexts-command.test.ts`, `packages/cli/src/cli/__tests__/cli-router.test.ts`

**Interfaces:**
- Consumes: `ContextsViewReader` (Task 6).
- Produces: `export class ContextsCommand { constructor(projectRoot: string); run(options: { json?: boolean }): void }`.
  - `--json`: the full artifact to stdout (`JSON.stringify(view, null, 2)` plus a newline); without a view, `{"found":false,"hint":"No contexts view. Run ctxo index (without --skip-community)."}`; exit 0.
  - Table to stderr, nothing on stdout: a header `[ctxo] Contexts view at <commitSha>: <n> candidates cover <covered>/<files> files (<pct>%), <h> hubs, <u> unclustered, <c> collisions`; one line per candidate `#<id>  <fileCount> files  cohesion <c>  <label>  terms: <top 3>`; one line per hub `hub <file> (<reasons>, <dependents> dependents) -> #<id> | unassigned`; without a view, the same hint on stderr.
  - Help lines: `ctxo contexts             Candidate contexts from dependency and co-change clusters (table)` and `ctxo contexts --json      Same, full contexts-view.json to stdout`.

- [ ] **Step 1: Write the failing tests.**
  - `--json prints the full contexts view to stdout`; `without --json prints the table to stderr and nothing to stdout` (header counts, every label, the hub line).
  - Review Focus 3: `a view with zero candidates prints the header and the unclustered count`.
  - Review Focus 4: `a missing or invalid view prints found:false with --json and the hint on stderr without it`.
  - Router: `routes contexts --json to ContextsCommand.run` (constructor spy as in the update test, options `{ json: true }`); `help documents ctxo contexts and ctxo contexts --json`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/cli/__tests__/contexts-command.test.ts src/cli/__tests__/cli-router.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the command, the `contexts` case and the help lines.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(cli): ctxo contexts command (#156)"`

---

### Task 9: K20 experiment, `cochange.unit: commit | merge`

**Files:**
- Modify: `packages/cli/src/core/types.ts` (`ChangeSetUnit`, `CoChangeWindowMeta.unit`, `CoChangeWindowMetaSchema`)
- Modify: `packages/cli/src/ports/i-git-port.ts` and `packages/cli/src/adapters/git/simple-git-adapter.ts` (`getChangeLog`)
- Modify: `packages/cli/src/core/config/config-schema.ts` (`CoChangeConfigSchema.unit`), `packages/cli/src/core/config/load-config.ts` (`ResolvedCoChangeConfig.unit`, `resolveCoChangeConfig`)
- Modify: `packages/cli/src/core/co-change/co-change-analyzer.ts` (`CoChangeBuildOptions.unit`)
- Modify: `packages/cli/src/cli/index-cochange.ts` (`writeCoChangeMatrix`, `describeCoChangeWindow`, new `coChangeCommitsFor`) and `packages/cli/src/cli/index-command.ts` (Phase 2b)
- Test: `packages/cli/src/adapters/git/__tests__/simple-git-adapter.change-log.test.ts`, `packages/cli/src/core/co-change/__tests__/co-change-analyzer.test.ts`, `packages/cli/src/core/config/__tests__/cochange-config.test.ts`, `packages/cli/src/cli/__tests__/index-command.cochange.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChangeSetUnit = 'commit' | 'merge';                                         // core/types.ts
  // CoChangeWindowMeta: readonly unit?: ChangeSetUnit   (written only for 'merge'; schema z.enum optional)
  getChangeLog?(maxCommits: number | 'all', unit?: ChangeSetUnit): Promise<ChangeLog | undefined>;   // IGitPort; default 'commit'
  // ResolvedCoChangeConfig: readonly unit: ChangeSetUnit (default 'commit'); CoChangeBuildOptions: readonly unit?: ChangeSetUnit
  export async function coChangeCommitsFor(git: IGitPort, coChange: ResolvedCoChangeConfig, commitLog: readonly CanonicalCommit[]): Promise<readonly CanonicalCommit[] | undefined>;
  ```
- `merge` replaces `--no-merges` with `--first-parent --diff-merges=first-parent` (git 2.31 or later), so a merge record lists the files of `git diff M^1 M`. `coChangeCommitsFor` returns `commitLog` for `commit`; for `merge` it canonicalizes `getChangeLog(coChange.maxCommits, 'merge')` and returns `undefined` on failure, in which case Phase 2b writes nothing (never replace a good matrix). `intent[]` always uses the commit-unit log. The window log line says `first-parent change sets` in `merge` mode.

- [ ] **Step 1: Write the failing tests** (every commit and merge with the `IDENTITY` flags; reuse `createRepo` and `createMergedHistory`).
  - Adapter: `getChangeLog with unit merge walks HEAD's first-parent history and gives a --no-ff merge the files of git diff M^1 M`: on `createMergedHistory` the entries are `[merge, c3, c1]`, the merge entry lists `src/side.ts`, and `c2` is absent.
  - Adapter: `a squash-merged commit and fast-forwarded commits stay their own change sets` (`git merge --squash` then commit; `git merge --ff-only`); `merge mode honours maxCommits over first-parent entries`.
  - Analyzer: `window records unit merge and omits unit for commit`.
  - Config: `cochange.unit defaults to commit, accepts merge and rejects other values`.
  - Index: `merge mode makes files changed in different commits of one merged branch co-change`: two branches, each changing `src/greet.ts` in one commit and `src/types.ts` in another, merged with `--no-ff`; in `merge` mode the pair has `sharedCommits` 2 and `window.unit` is `merge`; in `commit` mode the pair is absent.
  - Index: `merge mode skips a merge whose diff exceeds maxFilesPerCommit as massSkipped`; `on a linear history merge mode gives the same entries as commit mode`; `merge mode leaves intent[] built from non-merge commits`.
- [ ] **Step 2: Run them.** `pnpm --filter @ctxo/cli exec vitest run src/adapters/git src/core/co-change src/core/config src/cli/__tests__/index-command.cochange.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the unit through port, adapter, config, analyzer and Phase 2b.
- [ ] **Step 4: Run them.** Expected: PASS. Then `pnpm --filter @ctxo/cli test:unit`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(cochange): experimental change-set unit cochange.unit merge (K20, #156)"`

---

### Task 10: Fixture acceptance and tuning (private)

Nothing from the fixture is committed. Everything below runs in the private fixture clone (path in the owner's brief), never in its original checkout.

- [ ] **Step 1:** Build the branch (`pnpm -r build`). In the clone, write a private `.ctxo/config.yaml` with the spec 14 filters (`cochange.maxCommits: all`, `cochange.exclude` set to the test folders, `cochange.include: ["**/*.sql"]`) and default `contextsView`. If a test folder escapes the default globs, add it to `index.tests` and note it (aggregate only) as a candidate for the default list. Run `node <worktree>/packages/cli/dist/index.js index`. Expected: success and the contexts-view log line.
- [ ] **Step 2:** Save `ctxo contexts --json` and `co-changes.json` to the session scratchpad. Check spec 7.5: at most 30 candidates; `coverage.ratio` at least 0.90; the spec 7.5 hub case listed in `hubs` with the areas it connects in different candidates; collisions listed.
- [ ] **Step 3:** With a scratchpad-only script, map candidates to the oracle's units: units split over two or more candidates, candidates merging two or more units, uncovered files. Write an explanation of every split and merge in the scratchpad.
- [ ] **Step 4:** If Step 2 fails, tune one setting at a time (`resolution`, `minCandidateFiles`, `hubs.topPercent`, `hubs.minDependents`, `weights`) in the private config and record each trial's aggregate numbers in the scratchpad. When the best setting differs from a code default, change that constant in `config-schema.ts`, update the default assertions in `contexts-view-config.test.ts`, run `pnpm --filter @ctxo/cli test:unit`, and commit `feat(contexts-view): defaults tuned on fixture evidence` (no fixture data in the message). If no setting meets acceptance, stop and report the numbers to the owner.
- [ ] **Step 5:** Run the index twice more. Expected: byte-identical `contexts-view.json`. Record the duration of the contexts-view step.
- [ ] **Step 6:** Write the aggregate numbers and anonymised explanations (for example "two units split along an internal API seam") into the PR description draft in the scratchpad.

---

### Task 11: K20 measurement (private, results only in the scratchpad)

- [ ] **Step 1:** In the fixture clone, keep Task 10's config, set `cochange.unit: merge` and re-index. Save the outputs to the scratchpad.
- [ ] **Step 2:** For both units, record in one scratchpad table: co-change pair count, `commitsUsed` (change sets in `merge`), `massSkipped`, candidates, coverage, units split, candidates merging units, the spec 7.5 hub case, and the co-change pass duration (budget 3 s, spec 13.4).
- [ ] **Step 3:** Repeat Steps 1 and 2 on a scratch clone of this repository (`git clone --no-hardlinks <worktree> <scratchpad>/ctxo-self`), never on the worktree, whose `.ctxo/` is tracked.
- [ ] **Step 4:** Restore `cochange.unit: commit` in the clone. Add the table to the PR description draft and stop: the owner decides between keeping `merge` as an option, recommending it, or a separate feature issue. Open no issue.

---

### Task 12: Docs, ADR-016 addendum, help, changeset and full verification

**Files:**
- Modify: `docs/architecture/ADR/adr-016-co-change-engine-and-snapshot-policy.md`, `docs/features/architectural-intelligence.md`, `docs/roadmap.md`, `CHANGELOG.md`, `llms.txt`, `llms-full.txt`, `CLAUDE.md`
- Create: `site/docs/cli/contexts.md`, `.changeset/contexts-view.md`
- Modify: `site/docs/.vitepress/config.ts` (CLI sidebar: `ctxo contexts` after `ctxo gate`), `site/docs/cli/index.md`, `site/docs/cli/config-yaml.md`, `site/docs/reference/config-schema.md`, `site/docs/reference/response-envelope.md`, `site/docs/mcp-tools/get-architectural-overlay.md`, `site/docs/mcp-tools/get-ranked-context.md`, `site/docs/mcp-tools/overview.md`, `site/docs/mcp-tools/tool-selection-guide.md`
- No change: `README.md` (it lists no full command or tool set); `site/docs/mcp-tools/search-symbols.md` (already documents `mode`).

- [ ] **Step 1: ADR-016 addendum** "Contexts view defaults (PR 1A)": the K4 defaults and Designer calls 1 to 8 with Task 10's aggregate evidence, the alternatives rejected (symbol-level contexts, Leiden, data-access weight before PR 1B), and the K20 experiment with "decision pending the owner".
- [ ] **Step 2: Feature doc and roadmap.** Add section "5. Candidate contexts" (graph, weights, hubs, folding, labels, terms, collisions, surfaces, refresh cadence: every index and hook run, skipped by `--skip-community`, not by `ctxo watch`) and the new config to "Configuration". Roadmap: a shipped bullet under "Code intelligence"; deferred rows "Contexts view refresh in `ctxo watch`" (trigger: users reading the view during long watch sessions) and "`cochange.unit: merge` as the recommended mode" (trigger: the owner's K20 decision).
- [ ] **Step 3: CHANGELOG `[Unreleased]`.** Added: contexts view and `contexts-view.json`, overlay `mode: "contexts"`, `ctxo contexts`, the `communities:`, `contextsView:` and `index.tests` config, the shared test classifier, experimental `cochange.unit: merge`. Fixed: overlay `mode`, ranked `searchMode` and search `mode` are registered, so clients can send them; god-node ties in code point order. Removed: the unused `fuzzy` parameter (typo correction stays automatic in `fts` mode).
- [ ] **Step 4: llms files and CLAUDE.md.** Tool reference entries for the three parameters (no `fuzzy`), the overlay modes and return shape, `ctxo contexts`, the new config, a "New in <release>" bullet list in `llms.txt`, where `<release>` is the version `pnpm changeset status` reports (expected 0.13 if the staged release lands first); CLAUDE.md Quick Reference lines for `ctxo contexts [--json]`, the overlay row of the tool table, and the config schema block.
- [ ] **Step 5: Site docs.** The new `ctxo contexts` page (synopsis, flags, table and JSON examples with synthetic paths); `ctxo index` (contexts-view.json, `--skip-community`); both config pages (four sections with defaults and bounds); the envelope page (`candidates`, `collisions`, `hubs`, plus the already-truncatable `clusters` and `clustersAffected`); the overlay page (`"contexts"` row, request and response example); the ranked-context page (drop the `fuzzy` row, reword point 4: "in `fts` mode typo correction runs automatically and is reported in `fuzzyCorrection`"); overview and tool-selection guide ("preparing a context map -> get_architectural_overlay(mode: \"contexts\")").
- [ ] **Step 6: Help and descriptions.** `pnpm --filter @ctxo/cli build && node packages/cli/dist/index.js --help`. Expected: both `ctxo contexts` lines. The Task 7 descriptions are in `index.ts`.
- [ ] **Step 7: Changeset** `.changeset/contexts-view.md` with `"@ctxo/cli": minor` and a two-sentence note naming #156 Phase 1.
- [ ] **Step 8: No em dashes.** `git diff -U0 HEAD -- docs CHANGELOG.md llms.txt llms-full.txt CLAUDE.md site .changeset | LC_ALL=C.UTF-8 grep -nP '^\+.*\x{2014}'` (plain `grep -P` fails under this machine's default locale). Expected: no output.
- [ ] **Step 9: Full verification.** `pnpm -r build && pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm --filter @ctxo/cli test:e2e`. Expected: all green, including the tarball test (raise the limit per Global Constraints if crossed).
- [ ] **Step 10: Commit.** `git commit -m "docs: contexts view, overlay modes, config sections and changeset (#156)"` (explicit paths; never `.ctxo/`).
