---
title: "BMad PRD Creation Session Log"
date: "2026-03-28"
project: "Ctxo"
workflow: "bmad-create-prd"
status: "complete"
steps_completed: 12
---

# BMad PRD Creation Session Log

**Date:** 2026-03-28
**User:** Alper Hankendi
**Project:** Ctxo -- Logic-Slice Based MCP Server

---

## Session Overview

This session walked through the full BMad `bmad-create-prd` workflow (12 steps) to produce a Product Requirements Document for Ctxo. Starting from existing product briefs and technical research documents, the PM agent guided the user through project discovery, vision refinement, success criteria, user journey mapping, domain requirements, innovation discovery, developer-tool deep dive, scoping, functional requirements (FR1-FR28), non-functional requirements (NFR1-NFR18), document polish, and a testing strategy. The final PRD was written to `artifacts/planning-artifacts/prd.md`.

---

## Step 1: Initialization

**Mode:** Create -- new PRD from scratch.

**Input Documents Discovered:**

- Product Briefs (2 found):
  - `artifacts/planning-artifacts/product-brief-Ctxo.md`
  - `docs/product-brief-session.md`
- Research (1 found):
  - `artifacts/research/technical-ctxo-core-stack-research-2026-03-28.md`
- Project Docs (2 found):
  - `docs/session-log-architecture-2026-03-28.md`
  - `docs/bmad-agent-architect-session.md`
- Project Context: None found

The agent loaded `product-brief-Ctxo.md` as the primary brief, the technical research document, and the architecture session doc. The `product-brief-session.md` was identified as a session log that may overlap with the main brief.

**PRD file created:** `artifacts/planning-artifacts/prd.md`

---

## Step 2: Project Discovery

**Documents loaded:** 2 product briefs, 1 research doc, 0 brainstorming docs, 2 project docs.

**Classification:**

- **Project Type:** `developer_tool` -- npm package, MCP server, API surface exposed to AI clients, no visual UI
- **Domain:** `general` (developer productivity) -- no regulated industry, no compliance requirements
- **Complexity:** `high` -- novel protocol (MCP), type-aware AST analysis across file boundaries, real-time performance constraints (< 500ms p95), multi-language extension architecture
- **Project Context:** `greenfield`

**Agent's summary of Ctxo:**

> Ctxo is an MCP server delivered as an npm package (`npx ctxo`) that gives AI coding assistants dependency-aware, intent-enriched context about a codebase -- a Logic-Slice engine built on ts-morph, tree-sitter, and SQLite. Five tools, local-only, index committed to git.

The agent probed whether Ctxo is intended as open-source or commercial. The user continued without specifying, implying OSS-first for V1.

---

## Step 2b: Product Vision

The agent asked three probing questions about differentiation, core insight, and timing. The user responded with a detailed vision statement:

### User's Vision: "Ctxo: From Dumb Pipes to Neural Context"

Mevcut AI araclarinin (MCP sunuculari, indeksleme araclari) en buyuk gunahi, kodu sadece metin (string) olarak gormeleridir. Bu araclar AI'ya koca bir kutuphaneleri "al hepsini oku" diyerek firlatan, verimsiz ve "aptal borulardir" (Dumb Pipes).

Ctxo bu paradigmayi yikar. Ctxo bir dosya okuyucu degil; kodun sinir sistemini (nervous system) anlayan bir Baglam Motorudur (Context Engine).

**The Differentiation: Why Ctxo?**

Ctxo, gelistiricinin zihnindeki "baglam haritasi" ile AI'nin "bilgi penceresi" arasindaki o devasa boslugu su uc temel farkla doldurur:

**Surgical Logic-Slicing (The Death of "Missing Type" Errors):**
Standart araclar bir fonksiyonu ceker ve AI'yi "tip tanimlari eksik" uyarisiyla bas basa birakir. Ctxo, AST (Abstract Syntax Tree) analizi yaparak o fonksiyonun dokundugu her bir Interface, Type ve Helper fonksiyonunu farkli dosyalarda olsalar bile tek bir "mantiksal dilim" (Logic-Slice) halinde paketler. AI artik kor ucusu yapmaz; ihtiyaci olan her sey elindedir.

**Historical Consciousness (The "Why" Behind the Code):**
Kod sadece satirlardan ibaret degildir; bir gecmisi vardir. Ctxo, Git gecmisini dogrudan baglama entegre eder. AI'ya sadece "ne yazdigini" degil, "neden yazdigini" (commit mesajlari, PR tartismalari) soyler. Bu, AI'nin 3 ay once bir bug'i cozmek icin eklenen kritik bir kontrolu yanlislikla silmesini engeller.

**Risk-Aware Intelligence (The Downstream Guardrail):**
Rakipler sadece "isteneni" yapar. Ctxo ise projenin bagimlilik grafikini bildigi icin AI'yi uyarir: "Bu degisikligi yapabilirim ama bu fonksiyon 12 farkli kritik modulu etkiliyor, guvenli bir refactor oneriyorum."

**The "Aha!" Moment: When the Magic Happens**

Kullanici Ctxo'nun gucunu su anlarda hisseder:

- **The "Mind-Reader" Moment:** AI'ya "su fonksiyonu guncelle" dediginide, AI'nin senden hicbir ekstra dosya istemeden, projenin en ucra kosesindeki tip tanimlarina kadar her seyi bildigini fark ettigin an.
- **The "PR-Saver" Moment:** AI'nin seni durdurup, "Bu degisikligi yaparsak v1.2'de cozulen guvenlik acigi geri donebilir, Git gecmisinde soyle bir not var" dedigi o kirilma ani.
- **The "Zero-Noise" Moment:** Binlerce satirlik dosyalar yerine sadece 50 satirlik ama "tam isabet" bir baglamla, AI'nin ilk denemede (one-shot) hatasiz kod urettigi an.

**Conclusion: The Partner vs. The Tool**

Ctxo, AI'yi yonettigin bir arac olmaktan cikarip, seninle ayni "kod hafizasina" sahip bir partnere donusturur.

| Durum | Eski Dunya (AI + Standart MCP) | Yeni Dunya (AI + Ctxo) |
|---|---|---|
| Baglam | AI "Dosya eksik" diye aglar. | AI ihtiyaci olani sessizce ceker. |
| Hata | Yan etkileri (side-effects) goremez. | "Bunu degistirirsen sunlar bozulur" der. |
| Maliyet | Dosyanin tamamini okur (Token israf). | Sadece ilgili dilimi okur (Token tasarruf). |
| Iletisim | Sen AI'yi yonetirsin. | AI seni yonlendirir. |

### Agent's Reflection

**Vision:** Ctxo transforms AI coding assistants from "dumb pipes" (tools that dump raw text at an AI and hope for the best) into a Neural Context layer -- a Context Engine that understands the nervous system of code, not just its syntax.

**What Makes It Special -- three things working together:**

1. **Surgical Logic-Slicing** -- AST-powered packaging of a symbol + every Interface, Type, and Helper it touches across files. Eliminates "missing type" errors at the root.
2. **Historical Consciousness** -- Git history as first-class context. The AI knows *why* code exists, not just what it is -- preventing the quiet erasure of critical bug fixes and security patches.
3. **Risk-Aware Intelligence** -- Blast radius awareness before action. AI becomes a downstream guardrail, not just an executor.

**The "Aha" Moments (3 distinct ones):**

- **Mind-Reader:** AI modifies the function you asked about -- with zero extra prompting, zero missing types, zero file-hunting.
- **PR-Saver:** AI stops itself and says "this change risks reintroducing the v1.2 security vulnerability -- here's the git note."
- **Zero-Noise:** 50 lines of surgical context produces one-shot correct output. No token burn on irrelevant code.

**Core Insight:** The paradigm shift isn't about better search or faster indexing. It's about shifting the relationship: from you managing the AI to the AI guiding you, because it holds the same code memory you do.

**Why Now:** MCP is the emerging standard for AI-to-tool communication. The window to become the default context layer -- before the space consolidates -- is open right now.

---

## Step 2c: Executive Summary

The agent drafted the executive summary based on the vision discovery:

> AI coding assistants have a context problem. They receive code as flat text -- blind to the dependency graph it lives in, the git history behind every decision, and the blast radius of every change. The result is a capable AI operating with the situational awareness of someone who just cloned the repo 30 seconds ago.
>
> **Ctxo** is a Model Context Protocol (MCP) server that closes this gap. It transforms AI assistants from dumb pipes -- tools that dump raw files and hope the AI figures it out -- into a Neural Context layer: a Context Engine that understands the nervous system of a codebase, not just its syntax.
>
> Ctxo runs entirely on the developer's machine. Its index is committed to the repository as per-file JSON, diffable in PRs, shareable via `git pull`, and queryable in under 500ms. A fresh `git clone` is immediately context-rich. The AI gets the codebase's institutional memory, not just its current state.
>
> Target users: senior and mid-level developers who have hit the ceiling of what AI coding assistants can do without deeper context -- developers who've seen the AI confidently break something it didn't know existed.

**What Makes This Special:**

Three capabilities, working together, that no other MCP tool delivers simultaneously:

- **Surgical Logic-Slicing.** AST-powered dependency resolution that packages a symbol with every Interface, Type, and Helper it touches across files -- delivered as a single Logic-Slice. Eliminates "missing type" errors at the root.
- **Historical Consciousness.** Git history as first-class context. The AI knows not just *what* code does, but *why* it was written that way -- commit intent, revert warnings, abandoned approaches.
- **Risk-Aware Intelligence.** Blast radius awareness before action. Before modifying a symbol depended on by 34 other modules, the AI knows it -- and can recommend a safe refactor path rather than a confident breaking change.

The paradigm shift: from *you managing the AI* to *the AI guiding you*, because it holds the same code memory you do.

**Project Classification:**

- **Project Type:** Developer Tool (MCP server, npm package)
- **Domain:** Developer Productivity (general -- no regulated industry)
- **Complexity:** High -- novel protocol integration (MCP), type-aware cross-file AST analysis, real-time performance constraints (< 500ms p95), multi-language extension architecture
- **Project Context:** Greenfield

---

## Step 3: Success Criteria

### User Success

- **Mind-Reader Moment achieved:** In a Ctxo-enabled session, the AI never asks "I don't see the definition for Type X" -- all required interfaces, types, and helpers are present in the Logic-Slice without manual file-fetching by the user.
- **Time to first value:** A developer installs Ctxo, runs `npx ctxo index`, and receives their first Logic-Slice response within 5 minutes of a fresh clone.
- **Zero-Noise output:** Logic-Slice context is 50-150 lines for the majority of symbol queries (vs. full file dumps that span hundreds of lines), reducing prompt token cost while increasing relevance.
- **PR-Saver moment:** For codebases with revert commits in git history, `get_why_context` surfaces anti-pattern warnings in at least one AI session per team per sprint.

### Business Success

- **3-month target:** 10+ multi-developer teams (3+ devs) with the `.ctxo/index/` committed to their main branch and actively used in CI.
- **Ecosystem adoption:** Listed as a recommended MCP server in at least one Claude Code or Cursor community resource by V1 launch.
- **Monetization:** V1 is open-source / free -- success is measured purely by adoption and usage signals. Revenue strategy is out of scope for this PRD.

### Technical Success

- **Performance:** Context delivery < 500ms p95 on a warm index (1,000-file TypeScript codebase). MCP server startup < 100ms (lazy initialization).
- **Compatibility:** All five MCP tools verified functional with Claude Code, Cursor, and VS Code Copilot at V1 launch.
- **Index integrity:** Incremental re-indexing on file change completes in < 2s. Index format is text-based, diffable, and produces no merge conflicts on `git pull`.
- **Privacy:** Zero sensitive data (API keys, credentials, private IPs) reaches the MCP client -- privacy masking pipeline validated against a test fixture set.

### Measurable Outcomes

- Reduction in AI-generated changes requiring immediate revert -- baseline established via git history analysis with 3+ willing early adopter teams post-launch (instrumentation-first; no pre-launch baseline assumed).
- Token consumption per AI session reduced vs. file-dump approach -- measured by comparing context window usage with/without Ctxo in controlled test scenarios.

### Product Scope

**MVP -- Minimum Viable Product (V1, TypeScript/JavaScript):**
Five MCP tools fully functional: `get_logic_slice`, `get_blast_radius`, `get_architectural_overlay`, `get_why_context`, `get_change_intelligence`. Progressive detail levels L1-L4. Privacy masking pipeline. Committed JSON index (`.ctxo/index/`). Incremental file watching. Monorepo auto-discovery. CI indexing gate (GitHub Actions). `npx ctxo` install. Verified compatibility: Claude Code, Cursor, VS Code Copilot.

**Growth Features (Post-MVP):**
Go + C# language support via tree-sitter syntax-level adapters (V1.5). IDE extension for one-click install. Dashboard for index health and blast radius visualization. Team analytics (opt-in): aggregate revert reduction metrics.

**Vision (V2+):**
Go deep analysis via gopls MCP composition. C# deep analysis via Roslyn LSP adapter. Multi-repo / cross-service dependency graphs. Natural language query interface over the index. Ctxo becomes the default context layer -- `.ctxo/index/` as unremarkable as `.github/workflows/`.

---

## Step 4: User Journey Mapping

Four journeys were mapped: Solo Developer Mia, Team Lead Daniel, New Joiner Priya, and Edge Case Carlos.

### Journey 1: The Solo Developer -- First Context Slice

Meet Mia. She's a senior frontend developer at a 12-person startup. Her team shipped fast for two years; the codebase is now 800 files of TypeScript and nobody has a complete map of it anymore. She uses Claude Code daily but spends 20% of every AI session doing file archaeology -- "also look at this file... and this one... and this interface." Last week the AI confidently refactored `useAuthToken` without knowing it was consumed by three other hooks. The PR review caught it. Barely.

She finds Ctxo in the Claude Code MCP server list. Thirty seconds:

```
npx ctxo index
```

Index builds in 18 seconds. She adds the one-line MCP config and reloads Claude Code.

She asks Claude to update `useAuthToken`. No file-hunting. No "I don't see the definition for TokenValidationResult." Claude responds: "I've updated the hook and verified its contract against IAuthProvider, TokenValidationResult, and the three consuming hooks -- no breaking changes."

That's the moment. She opens Slack and sends her team lead a message: "You need to see this."

**Capabilities revealed:** `get_logic_slice` (L2 depth), MCP stdio transport, warm-index query performance, Claude Code compatibility.

### Journey 2: The Team Lead -- Committing the Index

Meet Daniel. He's a tech lead on a 6-person backend team. Mia sent him the Slack message. He tries Ctxo on his machine and hits the same moment. But he's thinking bigger: "What if everyone on the team had this -- and what if it accumulated over time?"

He reads about the committed index pattern. He runs `npx ctxo index`, reviews the `.ctxo/index/` output -- one JSON file per source file, 3.2MB total, fully text-based. He opens a sample file: readable, diffable, reasonable. He adds `.ctxo/cache/` to `.gitignore`, commits `.ctxo/index/`, and opens a PR.

The PR description writes itself: "Adds Ctxo index -- gives AI assistants full dependency context on this codebase. Pull and you're context-rich immediately."

He adds the GitHub Actions CI gate. Now every PR that modifies source files triggers `npx ctxo index --check` -- the CI fails if the index is stale. Institutional memory stays current automatically.

Three weeks later a new hire, Priya, clones the repo. She has full context on her first day. Daniel never has to explain the PaymentProcessor dependency graph again.

**Capabilities revealed:** git commit index pattern, `.gitignore` cache separation, CI indexing gate (GitHub Actions), incremental re-indexing, monorepo auto-discovery.

### Journey 3: The New Joiner -- Day-One Onboarding

Meet Priya. She joined Daniel's team two weeks ago. The codebase is 1,200 files. She's been given a ticket: add rate limiting to the ApiGateway service.

Old world: she'd spend half a day reading files, asking colleagues "what does this touch?", making a change that looks right but breaks MetricsCollector downstream.

Ctxo world: she runs `git clone`. The `.ctxo/index/` is already there. She opens Claude Code, types: "I need to add rate limiting to ApiGateway -- what's the blast radius?"

Claude responds with the architectural overlay for the gateway layer, the five downstream services that depend on it, and a note from git history: "Rate limiting was attempted in commit 3a7f91 eight months ago and reverted -- the implementation used a shared mutex that caused deadlocks under load. Recommend token bucket per-connection instead."

Priya didn't know that history existed. Nobody told her. The codebase told her.

**Capabilities revealed:** `get_blast_radius`, `get_why_context`, `get_architectural_overlay`, anti-pattern memory from revert commits, committed index shared via `git clone`.

### Journey 4: The Developer -- Edge Case / Stale Index Recovery

Meet Carlos. He's been using Ctxo for a month. It's become invisible -- he forgets it's there until the AI demonstrates something impossible. Today something goes wrong.

He runs a Logic-Slice query on `InvoiceGenerator`. The response is missing `TaxCalculator` -- a dependency he knows exists. He checks: he's been on a feature branch for three days, added `TaxCalculator` yesterday, never re-ran the index.

Ctxo surfaces a warning in the MCP response: "Index for invoice-generator.ts is 3 days old and may not reflect recent changes. Run `npx ctxo index --file src/billing/invoice-generator.ts` to update."

He runs the incremental update. Two seconds. The next query includes `TaxCalculator`. He files a mental note: "Wire up the file watcher so this never happens again." He adds `npx ctxo watch` to his dev startup script.

**Capabilities revealed:** Index staleness detection, incremental file-level re-indexing, `ctxo watch` file watcher, graceful degradation with user-actionable warnings.

### Journey Requirements Summary

| Capability Area | Revealed By |
|---|---|
| `get_logic_slice` (L1-L4 progressive depth) | Journey 1 |
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

---

## Step 5: Domain-Specific Requirements

Classification: domain = general (developer productivity), complexity = high.

The complexity is high due to technical factors (novel protocol, AST analysis, real-time constraints) -- not regulatory factors. There are no compliance regimes (HIPAA, PCI-DSS, GDPR processing, etc.) that apply.

The one domain concern worth calling out: **privacy.** Ctxo processes source code which may contain secrets, credentials, and proprietary business logic. The privacy masking pipeline is a trust prerequisite for adoption, especially in enterprise environments. Already captured in success criteria.

No formal Domain Requirements section was appended -- no meaningful additions beyond what is already in scope.

---

## Step 6: Innovation Discovery

### Detected Innovation Areas

1. **Logic-Slice as a new paradigm for context delivery.** Every existing MCP server for code (file readers, symbol search, grep tools) operates at the file or token level. Ctxo operates at the semantic dependency graph level -- a fundamentally different unit of context.

2. **Institutional memory as committed data.** The idea that a codebase's intent graph (not just its code) should live in git, accumulate over time, and be shared via `git pull` -- this is novel. No existing tool treats the AI's context layer as a team asset that compounds. ESLint's `.eslintrc` doesn't grow smarter over time. Ctxo's index does.

3. **Anti-pattern memory from revert commits.** Surfacing "this was tried and abandoned -- here's why" from git history is a capability that no other tool provides. The AI inherits institutional memory that survives team turnover.

4. **Composable MCP architecture.** The V2 pattern of composing with gopls and Roslyn as peer MCP servers (rather than reimplementing language analysis) is a novel approach to multi-language extensibility in the MCP ecosystem.

### Market Context & Competitive Landscape

The MCP ecosystem is early (protocol released late 2024). Current MCP servers for code are primarily file readers and symbol search tools -- none provide dependency-graph-level context. The committed index pattern has no direct competitor. The timing window to establish Ctxo as the default context layer is open now, before the space consolidates around file-dump approaches.

Closest adjacent tools (Sourcegraph Cody, GitHub Copilot workspace context, Cursor's codebase indexing) operate as SaaS with cloud-side indexing -- the opposite of Ctxo's local-first, git-committed architecture. This is both a differentiation and a positioning advantage for security-conscious teams.

### Validation Approach

- **Logic-Slice validity:** Controlled comparison -- same query with Ctxo vs. file-dump approach, measuring: (a) missing type errors in AI output, (b) token usage, (c) first-attempt correctness rate. Target: measurable improvement in all three.
- **Committed index pattern:** Adoption signal -- teams that commit the index and use CI gate vs. those that don't. Track index staleness rate as proxy for CI gate value.
- **Anti-pattern memory:** Qualitative validation with early adopters -- does surfacing revert history change AI behavior in measurable ways?

### Risk Mitigation

- **Index staleness:** Mitigated by CI gate (fails on stale index) + file watcher for local dev + staleness warnings in MCP responses.
- **Index size in large repos:** Progressive detail levels (L1-L4) limit response payload; per-file JSON keeps merge conflicts scoped. Monitor for repos > 10,000 files -- may require chunking strategy.
- **MCP protocol evolution:** `@modelcontextprotocol/sdk` is the reference implementation; Ctxo tracks it as a direct dependency. Breaking changes are upstream-controlled risk.

---

## Step 7: Developer Tool Deep Dive

### Project-Type Overview

Ctxo is an npm package distributed via npx, exposing an MCP server over stdio transport. Its API surface is five MCP tools consumed by AI coding assistants. There is no visual UI; the developer experience is: install (one command), configure (one JSON line), use (via AI assistant). The tool must feel invisible -- the developer interacts with their AI assistant, not with Ctxo directly.

### Language Matrix

| Language | Version | Analysis Depth | Status |
|---|---|---|---|
| TypeScript | All (3.x+) | Full type-aware (ts-morph) | V1 |
| JavaScript | ES2015+ | Full (ts-morph, no type inference) | V1 |
| TSX / JSX | All | Full (tree-sitter TSX grammar) | V1 |
| Go | All | Syntax-level (tree-sitter) | V1.5 |
| C# | All | Syntax-level (tree-sitter) | V1.5 |
| Go (deep) | All | Type-aware (gopls MCP composition) | V2 |
| C# (deep) | All | Type-aware (Roslyn LSP) | V2 |

### Installation Methods

- **Primary:** `npx ctxo index` -- zero global install, always-latest
- **Global install:** `npm install -g ctxo` -- optional, for teams preferring pinned versions
- **MCP client config:** Single JSON entry -- `{ "command": "npx", "args": ["-y", "ctxo"] }`
- **CI:** `npx ctxo index --check` in GitHub Actions workflow

### API Surface (MCP Tools)

| Tool | Input | Output | Detail Levels |
|---|---|---|---|
| `get_logic_slice` | symbol, file, depth? | Symbol + transitive deps | L1-L4 |
| `get_blast_radius` | symbol, file | Impact score + affected symbols | -- |
| `get_architectural_overlay` | path? | Layer map (Domain/Infra/Adapters) | -- |
| `get_why_context` | symbol, file | Commit intent + anti-pattern warnings | -- |
| `get_change_intelligence` | symbol, file | Complexity x churn score | -- |

All tools return structured JSON. Privacy masking applied to all outputs before MCP response is sent.

### Implementation Considerations

- **Startup:** Lazy initialization -- MCP server starts in < 100ms; index loaded on first query, not at startup
- **Transport:** StdioServerTransport for local subprocess (V1); StreamableHTTP reserved for future cloud tier
- **Index format:** Per-file JSON at `.ctxo/index/<relative-path>.json`; SQLite query cache at `.ctxo/cache/` (gitignored)
- **Versioning:** Semantic versioning; index format version tracked in `.ctxo/index/manifest.json` for future migrations
- **Testing:** vitest + InMemoryTransport for unit/integration; real filesystem fixtures for E2E

---

## Step 8: Scoping

### MVP Strategy & Philosophy

**MVP Approach:** Problem-solving MVP -- deliver the core value proposition (Logic-Slice + institutional memory) to individual developers, prove the "aha moment," enable organic team adoption via the committed index pattern.

**Resource Requirements:** 1-2 engineers with TypeScript/AST experience. Solo-buildable by one senior engineer over 6-8 weeks.

### MVP Feature Set (Phase 1 -- V1)

**Core User Journeys Supported:** Journey 1 (Solo Developer), Journey 2 (Team Lead / committed index), Journey 3 (New Joiner), Journey 4 (Stale index recovery).

**Must-Have Capabilities:**

- `get_logic_slice` with L1-L4 progressive depth (ts-morph, TypeScript/JavaScript/TSX)
- `get_blast_radius` -- impact score + affected symbols (SQLite recursive query)
- `get_architectural_overlay` -- layer map (Domain/Infra/Adapters)
- `get_why_context` + anti-pattern memory (git history parsing, revert detection)
- `get_change_intelligence` -- complexity x churn score
- Privacy masking pipeline (API keys, credentials, private IPs stripped from all outputs)
- Committed JSON index (`.ctxo/index/`) + `.gitignore` cache separation
- `npx ctxo index` + incremental re-indexing + `ctxo watch` file watcher
- CI indexing gate (GitHub Actions: `npx ctxo index --check`)
- Monorepo auto-discovery
- MCP stdio transport, verified: Claude Code, Cursor, VS Code Copilot

### Post-MVP Features

**Phase 2 -- V1.5 (Growth):**

- Go + C# language support via tree-sitter syntax-level adapters
- `npx ctxo init` -- auto-writes MCP client config to detected AI assistant config file
- Dedicated documentation site (beyond README)
- Index health CLI: `npx ctxo status`

**Phase 3 -- V2+ (Expansion):**

- Go deep analysis via gopls MCP composition
- C# deep analysis via Roslyn LSP adapter
- Multi-repo / cross-service dependency graphs
- Natural language query interface over the index
- Python support (evaluate based on demand signal post-V1)
- Optional opt-in analytics: aggregate revert reduction metrics across teams

### Risk Mitigation Strategy

- **Technical Risks:** ts-morph type resolution in large monorepos may exceed memory limits -- mitigated by per-file index architecture (never load full program into memory simultaneously) and L1 depth default. Validate on a 5,000-file repo before shipping.
- **Market Risks:** MCP ecosystem may not grow as fast as expected, limiting addressable market -- mitigated by ensuring Ctxo works as a standalone CLI tool (not purely MCP-dependent), preserving value even if MCP adoption stalls.
- **Resource Risks:** If solo build, CI gate and monorepo auto-discovery are the highest-effort V1 items -- these can ship as V1.1 (day-one post-launch) without breaking the core value proposition.

---

## Step 9: Functional Requirements

28 functional requirements across 7 capability areas:

### Index Management

- **FR1:** Developer can build a full codebase index from the command line in a single command
- **FR2:** Developer can trigger incremental re-indexing for a single file or directory
- **FR3:** Developer can start a file watcher that automatically re-indexes changed files
- **FR4:** Developer can check whether the current index is up to date with source code (for CI use)
- **FR5:** Developer can view a manifest of what is currently indexed (file count, last-updated timestamps)
- **FR6:** The system detects index staleness and surfaces an actionable warning in MCP tool responses
- **FR7:** The system auto-discovers monorepo workspaces and indexes all packages

### Context Delivery (MCP Tools)

- **FR8:** AI assistant can retrieve a Logic-Slice for a named symbol -- the symbol plus all transitive dependencies (interfaces, types, helpers) across files
- **FR9:** AI assistant can request Logic-Slice at four progressive detail levels (L1 minimal to L4 full) to manage context window size
- **FR10:** AI assistant can retrieve the blast radius for a symbol -- the set of symbols that would break if it changed, ranked by dependency depth
- **FR11:** AI assistant can retrieve an architectural overlay for the codebase -- a layer map identifying Domain, Infrastructure, and Adapter boundaries
- **FR12:** AI assistant can retrieve the "why context" for a symbol -- git commit intent, PR rationale, and anti-pattern warnings from revert history
- **FR13:** AI assistant can retrieve a change intelligence score for a symbol -- a composite of cyclomatic complexity and change frequency

### Anti-Pattern Memory

- **FR14:** The system parses git history to detect revert commits and associates revert rationale with the affected symbols
- **FR15:** The system surfaces anti-pattern warnings when a symbol with revert history is queried via `get_why_context`
- **FR16:** Anti-pattern warnings persist in the committed index and are available to any developer or AI assistant after `git clone`

### Privacy & Security

- **FR17:** The system strips API keys, credentials, tokens, and private IP addresses from all MCP tool responses before delivery to the AI client
- **FR18:** The privacy masking pipeline is configurable -- developers can extend the pattern list for domain-specific sensitive identifiers
- **FR19:** The local SQLite query cache is never committed to git (enforced via `.gitignore` template generated on first run)

### Team Collaboration & Distribution

- **FR20:** Developer can commit the codebase index to git as text-based, per-file JSON artifacts
- **FR21:** The committed index is diffable in pull requests -- changes to indexed symbols are visible as line-level diffs
- **FR22:** A developer who clones a repository with a committed index gets full context immediately, without running `ctxo index`
- **FR23:** The CI system can gate pull requests on index freshness -- failing the build when source changes are not reflected in the index

### MCP Client Integration

- **FR24:** Developer can configure any MCP-compatible AI client to use Ctxo with a single JSON configuration entry
- **FR25:** Ctxo MCP server starts in the background as a subprocess and is ready to serve queries without manual startup steps
- **FR26:** All five MCP tools are callable from Claude Code, Cursor, and VS Code Copilot without client-specific configuration differences

### Language Support

- **FR27:** Developer can index and query TypeScript, JavaScript, and TSX/JSX codebases with full type-aware dependency resolution (V1)
- **FR28:** Developer can index and query Go and C# codebases with syntax-level dependency resolution (V1.5)

### Completeness Check

| Source | Covered |
|---|---|
| Logic-Slicing (Journey 1, Executive Summary) | FR8, FR9 |
| Blast radius (Journey 3) | FR10 |
| Architectural overlay (Journey 3) | FR11 |
| Why context + anti-pattern memory (Journey 3, Brief) | FR12, FR14, FR15, FR16 |
| Change intelligence (Brief) | FR13 |
| Privacy masking (Brief, Success Criteria) | FR17, FR18 |
| Committed index / team asset (Journey 2, Innovation) | FR20, FR21, FR22 |
| CI gate (Journey 2, Scoping) | FR4, FR23 |
| Stale index recovery (Journey 4) | FR6 |
| File watcher (Journey 4) | FR3 |
| MCP client config (Project-Type) | FR24, FR25, FR26 |
| Language matrix (Project-Type) | FR27, FR28 |
| Index management / monorepo | FR1, FR2, FR5, FR7 |
| `.gitignore` cache separation | FR19 |

---

## Step 10: Non-Functional Requirements

18 non-functional requirements across 4 categories. Scalability and accessibility were skipped (single-machine CLI tool with no visual UI).

### Performance

- **NFR1:** MCP tool responses (all five tools) complete in < 500ms p95 on a warm index for a TypeScript codebase of 1,000 files or fewer
- **NFR2:** MCP server process starts and is ready to accept connections in < 100ms (measured from process spawn to first tool response readiness)
- **NFR3:** Full initial index build completes in 30s or less for a 1,000-file codebase on a modern developer machine (MacBook M-series or equivalent)
- **NFR4:** Incremental re-indexing for a single changed file completes in < 2s
- **NFR5:** Logic-Slice responses at L1 depth are 150 lines or fewer; L4 depth responses stay within an 8,000-token budget to avoid exhausting AI context windows
- **NFR6:** Index size for a 1,000-file TypeScript codebase does not exceed 10MB on disk

### Security & Privacy

- **NFR7:** No source code, symbol names, or index content is transmitted to any remote server -- all processing is strictly local
- **NFR8:** The privacy masking pipeline detects and redacts: AWS/GCP/Azure credential patterns, JWT tokens, private IPv4/IPv6 addresses, common `.env` variable patterns (e.g. `*_SECRET`, `*_KEY`, `*_TOKEN`, `*_PASSWORD`)
- **NFR9:** The SQLite query cache (`.ctxo/cache/`) contains no plaintext source code -- only derived query results
- **NFR10:** Ctxo process runs with no elevated privileges; does not require sudo or admin rights

### Reliability

- **NFR11:** Index staleness (source file modified after last index build) is detected and reported within the MCP tool response -- never silently served as fresh
- **NFR12:** A crashed or stopped file watcher does not corrupt the committed index; on restart, the watcher re-validates index state before resuming
- **NFR13:** If the SQLite cache is deleted or corrupted, Ctxo rebuilds it from the committed JSON index without user intervention
- **NFR14:** `npx ctxo index --check` exits with a non-zero code when any source file has been modified after the index was last built (enabling reliable CI gating)

### Integration

- **NFR15:** Ctxo implements the MCP specification (current stable version at V1 ship date) without extensions or deviations that break compatibility with conformant MCP clients
- **NFR16:** All five MCP tools are tested for functional equivalence across Claude Code, Cursor, and VS Code Copilot before V1 release
- **NFR17:** The MCP server exposes a `tools/list` response conformant with the MCP spec so AI clients can discover available tools without documentation
- **NFR18:** Ctxo requires only Node.js >= 18 and `git` as runtime dependencies -- no additional system installation required

---

## Step 11: Polish & Testing Strategy

### Polish Changes Made

- Merged "Project Classification" into Executive Summary as a subsection
- Consolidated "Product Scope" (brief) and "Project Scoping & Phased Development" (detailed) -- removed duplication, kept the clear V1/V1.5/V2 scope overview + renamed detailed section to "Development Roadmap & Risk"
- Merged Innovation "Risk Mitigation" into the single Roadmap & Risk section
- Renamed "Implementation Considerations" to "Technical Context" (more accurate label)
- Tightened Journey 2 prose (removed redundant setup sentence)
- Removed the Journey Requirements Summary caption header (table is self-explanatory)
- Minor anti-pattern cleanup throughout

### Testing Strategy (added per user request)

Five layers of testing were added to the PRD:

**Unit Tests:**
- **Scope:** Pure domain logic -- AST parsing, dependency graph resolution, blast radius calculation, git commit parsing, privacy masking pattern matching, change intelligence scoring
- **Approach:** `vitest` with in-memory fixtures; no filesystem or git access. Each module tested in isolation against TypeScript/JavaScript AST samples as fixture data.
- **Coverage target:** >= 90% line coverage on core domain modules (`logic-slice`, `blast-radius`, `why-context`, `change-intelligence`, `privacy-masker`)
- **Key cases:** Circular dependency graphs, symbols with no git history, files with zero revert commits, symbols exceeding L4 depth budget, privacy patterns at token boundaries

**Integration Tests:**
- **Scope:** MCP tool handlers end-to-end through the full pipeline -- index read, query, privacy masking, MCP response -- using `@modelcontextprotocol/sdk` `InMemoryTransport` (no real MCP client required)
- **Approach:** Real filesystem fixtures (committed TypeScript sample projects of known structure); SQLite cache rebuilt from fixture index on each test run
- **Key cases:** All five tools return well-formed MCP responses; stale index warning appears when fixture file is touched after index build; `get_why_context` surfaces revert warning for fixture commits containing "Revert"

**E2E Tests:**
- **Scope:** Full `npx ctxo` CLI -- index build, incremental re-index, `--check` exit codes, file watcher trigger
- **Approach:** Real TypeScript fixture projects on disk; CI runs on macOS and Linux (Node.js 18, 20, 22)
- **Key cases:** Index build on clean project produces valid manifest; `--check` exits non-zero after source file modification; incremental re-index updates only the changed file's JSON; `ctxo watch` detects a save and re-indexes within 2s

**MCP Client Compatibility Tests:**
- **Scope:** Verify all five tools are callable and return valid responses from Claude Code, Cursor, and VS Code Copilot
- **Approach:** Manual smoke test protocol run against a reference TypeScript project before each V1 release; automated where client SDKs expose a testable interface
- **Gate:** All three clients must pass smoke tests before V1 release tag is cut (maps to NFR16)

**Privacy Masking Validation:**
- **Scope:** Dedicated test fixture set containing known credential patterns (synthetic, non-real) -- AWS keys, JWTs, `.env` patterns, private IPs
- **Approach:** Assert zero leakage: run each pattern through all five tool outputs and verify masking pipeline redacts 100% of fixture sensitive strings before MCP response
- **Gate:** Any new credential pattern added to the masking pipeline requires a corresponding fixture test (maps to FR17, FR18, NFR8)

---

## Step 12: PRD Complete

The PRD for Ctxo is complete at `artifacts/planning-artifacts/prd.md`.

### Final Status

| Section | Status |
|---|---|
| Executive Summary + Classification | Done |
| Success Criteria | Done |
| Product Scope (V1 / V1.5 / V2+) | Done |
| User Journeys (4 narratives + requirements map) | Done |
| Innovation & Novel Patterns | Done |
| Developer Tool Specific Requirements | Done |
| Development Roadmap & Risk | Done |
| Functional Requirements (FR1-FR28) | Done |
| Non-Functional Requirements (NFR1-NFR18) | Done |
| Testing Strategy (5 layers) | Done |

28 FRs, 18 NFRs, 5 testing layers -- fully traced from vision through capability contract.

### Recommended Next Steps

- **Check Implementation Readiness** (`/bmad-check-implementation-readiness`) -- validates PRD completeness before architecture and epic work begins.
- **Create Architecture** (`/bmad-agent-architect`) -- Winston can now work from a full PRD.
- **Create Epics & Stories** (`/bmad-create-epics-and-stories`) -- if going straight to implementation breakdown.

The PRD is the foundation -- all design, architecture, and development work should trace back to it. Update it as decisions evolve.
