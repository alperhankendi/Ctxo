# Execution Flows - Design Spec

- **Date:** 2026-11-12
- **Status:** Owner decisions taken (2026-11-12). The full document is waiting for owner review.
- **Author:** Alper Hankendi
- **Issue:** #231 (phases: #232, #233, #234, #235)

## Problem

An agent that changes a function sees its dependents: `get_blast_radius` lists them, with tiers and risk scores. It does not see which **user-facing operations** run through the function. "This change touches 14 symbols" is not the same as "this change touches `POST /api/loans`, the nightly `OverdueReminderJob` and the `LoanReturned` handler". The second answer is what a developer checks before merging, and what a reviewer asks about.

The graph already holds most of the answer:
- `calls` edges between functions and methods, from the full tiers of the TypeScript, C#, Go and Java plugins
- annotations (protocol v2) that mark HTTP handlers, listeners and scheduled jobs
- `endpoint` facts with verb and route, when facts are requested
- data edges (`reads`, `writes`, `executes`) to tables and procedures
- communities and candidate contexts

Nothing connects these pieces into **flows**: an entry point plus the call tree it runs. So every agent rebuilds that picture by hand, one `get_logic_slice` at a time, or does not build it at all.

## Goals

- Detect **entry points**: HTTP handlers, message and event listeners, scheduled jobs, CLI commands, `main`, and request handlers. Detection works without changes to user code.
- For each entry point, trace the **call tree** it runs within bounded limits. The result is a **flow**, labelled by what a human would call it (`POST /api/loans`, `OverdueReminderJob.Execute`).
- Answer three questions through MCP and the CLI:
  1. Which flows does this repository have?
  2. Which flows pass through this symbol, and by which call chain is it reached from each entry?
  3. Which flows does this change (a symbol or a PR) touch?
- Record the **tables a flow touches** (read, written, through procedures) and the **communities it crosses**, so a flow is also a cross-layer and cross-context view.
- Be deterministic: the same index gives byte-identical output.

## Non-goals

- No runtime tracing and no profiling data. Flows are static, from the graph.
- No statement-level control flow: no branches, conditions or ordering of calls inside a function. A flow is a call tree, not a sequence diagram.
- No asynchronous hops in v1. Message bus edges (`publishes`, `subscribes`, #209) and HTTP client-to-handler edges (the route map issue, #237) will extend flows once they exist. Until then, a flow ends where the code publishes a message or calls an HTTP API.
- No change to blast radius tiers, risk scores, PageRank or the safe-edit gate decision.
- No changes to `ctxo visualize` in v1. Flows will feed the visualize v2 discussion separately.
- No LLM-generated labels or summaries.
- `@ctxo/domain` enrichment (the named context of each step, rules along a flow) is a follow-up, not part of v1.

## Anti-goals

These would make the feature a failure even if it technically works:
- **Noise.** Hundreds of "flows" that are really every exported helper with no caller. Graph-only entry points must be conservative (see Part B). A short, credible list beats a complete, unreadable one.
- **Shallow flows presented as complete.** A flow that stops after one hop because an edge is missing must say so. Every truncation is counted and reported.
- **Index slowdown or artifact churn.** `ctxo index` must not get noticeably slower, and the committed artifact must not change on commits that do not change entry points.

## Part A: call edges that a trace can follow

Flows are only as good as the `calls` edges. The current state per language:

| Language and tier | `calls` edges today | Effect on flows |
|---|---|---|
| C# Roslyn (full) | Method to method, type-resolved (`IInvocationOperation`). `new T()` gives a `uses` edge to the type, not `calls` | Good. A call through an interface lands on the interface member (see dispatch, Part C). Constructors are not entered, which loses little because later method calls on the instance have their own edges |
| Go analyzer (full) | Function or method to method, type-resolved | Good |
| TypeScript ts-morph (full) | Only from exported functions and methods of exported classes. Resolved by the **last name segment** (`foo.bar()` looks up `bar`), with `this.x()` resolved on the class | Weak. Calls through an instance (`storage.getDb()`, `calculator.calculate()`) usually give no edge; non-exported functions and arrow functions assigned to constants are never sources. Flows stop at the first instance call |
| Java JDT (full) | Edges start at the **enclosing type**, not the method (roadmap deferred item) | Coarse. A flow starts at the annotated method's type, and steps are types |
| Tree-sitter syntax tiers (all languages) | None | No flows. `ctxo flows` reports such languages as not covered |

Both weak rows are fixed in this work (owner decision), as A1 and A2 below.

**A1. TypeScript call resolution (phase 1 of this work, owner decision).**
- **Resolution:** resolve each call expression's target through the ts-morph type checker (the declaration of the called symbol) when that declaration is in the repository. Fall back to today's name lookup otherwise.
- **Sources:** extend them to non-exported functions, arrow functions and function expressions assigned to `const`, and object-literal methods, where they are symbols.
- **Measurement:** before and after, on this repository and on the TypeScript fixture: edge counts, `ctxo gate --preview` output and index time. More `calls` edges raise `confirmed` dependents, so the gate can fire on more symbols. The measured change goes into the PR description and the CHANGELOG, and `@ctxo/lang-typescript` gets a changeset that says so.
- **Library calls:** the in-memory ts-morph project has no `node_modules` types (a known limitation). Calls into libraries stay unresolved, which is fine: flows stop at the repository boundary anyway.

**A2. Java method-level edges (in this work, owner decision).** This closes the roadmap deferred item "JDT `calls` / `uses` edges from methods instead of types".
- **What changes:** the JDT analyzer (`@ctxo/lang-java-analyzer`) emits `calls` and `uses` edges from the enclosing method, constructor or initializer. It does so as it already does for data edges, and as Roslyn and the Go analyzer do. Edges from field initializers and type-level declarations (annotations, `extends`, `implements`) stay on the type.
- **Effects to handle in the same work:**
  - Every Java file's edges and blast radius change. Measure before and after on the Java fixture, as for A1, and record the change in the changesets of `@ctxo/lang-java-analyzer` and `@ctxo/lang-java`.
  - The domain layer's test reachability says "a test without edges of its own starts from its container (JDT edges are type-level)". With method-level edges that fallback rarely applies. Keep it for older analyzer JARs, and update the domain docs and tests.
  - An older analyzer JAR keeps type-level edges. The plugin detects the analyzer version, and `ctxo doctor` (the `java_tier` check) warns that flows are type-level until `ctxo install java --full-tier`.
  - The prebuilt JARs are rebuilt and shipped through the normal release flow.
- **Fallback:** a trace that starts at a Java method with no outgoing edges of its own (older JAR) starts from its container type.

## Part B: entry points

Detection runs at index time, because annotations and facts live in the JSON index only (SQLite does not hold them).

**Facts are requested (owner decision).** With `flows.enabled: true` (the default), `ctxo index` requests facts from the plugins, as `index.facts: true` and a domain registry already do. So call-registered endpoints (Express, Fastify, gin, `http.HandleFunc`, ASP.NET `MapGet`) are `http` entry points out of the box.
- **The cost is accepted:**
  - every index JSON of a fact-capable plugin gains a `facts` array (`[]` when none is found), which means one large index diff on the first run
  - fact extraction adds index time, which is measured separately (see performance budgets)
- **Upgrades:** after the upgrade, a full `ctxo index` is needed for every file to get facts, as for the other ways of turning facts on. Incremental runs give facts only to the files they touch. The CHANGELOG and `ctxo flows` say this when some files have no `facts` key.
- **`flows.enabled: false`** neither requests facts nor writes `flows.json`. Facts can still be requested by the other two ways.

**Candidates.** Symbols of kind `function` or `method` (`class` only for Java with an older analyzer JAR, per A2) that meet all of these:
- not in a test file (the shared test-file classifier), and not matched by `index.ignore`
- at least one outgoing `calls` edge (or, for call-registered endpoints, see below)

**Signals, strongest first.** A candidate is an entry point if it has at least one signal. Each entry point records every signal it has.

| Kind | Signal | Defaults |
|---|---|---|
| `http` | An endpoint annotation on the method or its class | C#: `HttpGet`, `HttpPost`, `HttpPut`, `HttpDelete`, `HttpPatch`, `Route`. Java: `GetMapping`, `PostMapping`, `PutMapping`, `DeleteMapping`, `PatchMapping`, `RequestMapping`, JAX-RS `GET`, `POST`, `PUT`, `DELETE`, `Path`. TypeScript (Nest): `Get`, `Post`, `Put`, `Delete`, `Patch`, `All` |
| `http` | An `endpoint` fact (requested by flows, see above), giving `verb` and `route` | Annotation endpoints carry the annotated method. Call-registered endpoints (`MapGet`, Express, gin, `http.HandleFunc`) carry the registering declaration. For those, the trace also follows `uses` edges from the registering declaration to function symbols at depth 1, so named handlers passed as values join the flow |
| `message` | A listener annotation | `KafkaListener`, `RabbitListener`, `JmsListener`, `EventListener`, `SqsListener`, Nest `EventPattern`, `MessagePattern`, `OnEvent` |
| `schedule` | A scheduling annotation | `Scheduled` (Spring), Nest `Cron`, `Interval`, `Timeout`; Hangfire and Quartz job interfaces through `implements` (below) |
| `handler` | A method of a class that `implements` a known handler interface, where the method name matches | C#: `IRequestHandler.Handle`, `INotificationHandler.Handle`, `IConsumer.Consume`, `IHostedService.StartAsync`, `BackgroundService.ExecuteAsync` (via `extends`), `IJob.Execute` (Quartz). Java: `CommandLineRunner.run`, `ApplicationRunner.run`, `Job.execute` |
| `cli` / `main` | Conventional names | `main` and `Main` functions, `Program.Main`; `run` and `execute` methods of classes whose name ends in `Command` |
| `graph` | No signal above, and the graph says nothing calls it | See conditions below |

**Graph-only entry points (anti-noise).** A candidate without a signal is an entry point only if all of these hold:
- no incoming code edge of any kind (`calls`, `uses`, `imports`, `extends`, `implements`) from a non-test symbol
- its trace reaches at least `flows.graphEntryMinReach` distinct symbols (default 3)
- it is not under a folder named `scripts`, `tools`, `examples`, `fixtures` or `docs` (the builder may extend this list)

**Score and cap.** Each entry point gets a score:
- Any signalled entry point outranks every graph-only one.
- Within a kind, the score grows with the number of distinct symbols the trace reaches (log scale) and the entry's PageRank.
- Ties break on symbol ID.

The score is computed **when flows are read** (MCP server, CLI), not stored, because PageRank and reach move on almost every commit (see Part D).

**Cap.**
- At index time, the cap keeps `flows.maxEntryPoints` (default 200) entry points: every signalled one first, ordered by kind and then symbol ID, and graph-only ones only to fill the remaining places. The artifact counts the rest as `entryPointsDropped`.
- Ranking by score happens at read time.
- The exact formula is the builder's, within these ordering rules.

**Labels.**
- `http`: `<VERB> <route>` from the fact or annotation arguments (verb `ANY` when none is declared), else the symbol name.
- All other kinds: the symbol name as written in its ID (`OverdueReminderJob.Execute`).
- Labels are not unique. The flow ID is.

**Flow ID.** The entry point's symbol ID. It is stable, readable and needs no hashing.

**Config.** Defaults are built in; config only adds to them:

```yaml
flows:
  enabled: true
  maxEntryPoints: 200
  maxDepth: 8
  maxStepsPerFlow: 150
  hubMinCallers: 25          # callees with this many production callers are steps but not expanded
  graphEntryMinReach: 3
  entryPoints:
    annotations: []          # extra annotation names, e.g. [MyEndpoint]
    implements: []          # extra handler interfaces as "Interface.method", e.g. [IEventHandler.Handle]
    names: []                # extra symbol-name globs, e.g. ["*Job.Run"]
    exclude: []              # symbol-ID globs that are never entry points
```

Invalid globs warn through `ctxo doctor`, like the other glob settings. Schema violations fail, and the loader falls back to defaults.

## Part C: tracing

From each entry point, a breadth-first walk over the graph:

- **Edges followed:**
  - `calls`
  - `executes` (code to a stored procedure, then the procedure's own `executes`)
  - `uses` at depth 1 for call-registered endpoints only (Part B)
  - Nothing else: `imports` and `uses` in general are too broad.
- **Dispatch through interfaces and base classes.** A step that lands on a member `B.M` of an interface or class `B` also continues into the same-named member `C.M` of each non-test class `C` that `implements` or `extends` `B`, directly or transitively. The index records no modifiers (no abstract or virtual flag), so the match is by name and is the same for interfaces and base classes. Matching uses class-level `implements` and `extends` edges. When `B.M` has its own outgoing edges (a concrete base method), the walk follows both those edges and the overrides. If more than 3 members match, they are not expanded and count as `dispatchAmbiguous`. (Author's call: no plugin-api change for modifiers.)
- **Class steps.** A `calls` edge to a class (TypeScript `new Foo()`) gives a step for the class, and the step is not expanded: the edge does not say which members run.
- **Data.** A step's `reads` and `writes` edges are not steps. They are collected into the flow's `dataTouched` list (resource ID and modes), procedures included.
- **Hubs.** A callee with at least `hubMinCallers` production callers (loggers, guards, mappers) is recorded as a step with `hub: true` and not expanded. `hubsNotExpanded` counts them.
- **Limits.** `maxDepth` (default 8) and `maxStepsPerFlow` (default 150). A symbol appears once per flow, at its first, shallowest position. Cycles are therefore safe.
- **Order.** Children are visited in symbol-ID order, so the result is deterministic.
- **Truncation is reported per flow:** `depthLimited` (a step at max depth had unexpanded callees), `stepLimited`, `dispatchAmbiguous`, `hubsNotExpanded`.
- **Communities.** Each step takes its community from the current snapshot. A flow lists its communities by step count and sets `crossCommunity` when there is more than one. Cluster labels pass through `ClusterLabelMasker` like everywhere else.

The walk is pure: `core/flows/`, no adapter imports. It runs on a `SymbolGraph` plus the entry-point list.

## Part D: storage and lifecycle

- **`.ctxo/index/flows.json` (committed).** It holds the entry points only, not the call trees, and nothing that moves on unrelated commits.
  - **Contents:**
    - `version`
    - resolved settings
    - `entryPoints`: `symbolId`, `kind`, `label`, `route?`, `signals`, sorted by kind and then symbol ID
    - `testFilesByAnnotation`: the files the annotation check marks as tests, which the test globs alone miss (see below)
    - `stats`: candidates, signalled, graph-only, dropped, and covered and uncovered languages
  - **What it leaves out:** no `commitSha`, no score and no timestamp. So the file changes only when an entry point, a setting or a test-file classification changes, and a PR that adds an endpoint shows it as one new line. This is unlike `contexts-view.json`, on purpose. It is written only when its content changes.
- **Its own index step.**
  - **When it runs:** after Phase 2d and before the module passes (Phase 2e), on every run that refreshes the products, from the same merged index. It does not need a community snapshot or PageRank, so `--skip-community` and a failed community detection do not skip it.
  - **Failure** is non-fatal, like the contexts view: it is reported and the run goes on.
  - **`ctxo watch`** does not refresh it. The post-commit hook's `ctxo index --commit HEAD` does. `flows.enabled: false` turns it off.
- **Call trees are computed on demand** from the SQLite graph and the entry-point list, by the MCP server and the CLI, with the same core function.
  - The MCP server computes every flow on first use and caches the result until the storage changes. The builder chooses the cache key from the existing staleness mechanics.
  - This keeps trees current during `ctxo watch` and keeps megabytes of trees out of git.
  - **Test files at read time.** SQLite holds no annotations. The read side therefore classifies test files with the test globs plus `testFilesByAnnotation`, so "production callers" (hubs, dispatch, graph-only checks) mean the same at index time and at read time. If the builder finds that the server already sees annotations (as `find_dead_code` may), the list can go. That is the builder's call.
- **Staleness.** The entry-point list can lag behind the code during `ctxo watch` (a new endpoint appears at the next index or commit). The trees cannot, since they come from the current graph. An entry point whose symbol is no longer in the graph is skipped, and `_meta` counts it under the usual staleness hint.

## Part E: surfaces

**New MCP tool `get_execution_flows` (core tools: 15).** It is read-only, carries the standard annotations, and its response passes through masking and the `_meta` envelope.
- **No arguments:** the flow list, ranked. Each entry has `flowId`, `label`, `kind`, `steps` (count), `dataTouched` (count), `crossCommunity` and `truncated` (bool). The response also has counts per kind and the uncovered languages. Optional `kind`, `query` (substring of the label or route) and `limit` (default 20).
- **`flowId`:** one flow in full:
  - the entry with its signals
  - `steps`: `symbolId`, `depth`, `parent`, `file`, `line`, `hub?`
  - `dataTouched`, `communities` and the truncation counters
- **`symbolId`:** the flows that pass through the symbol. Each has `flowId`, `label`, `kind`, the symbol's `depth`, and `chain`, the call chain from the entry to the symbol. A `total` is included. This answers "how is this reached?".
- The description says when to use the tool, next to `get_blast_radius` and `get_logic_slice`.

**Additions to existing tools (additive fields only):**
- **`get_blast_radius`:** `flowsAffected` holds `total` and up to 10 flows that contain the target (`flowId`, `label`, `kind`, `depth`).
- **`get_pr_impact`:** a top-level `flowsAffected` lists up to 15 flows. Each has the changed symbols it contains, and the list is ordered by the number of changed steps, then score. The response also gets `summary.flowsAffectedTotal`.
- **`get_context_for_task`:** for `understand` and `fix`, up to 3 `flows` with their chains to the symbol, within `tokenBudget` (dropped first when the budget is tight).

**CLI `ctxo flows`:**
- `ctxo flows`: a table on stderr (label, kind, steps, tables, truncated). With `--json`, the tool's no-argument body goes to stdout.
- `ctxo flows --symbol <id> [--json]` and `ctxo flows --flow <id> [--json]`.
- `ctxo flows --flow <id> --mermaid`: a Mermaid `flowchart TD` of one flow (steps as nodes, tables as a separate shape), for PR descriptions and docs.
- Exit codes follow `ctxo contexts`. `--help` prints the help without running.

**Agent setup:**
- The `ctxo-understand` skill names `get_execution_flows` for "what does this repository do" and "how is this reached".
- The `ctxo-review-pr` skill reads `flowsAffected` from `get_pr_impact`.
- The rules block in `ctxo init` gains no new line (the tool selection guide in the skills covers it).

**Docs, per the project's PR checklist:** `llms.txt`, `llms-full.txt`, a feature doc `docs/features/execution-flows.md`, the roadmap, the CHANGELOG, the site docs (tool reference, CLI reference, config schema), the CLI `printHelp`, the MCP tool descriptions, and the tool counts in `CLAUDE.md` and the README.

## Performance budgets

These are measured on this repository and on the fixtures. The baseline is a fresh full `ctxo index` on the branch point, not the committed index, which is older than the code. Committing a refreshed dogfood index is not part of this work.
- **Index time:**
  - The flows index step (entry-point detection) adds at most 300 ms to `ctxo index` on this repository.
  - The fact request it turns on, and the changes in A1 and A2, are measured separately: index time before and after, reported in the PR.
- **Query time:**
  - First `get_execution_flows` call (every tree computed): at most 500 ms.
  - Cached calls: at most 50 ms.
  - Additions to `get_blast_radius` and `get_pr_impact`: at most 50 ms each with a warm cache.

## Testing

- **Core unit tests** (`core/flows/__tests__/`):
  - each signal kind
  - the graph-only conditions
  - dispatch with 1, 3 and 4 implementations
  - hubs, every limit and every truncation counter
  - `executes` chains and `dataTouched`
  - determinism (two runs, identical output)
- **Language fixtures.** The TypeScript and C# fixtures under `packages/domain/test-fixtures/library-lending/` get the flows they should produce, as golden files: at least one HTTP endpoint, one handler, one scheduled or hosted job and one flow that writes a table. Go and Java get one fixture flow each.
- **Part A1 edge tests:** instance calls, interface calls, arrow functions, non-exported functions, calls into `node_modules` (unresolved, no edge).
- **Part A2 edge tests (JUnit and plugin side):**
  - method, constructor, static initializer and lambda sources
  - edges from field initializers staying on the type
  - the older-JAR fallback, and the doctor warning
  - the domain test-reachability tests, updated
- **Facts request:** with `flows.enabled` true and no registry, the plugins receive `capabilities.facts`. With `flows.enabled: false` and no other request, they do not.
- **MCP tests** with `InMemoryTransport`: the three modes, the three additions, masking, `_meta`, and a graceful miss (unknown `flowId`, no `flows.json`).
- **Dogfood:** `ctxo flows` on this repository lists the CLI commands (`*Command.run`) as flows. The list is reviewed by hand once and the review is recorded in the PR.
  - The MCP tool handlers are factories that return closures, called from `mcp-server.ts`. So no signal matches them, and they are not expected as flows in v1 (author's call; a `registerTool` signal is a possible follow-up).

## Honest limitations (to be stated in the feature doc)

- Flows follow static `calls` edges, so dynamic dispatch the graph cannot see stays invisible: reflection, DI resolution by string, callbacks stored in fields, and event emitters. Dispatch through interfaces is followed only by the name-match rule.
- TypeScript calls into `node_modules` stay unresolved (A1), and Java flows stay type-level with an analyzer JAR older than A2.
- A flow ends at the repository boundary, at message publishing and at outgoing HTTP calls (see non-goals).
- Endpoint routes miss prefixes mounted from another file (a router imported from another file, a Go group passed to another function), and after an incremental run C# `MapGroup` and inherited `[Route]` prefixes can be stale until a full `ctxo index` (existing limitations of endpoint facts, see the roadmap Deferred rows).
- Graph-only entry points depend on edges being complete. A function called only through a missing edge looks like an entry point.

## Owner decisions (2026-11-12)

1. **TypeScript call resolution (A1)** is phase 1 of this work, with the before and after measurement in the PR.
2. **`flows.enabled` requests facts**, so call-registered endpoints are entry points out of the box. The one-time index diff and the added index time are accepted.
3. **Java method-level JDT edges (A2)** are part of this work.
4. **The surface is a new tool**, `get_execution_flows` (15 core tools).

## Delivery phases

Each phase is its own PR with its own changesets. Phases 1 and 2 can run in parallel.

1. **TypeScript call resolution (A1), #232.** `@ctxo/lang-typescript`, with the measurements.
2. **Java method-level edges (A2), #233.** `@ctxo/lang-java-analyzer` and `@ctxo/lang-java`, the domain reachability update, and the measurements.
3. **Flows core and index step, #234.**
   - Part B, Part C and Part D (`core/flows/`, `flows.json`, the facts request)
   - the `ctxo flows` CLI
   - the fixtures and their golden flows
4. **Surfaces, #235.**
   - Part E: `get_execution_flows`, the additions to `get_blast_radius`, `get_pr_impact` and `get_context_for_task`
   - the skills
   - the docs and tool counts

## Calls made in this draft (author's, open to change)

- The name is "execution flows" (tool `get_execution_flows`, CLI `ctxo flows`, artifact `flows.json`).
- One flow per entry point, as a tree. Not one flow per entry-and-terminal pair.
- The flow ID is the entry symbol ID.
- Entry points are committed in `flows.json`. Trees are computed on demand and cached.
- Default limits: depth 8, 150 steps, 200 entry points, hub threshold 25 callers, at most 3 dispatch targets.
- `uses` edges are followed only at depth 1, from call-registered endpoints.
- `@ctxo/domain` enrichment is left to a follow-up.
- `flows.json` carries no commit SHA and no score, so it does not change on every commit. The score is computed at read time.
- The flows step runs on its own, not tied to the community snapshot.
- Dispatch is by member name through `implements` and `extends`, with no modifier data and no plugin-api change.
- A class step (from TypeScript `new Foo()`) is a leaf.
- The dogfood check expects the CLI commands, not the MCP handler factories.
- Performance is measured against a fresh full index, not the committed one.

## Left to the builder

- The exact score formula, within the ordering rules in Part B.
- The cache key and the invalidation of the MCP flow cache.
- The extended list of excluded folders for graph-only entry points.
- Response field names not fixed above, following the existing tools' naming.

## Follow-ups (out of scope)

- Flows across message bus edges (#209) and across HTTP client-to-handler edges (#237).
- `@ctxo/domain`: the named context per step, contexts crossed per flow, and rules linked along a flow.
- Flows in `ctxo visualize` (visualize v2 discussion).
- A `registerTool`-style signal, so MCP tool handlers become flows.
