# Domain Knowledge Layer, Data Coupling and Co-change Repair - Design Spec

- **Date:** 2026-10-20
- **Status:** Draft for owner review
- **Author:** Alper Hankendi (design session with Claude)
- **Issues:** #156 (Phases 0-4), #157 (including the snapshot comment), #159
- **Related:** ADR-001, ADR-004, ADR-012, ADR-015, #70, #56

---

## 1. Why

A team keeps domain knowledge per bounded context as markdown cards in its own repo. It wants two things from its coding agent: read the right card when it touches that context's code, and update the card in the same PR when behaviour changes. Spec-driven tools produce per-change specs, a record of past work; the domain itself has no home. The cards are that home.

Ctxo supplies only the deterministic parts:

- **Structure:** candidate contexts from dependency and co-change clusters, data coupling through SQL tables and procedures, term collisions.
- **Linkage:** rules to tests and code, decisions to their provenance, contexts to paths.
- **Verification:** a CI gate and hooks that check structure, never meaning.
- **Retrieval:** MCP tools and additive fields that hand the agent the right card content.

Frame: **tools recover structure, humans recover meaning.**

Today the raw material is incomplete. The co-change matrix is wiped by every post-commit run (#157), snapshot history fills with duplicates of one commit, blast radius ignores co-change, coupling through SQL is invisible, and nothing links knowledge to code.

## 2. Principles (non-negotiable)

1. **No authoring.** Ctxo never writes domain text: no LLM calls, no generated card text, definitions or summaries. Generated loader files are pointers, not knowledge.
2. **The consuming repo is the single source of truth.** Everything Ctxo derives is rebuildable from the repo and its git history.
3. **Deterministic computational sensors only.** Structural checks may block. Semantic judgement is out of scope.
4. **Additive.** Optional fields on existing tools first, very few new tools. A repo with no registry and no `docs/domain` sees no new fields and no new errors.
5. **Opt-in.** The domain layer is `@ctxo/domain`; SQL support is the language plugin `@ctxo/lang-sql`. The core stays code intelligence. ADR-018 records the boundary with ADR-004.
6. **Expensive analysis runs at `ctxo index` time** and is stored in the index. MCP tools only read it.

## 3. Goals, non-goals, anti-goals

### Goals

- **G1** Co-change data is correct, never wiped, has its own depth, and feeds blast radius and the safe-edit gate.
- **G2** History holds at most one community snapshot per commit; drift and boundary confidence count distinct commits.
- **G3** An as-is context map: candidate contexts from file-level dependency and co-change clusters with hub damping, tables shared between candidates, and term collisions.
- **G4** Named contexts with deterministic guards: a registry, `contexts-touched`, a domain fold guard, a `verify-domain` CI gate, generated path-scoped loader rules, boundary violations and drift by named context.
- **G5** Domain knowledge in a graph of its own: rules, terms and decisions linked to tests, symbols and provenance; additive fields on existing tools; two new tools; a domain scope for ranked search.
- **G6** Support for the agentic Deletion Test loop: shadow-spec candidates and per-context metrics with a suggested maturity rung.
- **G7** Tiered agent rules (#159): a compact always-loaded block where the guard and skills exist, the full block elsewhere.

### Non-goals

- Generating card text, glossary definitions or summaries.
- Fetching or indexing external documentation (ADR-004 stands). External provenance (issue URLs) is stored as a string and never fetched.
- Running or scheduling the agentic loop.
- Judging whether a card correctly describes a change.
- NoSQL and messaging support (future path recorded in ADR-017 and the roadmap; see section 17).
- Domain isolation and bounded-context visualization (owner will evaluate in separate sessions).
- Multi-repo linking. Keep IDs and links general enough for frontend repos that link to backend cards; do not build it.
- Leiden community detection, the "new violations only" boundary mode, a Cursor stop-hook reminder, the #159 Grep hint (all deferred, section 17).

### Anti-goals (failure even if it technically works)

- Domain features add fields or errors to a repo that has no `@ctxo/domain`, registry or `docs/domain`. (Code-intelligence additions in PR 0 to 1B are additive by design: new modes, kinds, annotations and fields, documented in the changelog.)
- The same input gives a different output (wall-clock windows, unseeded randomness, unordered collections).
- A hook loops, blocks on an internal error, or blocks work that has no committed context change.
- `verify-domain` fails a brownfield repo on day one under default settings.
- Editing a card shifts code clusters or creates drift events.
- Anything from the private fixture (code, paths, table names, business rules) lands in the public repo, its tests, docs, commits, issues or PRs.

## 4. Constraints

- pnpm monorepo, TypeScript ESM, Node >= 20, vitest, tests co-located in `__tests__/`.
- Hexagonal rules inside `@ctxo/cli`: `core/` never imports `adapters/` or `ports/`; the composition root wires adapters; no barrel exports; every adapter implements a port.
- Never `console.log` (stdout is JSON-RPC); use `createLogger('ctxo:<ns>')`. Adapters warn and continue. All MCP responses pass through the masking pipeline.
- Language plugins import only from `@ctxo/plugin-api`, never from `@ctxo/cli`. Two documented exceptions: language plugins may depend on Ctxo-owned, zero-dependency utility packages (today only `@ctxo/sql-extract`, ADR-017), and `@ctxo/domain`, which is not a language plugin, uses the CLI's internal API (K7, ADR-018).
- The CLI tarball limit (1350 KB, `packages/cli/tests/e2e/release-packaging.test.ts`) guards against bloat. About 800 KB of today's roughly 1260 KB is sourcemaps. When a PR crosses the limit, it raises the limit with the measured size and the reason in the PR description (established practice); sourcemaps keep shipping.
- Plugin protocol: core keeps accepting `apiVersion: '1'` for at least 12 months after `'2'` ships (ADR-012).
- Changesets drive releases. Plugins declare `peerDependencies "@ctxo/plugin-api": "^0.7.3"`, so a plugin-api minor bump to 0.8.0 falls out of range unless the ranges are widened in the same PR.
- Claude Code hook behaviour was verified against the official docs on 2026-10-20 (section 13.6). Re-verify with `claude --debug` while implementing.
- Repo text in English, no em dashes, no `Co-Authored-By` lines. Never push, open PRs, publish or comment on issues without the owner's approval.

## 5. Delivery plan

One PR per row. Each PR gets its own plan in `docs/superpowers/plans/`, its own worktree and branch, TDD, a changeset, docs (`llms.txt`, `llms-full.txt`, the feature doc, `docs/roadmap.md`, `CHANGELOG.md`), an ADR where a decision is made, and a comparison run on the private fixture (section 14).

| PR | Phase | Scope | Packages | ADR |
|---|---|---|---|---|
| 0 | 0 | Co-change engine and window, incremental indexing, one snapshot per commit, distinct-commit confidence, blast radius and gate use co-change, renames | cli | ADR-016 |
| 1A | 1 | Contexts view (file level), term harvest for types, `communities:` config, hidden MCP params exposed | cli | none (decisions in ADR-016 addendum or this spec) |
| 1B | 1 | Plugin protocol v2 (kinds, annotations, facts protocol), core v2 support, `@ctxo/sql-extract`, `@ctxo/lang-sql`, Roslyn annotations and SQL call sites, data coupling in the contexts view | plugin-api, cli, lang-csharp, sql-extract (new), lang-sql (new), other lang-* (peer ranges) | ADR-017 (first commit) |
| 1C | 1 | Language parity (K18): SQL call sites, annotations and test symbols for TypeScript, Java and Go | lang-typescript, lang-java, lang-java-analyzer, lang-go | ADR-017 addendum |
| 2A | 2 | Tiered agent rules (#159), granular `ctxo init`, doctor checks, rules writer fixes | cli | ADR-015 amendment |
| 2B | 2 | `@ctxo/domain`: registry, `contexts-touched`, fold guard, `verify-domain`, loader rules, boundaries and drift by named context, `context` field | domain (new), cli | ADR-018 (first commit) |
| 3 | 3 | Card parser, domain graph, rule/test/symbol/decision/term links, additive fields, `get_domain_context`, `get_rule`, domain scope in `get_ranked_context` | domain, cli, lang-csharp (if needed) | none expected |
| 4 | 4 | Fact detectors in four languages, `find_shadow_specs`, `get_context_map` | domain, lang-typescript, lang-csharp, lang-go, lang-java | none expected |

Order: 0, 1A, 1B, 1C, 2A, 2B, 3, 4. Dependencies: 1A needs 0 (co-change); 1B adds data coupling to the 1A view; 1C needs 1B (protocol v2, `@ctxo/sql-extract`, capabilities); 2B needs 0; 3 needs 2B, 1B and 1C (annotations, test symbols); 4 needs 3 and 1B (facts protocol). Phase acceptance for Phase 1 is complete at the end of 1C, for Phase 2 at the end of 2B.

---

## 6. PR 0 - Co-change engine, snapshots, blast radius (#157, Phase 0)

### 6.1 Problems being fixed (all verified by reading code)

- `ctxo index --file` aggregates co-change over the one re-indexed file and overwrites `co-changes.json` with `[]` (`packages/cli/src/cli/index-command.ts` Phase 2b). The post-commit hook runs this once per changed file, so the matrix is always empty. Ctxo's own committed matrix went from 1126 entries to 0.
- Co-change depth is tied to `--max-history` through `intent[]` (20 commits per file from the newest 1000 repo commits). No `--follow`, no cap on files per commit.
- `writeSnapshot` archives the previous snapshot on every run with no same-SHA check (`community-snapshot-writer.ts`), so one commit can fill the 10-slot history. Confidence counts snapshot files (`drift-detector.ts`, `boundary-violation-detector.ts`).
- Only `get_pr_impact` loads co-change. `get_blast_radius`, `ctxo blast-radius`, `gate-hook`, `gate --preview` and `get_context_for_task` call the calculator without it, although the tool description promises "likely (co-changed)".
- `--file` also empties the SQLite cache (`initEmpty` + `bulkWrite([X])`), builds `boundary-violations.json` from the one-file graph, and `safeHeadSha` treats a Promise as a string.
- `installHook` returns early when the marker exists, so a changed hook never reaches existing installs; it also ignores `core.hooksPath`.
- Docs and detector hints claim `ctxo index --check` builds snapshot history; it writes nothing.

### 6.2 Co-change engine

- **Source:** one pass of `git log --no-merges -M --name-status` over commits reachable from HEAD, newest first, through a new git port method (for example `getChangeLog(window)` returning `{ sha, committedAt, changes: [{ status, path, oldPath? }] }[]`). The core analyzer stays pure.
- **Window (K5):** the last `maxCommits` non-merge commits from HEAD (default 2000), optionally narrowed by `since` (a duration such as `12m`, anchored to HEAD's committer date, never the wall clock), or `maxCommits: all`. Both limits apply when both are set. The window is independent of `--max-history`, which keeps controlling `intent[]` only.
- **Processing (newest first, same rules as the oracle):**
  - Maintain a canonical rename map: a path renamed later maps to its newest name.
  - Keep only paths that are currently indexed files (any language plugin), plus tracked files matching `cochange.include` (default empty; for example `**/*.sql` before lang-sql exists, or cards later), minus files matching `cochange.exclude`. `exclude` is applied last, so it also vetoes files that `include` added. Deleted files drop out. On a full run the indexed set is the files the run discovered plus the surviving committed entries, so the committed matrix does not depend on which language plugins are installed on the machine.
  - A commit with no remaining file is ignored. A commit whose remaining file count exceeds `maxFilesPerCommit` (default 30) is skipped and counted as `massSkipped`; the threshold counts files after filtering. The others count as `commitsUsed`.
  - Count commits per file and shared commits per file pair.
- **Entries:** keep the existing `CoChangeEntry` schema and thresholds (`sharedCommits >= minShared` (default 2), `frequency = shared / min(countA, countB) >= 0.1`). Sort by frequency desc, shared desc, then `file1`, `file2`.
- **Metadata:** add `window` to `co-changes.json`: `{ maxCommits, since?, head, commitsScanned, commitsUsed, massSkipped, maxFilesPerCommit, minShared }`. The file is rewritten only when entries or window changed (the timestamp alone never causes a write).
- **Renames in history:** the same pass feeds `intent[]`, so per-file history follows renames. Merge commits are excluded (they never listed files anyway).
- **Cost:** no cache in the first version. If the full pass exceeds 2 s on the fixture, add `.ctxo/.cache/cochange-log.json` keyed by SHA and parse only `lastHead..HEAD` (full rebuild when `lastHead` is not an ancestor).

### 6.3 Incremental indexing and the post-commit hook

- New flags:
  - `ctxo index --files <path...>`: re-index an explicit list.
  - `ctxo index --commit <rev>`: re-index the files changed by one commit. The CLI reads `git diff-tree --root --no-commit-id -r -M --name-status <rev>` itself, so spaces, deletions, renames and the first commit work. Deleted files have their JSON and SQLite rows removed; a rename removes the old entry and indexes the new path.
  - `--file <path>` stays as an alias of `--files <path>`.
- Incremental semantics (both flags):
  - Load the symbol registry from the committed JSON of all other files before extracting, so cross-file edge kinds resolve as in a full run.
  - Write only the touched files' JSON. Rebuild the SQLite cache from the merged full index (`initEmpty` + `bulkWrite(merged)`), never from the touched files alone and never through `init()`, which re-inserts rows without clearing and duplicates edges.
  - Recompute co-change from git for the whole repo (6.2), never from the pending files.
  - Recompute communities on the merged full graph (unchanged behaviour), write one snapshot (6.4), and compute drift and boundary artifacts from the full graph.
- Hook block (the version marker allows upgrades):

```sh
# ctxo-start v2
# Incremental re-index of the files changed by this commit (one run per commit)
if [ -d .ctxo ] && command -v ctxo >/dev/null 2>&1; then
  ctxo index --commit HEAD >/dev/null 2>&1 || true
fi
# ctxo-end
```

- `installHook` replaces the first complete block between `# ctxo-start` and `# ctxo-end` (old unversioned blocks included, the user's lines around it kept) and removes every further complete ctxo block, so duplicates collapse into one. It resolves the hooks directory with `git rev-parse --git-path hooks`. `ctxo init` and `ctxo doctor --fix` both upgrade it. A new doctor check `git_hooks` reports a missing, outdated or duplicated block (this also revives the dead `git_hooks` fix mapping).
- Shared hooks directories are refused (owner decision K23). When `git config --show-scope --get core.hooksPath` reports the `global` or `system` scope, the directory is shared by every repository on the machine: `ctxo init` and `ctxo doctor --fix` write nothing there, print the two blocks to add by hand and the `git config --local core.hooksPath <dir>` alternative, and carry on (the `doctor --fix` attempt is reported as skipped, not failed). A local `core.hooksPath` is honoured. The `[ -d .ctxo ]` guard in both blocks keeps a hand-added block harmless in repositories that do not use ctxo. `--show-scope` needs git 2.26 or newer; on an older git the directory is treated as not shared. A current block added by hand to a shared directory makes `git_hooks` pass.
- A full run uses only the files it discovers (communities, SQLite and the artifacts come from them) and prunes the index entries of deleted or newly ignored sources, never those of skip-worktree paths (sparse checkout); if that query fails, nothing is pruned. Incremental runs use the merged index.

### 6.4 Snapshots and confidence

- When the current `communities.json` has the same `commitSha` as the new snapshot, overwrite the current file without archiving. History therefore holds at most one snapshot per commit (`nocommit` handling unchanged).
- `listHistory` de-duplicates existing histories by `commitSha` (keeps the newest per SHA), so old repos get correct numbers without a migration.
- Drift compares against the newest history entry whose `commitSha` differs from the current one.
- Drift and boundary results keep `snapshotsAvailable` (the number of history entries passed in, for compatibility) and add `distinctCommits`. Confidence uses distinct commits with the existing thresholds: fewer than 3 low, 3 to 6 medium, 7 or more high. Boundary confidence needs at least 2 distinct commits.
- `ctxo index --check` writes nothing and records no snapshot. The docs, the detector hints and the declined-hooks advice in `ctxo init` say so, and point to the post-commit hook or `ctxo index` after commits instead.

### 6.5 Blast radius and the gate use co-change

- One adapter-level loader reads and validates `co-changes.json` (a zod schema for `CoChangeMatrix`), caches it by mtime, and returns `Map<file, CoChangeEntry[]>` or nothing. Every caller passes it to `BlastRadiusCalculator.calculate`: `get_blast_radius`, `get_pr_impact` (replacing its private loader), `get_context_for_task`, `ctxo blast-radius`, `gate-hook`, `gate --preview`.
- Tiering rule unchanged: a `potential` dependent whose file co-changes with the root symbol's file at `frequency > 0.5` becomes `likely`.
- New additive field on `get_blast_radius` and `ctxo blast-radius`: `coChangedFiles`, the top 10 files that co-change with the root's file (`frequency >= 0.5`) but have no graph path to it. Informational only: not counted in tiers, risk scores or the gate.
- Consequence to document: the gate counts `confirmed + likely`, so it may fire somewhat more often on symbols with co-changing dependents. That is the intent of #156.

### 6.6 Config

```yaml
cochange:
  maxCommits: 2000        # number or "all"
  # since: 12m            # optional; d, w, m, y; anchored to HEAD's committer date
  maxFilesPerCommit: 30
  minShared: 2
  include: []             # extra tracked, non-indexed files to analyse (globs)
  exclude: []             # indexed files to leave out of co-change (globs)
```

CLI overrides: `--cochange-commits <n|all>`, `--cochange-since <duration>`.

### 6.7 Acceptance (PR 0)

- With an existing matrix, `ctxo index --commit HEAD` and `--files` keep every entry (the matrix equals a full run's matrix for the same HEAD).
- The window is configurable independently of `--max-history`; `co-changes.json` records it.
- `get_blast_radius`, `ctxo blast-radius`, the gate and `gate --preview` return `likely` dependents upgraded by co-change.
- Two runs on the same commit leave one history entry for that commit; confidence counts distinct commits.
- Renames: a temp-repo test with `git mv` keeps co-change and `intent[]` across the rename.
- Merge commits are excluded from the log, and commits above `maxFilesPerCommit` are skipped and counted (`massSkipped`).
- Fixture: `commitsUsed`, `massSkipped` and file-pair co-change agree with the oracle under the same file filter (section 14).

---

## 7. PR 1A - Contexts view (Phase 1)

### 7.1 Shared test-file classifier

There are two hard-coded test pattern lists today (`dead-code-detector.ts`, `architectural-overlay.ts`), both TypeScript-centric. Add one core classifier used by the contexts view and later by `@ctxo/domain`:

- Default globs: `**/__tests__/**`, `**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`, `**/*_test.go`, `**/src/test/**`, `**/*.Tests/**`, `**/*.Test/**`, `**/*Tests.cs`, `**/*Test.cs`, `**/test_*.py`, `**/*_test.py`.
- Extra globs from `index.tests` in config.
- After PR 1B, a file is also a test file when it contains a symbol annotated with a test framework attribute (`Fact`, `Theory`, `Test`, `TestCase`, `TestMethod`).
- The dead-code detector may switch to it later; not required in this PR.

### 7.2 Graph (K4)

- **Nodes:** indexed non-test files, minus `index.ignore` and `contextsView.exclude`.
- **Dependency weight:** for each file pair, count distinct symbol edges in both directions (kind weight 1.0 for `calls`, `extends`, `implements`, `uses`; 0.5 for `imports`). Normalize: `dep = log2(1 + count) / log2(1 + maxCount)`.
- **Co-change weight:** `frequency` from `co-changes.json` for the pair (0 if absent).
- **Combined:** `w = weights.dependency * dep + weights.coChange * co` (defaults 1.0 and 1.0).
- **Hub damping:**
  - Automatic: a file is a hub when it holds a god node from `communities.json`, or when its number of distinct dependent files is in the top `hubs.topPercent` (default 1) and at least `hubs.minDependents` (default 10). Every edge touching a hub is multiplied by `1 / log2(2 + dependents)`.
  - Configured: files matching `hubs.paths` lose all their edges (weight 0).
  - Hubs are reported separately and assigned to the candidate of their strongest remaining edge, if any.
- **Clustering:** Louvain with `resolution` (default 1.0), the same determinism measures as `CommunityDetector` (sorted nodes, `randomWalk: false`, codepoint ordering) and its `splitDisconnectedCommunities`.
- **Post-processing:** candidates with fewer than `minCandidateFiles` (default 3) files fold into the neighbouring candidate with the strongest total weight; isolated small groups go to `unclustered`.
- **Identity and labels:** labels are computed first, then IDs: candidate IDs are sequential by size desc, then final label, then first member; each also carries a `fingerprint` (hash of its sorted members). The suggested label (K34) starts as the longest common directory of the members, joined with `/` and keeping the original spelling; when that is the repo root, it is the directory of the member with the highest file-level PageRank (ties: first member), and `.` if that is the root too. Then, in one refinement pass, every label shared by two or more candidates is replaced, for each of them, by the directory of its own top-PageRank member (`.` at the root); labels may still repeat after it. No automatic domain naming.
- **Per candidate:** `id`, `label`, `fingerprint`, `files` (capped list plus count), `cohesion` (internal weight / (internal + boundary weight)), `topTerms` (7.3), `sharedTables` (added by PR 1B), `crossEdges` (to other candidates, with counts by kind) and `coChangePairs` crossing candidates (top N).
- **Output:** `{ candidates, unclustered, hubs, settings, coverage: { files, covered, ratio } }`.
- Numbers are tuned on the fixture and recorded with their evidence in ADR-016's addendum or the PR description.

### 7.3 Term harvest (types in 1A, tables in 1B)

- Per candidate, dominant identifiers: type names (`class`, `interface`, `type`, enum types), enum members, and, after 1B, table and view names and columns. Tokenize with the existing symbol tokenizer (camelCase, PascalCase, snake_case), drop stop words and a configurable list of technical suffixes (`Service`, `Repository`, `Controller`, `Handler`, `Manager`, `Dto`, `Impl`, `Async`, interface `I` prefix). Rank by number of files; top 10 with counts.
- **Collisions:** the same normalized name (case-insensitive) as a type or table in two candidates whose shapes differ: member names for types, column names for tables, Jaccard similarity below 0.5. Output each collision with the occurrences and their member sets. This is input for a glossary session, not a definition.

### 7.4 Surfaces

- Computed at `ctxo index` time together with communities (skipped by `--skip-community`), stored in `.ctxo/index/contexts-view.json`.
- MCP: `get_architectural_overlay({ mode: "contexts" })`. Register `mode` in the tool schema in `packages/cli/src/index.ts`: today it exists only in the handler schema, so clients can never send it. Fix the other hidden params the same way: `searchMode` on `get_ranked_context`, `mode` on `search_symbols`; remove the unused `fuzzy` param from handler and docs. Add a registration test comparing tool registration schemas with handler schemas.
- `candidates` is truncation-aware (add it to `TRUNCATABLE_FIELDS`); member lists are capped per candidate with counts.
- CLI: `ctxo contexts [--json]` (JSON to stdout, a table to stderr).
- Config:

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

- `JsonIndexReader` must skip `contexts-view.json` (it parses every unknown JSON file as a FileIndex).

### 7.4a Experiment: change-set unit for co-change (K20)

Measured in PR 1A and left out; tracked in #165.

- Commits are not always the unit of a logical change. Our own flow lands one PR as many small commits (test, code, docs), so files changed in different commits of one PR never count as co-changing.
- Add `cochange.unit: commit | merge` (default `commit`, so the oracle comparison stays like for like).
- In `merge` mode, the default branch's first-parent history defines change sets, using git only (no hosting API):
  - a merge commit `M` is one change set with the files of `git diff M^1 M`;
  - a squash-merged commit is its own change set;
  - commits without a recoverable boundary (rebase or fast-forward merges) stay single change sets.

  The mass threshold and all other rules apply per change set.
- Measure both modes on the fixture: contexts-view candidates against the oracle's units (splits, merges, coverage), plus the co-change pair count. Record the numbers in the PR.
- The owner decides after measurement: keep `merge` as an option, make it the recommended mode, or track it as a separate feature issue. No issue is opened without the owner's approval.

### 7.5 Acceptance (PR 1A)

- Same input twice gives byte-identical `contexts-view.json`.
- Synthetic test: two areas that share only a hub file land in different candidates with damping and merge without it.
- Fixture: at most 30 candidates covering at least 90% of non-test source files; the shared connection-factory hub no longer merges the four unrelated sync areas; collisions listed. Each candidate's composition is compared with the oracle's units, and every split or merge is explained.

---

## 8. PR 1B - Plugin protocol v2, data coupling, @ctxo/lang-sql (Phase 1)

ADR-017 is the first commit of this PR.

### 8.1 ADR-017 scope

- New kinds: symbols `table`, `view`, `procedure`; edges `reads`, `writes`, `executes` (K3).
- Typed `annotations` on symbols (K3).
- The `facts` protocol (K12): types, schema and plumbing land here; detectors land in PR 4.
- Versioning and the acceptance window for `'1'` and `'2'`.
- "Data coupling" is the concept; `DATA_RESOURCE_KINDS` (`table`, `view`) is what core analyses use, never the literal `table`.
- Package naming: `@ctxo/lang-sql` stays a language plugin for SQL files (K3a).
- Future path, not built (K3b): NoSQL (`collection` kind, virtual resource nodes such as `@data/mongodb::loans::collection`, host-plugin recognizers for driver calls, EF Core `ToTable`/`[Table]` through the same mechanism, config recognizers for in-house wrappers, own lang plugins for schema languages such as CQL, Cypher, Prisma) and messaging (`topic`/`queue` kinds, `publishes`/`subscribes` edges; type-based buses point at the message class symbol; named channels get virtual nodes such as `@msg/kafka::loan-events::topic`; evidence in host plugins; context-map interpretation in `@ctxo/domain`; AsyncAPI as a future lang plugin).

### 8.2 `@ctxo/plugin-api` v2

```ts
export const SYMBOL_KINDS = ['function', 'class', 'interface', 'method', 'variable', 'type',
                             'table', 'view', 'procedure'] as const;
export const EDGE_KINDS = ['imports', 'calls', 'extends', 'implements', 'uses',
                           'reads', 'writes', 'executes'] as const;
export const DATA_RESOURCE_KINDS = ['table', 'view'] as const;

export interface SymbolAnnotation {
  readonly name: string;                          // e.g. "Trait", "Fact", "HttpGet", "columns"
  readonly args?: readonly string[];              // constant positional arguments
  readonly named?: Readonly<Record<string, string>>;
}
export interface SymbolNode { /* existing fields */ readonly annotations?: readonly SymbolAnnotation[] }

export const FACT_KINDS = ['literal-comparison', 'normalization', 'retry-timeout', 'endpoint'] as const;
export interface CodeFact {
  readonly kind: FactKind;
  readonly symbolId: SymbolId;     // enclosing symbol
  readonly line: number;
  readonly text: string;           // single line, trimmed, capped at 200 chars
  readonly detail?: Readonly<Record<string, string>>;
}
export interface ILanguageAdapter { /* existing */ extractFacts?(filePath: string, source: string): Promise<CodeFact[]> }
export interface PluginContext {
  /* existing */
  readonly capabilities?: {
    readonly facts?: boolean;          // host wants extractFacts (PR 4 detectors)
    readonly sqlCallSites?: boolean;   // host has a plugin for .sql loaded
  };
}

export const SUPPORTED_API_VERSIONS = ['1', '2'] as const;
export interface CtxoLanguagePlugin { readonly apiVersion: '1' | '2'; /* existing */ }
```

- Version: protocol v2 ships in the next `@ctxo/plugin-api` minor after the release that is being prepared now (that release already takes plugin-api to 0.8.0 on protocol v1, widens peer ranges to `^0.7.3 || ^0.8.0` and enables changesets' `onlyUpdatePeerDependentsWhenOutOfRange`). In the same PR, widen every official plugin's peer range to include the new minor and confirm with `changeset status` that no dependent gets a major bump.
- Update the contract test (`packages/plugin-api/src/__tests__/contract.test.ts`).

### 8.3 Core support for v2 (cli)

- `plugin-discovery.ts` accepts `'1'` and `'2'`.
- Import kind lists from `@ctxo/plugin-api` instead of the duplicate copy in `core/types.ts`. Update every place that enumerates kinds: `SymbolIdSchema`, `EdgeTargetSchema`, `EdgeKindSchema`, MCP tool input enums in `index.ts` and the handler schemas (`search_symbols.kind`, `find_importers.edgeKinds`, `get_symbol_importance.kind`), the blast-radius tier sets, `get_class_hierarchy`, `context-assembler.ts`, both visualizer color maps, and the docs.
- Blast-radius tiers: `reads`, `writes`, `executes` are `confirmed` (direct dependency; a schema change breaks readers and writers).
- `SymbolNodeSchema` gains `annotations`; `FileIndexSchema` gains `facts`. Without this, zod strips the fields on read.
- Name references to data resources: a 2-part reference `schema.name::table` matches any node of a `DATA_RESOURCE_KINDS` kind with that name (the C# side cannot know table versus view). When several files define the same object, the first file in sorted path order wins. Resolution stays deterministic.
- Facts: the core calls `extractFacts` only when facts are requested (`@ctxo/domain` installed, or `index.facts: true`) and writes `facts` into the file's JSON. SQLite is unchanged (annotations and facts live in JSON only).

### 8.4 `@ctxo/lang-csharp` and the Roslyn helper

- **Annotations:** for every extracted symbol, emit its attributes with constant arguments. Read `symbol.GetAttributes()`; when the attribute type does not resolve (packages not restored), fall back to syntax (`AttributeLists` plus `SemanticModel.GetConstantValue`). `name` is the attribute name as written, without namespace and `Attribute` suffix; `named.type` carries the fully qualified name when known. Caps: 20 attributes per symbol, 10 args each, 200 chars per arg. Add the field to `CtxoSymbol` (Program.cs), `RoslynSymbol`, and both mappings in `roslyn-adapter.ts`.
- Annotations are always on (capped, additive, like the v0.8 community fields). C# users see a one-time change in their committed index JSON on the first re-index after upgrading; the changelog says so.
- **SQL at call sites (K3):** emitted only when the host sets `capabilities.sqlCallSites` (a plugin for `.sql` is loaded), so repos without `@ctxo/lang-sql` get no edges to resources that cannot exist. A data-driven table of known APIs in the helper:
  - ADO.NET: `SqlCommand` constructor `cmdText`, `CommandText` assignments; with `CommandType.StoredProcedure` the text is a procedure name.
  - Dapper: `SqlMapper` extension methods (`Query*`, `Execute*`, `ExecuteScalar*`, `QueryMultiple*`), `sql` parameter; `commandType: CommandType.StoredProcedure` means a procedure name.
  - `SqlBulkCopy.DestinationTableName` assignment: `writes`.
  - EF Core raw SQL: `FromSqlRaw`, `ExecuteSqlRaw`, `SqlQueryRaw`.
  - Only compile-time constants (`GetConstantValue`: literals, `const` fields, constant concatenation, verbatim and raw strings). Non-constant SQL is counted and logged at debug level, never guessed.
  - Parse the text with `Microsoft.SqlServer.TransactSql.ScriptDom`. `FROM`/`JOIN` named tables: `reads`; `INSERT`/`UPDATE`/`DELETE`/`MERGE` targets, `TRUNCATE`, `SELECT INTO`: `writes`; `EXECUTE`: `executes`. Exclude temp tables, table variables and CTE names.
  - Emit edges from the calling method to a 2-part name reference, `schema.name::table` or `schema.name::procedure`, canonical form: lowercase, brackets stripped, default schema `dbo`.
  - Relax the 3-part filter in `roslyn-adapter.ts` so these name references survive.
- A test-only helper mode (`--sql-extract <file>`) prints the ScriptDom extraction for a SQL file, used by the shared corpus test (8.5).
- The tree-sitter fallback emits attribute annotations; SQL edges need the Roslyn tier.
- Tests use stub types (`Dapper.SqlMapper`, `Microsoft.Data.SqlClient.SqlCommand`, `Xunit.TraitAttribute`) defined in fixture source, so no NuGet restore is needed for them. Dotnet-dependent tests stay gated with `describe.skipIf(!HAS_DOTNET)`.
- Verify before relying on it: the helper targets `net8.0` without `RollForward`; a machine with only a newer runtime may fail to launch it.

### 8.5 `@ctxo/sql-extract` and `@ctxo/lang-sql` (K10, K18)

- New library package `packages/sql-extract`, `@ctxo/sql-extract`, zero runtime dependencies. It holds the tokenizer and recognizers below and exposes two functions: one extracts definitions from a SQL file, the other extracts accesses (`reads`, `writes`, `executes` as canonical names) from a SQL statement or a procedure name. `@ctxo/lang-sql` uses it from day one; PR 1C makes the TypeScript, Java and Go plugins use it too. It is not a plugin and is not discovered.
- New package `packages/lang-sql`, `apiVersion: '2'`, `id: 'sql'`, `extensions: ['.sql']`, `tier: 'syntax'`. Register it in `detect-languages.ts` (`KNOWN_LANGUAGES`, `EXTENSION_LANGUAGE`, `officialPluginFor`), the install command, doctor coverage, the CLI's devDependencies list (global-install discovery), `ctxo update`, and the CI pack list.
- **Tokenizer (TypeScript, deterministic, T-SQL dialect first):** line and block comments, strings with doubled quotes and `N'...'`, bracketed and double-quoted identifiers, `GO` batch separators on their own line, semicolons.
- **Definitions:** `CREATE [OR ALTER] TABLE | VIEW | PROC[EDURE] | FUNCTION`, plain `ALTER VIEW | PROC | FUNCTION`. Symbol id `<file>::<schema.name>::<kind>` with the canonical lowercase name; `name` keeps the declared spelling. Functions map to the existing `function` kind.
- **Columns:** from `CREATE TABLE` and `ALTER TABLE ... ADD`, as an annotation `{ name: 'columns', args: [sorted lowercase names] }` (used for term collisions).
- **Accesses inside procedure, view and function bodies:** the same mapping as the C# side (`reads`, `writes`, `executes`), excluding temp tables, table variables, CTE names and aliases, and resolving `UPDATE alias ... FROM table alias`.
- Top-level DML in migration or seed scripts (outside any definition) is not turned into edges in v1; co-change still connects those scripts.
- Dialect and default schema are constants in v1 (`tsql`, `dbo`). Configuration waits for the first non-T-SQL consumer.
- **Shared conformance corpus:** `packages/lang-sql/corpus/<case>.sql` with `<case>.expected.json` (resources defined, accesses by kind). lang-sql tests run every case. A lang-csharp integration test (gated on dotnet) runs the same cases through `ctxo-roslyn --sql-extract` and compares accesses with the same expectations. Both sides must agree.

### 8.6 Data coupling in the contexts view and core

- `sharedTables` per candidate: data resources accessed (reads or writes, directly or through a procedure) by files of two or more candidates, with access modes per candidate.
- Ownership hint: the candidate that writes a resource; several writers are flagged.
- Resources referenced but defined in no `.sql` file are listed as external.
- Data access is not a clustering weight by default: shared tables are a boundary finding to show, not a reason to merge (`contextsView.weights.data`, default 0).
- Term harvest adds table and view names and columns.

### 8.7 Acceptance (PR 1B)

- v1 plugins keep working unchanged; a v2 plugin's kinds, annotations and facts survive the JSON round trip.
- The corpus passes on both sides (`@ctxo/sql-extract` and ScriptDom).
- Fixture: tables shared by two or more candidates are listed; resources and per-unit access are compared with the oracle (baseline: 72 tables, 29 procedures), and every difference is explained. Expected sources of difference: the oracle scans every string literal in a file, Ctxo only constant SQL at known call sites; the oracle's regexes can misread aliases and comments.
- Test methods carry `Fact`/`Trait` annotations on the fixture.

---

## 8A. PR 1C - Language parity for TypeScript, Java and Go (K18, Phase 1)

Goal: the capabilities C# gets in PR 1B, for the other three official languages. Without this PR, outside .NET:
- code that touches tables is invisible;
- rule-to-test links stay at file level;
- the Pinned suggestion cannot follow edges from tests (Go's full tier never loads `_test.go`; TypeScript test files have no symbols);
- Java annotations and TypeScript decorators are not read.

### 8A.1 Scope of parity

- **SQL at call sites:** the same scope as C#. Raw SQL text at known call sites and stored-procedure calls, compile-time constants only, full tier only, emitted only with `capabilities.sqlCallSites`.
- **ORM and query builders stay out in every language,** C# included: EF LINQ, JPQL and Spring Data derived queries, knex chains, Prisma model calls, TypeORM repositories, gorm model calls. They map entities rather than SQL text (deferred, section 17).
- **Canonical names:** the same 2-part form as C# (`schema.name::table` or `::procedure`), produced by `@ctxo/sql-extract`, so all four languages and `lang-sql` resolve to the same nodes. The shared corpus gains host-language cases per language.

### 8A.2 Known-API tables (data-driven, like the C# one)

| Language | Where | APIs |
|---|---|---|
| TypeScript/JS | ts-morph, in process | pg `query`; mysql2 `query`/`execute`; mssql `request.query`, `request.execute(proc)` (procedure); `knex.raw`; Prisma `$queryRaw`/`$executeRaw` and their `Unsafe` forms; TypeORM `query`; Sequelize `query`; better-sqlite3 `prepare`/`exec`. Constants: string literals, templates without substitutions, `const` bindings ts-morph can resolve, tagged templates with interpolations replaced by placeholders |
| Java | JDT analyzer reports, the TS side parses | JDBC `prepareStatement`, `prepareCall` (`{call proc}` is a procedure), `Statement.execute*`; Spring `JdbcTemplate` / `NamedParameterJdbcTemplate`; `EntityManager.createNativeQuery`; `@Query(value = ..., nativeQuery = true)`; MyBatis `@Select`/`@Insert`/`@Update`/`@Delete`. Constants through JDT constant evaluation (literals, `static final`, concatenation, text blocks) |
| Go | ctxo-go-analyzer reports, the TS side parses | `database/sql` `Query`/`QueryRow`/`Exec`/`Prepare` (and `Context` forms) on DB, Tx, Conn, Stmt; sqlx `Select`/`Get`/`Queryx`/`NamedExec`/`MustExec`; pgx `Query`/`QueryRow`/`Exec`; gorm `Raw`/`Exec`. Constants through `go/types` constant values |

The JDT and Go analyzers add `{ symbolId, line, text, kind: 'statement' | 'procedureName' }` records to their own JSON output (an internal protocol of each plugin, not the plugin API). The TypeScript side of each plugin calls `@ctxo/sql-extract` and emits the edges.

### 8A.3 Annotations

- **Java:** annotations on types, methods and fields, with constant member values (JDT). The tree-sitter fallback reads `marker_annotation` and `annotation` nodes with string arguments. `name` is the simple name.
- **TypeScript:** decorators on classes, methods and properties, with string-literal arguments; string properties of object-literal arguments become `named`.
- **Go:** struct field tags as `{ name: 'tag', named: { json: 'loan_id', gorm: 'column:loan_id' } }`.
- Same caps as C# (8.4).

### 8A.4 Test symbols

- **Go:** the analyzer loads test packages (`Tests: true`) and de-duplicates package variants by file. `_test.go` functions become symbols with edges.
- **TypeScript:** in test files (shared classifier), each `describe`, `it` or `test` block becomes a synthetic `function` symbol named by its title path (`describe title > it title`), annotated `{ name: 'test' }`, with `calls`/`uses` edges from its body.
- **Java:** test methods are symbols as long as test sources are in the analyzed source set (verify in the plan; add them if not).
- **Effect:** rule-to-test links become test-level and reachability from tests works in all four official languages.

### 8A.5 Acceptance (PR 1C)

- Small synthetic sample projects per language (TypeScript, Java, Go) with raw SQL calls, a stored-procedure call, annotations or decorators or struct tags, and tests. Edges, annotations and test symbols appear as specified, and the corpus host-language cases pass.
- Without `@ctxo/lang-sql` installed, no SQL edges appear in any language.
- Existing plugin tests keep passing. Java full-tier tests stay gated on a JRE, Go analyzer tests on a Go toolchain.
- The fixture is C#, so this PR is validated on the synthetic samples only.

---

## 9. PR 2A - Tiered agent rules (#159, Phase 2)

- **Tiered body.** `ruleBody({ tier })`:
  - `compact` for Claude Code when the guard hook and the skills are installed, at most 8 lines including the heading. Draft:

```markdown
<!-- ctxo-rules-start v0.13 -->
## ctxo
This repo has a ctxo index: dependency graph, git intent, change health. For structural questions (who depends on X, what breaks if X changes, why X looks like this), use the ctxo MCP tools before grepping.
A pre-edit guard blocks the first edit to a high-impact symbol until `get_blast_radius` has been called for it.
Skills: `ctxo-understand` (orient at task start), `ctxo-safe-edit` (before changing a symbol), `ctxo-review-pr` (before reviewing a diff).
<!-- ctxo-rules-end -->
```

  - `full` for every other client: the current block with narrowed wording. "ALWAYS use ctxo MCP tools before reading source files" becomes "For structural questions (dependencies, impact, history), use ctxo tools first; reading a file to see its contents needs no index call."
- **Tool-selection detail moves into the skills** (`ctxo-understand` gets the selection guide). MCP tool descriptions remain the primary routing source.
- **Version marker** `<!-- ctxo-rules-start v<cli minor> -->`; old unversioned markers are recognized and replaced in place, never appended twice.
- **Rules writer fixes:** create-mode files (`AGENTS.md`, `.windsurfrules`, `copilot-instructions.md`, ...) get markers and keep user content outside them instead of being overwritten; a newly created append-mode file (`CLAUDE.md`, `GEMINI.md`) gets markers.
- **Guard default:** already on for Claude Code (opt-out); add `--no-guard`.
- **Granular init:** `--only <parts>` and `--skip <parts>`, parts = `rules`, `skills`, `guard`, `mcp`, `git-hooks`, `config` (`domain` joins in 2B). `--rules` stays as a deprecated alias for `--skip git-hooks,guard` with a notice. Dry run lists every file it would touch (today it misses config, `.gitignore`, MCP configs, Cursor skills).
- **`ensureClaudeHook`** no longer overwrites a corrupt `.claude/settings.json`; it warns and leaves it.
- **Doctor checks** (each fixed by `ctxo doctor --fix`): `ai_rules` (Claude Code rules present but guard hook missing; rules block older than the installed template), `skills` (missing or outdated), `claude_guard_hook`, and `git_hooks` (from PR 0).
- Fix ADR-015's text about session state (the code uses a file store, not in-process memory) and the site doc that says the guard prompt appears for Cursor.
- **Acceptance (#159):** on Claude Code with guard and skills, the generated block is at most 8 lines; other clients get the full block; doctor reports "rules present, guard missing" and "rules template outdated" and `--fix` resolves both; `ctxo init` can install guard and skills without touching `.git/hooks`; an existing marked block is replaced in place.

---

## 10. PR 2B - `@ctxo/domain`: named contexts and guards (Phase 2)

ADR-018 is the first commit of this PR.

### 10.1 Package and integration (K7)

- New package `packages/domain`, `@ctxo/domain`, published. Dependencies: `@ctxo/cli` (peer), `yaml`, `picomatch`. Markdown headings are parsed with a small line parser (ATX headings outside fenced code), not a markdown library.
- The cli loads it directly: at startup (MCP server and CLI router) the cli resolves `@ctxo/domain` from the consumer project's `node_modules`, then next to the running CLI install, imports it, and calls its registration function. Failure to load warns and continues. A version mismatch warns and skips.
- **Supported setups (K15):** a global install is the supported path for repos without `package.json` (such as .NET repos): `npm i -g @ctxo/cli @ctxo/domain @ctxo/lang-sql`, so the MCP server, the hooks and the CLI all run the same copy. When `ctxo init` detects that the running CLI is a global install, it writes MCP entries that call the global `ctxo` binary instead of `npx -y @ctxo/cli`. Project-local installs in repos with `package.json` keep working. `ctxo install domain sql` installs globally when the project has no `package.json` (today it refuses without `--global`). A doctor check warns when the MCP entry and the hooks point at different copies (for example npx for MCP and a global binary for hooks).
- The cli exposes an internal API through an `exports` subpath (for example `@ctxo/cli/internal`), built as an extra tsup entry with code splitting so the tarball stays under the limit. It exposes ports and core types and services (FileIndex and graph types, `SymbolGraph`, `BlastRadiusCalculator`, config loading, logger, response envelope, masking types, `IStoragePort`, `IGitPort`, the test-file classifier), not adapters. Registration shape:

```ts
export interface CtxoModuleRegistration {
  readonly id: 'domain';
  indexPass?(ctx: IndexPassContext): Promise<void>;           // runs after core phases of ctxo index
  registerTools?(registrar: ToolRegistrar): void;             // core wraps masking, _meta, recording, staleness
  enrich?: Partial<Record<CoreToolName, ResponseEnricher>>;  // additive fields on core tools
  registerCommands?(registrar: CommandRegistrar): void;       // verify-domain, contexts-touched, domain, domain-guard-hook
  init?: InitContribution;                                    // ctxo init --domain
  doctorChecks?: readonly IHealthCheck[];
}
```

- `@ctxo/domain` imports only types from `@ctxo/cli/internal` (`import type`). Every runtime service comes from the running CLI through the registration call. `@ctxo/cli` is therefore a devDependency of `@ctxo/domain`, not a peer, so npm never installs a second CLI copy next to it. The running CLI passes its version; `@ctxo/domain` warns and stays inactive on a mismatch.
- Changesets: `@ctxo/cli` and `@ctxo/domain` form a `fixed` group, so they always share a version. `@ctxo/domain` starts at the cli's version.
- `ctxo install domain`, `ctxo doctor` (shows it), `ctxo update` (includes it; today its prefix filters only see `@ctxo/lang-*`).
- ADR-018 records the deliberate exception: `@ctxo/domain` imports the cli's internal API; language plugins still import only from `@ctxo/plugin-api`.

### 10.2 Registry (K1)

`docs/domain/contexts.yaml` (path configurable through `domain.registry`):

```yaml
version: 1
contexts:
  - id: lending                       # kebab-case, unique, permanent
    name: Lending
    card: docs/domain/lending/domain.md   # optional only while rung is fear
    paths: ["src/Lending/**", "src/Holds/**"]
    rung: pinned                      # fear | pinned | named | bounded | boring (owner sets)
    rulePrefix: LEND                  # optional; rule IDs in this card must use it
    contracts:                        # allowed crossings into other contexts
      billing: ["src/Billing/Api/IChargeService.cs"]
unowned:
  allow: ["src/Host/**"]              # files allowed to belong to no context
glossary: docs/domain/glossary.md     # default
contextMap: docs/domain/context-map.md   # default
```

- Paths are picomatch globs over repo-relative forward-slash paths.
- **Contracts:** `contracts.<target>` lists files (globs) in the target context that this context may depend on. An edge from context A into context B is allowed when its target file matches `A.contracts.B`. Edges into unowned files are allowed. Data resources are anchored to their defining `.sql` file, so contracts cover them through file globs.
- **Ownership:** every indexed source file belongs to at most one context. A file matching two contexts is an error; a file matching none is an error unless it matches `unowned.allow`.
- **Rungs:** the registry is the source of truth. `context-map.md` must contain a markdown table with `Context` and `Rung` columns; `verify-domain` checks that every context appears there with the same rung.

### 10.3 `ctxo contexts-touched`

`ctxo contexts-touched --since <ref> [--committed | --staged] [--json] [--check]`

- **Changes considered:** by default, the committed range `merge-base(ref, HEAD)..HEAD` plus working-tree changes (staged, unstaged, untracked non-ignored). `--committed` restricts to the range (used by the guard), `--staged` to staged changes.
- **Touched:** a context whose paths contain a changed non-test file (shared classifier).
- **Card changed:** the context's card file has a content change in the considered changes.
- **Acknowledged (K2):** a trailer `Domain-Unchanged: <id>[, <id>...] [(reason)]` in any commit of the range, read with `git log --format=%(trailers:key=Domain-Unchanged,valueonly)`. Unknown IDs produce a warning.
- **Output:**

```json
{
  "since": "origin/main", "base": "a1b2c3d", "head": "e4f5a6b",
  "contexts": [
    { "id": "lending", "files": ["src/Lending/LoanPolicy.cs"], "card": "docs/domain/lending/domain.md",
      "cardChanged": false, "acknowledged": { "commit": "9f8e7d6", "reason": "refactor only" },
      "status": "acknowledged" }
  ],
  "unowned": [], "unresolved": []
}
```

- `status` is `card-changed`, `acknowledged` or `unresolved`. `--check` exits 1 when anything is unresolved.

### 10.4 Domain fold guard (K9)

- `ctxo domain-guard-hook` (hidden) is registered by `ctxo init --domain` in `.claude/settings.json` for `SessionStart`, `Stop` and `TaskCompleted` (no matcher; matchers do not apply to these events). `SubagentStop` is off by default (`domain.guard.subagents`).
- **SessionStart (K16):** records the session's starting HEAD in `.ctxo/.cache/domain-guard/<session>.json`. A resumed session keeps its original record. If no record exists when Stop fires (hook installed mid-session), the current HEAD is recorded and nothing is blocked in that turn.
- It evaluates **committed changes of this session only (K9, K16):** commits in `startHead..HEAD`, intersected with the branch range below, through the same logic as `contexts-touched --committed`. Uncommitted work never blocks. History from earlier sessions or from people is left to the CI gate (`verify-domain --since`).
- **Branch range:** `domain.guard.base` if set, else `merge-base(HEAD, origin/HEAD)`, else `main` or `master`. On the default branch itself the range is `@{u}..HEAD` (unpushed commits); without an upstream, `startHead..HEAD` alone is used.
- **Decision:**
  - If the payload has `stop_hook_active: true`, allow.
  - If there are no unresolved contexts, allow.
  - If this session already blocked for the same fingerprint (HEAD SHA plus sorted unresolved IDs, kept in `.ctxo/.cache/domain-guard/<session>.json`), allow.
  - Otherwise block once:
    - **Stop:** stdout `{"decision":"block","reason":"..."}`, exit 0.
    - **TaskCompleted:** reason on stderr, exit 2 (the only documented way to block it).
- **Resolution:** commit a card change, or any commit in the range carrying the trailer (an empty commit is fine).
- **Reason text** names the contexts, the changed files (capped), the card path and the exact trailer line:

```
ctxo domain guard: 1 context has committed changes without a card update.
- lending: 3 files (src/Lending/LoanPolicy.cs, ...)
  card: docs/domain/lending/domain.md (unchanged)
Update the card if behaviour changed (rules, decisions, contracts), then commit it.
If behaviour did not change, add this trailer to a commit:
  Domain-Unchanged: lending (reason)
```

- **Fail-open:** any internal error allows (exit 0, log to stderr). Claude Code also fails open for these events and caps consecutive Stop continuations at 8.
- **Speed:** the hook route must not load the MCP stack (today `index.ts` imports it before routing). Budget under 1 s on the fixture.
- **Skill:** `ctxo-domain-fold` (installed with `--domain`) covers reading the card before changing a context's code and the fold at branch finish (run `contexts-touched`, update the card or add the trailer).

### 10.5 `ctxo verify-domain` (CI gate)

`ctxo verify-domain [--since <ref>] [--boundaries by-rung|report] [--json]`

| # | Check | Severity |
|---|---|---|
| 1 | Registry schema valid, IDs unique and kebab-case, rungs valid | error |
| 2 | Every context with a rung above fear has a card; every listed card exists | error |
| 3 | Every `paths` glob matches at least one indexed file | error |
| 4a | No file owned by two contexts | error |
| 4b | No unowned file outside `unowned.allow` (K17) | `domain.coverage.unowned`: `warn` (default) or `error` |
| 5 | Cards have the template H2 headings in order: Language; Rules and invariants; Boundary contracts; Decisions; Open questions | error |
| 6 | Rule IDs match `domain.rules.idPattern` (default `^[A-Z][A-Z0-9]*-\d+$`), are unique across cards and match `rulePrefix`; IDs in structured test references (rule-key annotations, `rule:` comments, test titles that start with an ID) exist in cards; every rule has a test link or an `Untested:` line. Plain mentions in comments never raise "unknown ID" (10.9) | error |
| 7 | Relative links and heading anchors in cards resolve (external URLs are not fetched) | error |
| 8 | Generated loader files match what `ctxo domain rules` would write | error |
| 9 | `context-map.md` rung table agrees with the registry (runs when the file exists; a missing file while contexts exist is a warning) | error |
| 10 | Boundaries (K11): edges outside `contracts` | error for `blockingRungs` in by-rung mode, else warning |
| 11 | With `--since`: no unresolved touched contexts (10.3) | error |

- Exit 0 when there are no errors (warnings allowed), 1 on errors, 2 on internal failure. CI must not pass silently.
- Day one: with the init skeleton (no contexts) or a partial registry, unowned files and a missing context map are warnings, so CI stays green until the team sets `domain.coverage.unowned: error`.

```yaml
domain:
  coverage:
    unowned: warn          # warn | error (K17)
```
- With no registry: print a hint and exit 0.
- Rule IDs in check 6 need a minimal card parser (rule headings) and the test-ID scan (K6) in this PR; PR 3 builds the full domain graph on the same parser.

### 10.6 Generated loader rules

`ctxo domain rules --write | --check` generates one file per context that has a card. Stale generated files are deleted. The `ctxo-context-` prefix keeps them apart from user rules, and from the `ctxo-domain-fold` skill (its Cursor copy is `.cursor/rules/ctxo-domain-fold.mdc`, which a context with the id `fold` would otherwise overwrite).

`.claude/rules/ctxo-context-lending.md`:

```markdown
---
paths:
  - "src/Lending/**"
  - "src/Holds/**"
---
<!-- generated by ctxo domain rules; do not edit -->
# Lending context
Before changing code under these paths, read `docs/domain/lending/domain.md` (rules, contracts, decisions).
If behaviour changes, update that card in the same PR. If it does not, add `Domain-Unchanged: lending (reason)` to a commit.
```

`.cursor/rules/ctxo-context-lending.mdc` has the same text with frontmatter `description`, `globs: src/Lending/**,src/Holds/**` (comma-separated string, per Cursor docs) and `alwaysApply: false`.

Verified behaviour: Claude Code loads a path-scoped rule when Read, Write or Edit touches a matching file (not Glob or Grep), and the built-in Explore and Plan subagents, which skip CLAUDE.md, still receive matching path-scoped rules.

### 10.7 Boundaries and drift by named context; the `context` field

- **Index pass** (when a registry exists): file-to-context map, cross-context edges by kind, violations under the configured mode. Writes `.ctxo/index/domain/contexts.json` and `.ctxo/index/domain/boundaries.json`. `JsonIndexReader` must skip the `domain/` directory.
- **Boundary modes (K11):**

```yaml
domain:
  boundaries:
    enforce: by-rung                  # by-rung | report
    blockingRungs: [bounded, boring]
```

  - `ctxo init --domain` asks; non-interactive installs take `--boundaries <mode>`; `verify-domain --boundaries` overrides once.
  - The computation is identical in both modes and linear in edges.
- **Drift by named context:**
  - The per-context share of cross-context edges, tracked over a rotating history of per-commit context metrics (`.ctxo/index/domain/history/`, one entry per commit, 10 entries).
  - Files that moved between contexts through renames in the co-change window.
  - Surfaced as an additive `contextDrift` in `get_why_context` and later in `get_context_map`.
- **Context field:** an enricher adds `context: "<id>"` to symbol entries in `search_symbols`, `get_blast_radius` (impacted symbols), `find_importers`, `get_logic_slice` (root) and `get_pr_impact` (changed symbols), only when a registry exists.
- **Boundary violations in `get_pr_impact`:** an additive `contextBoundaryViolations` for edges touching changed symbols.

### 10.8 `ctxo init --domain`

- Installs `@ctxo/domain` with consent if missing.
- Writes `domain:` config defaults and asks for the boundary mode.
- Creates an empty registry skeleton if none exists (structure only, no contexts, no cards).
- Registers the Stop and TaskCompleted hooks and installs the `ctxo-domain-fold` skill.
- Runs `ctxo domain rules --write` when contexts exist.
- `domain` joins the `--only` and `--skip` parts.

### 10.9 Convention discovery and ID safeguards (K19)

Other teams arrive with their own conventions: tracker keys shaped like rule IDs (Jira, Linear, YouTrack: `LEND-456`), existing test tags (`Trait("Category")`, `@Tag`), their own test and docs folders. Ctxo learns them by **discover, propose, confirm**. The config is the single source of truth, so behaviour never shifts silently.

- **`ctxo domain discover [--json] [--write]`** prints evidence and a proposed config. It writes only with `--write`. It discovers:
  - rule prefixes in card headings;
  - tracker-like keys (`\b[A-Z][A-Z0-9]{1,9}-\d+\b`) in commit subjects of the co-change window and in branch names (a prefix seen in at least 5 commits or branches is a tracker prefix);
  - annotation keys used on test methods (for `ruleTraitKeys`);
  - test folders not covered by the default globs;
  - Characterization and Contract folders (for K13a);
  - ADR and spec folders (for provenance link checks).
- **`ctxo init --domain`** runs the same discovery, shows the proposal and asks for confirmation; `--yes` accepts it non-interactively.
- **`ctxo doctor`** re-runs discovery later and only warns, for example when a new tracker prefix overlaps a rule prefix. It never edits config.
- **Config:**

```yaml
domain:
  rules:
    idPattern: "^[A-Z][A-Z0-9]*-\\d+$"
    trackerPrefixes: [LEND, OPS]    # confirmed by the team
```

- **Safeguards that hold with any config, or none:**
  - A link is created only to an ID that exists in a card (K6).
  - "Unknown rule ID" errors come only from structured references (rule-key annotations, `rule:` comments, test titles that start with an ID), never from plain mentions.
  - When a rule prefix is also a tracker prefix, only structured references count for that prefix; plain text never links.
- Example output:

```
$ ctxo domain discover
Rule IDs
  card prefixes:      LEND (5 rules), BILL (3 rules)
  tracker-like keys:  LEND in 183 commit subjects/branches   <- overlaps a rule prefix
                      OPS  in 12
Test tagging          xUnit Trait keys in use: Category (41), Rule (3)
Test folders          src/*.Tests; no Characterization/ or Contract/ folders
Provenance folders    docs/adr (7), docs/specs (12)
```

### 10.10 Acceptance (PR 2B)

- `verify-domain` fails on a non-fear context without a card, on a glob that matches nothing, and on an unknown rule ID found in a test.
- The guard blocks a session whose commits changed a context's code without a card change or acknowledgement. It lets the session finish after a card commit or a trailer commit, and always when `stop_hook_active` is true. A new session on a branch with unresolved commits from an earlier session is not blocked.
- `ctxo domain rules --check` passes right after `--write` and fails after a registry change.
- No registry: no new fields anywhere, commands print a hint and exit 0.
- Discovery: on a synthetic repo whose commit subjects use `LEND-<n>` tracker keys, `ctxo domain discover` proposes `trackerPrefixes: [LEND]`; with it confirmed, a test comment mentioning `LEND-456` neither links nor fails `verify-domain`.
- Synthetic fixture: a small library-lending sample with Lending, Billing and Catalog contexts, rules `LEND-01` to `LEND-05` (including `LEND-03` "a member holds at most five loans") and `BILL-01` to `BILL-03`, SQL migrations, and an `Account` type in both Lending (member account) and Billing (payer). C# and TypeScript variants; the C# variant uses `[Trait("Rule", "LEND-03")]` with stub xUnit types.

---

## 11. PR 3 - Domain graph and links (Phase 3)

### 11.1 Card format (consumer contract)

```markdown
# Lending

## Language
- **Loan**: ...
- **Hold**: ...

## Rules and invariants
### LEND-03 A member holds at most five loans
Tests: `src/Lending.Tests/LoanLimitTests.cs`
Code: `src/Lending/LoanPolicy.cs`, `src/Lending/LoanPolicy.cs::LoanPolicy.CanBorrow::method`

Free text written by people.

### LEND-04 A hold expires after seven days
Untested: covered by manual QA until the scheduler migration lands

## Boundary contracts
Free text; references to contract files.

## Decisions
- 2026-09-12: Loan limit raised from 3 to 5. [spec](../../specs/loan-limit.md), #123, [ADR-007](../../adr/adr-007-loan-limit.md)

## Open questions
- ...
```

- **Rules:** H3 headings under "Rules and invariants" matching `### <ID> <title>`. IDs are permanent and never renumbered.
- **Optional rule lines:** `Tests:`, `Code:` and `Untested:` lines at the start of a rule body; values are comma-separated backticked paths or symbol IDs.
- **Terms:** list items starting with `**Term**` in "Language" and in `glossary.md`. Glossary items may add `(context: <id>)`.
- **Decisions:** list items starting with an ISO date and a colon. Relative links point to provenance files; `#123` and URLs are external provenance strings.

### 11.2 Domain graph (K8)

- A separate graph in `.ctxo/index/domain/graph.json`, linked to code by symbol IDs. Code metrics (PageRank, Louvain, snapshots, dead code, gate percentiles) never see it, so editing a card never shifts code clusters.
- **Nodes:** `context:<id>`, `rule:<ID>`, `term:<context>/<term>`, `decision:<context>/<date>-<n>`.
- **Links, each with its source:**
  - **rule to test:**
    - Annotations: xUnit `Trait` with a key in `domain.tests.ruleTraitKeys` (default `Rule`), NUnit `Category`, MSTest `TestCategory` whose value is a rule ID.
    - The K6 text scan of test files: rule IDs that exist in cards, with variants `LEND-03`, `LEND03`, `Lend03`, `lend_03` matched at token boundaries, linked to the innermost indexed symbol spanning the line, else to the file. When the matching line declares a test (`it(`, `test(`, `describe(`, `t.Run(`, `@DisplayName(`, `[Fact(DisplayName =`), its title is recorded as the link's test name, so even languages without test symbols get test-level names.
    - The card's `Tests:` line.
  - **rule to symbol:** card `Code:` references, and code comments `rule: LEND-03` in any comment style found by the text scan.
  - **decision to provenance:** relative links resolved to repo files; external strings kept as-is and never fetched.
  - **term to identifiers:** case-insensitive match of the term against symbol names split on camelCase and snake_case, and against table names.

### 11.3 Additive fields

- `get_blast_radius`:
  - `rulesAffected`: rules linked to the root or impacted symbols, with their card.
  - `cardsToUpdate`: cards of the contexts owning those rules.
- `get_context_for_task`: the relevant card excerpt (rules linked to the symbol and its neighbours, terms, contracts) within the token budget.
- `get_why_context`: `decisions[]` for the symbol's context, newest five, with provenance. Decisions that mention a rule linked to the symbol come first.
- `get_pr_impact`:
  - `contextsTouched[]`: from 10.3 over the tool's `since`.
  - `cardsChanged`.
  - `rulesWithoutTests`: rules in touched contexts that have no test link.

### 11.4 New tools and the domain scope

- `get_domain_context({ symbolId? , path? })`: context (id, name, rung, card), Language terms, rules with tests and code links, contracts, decisions, open questions; truncation-aware.
- `get_rule({ ruleId })`: rule text, context, tests with link sources, implementing symbols, decisions that mention it, provenance.
- `get_ranked_context({ scope: "domain" })`: BM25 over card sections, glossary entries and in-repo provenance files, through the core search engine via the internal API. The default scope is `code` (unchanged).
- Tool count: 14 core tools, plus 2 from `@ctxo/domain` in PR 3 and 2 more in PR 4 when it is installed. Docs state both numbers.

### 11.5 Acceptance (PR 3)

- `get_blast_radius` on a symbol linked to a rule lists the rule and its card.
- `get_rule` returns the tests linked through `[Trait("Rule", ...)]`, with the source of each link.
- No registry: no fields, no errors. Same input: same output.

---

## 12. PR 4 - Agentic loop support (Phase 4)

### 12.1 Fact detectors (K12)

- All four official languages produce facts natively in their primary tier:
  - TypeScript: ts-morph.
  - C#: Roslyn IOperation.
  - Go: the analyzer.
  - Java: JDT.
- Their tree-sitter fallback tiers produce facts through simple queries.
- Plugins without `extractFacts` fall back to a text scan in `@ctxo/domain` over symbol spans, after stripping comments and strings with a light lexer.
- Every candidate records its source, `native` or `text`. C# is validated first on the fixture.

| Fact kind | Detects | `detail` |
|---|---|---|
| `literal-comparison` | A comparison in a condition (`if`, `while`, ternary, `switch case`, `when`) with a literal operand other than 0, 1, -1, null, true, false, empty string (configurable) | `operator`, `literal` |
| `normalization` | String normalization on a value: `ToLower*`, `ToUpper*`, `Trim*`, `Normalize`, `toLowerCase`, `toUpperCase`, `trim`, `strings.ToLower`, `strings.TrimSpace`, `equalsIgnoreCase` (configurable list) | `method` |
| `retry-timeout` | A numeric constant bound to a name containing retry, retries, attempt, timeout, delay, backoff, ttl, expir; or a duration constructor (`TimeSpan.From*`, `Duration.of*`, `time.Second * n`, `setTimeout(..., n)`) | `name`, `value` |
| `endpoint` | A public route: C# `[HttpGet]`/`[Route]`/`MapGet`, TS Express/Fastify/Nest, Go `http.HandleFunc`/gin, Java `@GetMapping` and friends | `verb`, `route` |

### 12.2 `find_shadow_specs({ context, kinds?, includeResolved? })`

- **Candidates** (each with file, line, symbol, fingerprint, source and resolution):
  - Facts of the first three kinds in the context's files.
  - Endpoints without a rule link.
  - Procedures and data resources owned by the context without a rule link.
  - Rules without tests.
- **Fingerprint:** `kind | symbol | normalized text`, independent of line numbers. A changed literal changes the fingerprint, so the candidate reopens.
- **Resolution (K13b):**
  - Automatic when a rule links to the candidate's symbol.
  - Otherwise from `docs/domain/<ctx>/shadow-specs.yaml`:

```yaml
- fingerprint: "literal-comparison | LoanPolicy.CanBorrow | loans.Count >= 5"
  resolution: { rule: LEND-03 }
- fingerprint: "retry-timeout | SmtpSender.Send | Timeout = 30s"
  resolution: { notARule: "transport timeout, not a business rule" }
```

- `verify-domain` reports resolution entries whose fingerprint no longer matches any candidate (warning).

### 12.3 `get_context_map()`

- **Per context:**
  - Card present, rule count, share of rules with tests.
  - Characterization and contract test counts (K13a conventions).
  - Cross-context edges in and out.
  - Co-change pairs with files of other contexts above the threshold.
  - Drift events, boundary violations, open shadow-spec candidates.
  - The owner's `rung`, a `suggestedRung` and the status of each criterion.
- **Suggested rung.** The ladder is cumulative and every criterion is reported separately, so the owner can disagree:
  - **fear:** none of the conditions below hold.
  - **pinned:** at least `domain.rungs.pinnedCoverage` (default 0.8) of the context's main paths are reachable in the graph from a characterization test. Main paths are its `endpoint` facts plus the contract symbols other contexts may use. After PR 1C, tests are symbols with edges in all four official languages, so this works beyond C#.
  - **named:** pinned, plus a card exists and its Language section has terms present in the glossary.
  - **bounded:** named, plus every contract symbol is reachable from a contract test, and there are no boundary violations.
  - **boring:** bounded, plus every rule has a test link and every shadow-spec candidate is resolved.
- **K13a conventions (config, with defaults):**

```yaml
domain:
  tests:
    ruleTraitKeys: [Rule]
    characterization:
      annotations: ["Trait:Kind=Characterization", "Tag:characterization"]
      paths: ["**/Characterization/**"]
      names: ["[characterization]"]
    contract:
      annotations: ["Trait:Kind=Contract", "Tag:contract"]
      paths: ["**/Contract/**", "**/Contracts.Tests/**"]
      names: ["[contract]"]
  rungs:
    pinnedCoverage: 0.8
```

### 12.4 Acceptance (PR 4)

- `find_shadow_specs` returns candidates with locations and sources; resolved ones are marked.
- `get_context_map` returns per-context metrics, criteria and a suggested rung.
- Native facts exist for all four official languages, and the text fallback works for a v1 plugin.

---

## 13. Cross-cutting rules

### 13.1 Determinism

- Sort every output collection with codepoint ordering.
- Never use the wall clock in analysis results: co-change windows are anchored to HEAD, and timestamps are metadata only.
- Clustering uses no randomness.
- Rewrite an artifact only when its content changed.
- Each PR has a "same input twice, byte-identical output" test for its artifacts.

### 13.2 Graceful degradation

| Missing | Behaviour |
|---|---|
| `co-changes.json` | Blast radius without the co-change upgrade, exactly as today |
| `@ctxo/domain` | No domain tools, fields, commands or hooks; core unchanged |
| Registry | Domain commands print a hint and exit 0; no `context` fields |
| `.NET` SDK | No Roslyn annotations or SQL call-site edges; tree-sitter annotations only |
| Plugin without facts | Text-scan fallback, marked `source: text` |
| `@ctxo/lang-sql` not installed | No SQL call-site edges in any language |
| Language without an official plugin (Python and others) | Co-change-only contexts view, file-level text scan for rule IDs and facts, no SQL edges, annotations or test symbols |

### 13.3 Masking and envelope

- Every new tool and field goes through the masking pipeline and the `_meta` envelope, including card text.
- Truncation keeps working on each tool's primary array, because `wrapResponse` truncates only the largest truncatable array in a payload:
  - The primary arrays of new tools (`get_domain_context`, `get_rule`, `find_shadow_specs`, `get_context_map`) are added to `TRUNCATABLE_FIELDS`.
  - Additive arrays on existing tools (`rulesAffected`, `cardsToUpdate`, `decisions`, `contextsTouched`, `cardsChanged`, `rulesWithoutTests`, `contextBoundaryViolations`, `dataResources`, `coChangedFiles` and the like) are capped at their source (default 50; `coChangedFiles` 10), carry a `<name>Total` count field when entries were cut, and are not added. A long additive list would otherwise take over truncation from the tool's own list. Nested per-entry lists keep their own caps (for example `sharedTables`, 15 per candidate, with `sharedTableCount`).
- Not fixed here (filed separately if the owner agrees): the masking false positive that redacted a file path as `AWS_SECRET`.

### 13.4 Performance budgets (measured on the fixture)

- Co-change pass: at most 3 s.
- Domain index pass: at most 2 s.
- `ctxo domain-guard-hook`: under 1 s.
- `ctxo index --commit HEAD` on a single-file commit: faster than today's per-file loop.

### 13.5 Artifacts

| Path | Committed | Written by |
|---|---|---|
| `.ctxo/index/co-changes.json` (+ `window`) | yes | PR 0 |
| `.ctxo/index/communities.json`, `communities.history/` (one per commit) | yes | PR 0 |
| `.ctxo/index/contexts-view.json` | yes | PR 1A |
| `.ctxo/index/domain/{contexts,boundaries,graph}.json`, `domain/history/` | yes | PR 2B, 3 |
| `.ctxo/.cache/domain-guard/<session>.json` | no | PR 2B |
| `.ctxo/.cache/cochange-log.json` (only if needed) | no | PR 0 |

`JsonIndexReader` skips every index-level file and the `domain/` directory.

### 13.6 Claude Code facts this design relies on (official docs, verified 2026-10-20)

- **Stop:**
  - Fires at the end of every turn, not on user interrupts.
  - Blocks with top-level `{"decision":"block","reason":"..."}` or exit 2.
  - The hook must branch on `stop_hook_active` itself.
  - Claude Code ends the turn after 8 consecutive Stop continuations.
- **TaskCompleted:** exists since 2.1.33 and fires when a task is marked completed through `TaskUpdate`. Exit 2 is the only documented way to block it. Matchers do not apply.
- **Fail-open:** Stop, SubagentStop and TaskCompleted fail open on crashes and timeouts (`onFailure` does not apply to them).
- **Path-scoped rules:** `.claude/rules/**/*.md` with a `paths:` frontmatter list loads on Read, Write or Edit of a matching file. Explore and Plan skip CLAUDE.md but get matching path-scoped rules.
- **MultiEdit** is no longer a tool.
- **Cursor:** `.mdc` frontmatter is `description`, `globs` (comma-separated string) and `alwaysApply`. Its `stop` hook cannot block.

---

## 14. Validation on the private fixture

- **Clone only.** Work in a local clone outside the repo, made with `git clone --no-hardlinks`, with `dotnet restore` done there. Never index, edit, switch branches or write files in the original checkout.
- **Dev build.** The dev build of Ctxo indexes the clone. The oracle runs inside the clone.
- **Comparison scripts** that map Ctxo output onto the oracle's units are private: they live in the clone or a scratch directory and are never committed to Ctxo.
- **Baseline (2026-10-20):**
  - Oracle: 970 commits used, 3 mass commits skipped, 81 units, 553 files, 72 tables, 29 procedures.
  - Ctxo index: 10,036 symbols, 2,327 communities, modularity 0.83, empty co-change list.
- **What the oracle does** (its rules, so the builder can match them; its location and the clone path are in the owner's private brief and never go into the repo, plans or PRs):
  - Window: the whole history of the default branch (`git log --no-merges -M --name-status <default branch> -- <production and test folders>`), not a `since` window. 1077 commits are scanned; 970 remain after filtering.
  - Files: only current production `.cs` and `.sql` files count. Tests are classified by folder; deleted files drop out.
  - Renames: walked newest first with a canonical map, the same rule as 6.2.
  - Mass threshold: more than 30 files, counted after filtering.
  - Co-change is aggregated to 81 units defined by the fixture's folder layout. Dependencies come from Ctxo's own index edges, aggregated to units, so they are not independent. Tables and procedures come from regexes over the SQL scripts and over every string literal in C# files.
- **Same filters.** For co-change comparisons, run Ctxo in the clone with `cochange.maxCommits: all`, `cochange.exclude` set to the test folders and, before lang-sql exists, `cochange.include: ["**/*.sql"]`. Compare `commitsUsed`, `massSkipped` and unit-pair shared counts after mapping files to units with a private script.
- **PR 2B to 4 on the fixture.** The fixture has no registry or cards yet. Semantics are accepted on the synthetic library-lending sample. On the fixture, a private registry derived mechanically from the contexts-view candidates (rung fear, no cards, kept only in the clone) checks scale, speed and the absence of crashes. If the owner's team adds real cards later, the comparison is rerun.
- **Explain every difference.** The oracle can be wrong too, for example a regex reading an alias as a table.
- **Reporting.** PR descriptions and the hand-back quote aggregate numbers only.

---

## 15. ADRs, docs, release

- **ADRs:**
  - ADR-016: co-change engine, window and snapshot policy (PR 0; contexts-view defaults may be appended in PR 1A).
  - ADR-017: plugin protocol v2, data coupling, facts, the `@ctxo/sql-extract` dependency exception, and the NoSQL and messaging future path (PR 1B, first commit; addendum in PR 1C for language parity).
  - ADR-018: the in-repo domain knowledge layer, its boundary with ADR-004, integration through the cli internal API, the fold guard and acknowledgement trailers (PR 2B, first commit).
  - ADR-015: text amendment (PR 2A).
- **Docs per PR:**
  - `llms.txt` and `llms-full.txt` (tool reference, parameters, CLI, config).
  - The feature doc: `docs/features/architectural-intelligence.md` for PR 0 and 1A; a new `docs/features/domain-knowledge.md` for PR 1B onward. From PR 2B it publishes the conventions as "Ctxo domain conventions v1" so other teams can adopt them without reading code: a JSON Schema for `contexts.yaml`, a headings-only card template, the rule ID rules, the trailer, and an adoption ladder showing that no level requires code changes (level 0: install and index; 1: registry with paths; 2: cards; 3: rule IDs and test links, through card `Tests:` lines, test names or framework tags; 4: contracts and shadow-spec resolutions).
  - `docs/roadmap.md`: move shipped items out, add deferred items with triggers.
  - `CHANGELOG.md` `[Unreleased]`.
  - CLAUDE.md quick reference and tool tables when tools change.
  - CLI help: the `printHelp` text in `packages/cli/src/cli/cli-router.ts` for every new or changed command and flag, plus each command's own help output. MCP tool descriptions and parameter descriptions in `packages/cli/src/index.ts` for every new or changed tool or parameter.
  - The site docs that cover touched commands, tools and config (`site/docs/cli/*`, `site/docs/mcp-tools/*`, `site/docs/reference/config-schema.md`, the sidebar), and `README.md` where it lists commands or tools.
  - Every PR's definition of done includes this checklist; the owner asked for it explicitly.
  - No em dashes.
- **Release:**
  - One changeset per PR, minor bumps for features, patch for pure fixes.
  - The next `@ctxo/plugin-api` minor carries protocol v2, with widened peer ranges (PR 1B).
  - The `fixed` group for cli and domain (PR 2B).
  - New packages added to the CI pack list and test runs.
  - No push, PR or publish without the owner's approval.

## 16. Hand-back (when all PRs are done or work is paused)

- The Ctxo version and the install command (`npm i -g @ctxo/cli @ctxo/domain @ctxo/lang-sql` per K15, or the dev build path while unreleased).
- How to run, on a consumer repo:
  - the contexts view (`ctxo contexts --json`, `get_architectural_overlay(mode: "contexts")`)
  - `ctxo contexts-touched`
  - `ctxo verify-domain`
  - the domain guard (`ctxo init --domain`)
- The fixture comparison against the oracle (aggregate numbers, explained differences).
- Everything deferred and why.

## 17. Deferred and out of scope

| Item | Reason | Trigger |
|---|---|---|
| NoSQL support | No consumer yet; path in ADR-017 | First repo with NoSQL coupling |
| Messaging (topics, queues) | Valuable for context maps; path in ADR-017 | Owner request or first repo with a bus |
| Leiden | Louvain plus connected-component split is enough at file level | Candidate quality fails on a large repo |
| "New violations only" boundary mode | Needs base-index comparison | Teams asking to gate named rungs incrementally |
| Cursor stop-hook reminder | Cursor cannot block; a follow-up message is intrusive | Cursor ships a blocking hook, or demand |
| #159 Grep hint | The issue says measure first | Gate adoption telemetry |
| Domain isolation and bounded-context visualization | Owner will evaluate in separate sessions | Owner |
| SQL dialects beyond T-SQL, configurable default schema | No consumer yet | First non-T-SQL repo |
| Top-level DML in SQL scripts as edges | Needs a script-level symbol design | Demand |
| ORM and query-builder data access (EF LINQ, JPQL and Spring Data derived queries, knex chains, Prisma models, TypeORM repositories, gorm models) and MyBatis XML mappers | Entities, not SQL text; needs entity-to-table mapping | First consumer whose data access is mostly ORM |
| Python and other language plugins | Roadmap item (plugin protocol is ready) | User demand |
| C# overload symbol ID collisions | Separate problem | Separate issue |
| Masking false positive on file paths | Separate bug | Separate issue |

## 18. Decision record

### Owner decisions

| # | Decision |
|---|---|
| K1 | Registry: one YAML file, default `docs/domain/contexts.yaml`, path via `domain.registry`; contexts without a card are allowed at rung fear; rungs live in the registry and `context-map.md` must agree |
| K2 | Acknowledgement: commit trailer `Domain-Unchanged: <id>[, <id>] (reason)`, only commits in the evaluated range count |
| K3 | Plugin protocol v2: new kinds and typed annotations; the C# Roslyn helper parses SQL at call sites itself with ScriptDom; `@ctxo/lang-sql` indexes `.sql` files only (amended by K12) |
| K3a | The package stays `@ctxo/lang-sql`; "data coupling" names the concept |
| K3b | NoSQL and messaging: future path in ADR-017 and the roadmap, not built |
| K4 | Contexts view defaults: evidence-based (file level, dependency plus co-change, tests excluded, automatic hub damping plus hub globs, resolution 1.0, small candidates folded, disconnected candidates split, no Leiden) |
| K5 | Co-change window: last 2000 non-merge commits from HEAD, with `since` (HEAD-anchored) and `all` options |
| K6 | Test linkage outside .NET: text scan of test files for rule IDs that exist in cards, plus structured annotations where available |
| K7 | Integration: the cli loads `@ctxo/domain` directly and exposes an internal API |
| K8 | Domain nodes: a separate domain graph; domain isolation and visualization in separate sessions |
| K9 | Fold guard: committed changes only |
| K10 | lang-sql parser: TypeScript tokenizer plus a shared conformance corpus with the C# side |
| K11 | Boundaries: configurable, default by-rung |
| K12 | Facts in protocol v2; four official languages native; text fallback for others |
| K13a | Characterization and contract tests: config conventions with defaults |
| K13b | Resolved shadow-spec candidates: per-context `shadow-specs.yaml` |
| K14 | Phase 1 and Phase 2 split into two PRs each |
| K15 | Repos without `package.json`: global install is the supported path (one copy for MCP, hooks and CLI); `ctxo init` writes MCP entries for the global binary when it runs from a global install |
| K16 | The fold guard judges only commits made in the current session (SessionStart records the starting HEAD); earlier branch history is left to CI |
| K17 | Unowned files: warning by default, error through `domain.coverage.unowned: error`; the context-map check runs when the file exists |
| K18 | Close every non-C# gap in this issue set: SQL call sites, annotations and test symbols for TypeScript, Java and Go, with the tokenizer in a shared library package |
| K19 | Conventions are learned by discover, propose, confirm (`ctxo domain discover`, `init --domain`, doctor warnings); config is the source of truth; ID safeguards hold with any config |
| K20 | PR 1A measures a change-set unit for co-change (`cochange.unit: commit \| merge`, first-parent merges from git only); default stays `commit`; the owner decides after measurement whether it becomes the recommended mode or a separate feature issue |

### Calls made in this design (owner may override)

- **PR 0:**
  - The hook uses one `ctxo index --commit HEAD` run, and the snapshot writer also replaces a same-SHA snapshot.
  - Confidence keeps the 3/7 thresholds over distinct commits.
  - Merge and mass-commit exclusion lands in PR 0 (same code path as the window).
  - The rename map also feeds `intent[]`.
  - `coChangedFiles` is informational only.
  - The `--commit` and `--files` flag names.
  - The `git_hooks` doctor check; respecting `core.hooksPath`.
- **PR 1A:**
  - The shared test-file classifier.
  - Kind weights.
  - The `contextsView` and `communities` config sections.
  - `ctxo contexts`.
  - Exposing the hidden MCP params and removing the dead `fuzzy` param.
  - The registration-schema test.
- **PR 1B:**
  - `reads`, `writes` and `executes` are confirmed tiers.
  - Data-resource name resolution, with the first file in sorted order as the tie-break.
  - All constant-argument attributes become annotations.
  - The ScriptDom `--sql-extract` test mode.
  - Data access is not a clustering weight by default.
  - Protocol v2 in the next plugin-api minor, with widened peer ranges.
  - Facts are produced on request only; SQL call-site edges only when a `.sql` plugin is loaded; annotations always on.
  - `cochange.include` and `cochange.exclude`.
  - The tarball limit is raised with measurements when crossed; sourcemaps keep shipping.
  - Top-level script DML is skipped.
- **PR 1C (from K18):**
  - A separate PR for language parity rather than a larger 1B.
  - `@ctxo/sql-extract` as a zero-dependency library created in 1B, and the plugin dependency exception for Ctxo-owned utility packages.
  - Parity means C#'s scope: raw SQL and procedure calls at known call sites, constants only, full tier only; ORM and query builders deferred in every language.
  - Analyzers report SQL text in their own JSON; the TypeScript side parses it.
  - Go struct tags as annotations; TypeScript test blocks as synthetic symbols; Go test packages loaded.
  - Test titles captured by the K6 text scan (PR 2B and 3).
- **PR 2A:**
  - The compact block draft and the version marker.
  - `--rules` as a deprecated alias.
  - No overwrite of corrupt settings.
  - The ADR-015 fixes.
- **PR 2B:**
  - The registration shape; type-only imports from the CLI's internal API, runtime services injected, `@ctxo/cli` as a devDependency of `@ctxo/domain`.
  - The `fixed` changesets group.
  - The `contracts` semantics, and edges into unowned files being allowed.
  - The `context-map.md` table format.
  - The `contexts-touched` modes and output shape.
  - Guard details: SubagentStop off, per-session fingerprint, base resolution, exit 2 for TaskCompleted.
  - `verify-domain` exit codes and the fold check under `--since`.
  - The generated rule file names and text.
  - Drift by named context as edge-share trend plus moved files.
  - The `context` field on five tools.
  - The init skeleton registry.
  - Discovery details: tracker key regex, the 5-occurrence threshold, `idPattern` default; "unknown ID" errors limited to structured references; overlapping prefixes switch to structured-only linking.
  - Publishing "Ctxo domain conventions v1" (JSON Schema, card template, adoption ladder) in the feature doc.
- **PR 3:**
  - The card micro-syntax (`Tests:`, `Code:`, `Untested:`, decision lines, term items).
  - Domain graph node IDs.
  - Which decisions `get_why_context` returns.
- **PR 4:**
  - The fact detector lists and trivial-literal list.
  - The cumulative suggested-rung ladder with per-criterion status.
  - The `pinnedCoverage` default of 0.8.
- **Release:**
  - `@ctxo/domain` starts at the cli's version.
  - New packages are added to the CI pack list and test runs.

## 19. Known issues found while mapping (fixed only where listed above)

- SQLite `init()` rebuilds from JSON without clearing, so edges with orphan `from` symbols duplicate on every MCP or watch start (TypeScript test files' synthetic module node).
- `ctxo watch` never calls `setSymbolRegistry`; the Roslyn keep-alive path assumes the solution sits at the project root.
- The C# Roslyn batch failure or timeout leaves `.cs` files with zero symbols while the delegate stays active; the `.csproj` fallback calls `OpenSolutionAsync`.
- `get_ranked_context` rebuilds its BM25 index only when the node count changes; its "PageRank" is in-degree.
- `loadConfig` falls back to all defaults when any key is invalid.
- `PluginContext.config` is always `{}`.
- The masking pipeline redacted a file path as `AWS_SECRET`.
- `CHANGELOG.md` at the root has no entries since v0.8; the site docs drift in places (doctor git hooks, init guard prompt).
