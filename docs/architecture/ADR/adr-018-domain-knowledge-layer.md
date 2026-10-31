# ADR-018: In-Repo Domain Knowledge Layer and the CLI Internal API

| Field | Value |
|---|---|
| **Status** | Accepted (0.14) |
| **Date** | 2026-10-23 |
| **Deciders** | Alper Hankendi |
| **Decision** | Ship the domain knowledge layer as the opt-in package `@ctxo/domain`, which the CLI loads from the project or from next to itself through a type-only internal API (`@ctxo/cli/internal`), with a context registry, `ctxo contexts-touched`, a session-scoped domain fold guard and `Domain-Unchanged` commit trailers, while Ctxo supplies structure, linkage, verification and retrieval and never authors or fetches domain text. |
| **Relates to** | [#156](https://github.com/alperhankendi/Ctxo/issues/156), [ADR-004](adr-004-reject-external-docs-integration.md), [ADR-012](adr-012-plugin-architecture-and-monorepo.md), [ADR-015](adr-015-safe-edit-guard.md), [ADR-016](adr-016-co-change-engine-and-snapshot-policy.md), [ADR-017](adr-017-plugin-protocol-v2-and-data-coupling.md), [domain knowledge layer spec](../../superpowers/specs/2026-10-20-domain-knowledge-layer-design.md) (section 10) |

---

## Context

A team keeps its domain knowledge per bounded context as markdown cards in its own repository. It wants two things from its coding agent: read the right card before changing that context's code, and fold behaviour changes back into the card in the same branch. Spec-driven tools leave a record of past changes; the domain itself has no home in the repository, and the cards are meant to be that home.

Nothing in Ctxo connects that knowledge to code today. The contexts view (PR 1A) proposes candidate contexts and the data coupling of ADR-017 shows shared tables, but a team cannot name a context, say which paths it owns, or learn that a branch changed a context's code without touching its card. Rules and skills can ask the agent to keep cards current, and like the pre-edit rules before ADR-015 they are followed at the start of a task and forgotten in the middle of it.

ADR-004 rejected fetching and indexing external documentation: Ctxo is code intelligence, not content management. A domain layer must not reopen that decision by another route.

Two constraints shape the integration:

1. **The domain features need core services at runtime:** the merged index, the symbol graph, config, the test-file classifier, git access and the co-change window of ADR-016. A language plugin sees none of these, and ADR-012 lets plugins import only `@ctxo/plugin-api`.
2. **Not every repository can hold a devDependency.** Repositories without `package.json` (.NET repositories, for example) have nowhere to declare one, and a setup that starts the MCP server through `npx` while its hooks call a global `ctxo` runs two copies of the CLI, only one of which may have the domain package next to it.

---

## Decision

### 1. The in-repo knowledge layer and ADR-004

Ctxo supplies structure, linkage, verification and retrieval only:

- **Structure:** candidate contexts, data coupling, and the ownership of files by named contexts.
- **Linkage:** contexts to paths and cards; from PR 3, rules to tests and code and decisions to their provenance.
- **Verification:** deterministic checks (`contexts-touched`, the fold guard, and `verify-domain` in Part 2) that test structure, never meaning.
- **Retrieval:** additive fields and tools that hand the agent the right card.

Ctxo never authors domain text: no generated card text, definitions or summaries, and no LLM calls. The generated loader rules of Part 2 are pointers to a card, not knowledge. The cards, the registry (`docs/domain/contexts.yaml` by default), the glossary and provenance files are ordinary repository content, written and reviewed by the team, and everything Ctxo derives from them can be rebuilt from the repository and its history. External provenance such as an issue URL is stored as a string and never fetched. Nothing here fetches or indexes external documentation, so ADR-004 stands unchanged.

### 2. An opt-in package

The layer ships as `@ctxo/domain`, a published package separate from `@ctxo/cli`. Without it the core is unchanged: no domain tools, fields, commands or hooks (spec 13.2). With the package and no registry, the domain commands print a hint and exit 0, and no `context` fields appear.

The seams that let the core load the package are visible without it in a few small ways, each listed in the CHANGELOG:

- A known domain command name (`verify-domain`, `contexts-touched`, `domain`) prints an install hint and exits 1, so CI never passes silently. `ctxo domain-guard-hook` exits 0 without output.
- `ctxo --help` ends with one install hint line, and `ctxo version` gains a `Modules:` line.
- The `install_copies` doctor check (Decision 7) runs on every project; its message names `@ctxo/domain` only when the package is installed.
- `get_why_context` gains the `_meta` envelope the other tools already carry.

### 3. Integration through the CLI internal API (K7)

`@ctxo/cli` exposes an internal API on the subpath export `@ctxo/cli/internal`, built as a second tsup entry with code splitting. It exports types (the module API, the index and graph types, `IGitPort`, `IStoragePort`, `IMaskingPort`, config, logger, health-check and envelope types, `SymbolGraph`, `BlastRadiusCalculator`) and one runtime function, `createModuleHost`. It exposes no adapters.

The CLI resolves `@ctxo/domain`, imports it and calls its `register(host)` function. The host carries the CLI version, the mode (`mcp`, `cli` or `hook`), the project and `.ctxo` roots, and `host.services`: config loading, the logger, the shared glob matcher, the test-file classifier, the git port, the index reader, the graph builder, the co-change window and the git-root finder. The registration may contribute:

| Member | Purpose |
|---|---|
| `indexPass` | Runs after the core phases of `ctxo index`, on the merged index. A failing pass is reported and the run continues. |
| `classifyWatchPath` | Tells `ctxo watch` which changed paths `indexPass` depends on (`input`: refresh after an adaptive quiet period, at least 1 s and twice the last pass, never postponed more than 30 s; `source`: counted towards `watch.snapshotMinFileChanges`). With it, watch runs `indexPass` on the merged JSON index without a change log, with `factsRequested` set; without it, watch runs no pass. |
| `watchArtifactsStale` | A cheap check whether the artifacts of `indexPass` are stale against the module's inputs; `ctxo watch` asks once at start and runs one pass when true. |
| `registerTools` | New MCP tools. The core wraps masking, the `_meta` envelope, stats recording and the staleness warning. A tool named like a core tool is skipped with a warning. |
| `enrich` | Additive fields on core tools, applied before the envelope so that truncation and masking see them. A throwing enricher drops its fields, never the response. |
| `registerCommands` | CLI commands (`contexts-touched` and `domain-guard-hook`; `verify-domain` and `domain` in Part 2). A name that shadows a core command is dropped with a warning. |
| `init` | The `domain` part of `ctxo init`. |
| `doctorChecks` | Health checks, run after the core checks. |
| `indexCapabilities` | `facts: true` makes `ctxo index` request facts from plugins (the capability of ADR-017). |

**Loading.** The project's `node_modules` is tried first, then the copy next to the running CLI. A failure to load warns and continues.

**Versions (designer call D1).** A copy loads only when its numeric `major.minor` equals the running CLI's; prerelease tags are ignored. Candidates are tried in order and the first match loads; a warning appears only when copies exist and none of them matches. `@ctxo/domain` repeats the check against `host.cliVersion` and stays inactive on a mismatch. Because the domain may not import CLI runtime code (Decision 4), it carries its own copy of this rule; the duplicate is deliberate, and both copies cite this ADR.

**Releases.** The internal API changes only in minor releases. Changesets puts `@ctxo/cli` and `@ctxo/domain` in one `fixed` group, so they always share a version, and `@ctxo/domain` starts at the CLI's version.

**No second CLI.** `@ctxo/cli` is a devDependency of `@ctxo/domain`, neither a dependency nor a peer, so npm never installs a second CLI copy next to it. The CLI that runs is always the one that loaded the module.

### 4. The import exception

Language plugins still import only from `@ctxo/plugin-api` (ADR-012), with the utility-package exception of ADR-017. `@ctxo/domain` is not a language plugin: plugin discovery (`@ctxo/lang-*`, `ctxo-lang-*`) never finds it, it handles no file type, and it is loaded only as described in Decision 3.

- `@ctxo/domain` imports `@ctxo/cli` and `@ctxo/cli/internal` as types only (`import type`). Every runtime service arrives through `host.services`.
- Lint enforces this in production code with `no-restricted-imports` and `allowTypeImports`, with the message `@ctxo/domain imports the CLI internal API as types only (ADR-018)`. Tests may import `createModuleHost` at runtime to build a real host.
- `packages/cli/src/internal.ts` is a package entry that re-exports. It is the one exception to the no-barrel rule.
- `@ctxo/domain` keeps the hexagonal split: a pure `core/` that never imports `adapters/`, `adapters/` for files and git, and `commands/` and `init/` that wire them. It has no `ports/` layer. The port-first rule ("every adapter implements a port") applies to `@ctxo/cli`. In `@ctxo/domain`, an adapter implements an interface declared in the domain's own `core/` where a core function consumes it.

### 5. The fold guard (K9, K16)

`ctxo domain-guard-hook` (hidden) runs as a Claude Code hook on `SessionStart`, `Stop` and `TaskCompleted`, without a matcher; `ctxo init --domain` registers it. `SubagentStop` is off unless `domain.guard.subagents: true`. One command serves every event, which it reads from `hook_event_name`.

- **Scope.** The guard judges only committed changes of the current session. Uncommitted work never blocks. History from earlier sessions or from other people is left to CI (`contexts-touched --check`, and `verify-domain --since` from Part 2).
- **SessionStart record.** `SessionStart` writes `.ctxo/.cache/domain-guard/<session>.json` with `startHead` (the full HEAD SHA, or `null` before the first commit) and the fingerprints already blocked, and prints nothing, because its stdout would become session context. A resumed session keeps its original record. When a later event finds no record (the hook was installed mid-session), the guard records the current HEAD and allows that turn.
- **Branch range.** The evaluated commits are those in `startHead..HEAD` that also lie in the branch range. One base resolver serves the guard and `contexts-touched`, with the configured base first: `domain.guard.base` when set, else the merge base of HEAD and `origin/HEAD`, else `main` or `master`. On the default branch itself the range is the unpushed commits, `@{u}..HEAD`; without an upstream, the session range alone applies. The commits go through the same computation as `contexts-touched --committed`.
- **Anchoring (designer call D10).** When `startHead` is no longer an ancestor of HEAD (rebase, amend, reset, branch switch), the record is re-anchored to HEAD and the turn is allowed. `startHead: null` means every commit reachable from HEAD belongs to the session.
- **Decision order.**
  1. `SessionStart`: write the record when none exists, exit 0.
  2. `stop_hook_active: true`: allow.
  3. The guard is disabled, the event is `SubagentStop` without `domain.guard.subagents`, or the registry is missing or invalid: allow.
  4. No record: record HEAD and allow.
  5. HEAD cannot be resolved: allow. `startHead` is not an ancestor of HEAD: re-anchor and allow.
  6. No unresolved context in the evaluated commits: allow.
  7. The fingerprint (HEAD SHA plus the sorted unresolved IDs) already blocked in this session: allow. Otherwise record the fingerprint and block once.
- **Two block outputs.** `Stop` (and `SubagentStop`) writes `{"decision":"block","reason":"..."}` to stdout and exits 0. `TaskCompleted` writes the reason to stderr and exits 2, the only documented way to block that event. The reason names each unresolved context, up to three of its changed files, the card path and the exact trailer line.
- **Fail-open.** Any internal error allows: exit 0 and one line on stderr. Empty or malformed input, a missing `session_id`, an unknown event and a corrupt session file all allow. This follows ADR-015's guard, and Claude Code itself fails open for these events and ends a turn after 8 consecutive `Stop` continuations.
- **No MCP stack on the hook route.** `packages/cli/src/index.ts` becomes a thin argv router, and the MCP wiring moves to `mcp-server.ts`. `domain-guard-hook` takes a fast route that loads the module host and `@ctxo/domain` but neither the MCP SDK, the tool handlers nor the CLI router. An e2e test records the modules the hook route imports.
- **Budget.** Under 1 s on the validation fixture (spec 13.4).

### 6. Acknowledgement (K2)

A commit states that a change left a context's behaviour as it was with a trailer:

```
Domain-Unchanged: <id>[, <id>...] [(reason)]
```

- It is read with `git log --format=%(trailers:key=Domain-Unchanged,valueonly)`. The reason is the balanced parenthesised group that ends the value; the IDs are the comma-separated text before it.
- Only commits in the evaluated range count: the `--since` range for `contexts-touched`, the session's branch range for the guard. A trailer elsewhere in history acknowledges nothing.
- A card change in the range resolves a context too, and wins over an acknowledgement.
- Uncommitted work cannot be acknowledged, because a trailer lives in a commit. `contexts-touched` reports working-tree changes by default, and they are resolved only once committed.
- An empty commit that carries the trailer is fine (`git commit --allow-empty`), so an acknowledgement never needs a code change.
- An unknown ID in a trailer gives a warning, never an error.

### 7. Adoption decisions

- **K15, one copy for repositories without `package.json`.** A global install is the supported path: `npm i -g @ctxo/cli @ctxo/domain @ctxo/lang-sql`, so the MCP server, the hooks and the CLI run one copy. `ctxo install` without a `package.json` installs globally and says so, and `ctxo install domain` pins `@ctxo/domain` to the running CLI's version. When `ctxo init` runs from a global install, it writes MCP entries that call the global `ctxo` binary instead of `npx -y @ctxo/cli`; it replaces only ctxo's own default npx entry, never a custom one. Project-local installs keep working. The `install_copies` doctor check warns, and never fails, when the MCP entry and the hooks point at different copies (npx for MCP, `ctxo` from PATH for the hooks) or when the hooks call `ctxo` and none is on PATH.
- **K17, unowned files warn by default.** A file that belongs to no context and is not in `unowned.allow` is a warning until the team sets `domain.coverage.unowned: error`, so a brownfield repository is not failed on day one. The context-map check runs when the file exists.
- **K19, discover, propose, confirm (Part 2).** Conventions such as tracker prefixes, test annotation keys and test folders are discovered by `ctxo domain discover`, proposed by `ctxo init --domain` and confirmed by the team; `ctxo doctor` only warns later. The config is the single source of truth, so behaviour never shifts silently, and the rule-ID safeguards hold with any config.
- **Domain artifacts (Part 2).** The index pass writes `.ctxo/index/domain/` (`contexts.json`, `boundaries.json`, `history/`). Each artifact carries a string `ctxoArtifact` marker (`domain-contexts`, `domain-boundaries`, `domain-history`; PR 3 adds `domain-graph`). `JsonIndexReader` skips any JSON object that carries the marker, and `JsonIndexWriter` refuses to delete one as a stale index entry.

---

## Deviations from the spec text

The spec is not edited. Where the PR 2B plans depart from its text on purpose, this ADR is the record:

| # | Spec text | Decision | Why |
|---|---|---|---|
| C1 | `picomatch` is a dependency of `@ctxo/domain` (10.1) | Registry globs go through the host's `makeGlobMatcher` in `host.services`; `@ctxo/domain` has no `picomatch` dependency | One matcher, so the CLI and the domain match paths identically (picomatch with `dot: true`, backslashes normalised) |
| C2 | `@ctxo/cli` is a peer of `@ctxo/domain` (10.1, dependency list) | `@ctxo/cli` is a devDependency | The spec's own later text in 10.1 and section 18 ask for a devDependency, so npm never installs a second CLI next to the package (Decision 3) |
| C3 | `JsonIndexReader` skips the `domain/` directory (10.7, 13.5) | The reader skips JSON that carries a `ctxoArtifact` marker | Index entries mirror source paths (`.ctxo/index/<path>.json`), so a source folder named `domain/` at the repository root would lose its index under a directory skip |
| C4 | `contexts-touched` statuses are `card-changed`, `acknowledged` and `unresolved`, and the output has no `mode` or `warnings` (10.3) | A fourth status, `no-card`, and the fields `mode` and `warnings` | A context without a card (allowed at rung `fear`) has nothing to fold into and is never unresolved; `mode` says which changes were considered, and `warnings` carries unknown trailer IDs. The additions are documented in "Ctxo domain conventions v1" |
| C10 | `ctxo init --domain` registers the `Stop` and `TaskCompleted` hooks (10.8) | It also registers `SessionStart` | The guard needs the session's starting HEAD (10.4, K16) |

---

## Alternatives considered

- **An extension contract in `@ctxo/plugin-api`.** Rejected by K7: the domain needs core services (the merged index, the graph, config, git, the co-change window), not one file at a time, and a public contract would freeze internals that still change between minors. The internal API is versioned with the CLI instead.
- **A second MCP server for the domain.** Rejected: two processes per session, the index loaded twice, and a second entry in every client's MCP config.
- **Acknowledging in card front matter.** Rejected by K2: an acknowledgement belongs to the commits it covers, and only commits in the evaluated range count. A front-matter flag is tied to no range, stays in the card after the branch merges, and editing it is itself a card change.
- **Guarding uncommitted work.** Rejected by K9: it blocks work in progress that cannot be acknowledged yet, because a trailer needs a commit.
- **Judging the whole branch in the guard.** Rejected by K16: a new session on a branch with unresolved commits from an earlier session or another person would be blocked for work it did not do. CI covers the whole range.

---

## Consequences

**Positive**

- A team can name contexts, assign paths to them and keep cards in step with code, with a CI gate and an in-session guard, without Ctxo writing any domain text.
- Repositories without the package see no domain behaviour, and the domain layer evolves with the CLI without widening the public plugin protocol.
- Repositories without `package.json` get one copy for MCP, hooks and CLI through a global install.

**Negative and risks**

- **The internal API is not stable.** A minor CLI release may change it. Both packages always release together (the `fixed` group), and the loader refuses a copy at another minor, so a mixed install turns domain features off with a warning instead of failing.
- **Two copies.** A project copy and a global CLI at different minors, or npx for MCP and a global binary for hooks, can leave the domain active in one launcher and missing in another. The loader takes the first copy at the CLI's minor, and `install_copies` warns about mixed launchers.
- **Claude Code only for the guard.** Other clients get the `ctxo-domain-fold` skill and the CI gate; Cursor's stop hook cannot block (spec 13.6, deferred in spec 17).
- **The guard trusts commits, not meaning.** A trailer satisfies the guard whether or not behaviour really stayed the same. Judging that is out of scope.
- **The hook route must stay light.** A static import that pulls the MCP stack into `index.ts` would break the 1 s budget; the e2e import-recording test guards it.
- **Tarball size.** The internal entry adds to the CLI tarball; the PR records the measured size against the release-packaging limit.

---

## Addendum: PR 3 additions to the internal API (#156)

PR 3 builds the domain graph (`.ctxo/index/domain/graph.json`), the fields it adds to core tools, the tools `get_domain_context` and `get_rule`, and the `domain` scope of `get_ranked_context`. Everything still reaches `@ctxo/domain` through `host.services` and the module registration; the package keeps importing `@ctxo/cli` as types only, and both packages still release together.

### Internal API

- **Async enrichers.** `ResponseEnricher` may return a Promise. The asynchronous tools (`get_blast_radius`, `get_pr_impact`, `get_why_context`) await it through `applyEnricherAsync`, which clones the payload and then applies the same plain-data guard as the synchronous path. A synchronous tool cannot wait: it drops a Promise result with the warning `<tool> enricher returned a Promise; a synchronous tool cannot wait for it` and swallows its rejection. Enrichers of several modules chain through a Promise once one of them returns one. The `get_pr_impact` domain fields read the commit range, which is why the seam became asynchronous. `@ctxo/domain` bounds its own asynchronous enrichers at 5 s (`ENRICHER_TIMEOUT_MS`); a slower one leaves its fields out of that response.
- **The seventh enrich-seam tool.** `get_context_for_task` joins the enrich seam (PR 2B had six tools: `get_logic_slice`, `get_why_context`, `get_blast_radius`, `search_symbols`, `find_importers`, `get_pr_impact`). It is synchronous.
- **`reserveTaskContextTokens` (`TokenReservation`).** An optional registration member that keeps tokens back from the `get_context_for_task` budget before the code context is packed. The core sums the modules' reservations (a throwing or non-finite one is skipped with a warning, a negative one counts as 0), rounds, and caps the sum at a quarter of `tokenBudget`. The payload still reports the requested `tokenBudget`; the enricher adds its excerpt into `tokenBudget - totalTokens`, so the sum never exceeds the budget.
- **`rankedContextScopes` (`RankedContextScope`).** An optional registration member that adds scopes to `get_ranked_context`. The `scope` parameter (`code`, then the module scopes in codepoint order) exists only when a module provides one, so the tool's schema and output are unchanged without the package. A module scope gets the validated `query` and `tokenBudget`; its result goes through `_meta` and masking and is recorded under `get_ranked_context`.
- **Host services.** `createDocumentSearch(documents)` (BM25 over arbitrary documents with the core engine: `SearchEngine.buildDocumentIndex`, `k1 1.2`, `b 0.75`, no PageRank blend; it hands out only `search`), `splitIdentifier(name)` (the core tokenizer's identifier split, so term links match names the way search does) and `dataResourceKinds` (plugin-api's `DATA_RESOURCE_KINDS`, one source for the table and view kinds).
- **Truncatable fields.** The primary arrays of the module tools (`rules`, `contexts`, `terms`, `openQuestions`, `tests`, `symbols`, `provenance`, `unresolved`) join the core's truncatable fields with drill-in hints. The additive lists on core tools are capped at their source (50, `decisions` at five, with `<name>Total`) and are not truncatable, so truncation always acts on the tool's own primary array.

### Domain graph decisions

- **The artifact.** `graph.json` carries the marker `domain-graph` and joins the marker gate of the other domain artifacts: the store overwrites or removes only a JSON file that carries the marker, so an index entry of a source folder named `domain/` is never touched (C3). Code metrics never read it (K8). `ctxo watch` runs no module pass, so the graph follows card edits at the next `ctxo index` or commit; until then the tools answer from the last graph with `stale: true`.
- **Canonical order.** `sortGraph` orders every array in codepoint order, and its final tie-breaks are part of the format: links fall back to their JSON text after kind, from, target, source and location; sections tie-break by id and then context; open questions by text and then context; unresolved references by rule, field, value, location and reason. The same input in any order gives a byte-identical file.
- **Card sections and H1 headings.** The `Rules and invariants` section ends at the next H1 or H2, so a `### X-NN` heading after a stray H1 there is not a rule (a change from PR 2B, which read rules up to the next H2). The intro and the other sections do not stop at an H1; only the rules section does.
- **`rule:` comment attribution (F4).** A `rule:` comment links to the symbol that starts within three lines below it when that symbol sits inside the innermost symbol spanning the comment (or nothing spans it), else to the innermost symbol spanning it. The containment check keeps a comment at the end of a short method body on that method instead of the next declaration. Spec 11.2 states "innermost" for the text scan of rule IDs, not for `rule:` comments, so this fills a gap rather than departing from the spec: the usual style is a comment above a declaration, often with attributes or decorators in between, and the innermost rule would give the enclosing class. The text scan keeps the innermost rule.
- **JUnit `Tag`.** Spec 11.2 lists xUnit `Trait`, NUnit `Category` and MSTest `TestCategory` as annotation sources. JUnit `Tag` stays a category source, as PR 2B scans it.

---

## Addendum: PR 4 additions (#156)

PR 4 adds the agentic loop: shadow-spec candidates, the Deletion Test tools and the context map. As before, everything reaches `@ctxo/domain` through `host.services` and the module registration; the package still imports `@ctxo/cli` as types only.

### Internal API

- **`indexCapabilities.factOptions`** (`FactDetectorOptions`: `trivialLiterals`, `normalizationMethods`; the types `TrivialLiteral`, `FactDetectorOptions` and `CodeFact` in `@ctxo/cli/internal`). The module declares the `domain.facts` lists; the CLI hands the first module's options to every plugin as `PluginContext.config.facts` (a deep-frozen copy), only when facts are requested. `@ctxo/domain` computes them lazily, on first read, and requests facts only when its registry file (`domain.registry`) exists, so without a registry the index JSON is byte-identical to a run without the package. The answer is cached per registration, so a `ctxo watch` started before the registry existed keeps facts off until it restarts.
- **`host.services.readCoChangeEntries(ctxoRoot)`.** The validated entries of `co-changes.json` as stored, one per file pair, frozen and shared; `undefined` when the file is missing or invalid. It uses the same reader and modification-time cache as every other co-change read (`ICoChangePort.readEntries`), one reader per `.ctxo` root for the life of the process. The maturity facts read cross-context co-change through it.
- **Truncatable fields.** `shadowSpecs` and `contextMap` join the truncatable fields. The secondary lists of `find_shadow_specs` (`staleResolutions`, `unknownRules`, `resolutionProblems`) are capped at 50 at the source with `<name>Total`, so the envelope always truncates the tool's primary array.

### The two artifacts

- `.ctxo/index/domain/shadow-candidates.json` (`domain-shadow-candidates`) and `.ctxo/index/domain/maturity.json` (`domain-maturity`) join the marker gate of the other domain artifacts, each with `registryHash` and `cardsHash`, written only when their content changed. Both are written together or both are removed: when the graph builds but the candidates or the maturity facts fail, the pass removes both (marker-gated, never a hand-written file) and warns, so the tools answer `no-artifacts` with "run ctxo index" instead of serving the previous run's data. When the graph itself cannot be built, `graph.json` and both files stay as they were (W10). `shadow-specs.yaml` entries are applied at query time, never stored, so editing the file needs no re-index.
- The domain pass composes its inputs once (`composeLoopInputs`): the graph, the test and code references, the cards, and the text-scan facts for files without a `facts` key, each file read once. Every text read goes through the checked reader the cards use: a tracked link whose target stays inside the repository is followed, one that leaves it is skipped. `ctxo verify-domain` uses the same composition and computes check 12 from current inputs, never from the artifacts.

### The two tools

- `find_shadow_specs({ context, kinds?, includeResolved? })` and `get_context_map()` are registered whenever the package loads (14 core tools, 18 with the package) and answer `{ found: false, hint }` without a registry, with registry problems or without the loop artifacts. Each artifact's `registryHash` is checked against the current registry, and stale data answers with `stale: true` and a hint. `ctxo domain shadow-specs <context>` and `ctxo domain map` print the same bodies without `_meta`; their exit codes come from the loop state's `reason` (`no-registry` 0, `registry-problems` 2, `no-artifacts` 2), never from hint text.

### Decisions

- **Fingerprints (H4, amended).** `kind | symbol | normalized text`, the symbol part the last two `.` segments of the file basename (without its last extension) and the symbol name (without a trailing `(...)`). Amended, owner approved on 2026-10-24: any member whose name contains a dot (C# explicit interface implementations, TypeScript computed or string-literal members) keeps its containing type in the symbol part, as a general rule, so two types' `CompareTo` or `[Symbol.iterator]` members never share a fingerprint. `%` and `|` in the kind and symbol parts are percent-encoded (`%25`, `%7C`), so a SQL delimited name or a string-literal member never breaks the separator. Amended again before release (2026-10-24, final review): the file part is the basename without only its final extension, kept as one segment, so `loan.service.ts::withRetry` gives `loan.service.withRetry` and never collides with `fine.service.ts::withRetry`; members keep `Type.member`. The module symbol of a file (`<file>::<basename>::variable`, the owner of code outside every declaration) gives the basename alone, also one segment: `app.ts` gives `app` and `api.loan.service.ts` gives `api.loan.service`, so `web.loan.service.ts` never shares it. The basename alone was chosen over `<basename>.<basename>` because it keeps the module symbol of `Program.cs` apart from the class `Program` in it (`Program.Program`). In `shadow-specs.yaml` a fingerprint is written as a YAML single-quoted scalar, the form `ctxo domain shadow-specs` prints.
- **Candidates come from non-test files with one owner.** Facts of test files and of unowned or multiply owned files are never candidates. One resolution entry resolves every candidate with its fingerprint; counts are per candidate.
- **`bounded` without boundaries is not met.** A context with no `boundaries.json` reports `boundariesKnown: false`; with the artifact, `bounded` is met vacuously when the context has no contract symbols and no violations, because every crossing outside a contract is already a violation.
- **Reachability over graph edges only.** Tests reach main paths through `calls`, `uses`, `imports`, `extends` and `implements`; data edges are not followed, and HTTP-level tests create no edges, so the suggestion can stay below the owner's rung. The suggestion never changes the registry.
- **Skill marker.** The `ctxo-domain-fold` skill gains the `find_shadow_specs` step and the marker `v0.16`, so `ctxo doctor` reports copies installed by 0.15 as outdated.

## Addendum: discovery that agents find (#191)

Agents adopting the domain layer did not find `ctxo domain discover`, and its proposal turned security IDs into tracker keys and missed contract tests marked by attributes or file names.

- **Skill marker.** The `ctxo-domain-fold` skill gains a first section, "When adopting or tuning the domain config", that names `ctxo domain discover` (dry run first, then hand edits or `--write`), and the marker `v0.17`, so `ctxo doctor` reports copies installed by 0.16 as outdated.
- **Pointers.** The `get_context_map` description names the command. Its response adds a hint while `domain.rules.trackerPrefixes`, `domain.tests.ruleTraitKeys`, `domain.tests.characterization` and `domain.tests.contract` are all at their defaults and the last `ctxo index` recorded that discovery would add something: the index pass runs discovery over committed inputs only (its own index and change log and the tracked files, never the local branch refs, since `maturity.json` is committed) and writes `discovery: { addsSomething }` into `maturity.json`; without a change log it keeps the last result. The `found: false` hints for no registry and no domain graph also name the command. The rules block `ctxo init` writes carries a domain line when the domain layer is set up, decided from committed state first (owner approved; see the ADR-015 amendment note "The domain line").
- **New evidence (`--json`).** `externalIds` (`{ prefix, occurrences, overlapsRulePrefix, note }`), `githubIssues` (`{ subjects, squashSuffixes, totalSubjects, branches, largestFamily }`), `otherIdentifiers` (`{ prefix, branches, possibleTrackerKey }`) and `testKindMarkers` (per kind `annotationValues`, `attributes`, `fileNames` with `entityTests` and `entityFiles`). External ID families no longer appear in `trackerKeys`.
- **New proposal fields.** `characterizationAnnotations` and `contractAnnotations`, merged by `--write` into `domain.tests.<kind>.annotations` (an absent list starts from its defaults), adding values and removing none. File-name globs join `characterizationPaths` and `contractPaths`.
- **External IDs are evidence only.** CWE, ISO and the other families in `EXTERNAL_ID_FAMILIES` are references: a plain mention never links as a rule ID (only IDs that exist in a card link), so they need no config and are never proposed. A family that equals a card rule prefix is flagged.
- **File names go to `paths`, not `names`.** A `names` marker matches test case names and declared titles only, never file or class names. A file named after a non-test class of the index (`LoanContractTests.cs` next to `LoanContract`) tests an entity, so it is left out of its glob's evidence; a glob made only of such files is evidence only.
