---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
workflowComplete: true
completedAt: '2026-03-28'
inputDocuments:
  - 'artifacts/planning-artifacts/product-brief-Ctxo.md'
  - 'artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md'
  - 'docs/bmad-agent-architect-session.md'
  - 'docs/product-brief-session.md'
workflowType: 'prd'
briefCount: 2
researchCount: 1
brainstormingCount: 0
projectDocsCount: 2
classification:
  projectType: developer_tool
  domain: general
  complexity: high
  projectContext: greenfield
---

# Product Requirements Document - Ctxo

**Author:** Alper Hankendi
**Date:** 2026-03-28

## Executive Summary

AI coding assistants have a context problem. They receive code as flat text — blind to the dependency graph it lives in, the git history behind every decision, and the blast radius of every change. The result is a capable AI with the situational awareness of someone who cloned the repo 30 seconds ago.

**Ctxo** is a Model Context Protocol (MCP) server that closes this gap. It transforms AI assistants from dumb pipes — tools that dump raw files and hope the AI figures it out — into a Neural Context layer: a Context Engine that understands the nervous system of a codebase, not just its syntax.

Ctxo runs entirely on the developer's machine. Its index is committed to the repository as per-file JSON, diffable in PRs, shareable via `git pull`, and queryable in under 500ms. A fresh `git clone` is immediately context-rich. The AI gets the codebase's institutional memory, not just its current state.

**Target users:** Senior and mid-level developers who have hit the ceiling of what AI coding assistants can do without deeper context — developers who've seen the AI confidently break something it didn't know existed.

### What Makes This Special

Three capabilities, working together, that no other MCP tool delivers simultaneously:

**Surgical Logic-Slicing.** AST-powered dependency resolution packages a symbol with every Interface, Type, and Helper it touches across files — delivered as a single Logic-Slice. Eliminates "missing type" errors at the root. The AI gets exactly what it needs; nothing more.

**Historical Consciousness.** Git history as first-class context. The AI knows not just *what* code does, but *why* it was written — commit intent, revert warnings, abandoned approaches. Prevents the quiet erasure of critical bug fixes and security patches.

**Risk-Aware Intelligence.** Blast radius awareness before action. Before modifying a symbol depended on by 34 other modules, the AI knows it — and can recommend a safe refactor path rather than a confident breaking change.

The three "aha" moments: AI modifies a function with zero missing-type prompts (Mind-Reader); AI stops to warn a change risks reintroducing a v1.2 security vulnerability from git history (PR-Saver); 50 lines of surgical context produces one-shot correct output where a brute-force file dump failed (Zero-Noise).

The paradigm shift: from *you managing the AI* → *the AI guiding you*, because it holds the same code memory you do.

### Project Classification

- **Project Type:** Developer Tool (MCP server, npm package)
- **Domain:** Developer Productivity (no regulated industry)
- **Complexity:** High — novel protocol integration (MCP), type-aware cross-file AST analysis, real-time performance constraints, multi-language extension architecture
- **Project Context:** Greenfield

## Success Criteria

### User Success

- **Mind-Reader Moment:** In a Ctxo-enabled session, the AI never asks "I don't see the definition for Type X" — all required interfaces, types, and helpers are present in the Logic-Slice without manual file-fetching.
- **Time to first value:** Developer installs Ctxo, runs `npx ctxo index`, and receives their first Logic-Slice response within 5 minutes of a fresh clone.
- **Zero-Noise output:** Logic-Slice context is ≤ 50–150 lines for the majority of symbol queries (vs. full file dumps spanning hundreds of lines), reducing token cost while increasing relevance.
- **PR-Saver moment:** For codebases with revert commits in git history, `get_why_context` surfaces anti-pattern warnings in at least one AI session per team per sprint.

### Business Success

- **3-month target:** 10+ multi-developer teams (≥ 3 devs) with `.ctxo/index/` committed to their main branch and actively used in CI.
- **Ecosystem adoption:** Listed as a recommended MCP server in at least one Claude Code or Cursor community resource by V1 launch.
- **Monetization:** V1 is open-source / free — success measured by adoption and usage signals. Revenue strategy is out of scope for this PRD.

### Technical Success

- **Performance:** Context delivery < 500ms p95 on a warm index (1,000-file TypeScript codebase). MCP server startup < 100ms (lazy initialization).
- **Compatibility:** All five MCP tools verified functional with Claude Code, Cursor, and VS Code Copilot at V1 launch.
- **Index integrity:** Incremental re-indexing on file change completes in < 2s. Index format is text-based, diffable, and produces no merge conflicts on `git pull`.
- **Privacy:** Zero sensitive data (API keys, credentials, private IPs) reaches the MCP client — privacy masking pipeline validated against a test fixture set.

### Measurable Outcomes

- Reduction in AI-generated changes requiring immediate revert — baseline established via git history analysis with 3+ willing early adopter teams post-launch (instrumentation-first; no pre-launch baseline assumed).
- Token consumption per AI session reduced vs. file-dump approach — measured by comparing context window usage with/without Ctxo in controlled test scenarios.

## Product Scope

### V1 — MVP (TypeScript / JavaScript / TSX)

Five MCP tools: `get_logic_slice`, `get_blast_radius`, `get_architectural_overlay`, `get_why_context`, `get_change_intelligence`. Progressive detail levels L1–L4. Privacy masking pipeline. Committed JSON index (`.ctxo/index/`). Incremental file watching. Monorepo auto-discovery. CI indexing gate (GitHub Actions). `npx ctxo` install. Verified: Claude Code, Cursor, VS Code Copilot.

### V1.5 — Growth (Multi-language)

Go + C# syntax-level support via tree-sitter adapters. `npx ctxo init` auto-configures MCP client. Dedicated documentation site. `npx ctxo status` index health CLI.

### V2+ — Vision

Multi-repo / cross-service dependency graphs. Natural language query interface. Python support (demand-gated). Opt-in team analytics. Ctxo becomes the default context layer — `.ctxo/index/` as unremarkable as `.github/workflows/`. (Go deep analysis delivered in v0.8; C# deep analysis delivered in v0.6 via Roslyn.)

## User Journeys

### Journey 1: The Solo Developer — First Context Slice

**Meet Mia.** She's a senior frontend developer at a 12-person startup. Her team shipped fast for two years; the codebase is now 800 files of TypeScript and nobody has a complete map of it anymore. She uses Claude Code daily but spends 20% of every AI session doing file archaeology — "also look at this file... and this one... and this interface." Last week the AI confidently refactored `useAuthToken` without knowing it was consumed by three other hooks. The PR review caught it. Barely.

She finds Ctxo in the Claude Code MCP server list. Thirty seconds:

```bash
npx ctxo index
```

Index builds in 18 seconds. She adds the one-line MCP config and reloads Claude Code.

She asks Claude to update `useAuthToken`. No file-hunting. No "I don't see the definition for TokenValidationResult." Claude responds: *"I've updated the hook and verified its contract against IAuthProvider, TokenValidationResult, and the three consuming hooks — no breaking changes."*

That's the moment. She opens Slack and sends her team lead a message: *"You need to see this."*

**Capabilities revealed:** `get_logic_slice` (L2 depth), MCP stdio transport, warm-index query performance, Claude Code compatibility.

---

### Journey 2: The Team Lead — Committing the Index

**Meet Daniel.** He's a tech lead on a 6-person backend team. Mia sent him the Slack message. He tries Ctxo on his machine and hits the same moment. But he's thinking bigger: *"What if everyone on the team had this — and what if it accumulated over time?"*

He reviews the `.ctxo/index/` output — one JSON file per source file, 3.2MB total, fully text-based. He adds `.ctxo/cache/` to `.gitignore`, commits `.ctxo/index/`, and opens a PR.

The PR description writes itself: *"Adds Ctxo index — gives AI assistants full dependency context on this codebase. Pull and you're context-rich immediately."*

He adds the GitHub Actions CI gate. Now every PR triggers `npx ctxo index --check` — CI fails if the index is stale. Institutional memory stays current automatically.

Three weeks later, a new hire clones the repo. Full context on day one. Daniel never has to explain the `PaymentProcessor` dependency graph again.

**Capabilities revealed:** Committed index pattern, `.gitignore` cache separation, CI indexing gate (GitHub Actions), incremental re-indexing, monorepo auto-discovery.

---

### Journey 3: The New Joiner — Day-One Onboarding

**Meet Priya.** She joined Daniel's team two weeks ago. The codebase is 1,200 files. Her ticket: add rate limiting to `ApiGateway`.

Old world: half a day reading files, asking colleagues "what does this touch?", making a change that looks right but breaks `MetricsCollector` downstream.

Ctxo world: `git clone`. The `.ctxo/index/` is already there. She opens Claude Code: *"I need to add rate limiting to ApiGateway — what's the blast radius?"*

Claude responds with the gateway layer's architectural overlay, the five downstream services that depend on it, and a note from git history: *"Rate limiting was attempted in commit 3a7f91 eight months ago and reverted — the implementation used a shared mutex that caused deadlocks under load. Recommend token bucket per-connection instead."*

Priya didn't know that history existed. Nobody told her. The codebase told her.

**Capabilities revealed:** `get_blast_radius`, `get_why_context`, `get_architectural_overlay`, anti-pattern memory from revert commits, committed index shared via `git clone`.

---

### Journey 4: The Developer — Stale Index Recovery

**Meet Carlos.** He's been using Ctxo for a month. It's become invisible — he forgets it's there until the AI demonstrates something impossible. Today something goes wrong.

He queries `InvoiceGenerator`. The response is missing `TaxCalculator` — a dependency he knows exists. He checks: feature branch, three days old, `TaxCalculator` added yesterday, index never updated.

Ctxo surfaces a warning in the MCP response: *"Index for invoice-generator.ts is 3 days old and may not reflect recent changes. Run `npx ctxo index --file src/billing/invoice-generator.ts` to update."*

Two seconds. The next query includes `TaxCalculator`. He adds `npx ctxo watch` to his dev startup script.

**Capabilities revealed:** Index staleness detection, incremental file-level re-indexing, `ctxo watch` file watcher, graceful degradation with actionable warnings.

---

### Journey Requirements Summary

| Capability Area | Revealed By |
|---|---|
| `get_logic_slice` (L1–L4 progressive depth) | Journey 1 |
| MCP stdio transport, Claude Code / Cursor compatibility | Journey 1 |
| Warm-index query performance (< 500ms) | Journey 1 |
| Committed JSON index, `.gitignore` cache separation | Journey 2 |
| CI indexing gate (GitHub Actions) | Journey 2 |
| Incremental re-indexing on file change | Journey 2, 4 |
| `get_blast_radius` | Journey 3 |
| `get_why_context` + anti-pattern memory (revert detection) | Journey 3 |
| `get_architectural_overlay` | Journey 3 |
| Index staleness detection + actionable warnings | Journey 4 |
| `ctxo watch` file watcher | Journey 4 |
| Monorepo auto-discovery | Journey 2 |

## Innovation & Novel Patterns

### Detected Innovation Areas

**New paradigm: Semantic dependency context over file context.** Ctxo introduces the Logic-Slice as the fundamental unit of AI context delivery — a symbol plus its complete transitive dependency graph, assembled at query time from a pre-built index. This replaces file-level context delivery, the universal approach of all current MCP servers. The AI receives the *minimum sufficient context* to reason correctly, not the *maximum available text* from surrounding files.

**Institutional memory as a committed team asset.** The `.ctxo/index/` pattern treats AI context as a versioned, diffable, git-managed artifact — distinct from all existing approaches (in-memory indexing, ephemeral caches, per-session context building). Every `git pull` delivers accumulated team knowledge — architectural decisions, anti-patterns, blast radius data. Context compounds over time.

**Anti-pattern memory from revert commit detection.** By parsing git history for revert commits and attaching rationale to affected symbols, Ctxo gives AI assistants access to *negative knowledge* — approaches tried, failed, and abandoned. No known equivalent exists in the MCP ecosystem.

### Market Context & Competitive Landscape

MCP ecosystem is early (protocol released late 2024). Current MCP servers for code are file readers and symbol search tools — none provide dependency-graph-level context. The committed index pattern has no direct competitor. The window to establish Ctxo as the default context layer is open now, before the space consolidates.

Closest adjacent tools (Sourcegraph Cody, GitHub Copilot workspace, Cursor codebase indexing) operate as SaaS with cloud-side indexing — the architectural opposite of Ctxo's local-first, git-committed model. This is both a differentiation and a positioning advantage for security-conscious teams.

### Validation Approach

- **Logic-Slice validity:** Controlled comparison — Ctxo vs. file-dump, measuring: (a) missing type errors in AI output, (b) token usage, (c) first-attempt correctness rate.
- **Committed index pattern:** Teams with committed index + CI gate vs. those without — track index staleness rate as CI gate proxy.
- **Anti-pattern memory:** Qualitative validation with early adopters — does surfacing revert history measurably change AI behavior?

## Developer Tool Specific Requirements

### Project-Type Overview

Ctxo is an npm package distributed via `npx`, exposing an MCP server over stdio transport. Its API surface is five MCP tools consumed by AI coding assistants. No visual UI. The developer experience: install (one command), configure (one JSON line), use via AI assistant. The tool must feel invisible — the developer interacts with their AI assistant, not with Ctxo directly.

### Language Matrix

| Language | Version | Analysis Depth | Status |
|---|---|---|---|
| TypeScript | All (3.x+) | Full type-aware (ts-morph) | V1 |
| JavaScript | ES2015+ | Full (ts-morph, no type inference) | V1 |
| TSX / JSX | All | Full (tree-sitter TSX grammar) | V1 |
| Go | All | Syntax-level (tree-sitter) | V1.5 |
| C# | All | Syntax-level (tree-sitter) | V1.5 |
| Go (deep) | All | Type-aware (`ctxo-go-analyzer` — go/packages + go/types + ssa + callgraph/cha) | V0.8 ✅ |
| C# (deep) | All | Type-aware (`ctxo-roslyn` — Roslyn Compiler API) | V0.6 ✅ |

### Installation Methods

- **Primary:** `npx ctxo index` — zero global install, always-latest
- **Global install:** `npm install -g ctxo` — for teams preferring pinned versions
- **MCP client config:** `{ "command": "npx", "args": ["-y", "ctxo"] }`
- **CI:** `npx ctxo index --check` in GitHub Actions workflow

### API Surface (MCP Tools)

| Tool | Input | Output | Detail Levels |
|---|---|---|---|
| `get_logic_slice` | `symbol`, `file`, `depth?` | Symbol + transitive deps | L1–L4 |
| `get_blast_radius` | `symbol`, `file` | Impact score + affected symbols | — |
| `get_architectural_overlay` | `path?` | Layer map (Domain/Infra/Adapters) | — |
| `get_why_context` | `symbol`, `file` | Commit intent + anti-pattern warnings | — |
| `get_change_intelligence` | `symbol`, `file` | Complexity × churn score | — |

All tools return structured JSON. Privacy masking applied to all outputs before the MCP response is sent.

### Technical Context

- **Startup:** Lazy initialization — server starts in < 100ms; index loaded on first query
- **Transport:** `StdioServerTransport` (V1); `StreamableHTTP` reserved for future cloud tier
- **Index format:** Per-file JSON at `.ctxo/index/<relative-path>.json`; SQLite query cache at `.ctxo/cache/` (gitignored)
- **Versioning:** Index format version tracked in `.ctxo/index/manifest.json` for migration safety
- **Testing:** `vitest` + `InMemoryTransport` for unit/integration; real filesystem fixtures for E2E

## Development Roadmap & Risk

### MVP Strategy

**Approach:** Problem-solving MVP — deliver Logic-Slice + institutional memory to individual developers, prove the "aha moment," enable organic team adoption via the committed index pattern.

**Resources:** 1–2 engineers with TypeScript/AST experience. Solo-buildable in 6–8 weeks.

**V1 Must-Have Capabilities:**
- All five MCP tools with L1–L4 progressive depth
- Privacy masking pipeline
- Committed JSON index + `.gitignore` cache separation
- `npx ctxo index` + incremental re-indexing + `ctxo watch`
- CI indexing gate (GitHub Actions)
- Monorepo auto-discovery
- MCP stdio transport, verified: Claude Code, Cursor, VS Code Copilot

### Risk Mitigation

**Technical:** ts-morph type resolution in large monorepos may exceed memory limits — mitigated by per-file index architecture (no full-program load) and L1 depth default. Validate on a 5,000-file repo pre-ship.

**Market:** MCP ecosystem adoption slower than expected — mitigated by ensuring Ctxo works as a standalone CLI tool independent of MCP adoption.

**Resource:** CI gate and monorepo auto-discovery are highest-effort V1 items — can slip to V1.1 (post-launch) without breaking core value proposition.

**Index size in large repos:** Progressive detail levels (L1–L4) limit response payload; per-file JSON scopes merge conflicts. Monitor for repos > 10,000 files — chunking strategy may be required.

**MCP protocol evolution:** `@modelcontextprotocol/sdk` is the reference implementation tracked as a direct dependency. Breaking changes are upstream-controlled risk.

## Functional Requirements

### Index Management

- **FR1:** Developer can build a full codebase index from the command line in a single command
- **FR2:** Developer can trigger incremental re-indexing for a single file or directory
- **FR3:** Developer can start a file watcher that automatically re-indexes changed files
- **FR4:** Developer can verify whether the current index is up to date with source code (for CI use)
- **FR5:** Developer can view a manifest of what is currently indexed (file count, last-updated timestamps)
- **FR6:** The system detects index staleness and surfaces an actionable warning in MCP tool responses
- **FR7:** The system auto-discovers monorepo workspaces and indexes all packages

### Context Delivery (MCP Tools)

- **FR8:** AI assistant can retrieve a Logic-Slice for a named symbol — the symbol plus all transitive dependencies (interfaces, types, helpers) across files
- **FR9:** AI assistant can request a Logic-Slice at four progressive detail levels (L1 minimal → L4 full) to manage context window size
- **FR10:** AI assistant can retrieve the blast radius for a symbol — symbols that would break if it changed, ranked by dependency depth
- **FR11:** AI assistant can retrieve an architectural overlay — a layer map identifying Domain, Infrastructure, and Adapter boundaries
- **FR12:** AI assistant can retrieve why-context for a symbol — git commit intent, PR rationale, and anti-pattern warnings from revert history
- **FR13:** AI assistant can retrieve a change intelligence score for a symbol — a composite of cyclomatic complexity and change frequency

### Anti-Pattern Memory

- **FR14:** The system parses git history to detect revert commits and associates revert rationale with affected symbols
- **FR15:** The system surfaces anti-pattern warnings when a symbol with revert history is queried via `get_why_context`
- **FR16:** Anti-pattern warnings persist in the committed index and are available to any developer or AI assistant after `git clone`

### Privacy & Security

- **FR17:** The system strips API keys, credentials, tokens, and private IP addresses from all MCP tool responses before delivery to the AI client
- **FR18:** The privacy masking pipeline is configurable — developers can extend the pattern list for domain-specific sensitive identifiers
- **FR19:** The local SQLite query cache is never committed to git (enforced via `.gitignore` template generated on first run)

### Team Collaboration & Distribution

- **FR20:** Developer can commit the codebase index to git as text-based, per-file JSON artifacts
- **FR21:** The committed index is diffable in pull requests — changes to indexed symbols appear as line-level diffs
- **FR22:** A developer who clones a repository with a committed index gets full context immediately, without running `ctxo index`
- **FR23:** The CI system can gate pull requests on index freshness — failing the build when source changes are not reflected in the index

### MCP Client Integration

- **FR24:** Developer can configure any MCP-compatible AI client to use Ctxo with a single JSON configuration entry
- **FR25:** Ctxo MCP server starts as a subprocess and is ready to serve queries without manual startup steps
- **FR26:** All five MCP tools are callable from Claude Code, Cursor, and VS Code Copilot without client-specific configuration differences

### Language Support

- **FR27:** Developer can index and query TypeScript, JavaScript, and TSX/JSX codebases with full type-aware dependency resolution (V1)
- **FR28:** Developer can index and query Go and C# codebases with syntax-level dependency resolution (V1.5)

## Non-Functional Requirements

### Performance

- **NFR1:** All five MCP tools respond in < 500ms p95 on a warm index for a TypeScript codebase of ≤ 1,000 files
- **NFR2:** MCP server process is ready to accept connections in < 100ms from process spawn
- **NFR3:** Full initial index build completes in ≤ 30s for a 1,000-file codebase on a modern developer machine (MacBook M-series or equivalent)
- **NFR4:** Incremental re-indexing for a single changed file completes in < 2s
- **NFR5:** Logic-Slice responses at L1 depth are ≤ 150 lines; L4 depth responses stay within an 8,000-token budget
- **NFR6:** Index size for a 1,000-file TypeScript codebase does not exceed 10MB on disk

### Security & Privacy

- **NFR7:** No source code, symbol names, or index content is transmitted to any remote server — all processing is strictly local
- **NFR8:** The privacy masking pipeline detects and redacts: AWS/GCP/Azure credential patterns, JWT tokens, private IPv4/IPv6 addresses, and common `.env` variable patterns (`*_SECRET`, `*_KEY`, `*_TOKEN`, `*_PASSWORD`)
- **NFR9:** The SQLite query cache (`.ctxo/cache/`) contains no plaintext source code — only derived query results
- **NFR10:** Ctxo runs with no elevated privileges; does not require `sudo` or admin rights

### Reliability

- **NFR11:** Index staleness is detected and reported within the MCP tool response — never silently served as fresh context
- **NFR12:** A crashed or stopped file watcher does not corrupt the committed index; on restart, the watcher re-validates index state before resuming
- **NFR13:** If the SQLite cache is deleted or corrupted, Ctxo rebuilds it from the committed JSON index without user intervention
- **NFR14:** `npx ctxo index --check` exits with a non-zero code when any source file has been modified after the index was last built

### Integration

- **NFR15:** Ctxo implements the MCP specification (current stable version at V1 ship date) without extensions or deviations that break conformant MCP client compatibility
- **NFR16:** All five MCP tools are tested for functional equivalence across Claude Code, Cursor, and VS Code Copilot before V1 release
- **NFR17:** The MCP server exposes a `tools/list` response conformant with the MCP spec so AI clients can discover available tools without documentation
- **NFR18:** Ctxo requires only Node.js ≥ 18 and `git` as runtime dependencies — no additional system installation required

## Testing Strategy

### Unit Tests

- **Scope:** Pure domain logic — AST parsing, dependency graph resolution, blast radius calculation, git commit parsing, privacy masking pattern matching, change intelligence scoring
- **Approach:** `vitest` with in-memory fixtures; no filesystem or git access. Each module tested in isolation against TypeScript/JavaScript AST samples as fixture data.
- **Coverage target:** ≥ 90% line coverage on core domain modules (`logic-slice`, `blast-radius`, `why-context`, `change-intelligence`, `privacy-masker`)
- **Key cases:** Circular dependency graphs, symbols with no git history, files with zero revert commits, symbols exceeding L4 depth budget, privacy patterns at token boundaries

### Integration Tests

- **Scope:** MCP tool handlers end-to-end through the full pipeline — index read → query → privacy masking → MCP response — using `@modelcontextprotocol/sdk` `InMemoryTransport` (no real MCP client required)
- **Approach:** Real filesystem fixtures (committed TypeScript sample projects of known structure); SQLite cache rebuilt from fixture index on each test run
- **Key cases:** All five tools return well-formed MCP responses; stale index warning appears when fixture file is touched after index build; `get_why_context` surfaces revert warning for fixture commits containing "Revert"

### E2E Tests

- **Scope:** Full `npx ctxo` CLI — index build, incremental re-index, `--check` exit codes, file watcher trigger
- **Approach:** Real TypeScript fixture projects on disk; CI runs on macOS and Linux (Node.js 18, 20, 22)
- **Key cases:** Index build on clean project produces valid manifest; `--check` exits non-zero after source file modification; incremental re-index updates only the changed file's JSON; `ctxo watch` detects a save and re-indexes within 2s

### MCP Client Compatibility Tests

- **Scope:** Verify all five tools are callable and return valid responses from Claude Code, Cursor, and VS Code Copilot
- **Approach:** Manual smoke test protocol run against a reference TypeScript project before each V1 release; automated where client SDKs expose a testable interface
- **Gate:** All three clients must pass smoke tests before V1 release tag is cut (maps to NFR16)

### Privacy Masking Validation

- **Scope:** Dedicated test fixture set containing known credential patterns (synthetic, non-real) — AWS keys, JWTs, `.env` patterns, private IPs
- **Approach:** Assert zero leakage: run each pattern through all five tool outputs and verify masking pipeline redacts 100% of fixture sensitive strings before MCP response
- **Gate:** Any new credential pattern added to the masking pipeline requires a corresponding fixture test (maps to FR17, FR18, NFR8)

## Delivered Phases (post-V1)

Phase PRDs consolidated into this document on 2026-04-13. Originals preserved in [docs/archive/prd/](../archive/prd/) for traceability. See [CHANGELOG.md](../../CHANGELOG.md) for per-release detail.

### Phase: ctxo Doctor

- **Status:** Delivered in v0.7.0-alpha.0
- **Delivered on:** 2026-04-08 (command implemented, ADR pending)
- **Goal:** Unified diagnostic command to check all subsystems (git, index, SQLite, node version, ts-morph, tree-sitter, disk, config) and report pass/warn/fail health status.
- **Scope delivered:** 15-check health registry with human/JSON/quiet output formats; `--json`, `--quiet` flags; exit codes (0=pass/warn, 1=fail); parallel check execution via `Promise.allSettled()`
- **Not delivered / deferred:** Auto-fix mode (`--fix` was deferred and merged into plugin-architecture doctor enhancement); remote diagnostics/telemetry
- **Key artifacts:** 15 `IHealthCheck` implementations in `packages/cli/src/adapters/diagnostics/checks/`; `DoctorCommand` CLI integration; ~71 unit + integration + edge case tests
- **Archive:** [prd-ctxo-doctor.md](../archive/prd/prd-ctxo-doctor.md)

### Phase 1: Search Quality Upgrade

- **Status:** Partial — in-memory BM25 delivered; FTS5 deferred
- **Delivered on:** 2026-04-08 (design locked; BM25 + Porter tokenization + camelCase-aware ranking in `get_ranked_context`)
- **Goal:** Replace substring matching in `get_ranked_context` with production-grade BM25 + PageRank search to handle camelCase, stemming, typo tolerance, and multi-word queries.
- **Scope delivered:** Two-phase search cascade (Phase 1 BM25 + Phase 2 trigram fallback); camelCase/snake_case tokenization; BM25 scoring with PageRank boosting; fuzzy Damerau-Levenshtein correction; NDCG@10 target ≥ 0.75
- **Not delivered / deferred:** FTS5 (deferred post-v0.7; in-memory BM25 shipped instead — see [ADR-003](../architecture/ADR/adr-003-fts5-search-deferred.md)); semantic/embedding search; custom synonyms
- **Key artifacts:** `ContextAssembler` BM25 scorer; `search_symbols` `mode: 'fts'` support
- **Archive:** [prd-phase1-search-quality.md](../archive/prd/prd-phase1-search-quality.md)

### Phase 2: Plugin Architecture & Language Expansion

- **Status:** Delivered in v0.7.0-alpha.0 (Phase A complete; Phase B deferred)
- **Delivered on:** 2026-04-13 (monorepo migration, 5 packages, plugin protocol v1, TS/Go/C# extraction, `ctxo install`, `ctxo doctor --fix`, version visibility)
- **Goal:** Replace bundled language adapters with plugin architecture supporting independent versioning, peer dependency isolation, and community extensibility.
- **Scope delivered:** pnpm monorepo with `@ctxo/cli`, `@ctxo/plugin-api`, `@ctxo/lang-typescript`, `@ctxo/lang-go`, `@ctxo/lang-csharp`; `CtxoLanguagePlugin` protocol v1; `ctxo install <lang>` with auto-detection; `ctxo doctor --fix` dependency-ordered remediation; `ctxo --version` verbose + JSON output
- **Not delivered / deferred:** Python/Java plugins (Phase B, v0.7.x); framework-aware analysis (Spring/Django ORM); full-tier analysis beyond C#; community plugin registry (v0.8+); automated release pipeline
- **Key artifacts:** [ADR-012](../architecture/ADR/adr-012-plugin-architecture-and-monorepo.md); `plugin-discovery.ts`, `language-coverage-check.ts`, `version-command.ts`, `install-command.ts`, `doctor-fix.ts`, `plugin-loader.ts`; 987+ tests across 5 packages
- **Archive:** [prd-plugin-architecture-and-language-expansion.md](../archive/prd/prd-plugin-architecture-and-language-expansion.md)

### Phase: Go Full-Tier via `ctxo-go-analyzer`

- **Status:** Delivered in v0.8.0-alpha.0
- **Delivered on:** 2026-04-13
- **Goal:** Lift `@ctxo/lang-go` from tree-sitter syntax tier to full type-aware semantic analysis — cross-package symbol resolution, `implements`, `extends`, `calls`, `uses` edges, dead-code detection.
- **Scope delivered:** Standalone Go binary `tools/ctxo-go-analyzer` bundled inside `@ctxo/lang-go` using `go/packages` + `go/types` + `x/tools/go/ssa` + `callgraph/cha`; `GoCompositeAdapter` picks full vs syntax tier at init; reflect-safe dead-code heuristics (reflect.{TypeOf,ValueOf,New} + json.{Marshal,Unmarshal,NewDecoder,NewEncoder}); generic `typeArgs` preserved on edge metadata; lazy binary build into `~/.cache/ctxo/lang-go-analyzer/<sourceHash-goVersion>/`; subdir fallback loader recovers partial results when the module graph has a fatal conflict; integration fixture + 47 tests (6 Go + 41 vitest) + E2E in `packages/cli/tests/e2e/go-full-tier.test.ts`.
- **Not delivered / deferred:** Prebuilt binary distribution (decided against — Go toolchain assumption acceptable for Go-project users; revisit if telemetry shows friction); RTA-based reachability (swapped for CHA because `rta.Analyze` panics on generic code in current `x/tools`).
- **Key artifacts:** [ADR-013](../architecture/ADR/adr-013-go-full-tier-via-ctxo-go-analyzer-binary.md); `packages/lang-go/tools/ctxo-go-analyzer/` (7 Go packages); `packages/lang-go/src/analyzer/` (composite + adapter + process + discovery + toolchain + binary-build); `packages/lang-go/src/composite-adapter.ts`.

### Phase 3: Monorepo Workspace Support

- **Status:** Deferred — placeholder pending v0.7 user feedback
- **Delivered on:** N/A
- **Goal:** Enable ctxo to index isolated-package monorepos (pnpm / npm / yarn / Turborepo / Nx workspaces) with per-package boundaries, plugin discovery, and alias resolution.
- **Scope delivered:** —
- **Not delivered / deferred:** All features. Forward-compat design applied in v0.7 via `IWorkspace` abstraction, parameterized plugin discovery, optional `workspace` field in MCP `_meta`.
- **Key artifacts:** Forward-compat stubs: `IWorkspace` interface, `loadPluginsFromManifest(manifestPath)` signature in v0.7. Phase 1 (future) targets `pnpm-workspace.yaml` auto-detection + per-package plugin aggregation.
- **Archive:** [prd-monorepo-workspace-support.md](../archive/prd/prd-monorepo-workspace-support.md)
