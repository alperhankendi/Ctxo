# ADR-STORAGE-01: Text-Based Committed JSON Index + Gitignored Local SQLite Cache

| Field        | Value                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| **Status**   | Accepted                                                                                         |
| **Date**     | 2026-03-28                                                                                       |
| **Deciders** | Alper Hankendi                                                                                   |
| **Session**  | [Architecture Session Log](../bmad-conversation-sessions/session-log-architecture-2026-03-28.md) |

## Context

Ctxo indexes codebases into a symbol graph (symbols, edges, git intent, anti-patterns, complexity metrics) and serves this data to AI agents via MCP tools. The index must be:

1. **Team-shared** — every developer and CI pipeline should see the same index state without re-parsing
2. **Fast to query** — MCP tool responses must complete in < 500ms
3. **Mergeable in git** — PRs that touch different source files should not conflict on the index
4. **Rebuildable** — a new developer should get a working query layer from a fresh clone without running the full indexer

These requirements are in tension: SQLite gives fast queries but is a binary file; JSON is diffable and mergeable but slow to query at scale.

## Decision

Split storage into two layers:

```
.ctxo/
  config.yaml              ← committed  (team settings, masking rules)
  index/                   ← committed  (text-based JSON, one file per source file)
    schema-version         ← migration marker
    src/
      payment/
        processPayment.ts.json
      auth/
        TokenValidator.ts.json
  .cache/                  ← gitignored (local SQLite, rebuilt from index/)
    symbols.db
```

### What is committed (JSON index)

* One `.json` file per source file, mirroring the source tree under `.ctxo/index/`
* Contains: symbols, edges, git intent, anti-patterns, complexity, churn, health score
* Schema version tracked in `.ctxo/index/schema-version`

### What is gitignored (SQLite cache)

* `better-sqlite3` database in WAL mode at `.ctxo/.cache/symbols.db`
* Rebuilt automatically from committed JSON on startup if missing or stale
* Used exclusively for fast queries (graph traversal, blast radius, logic-slice)

## Rationale

### Why not commit SQLite directly?

| Problem                    | Impact                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Binary merge conflicts** | SQLite `.db` files are opaque to git. Two developers indexing different files produce binary conflicts that cannot be resolved — only one side can win. This breaks team workflows on every PR. |
| **No meaningful diffs**    | `git diff` shows nothing useful for a binary file. Code reviewers cannot see what changed in the index.                                                                                         |
| **Repository bloat**       | Every commit stores the entire binary file. Over time this inflates `.git/` significantly — git LFS would be required but adds operational complexity.                                          |
| **No partial merge**       | Even with git LFS, there is no way to merge two independently updated SQLite files.                                                                                                             |

### Why per-file JSON instead of a single monolithic JSON?

| Single JSON file                                                              | Per-file JSON                                                                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Two developers index different source files → merge conflict on the same file | Conflicts scoped to individual files — only conflicts if two people change the same source file |
| Full file rewrite on every index update                                       | Only the changed file's JSON is rewritten                                                       |
| Large diffs in PRs                                                            | Small, focused diffs showing exactly which symbols changed                                      |
| Cannot parallelize writes                                                     | Independent files can be written concurrently                                                   |

### Why keep SQLite at all (instead of pure JSON)?

* **Query performance**: Graph traversal (transitive dependency resolution, blast radius calculation) requires indexed lookups. Scanning hundreds of JSON files per MCP request would exceed the 500ms latency target.
* **Relational queries**: "Find all symbols that import X" is a single indexed SQL query vs. scanning every JSON file.
* **WAL mode**: Concurrent reads during writes — critical for the file watcher updating the index while MCP tools serve queries.

### Why local-only (gitignored) SQLite?

* **Zero-conflict guarantee**: Since `.cache/` is gitignored, there are never merge conflicts on the database.
* **Deterministic rebuild**: SQLite is fully derived from committed JSON — it is a cache, not a source of truth. Deleting it and rebuilding loses nothing.
* **Storage replaceability**: Because SQLite sits behind `IStoragePort`, the database engine can be swapped (DuckDB, in-memory, remote graph DB) by changing one adapter and one line in the composition root. The committed JSON index means no data migration is needed.

## Cache Invalidation Strategy

| Scenario                               | Trigger                             | Action                                                                     | Latency    |
| -------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- | ---------- |
| **Cold start** (clone / deleted cache) | MCP server startup, no `symbols.db` | Read all `.ctxo/index/*.json` → batch-insert SQLite                        | 100ms – 3s |
| **Dev session** (file change)          | Chokidar file watcher               | Re-parse single file → update JSON + SQLite rows                           | \~20ms     |
| **Git pull** (team changes)            | MCP startup after pull              | Compare JSON `lastModified` vs SQLite timestamps → re-import changed files | 100ms – 2s |

## CI Integration

Two supported patterns for keeping the committed index fresh:

**Pattern A — CI commits updated index** (recommended):

```YAML
- run: npx ctxo index
- run: git add .ctxo/index/ && git diff --staged --quiet || git commit -m "chore: update ctxo index [skip ci]" && git push
```

**Pattern B — CI gates on stale index**:

```YAML
- run: npx ctxo index
- run: git diff --exit-code .ctxo/index/
```

## Consequences

### Positive

* PRs show human-readable diffs of index changes — reviewers can see what the indexer detected
* New developers get a working system from `git clone` → `ctxo init` (SQLite auto-rebuilds)
* Zero merge conflicts on the query layer
* Storage engine is a swappable cartridge behind `IStoragePort`
* `.ctxo/index/` serves as a durable backup — corrupt SQLite is simply deleted and rebuilt

### Negative

* Two representations of the same data must be kept in sync (JSON source of truth → SQLite derived)
* Committed JSON files add to repository size (mitigated: one small JSON per source file, not a monolith)
* Cold-start rebuild adds 100ms–3s latency on first MCP request after clone
* Schema migrations must update both JSON format and SQLite schema

### Risks

* **Schema drift**: If JSON schema evolves but old JSON files are not migrated, SQLite rebuild may fail. Mitigated by `schema-version` file and auto-migration on startup.
* **Large monorepos**: Committing thousands of JSON files may slow `git status`. Mitigated by per-directory layout matching source tree structure.

## Alternatives Considered

| Alternative                          | Why rejected                                                  |
| ------------------------------------ | ------------------------------------------------------------- |
| Commit SQLite directly               | Binary merge conflicts, no diffs, repo bloat                  |
| Single monolithic JSON               | Merge conflicts between developers, large diffs               |
| SQLite + git LFS                     | No merge capability, LFS operational overhead                 |
| No committed index (always re-parse) | Slow CI, no team-shared state, wasted compute                 |
| Remote database (PostgreSQL, Neo4j)  | Violates "works offline" and "zero infrastructure" principles |

## References

* [Architecture Document](architecture.md) — Section "Storage Architecture Decision"
* [Architecture Session Log](../bmad-conversation-sessions/session-log-architecture-2026-03-28.md) — Full decision discussion
* [CLAUDE.md](../../CLAUDE.md) — Storage section (ADR-STORAGE-01)

