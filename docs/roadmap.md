# Ctxo — Roadmap

> Single source of truth for **what's next** and **what we've explicitly decided not to do**.
>
> - **Shipped work** — see [CHANGELOG.md](../CHANGELOG.md) and [prd.md § Delivered Phases](artifacts/prd.md#delivered-phases-post-v1)
> - **Per-story delivery status** — see [epics.md § Delivery Status](artifacts/epics.md#delivery-status-as-of-2026-04-13)
> - **Architectural decisions behind deferrals/rejections** — see [ADRs](architecture/ADR/)
>
> Consolidated 2026-04-13 from `todo.md` (competitive analysis) + `docs/todo-visibility.md` + epic audit remaining items. Originals archived in [archive/todo/](archive/todo/).

---

## Active Development (next candidates)

Items on deck for v0.7.x / v0.8. No strict ordering — picked by impact + readiness.

### Code intelligence

- **Community detection / graph clustering** — _shipped in v0.8 (see [CHANGELOG](../CHANGELOG.md))_. Louvain over the symbol graph powers `get_architectural_overlay` data-driven clusters, god nodes, cluster-scoped blast radius, drift signals in `get_why_context`, and boundary violations in `get_pr_impact`. Leiden remains deferred (see below).

- **Safe-edit guard + ctxo skills** - _shipped in v0.8_. PreToolUse hook (Claude Code) blocks edits to high-impact symbols until blast radius is checked; three model-invoked skills (`ctxo-understand`, `ctxo-safe-edit`, `ctxo-review-pr`) installed by `ctxo init`; new `ctxo blast-radius <symbolId> --json` and `ctxo gate --preview` commands; `gate:` config with `sensitivity` dial (strict/balanced/lenient). Cursor and other tools get skills + rules; Claude Code gets full hook enforcement. See [ADR-015](architecture/ADR/adr-015-safe-edit-guard.md).

- **Co-change engine, incremental indexing, one snapshot per commit (#157)** - _shipped_. Co-change comes from one git pass with its own window (`cochange:` config, `--cochange-commits`, `--cochange-since`), independent of `--max-history`; `ctxo index --files` and `--commit` re-index part of the index; the v2 post-commit hook runs `ctxo index --commit HEAD` once per commit and is upgraded in place by `ctxo init` and `ctxo doctor --fix` (new `git_hooks` check); history keeps one snapshot per commit and drift and boundary confidence count distinct commits; every blast-radius path (tools, CLI, gate) uses co-change and `get_blast_radius` adds `coChangedFiles`. See [ADR-016](architecture/ADR/adr-016-co-change-engine-and-snapshot-policy.md).

- **Contexts view: candidate bounded contexts (#156 Phase 1)** - _shipped_. `ctxo index` writes `.ctxo/index/contexts-view.json`: file-level Louvain over a blend of dependency and co-change edges, hub files damped, each candidate with a suggested label, fingerprint, cohesion, top terms, cross-candidate edges, co-change pairs and name collisions. Read it with `get_architectural_overlay({ mode: "contexts" })` (summary first, `candidate: <id>` for one in full) or `ctxo contexts [--json]`. New config: `communities:`, `contextsView:` and `index.tests`; `mode`, `searchMode` and `search_symbols` `mode` are now registered so clients can send them. See [architectural intelligence](features/architectural-intelligence.md) and the [ADR-016 addendum](architecture/ADR/adr-016-co-change-engine-and-snapshot-policy.md).

- **Plugin protocol v2, data coupling and `@ctxo/lang-sql` (#156 Phase 1)** - _shipped_. `@ctxo/plugin-api` adds the data kinds (`table`, `view`, `procedure`; `reads`, `writes`, `executes`), typed symbol annotations, facts on request (`index.facts`) and host capabilities, with `SUPPORTED_API_VERSIONS = ['1', '2']`. `@ctxo/lang-sql` (on the zero-dependency `@ctxo/sql-extract`, `ctxo install sql`) indexes T-SQL definitions and body accesses; the C# plugin reports attribute annotations and, with lang-sql installed, adds SQL edges at known ADO.NET, Dapper (including `CommandDefinition`), `SqlBulkCopy` and EF Core call sites (ScriptDom, constants only), falling back to tree-sitter when its helper cannot restore (new `csharp_tier` doctor check). Data edges are confirmed blast-radius dependents and stay out of symbol-level communities; every copy of a multi-defined table or procedure, and its 2-part ID, gives the same impact answer; the contexts view reports shared tables, ownership and external resources (`contextsView.weights.data`, default 0); test files are recognised by test-framework annotations. A shared corpus keeps the TypeScript and ScriptDom parsers in agreement. See [domain knowledge](features/domain-knowledge.md) and [ADR-017](architecture/ADR/adr-017-plugin-protocol-v2-and-data-coupling.md).

- **Call-site SQL for TypeScript, Java and Go (#156, PR 1C)** - next. The TypeScript, Java and Go plugins recognise constant SQL at known data-access call sites through `@ctxo/sql-extract`, with host-language corpus cases (ADR-017 addendum then). Call-site placeholder parity (EF `{0}`, JDBC `?`, Go `$1`) is part of it.

### Platform & transport

- **`CTXO_HTTP_PORT` shadows CLI commands** - _fixed (see [CHANGELOG](../CHANGELOG.md))_. `CTXO_HTTP_PORT` used to take the HTTP server path before the CLI router, so with the variable exported `ctxo <command>` (including `ctxo <command> --help` and the post-commit hook's `ctxo index --commit HEAD`, which made `git commit` hang) started a server. The variable now counts only when `ctxo` runs without arguments; with arguments the CLI router runs. `--http [--port <n>]` still selects HTTP mode.

- **Streamable HTTP transport** — for remote/cloud MCP usage. Today Ctxo is stdio-only. Needed for hosted scenarios and non-local clients.

### Ecosystem

- **Monorepo workspace support (Phase 1)** — pnpm-workspace.yaml auto-detection + per-package plugin aggregation. Forward-compat hooks landed in v0.7.0 (`IWorkspace`, parameterized plugin discovery); full implementation pending user demand. See [prd.md § Phase 3](artifacts/prd.md#phase-3-monorepo-workspace-support).

---

## Quality & verification backlog

Open loops from the Epic 6 audit (2026-04-13). Small-to-medium tasks; clearing these closes the "Cross-Client Compat & Release" epic cleanly.

- **Cross-client smoke-test matrix** — Auto-registration works (v0.5.1) but no captured smoke-test record. Run all 14 MCP tools against Claude Code / Cursor / VS Code Copilot / Windsurf against a reference fixture; commit the result into `docs/runbook/mcp-validation/test-sessions/`.
- **Published p95 baseline per MCP tool** — Benchmark harness exists (`pnpm --filter @ctxo/cli bench`); no baseline numbers in docs. Run once on a reference machine, publish table under [architecture.md](artifacts/architecture.md) NFR-1 budgets.

---

## Deferred (not started, scope clarified)

Work that's been scoped and explicitly parked. Each has a known trigger to reactivate.

| Item | Source | Trigger to reactivate |
|---|---|---|
| **Layer-3 UserPromptSubmit nudge** | Safe-edit guard v0.8 | Prompt-level reminder when the guard has been active but the agent skips skills. Deferred: PreToolUse hook already enforces; adding a nudge risks prompt noise before measuring adoption impact. |
| **Cursor reactive `stop`-hook gate** | Safe-edit guard v0.8 | Cursor has no blocking pre-edit hook (confirmed through v3.6 changelog). Revisit if Cursor ships a pre-edit extension point. |
| **Coordinated `tree-sitter@^0.25.0` ecosystem upgrade** | #106 (Option 2) | Grammar plugins are pinned to exact versions against the `tree-sitter@^0.22.4` core (closing the lockfile-regen landmine). Bumping core to `^0.25.0` unblocks `tree-sitter-go@0.25` (#77) and newer `tree-sitter-c-sharp` (#78). Trigger: user demand for newer grammars; requires validating the 0.25 core API against each tree-sitter adapter. |
| **Tier-3 platform enforcement** | Safe-edit guard v0.8 | Enforcement for platforms beyond Claude Code (Windsurf, Copilot, etc.). Depends on each platform shipping a blocking pre-tool hook. |
| **Gate adoption telemetry** | Safe-edit guard v0.8 | Track how often the guard fires and is satisfied vs bypassed. Gate on confirmed user demand for the signal. |
| **Co-change log cache** (`.ctxo/.cache/cochange-log.json`, keyed by SHA) | ADR-016 | The single git pass costs about 0.25 s on a 1600-commit repository. Add the cache and parse only `lastHead..HEAD` if a repository's pass exceeds 2 s. |
| **`--topo-order` for the co-change rename map** | ADR-016 | The rename map walks the log newest first and relies on git's default order. Adopt `--topo-order` if a repository with clock-skewed committer dates resolves renames to a stale name. |
| **Extensionless `extends` / `implements` ids in single-file runs** | #157 follow-up | With only the changed file loaded, `@ctxo/lang-typescript` can resolve an `extends` or `implements` edge to an extensionless import as `src/base::Base::class` instead of `src/base.ts::Base::class` (a full run gives the second). Affects `--file`, `--files` and `--commit` runs; fix in the adapter's symbol-reference fallback. |
| **Contexts view refresh in `ctxo watch`** | #156 / PR 1A | The view is recomputed by `ctxo index` (and the post-commit hook) but `ctxo watch` does not refresh it. Add it if users read the view during long watch sessions. |
| **`cochange.unit: merge` (change sets from merge commits)** | #165, ADR-016 addendum | Measured in PR 1A and left out: it strengthened cross-cutting co-change on the fixture and was flat on this repo. Reopen if a target emerges that the change-set unit serves better than filtering. |
| **Filter cross-cutting technical change sets from co-change** | #156 / PR 1A (K30) | Two areas of the fixture share a candidate through cross-cutting technical co-change, so the strict "four areas, four candidates" reading is not met. Trigger: a repository where such change sets visibly merge unrelated contexts. |
| **More test signals: other test attributes and bare `Tests/` folders** | #156 / PR 1B (K35, K38) | Annotation-based test detection shipped in PR 1B (11 xUnit, NUnit and MSTest names; name-only `*Test.cs` / `*Tests.cs` matches need an annotation once C# annotations exist). Still missed: test classes that use only other attributes (for example FsCheck `[Property]`; attributes derived from `Fact` or `Theory` have their own row) and unannotated `*Tests.cs` files in a bare capital `Tests/` or `Test/` folder (`**/tests/**` is case-sensitive). Workaround: an `index.tests` glob. Trigger: user evidence that the workaround is not enough. |
| **NoSQL data resources** | ADR-017 (K3b) | A `collection` kind with virtual resource nodes (for example `@data/mongodb::loans::collection`), host-plugin recognizers for driver calls, EF Core `ToTable` / `[Table]` through the same mechanism, and own language plugins for schema languages (CQL, Cypher, Prisma). Trigger: the first user whose contexts share a document store. |
| **Messaging coupling** | ADR-017 (K3b) | `topic` and `queue` kinds with `publishes` and `subscribes` edges; type-based buses point at the message class, named channels get virtual nodes (for example `@msg/kafka::loan-events::topic`); AsyncAPI as a future language plugin. Trigger: the first user whose contexts couple through a message bus. |
| **SQL dialects beyond T-SQL, configurable default schema** | #156 / PR 1B | Dialect (`tsql`) and default schema (`dbo`) are constants in v1. Trigger: fixture or user evidence of missed edges, or the first non-T-SQL consumer. |
| **Top-level DML as edges** | #156 / PR 1B | `INSERT`, `UPDATE` or `SELECT` outside any definition (migration and seed scripts) produce no edges; co-change still links those scripts. Trigger: fixture or user evidence of missed edges. |
| **`ALTER TABLE ... ADD` columns across files** | #156 / PR 1B | Added columns count only in the file that defines the table. Trigger: fixture or user evidence of missed columns or collisions. |
| **ORM and query-builder data access** | #156 / PR 1B | EF Core LINQ, `ToTable` / `[Table]` mappings and query builders produce no data edges; only constant raw SQL at known call sites does. Trigger: fixture or user evidence of missed edges. |
| **Non-constant SQL and project helper methods** | #156 / PR 1B | Dapper `CommandDefinition` became a known call site in PR 1B on fixture evidence. Still missed: SQL built at runtime (interpolation, `StringBuilder`, non-const variables and collections, `switch` expressions, table names from a registry) or kept in `static readonly` fields, and SQL that a project's own helper methods receive as arguments. On the PR 1B fixture these were 33 and 20 of the 75 real table accesses Ctxo missed (recall 59% of real pairs, precision 109 of 111). Trigger: a cheap recognizer for a common helper or builder pattern, or user evidence. |
| **Coverage of edgeless `.sql` files in the contexts view** | #156 / PR 1B (R3) | At `contextsView.weights.data` 0, `.sql` files with no co-change partner stay unclustered and lower `coverage` (0.99 to 0.91 on the fixture, candidates unchanged). Options: leave edgeless `.sql` files out of the coverage denominator, or give data edges a default weight. Workaround: `contextsView.exclude`. Trigger: a second SQL-heavy repository, or users reading the lower ratio as a regression. |
| **Test attributes by base type** | #156 / PR 1B (R5) | Test detection matches the 11 attribute names exactly, so a project's own attributes derived from `Fact` or `Theory` are not recognised. Resolve attribute base types in the Roslyn tier. No effect on the fixture (its folder globs caught every such file). Workaround: `index.tests`. Trigger: a name-only `*Tests.cs` file that this demotes to production. |
| **Data resource as one logical node** | #156 / PR 1B final review | Same-name definitions of a table or procedure resolve to one winner (production before docs before test, then codepoint-smallest path), and every copy shares the winner's dependents. The winner is not necessarily the newest migration, and the contexts view separately takes the union of the production copies' procedure bodies. Consider modelling a resource as one node keyed by canonical name, with the definitions as evidence, before NoSQL and messaging add virtual nodes. Trigger: PR 1C or 2 design work. |
| **C# keep-alive request timeout** | #156 / PR 1B final review | In `ctxo watch`, a single request that times out while the Roslyn keep-alive is still alive falls back to the batch cache, which can be stale for that file. A dead keep-alive is restarted, or the file falls back to tree-sitter; only the live-but-slow case remains. Fix: treat a request timeout like a failed restart for that file. Trigger: user evidence of stale C# symbols in watch. |
| **`get_why_context` miss cost** | #156 / PR 1B final review | A miss now reads every JSON index and builds the graph before it answers `found: false`, so that 2-part data ids resolve. Fine on the repositories measured; consider a cheap symbol-id lookup first. Trigger: slow misses on a large repository. |
| **Several `.csproj` files without a solution** | #156 / PR 1B | Without a `.sln` / `.slnx`, the Roslyn helper opens the first `.csproj` it finds, so only that project's files get Roslyn symbols. Trigger: user evidence. |
| **Contexts view honours `index.ignoreProjects` on incremental runs** | #156 / PR 1A | The view's `isIgnored` does not apply `ignoreProjects` to `--files` and `--commit` runs. Fix when a workspace relies on it. |
| **Warn on `!` negation in `index.tests`, `contextsView.exclude` and `hubs.paths`** | #156 / PR 1A | The globs are matched without negation; `ctxo doctor` could warn instead of silently ignoring a `!` pattern. |
| **`_meta.snapshotStaleness` in contexts mode uses `view.commitSha`** | #156 / PR 1A | The envelope compares the community snapshot's commit; in `mode: "contexts"` the view's own `commitSha` is the accurate reference. |
| **`foldSmallGroups` is quadratic in small groups** | #156 / PR 1A | Fine at the measured scale (18 groups, 0.2 ms). Optimise if a repository produces thousands of small groups. |
| **Leiden community detection** | v0.8 Architectural Intelligence work | Monorepos/codebases where Louvain cluster quality is insufficient (~100K+ symbols, high modularity resolution needs). Swap is additive — same `CommunitySnapshot` output shape. |
| **Historical graph reconstruction for drift (`--since=30d`)** | v0.8 drift design | User demand for deep temporal drift analysis over re-parse cost. Snapshot-based chain is default. |
| **GHA workflow template in `ctxo init`** | v0.8 init UX | Shipped as plain docs guidance in v0.8; wrap as interactive template when users ask. |
| **HEAD staleness hint in MCP `_meta`** | v0.8 init UX | Snapshot freshness is observable via `commitSha` inside `communities.json`; promote into response envelope if users report drift signal confusion. |
| **Phase 1 Tier 3 — FTS5 search** | todo.md Phase 1 Tier 3 | Monorepos or codebases with 25K+ symbols where in-memory BM25 degrades. See [ADR-003](architecture/ADR/adr-003-fts5-search-deferred.md). |
| **Python plugin** (Phase B) | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | User demand post-v0.7; plugin protocol v1 already stable. Java shipped (see ADR-014). |
| **Framework-aware analysis** (Spring / Django ORM) | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | Requires plugin protocol v2 (semantic hooks); out of scope until multiple plugins exist. |
| **Community plugin registry** | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | v0.8+; gate on first third-party plugin request. |
| **Automated release pipeline** | [prd.md § Phase 2](artifacts/prd.md#phase-2-plugin-architecture--language-expansion) | Currently using changesets + manual tag; automate when release cadence exceeds ~monthly. |
| **C# beyond current full-tier** | prd.md Language Matrix | Roslyn + tree-sitter composite covers v0.8 needs; revisit if users request features Roslyn does not already expose. |

---

## Rejected (ADR-backed)

| Item | Decision | Reason |
|---|---|---|
| **Session continuity** (pre-compaction snapshots, SessionDB) | Rejected | Stateless tools make session state unnecessary. See [ADR-002](architecture/ADR/adr-002-reject-session-continuity.md). |
| **External docs integration** (URL fetch + index) | Rejected | LLMs + client-side WebFetch already solve this; misaligned with code intelligence mission. See [ADR-004](architecture/ADR/adr-004-reject-external-docs-integration.md). |
| **Webhook HTTP listener** (Epic 8) | Rejected | CI gate (`ctxo index --check`) + `post-commit` git hook deliver the same guarantee with zero server overhead. See [epics.md § Epic 8](artifacts/epics.md#epic-8-event-driven-index-updates-github--gitlab-integration). |

---

## Visibility & ecosystem (marketing / outreach)

Not product work, but tracked here so it doesn't get lost.

### MCP directory listings

- [ ] **awesome-mcp-servers** — open PR: [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) (Developer Tools section)
- [ ] **glama.ai** — submit: <https://glama.ai/mcp>
- [ ] **smithery.ai** — submit: <https://smithery.ai>
- [ ] **mcp.so** — submit: <https://mcp.so>
- [ ] **pulsemcp.com** — submit: <https://pulsemcp.com>
- [ ] **mcpservers.org** — submit: <https://mcpservers.org>
- [ ] **mcpmarket.com** — submit: <https://mcpmarket.com>
- [ ] **modelcontextprotocol/servers** — open PR: [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)

### GitHub repo polish

- [x] Topics (13 topics added)
- [x] Discussions enabled
- [x] Social preview uploaded
- [x] CONTRIBUTING.md
- [ ] Demo GIF / video embedded in README
- [ ] npm README badges (downloads, stars, license)
- [ ] Issue templates (bug report, feature request)
- [ ] PR template
- [ ] SECURITY.md
- [ ] FUNDING.yml (GitHub Sponsors)

### External

- [ ] "How I built Ctxo" post on Dev.to / Hashnode
- [ ] Reddit post (r/programming, r/MachineLearning)

---

## How this document is used

- **Adding work:** append under the right section with enough context that a cold reader knows why. Link to ADRs / epics / PRDs rather than re-explaining rationale.
- **Finishing work:** move the bullet out of this file into [CHANGELOG.md](../CHANGELOG.md); if it was a phase, also update [prd.md § Delivered Phases](artifacts/prd.md#delivered-phases-post-v1).
- **Rejecting or deferring work:** require an ADR or epic note before moving to "Deferred" / "Rejected". No silent deletions — history goes in archive.
