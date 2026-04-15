# CLAUDE.md — Ctxo

## Project Overview

Ctxo is a **Model Context Protocol (MCP) server** that gives AI coding assistants dependency-aware, history-enriched context for codebases. It delivers "Logic-Slices" — a symbol plus all transitive dependencies, git intent, anti-pattern warnings, and change health scores — in under 500ms.

* **Type:** npm package / CLI tool / MCP server (stdio transport)
* **Author:** Alper Hankendi
* **Status:** v0.7.0-alpha.0 — 14 MCP tools, pnpm monorepo with 5 packages, 987+ tests
* **Language:** TypeScript (ESM-first, `"type": "module"`)
* **Runtime:** Node.js >= 20

## Quick Reference

```Shell
# Dev (pnpm workspace)
pnpm --filter @ctxo/cli dev       # zero-build dev run
pnpm -r build                     # build all packages
pnpm -r test                      # run tests across workspace (987+ tests)
pnpm -r typecheck                 # typecheck all packages
pnpm --filter @ctxo/cli test:unit # unit tests only
pnpm --filter @ctxo/cli test:e2e  # end-to-end tests
pnpm --filter @ctxo/cli build     # build CLI package to dist/

# Usage (consumer)
npx ctxo install                     # install language plugins (interactive)
npx ctxo install typescript go --yes # non-interactive install of specific plugins
npx ctxo install --dry-run --pm pnpm # preview install plan with chosen pm
npx ctxo index                       # build codebase index
npx ctxo index --install-missing     # auto-install detected plugins, then index
npx ctxo index --check               # CI gate: fail if index stale
npx ctxo index --skip-history        # fast re-index without git history
npx ctxo index --max-history 5       # limit commit history per file
npx ctxo watch                       # file watcher for incremental re-index
npx ctxo sync                        # rebuild SQLite from committed JSON
npx ctxo init                        # install git hooks + language detection/install prompt
npx ctxo init --no-install           # init without plugin install prompt
npx ctxo status                      # show index manifest
npx ctxo doctor                      # health check all subsystems (--json, --quiet)
npx ctxo doctor --fix                # dependency-ordered remediation (--dry-run, --yes)
npx ctxo version                     # verbose version report (default)
npx ctxo --version --verbose         # version + installed plugins list
npx ctxo --version --json            # machine-readable version report
npx ctxo visualize                   # generate interactive dependency graph HTML
npx ctxo visualize --max-nodes 200   # limit to top 200 symbols by PageRank
npx ctxo visualize --no-browser      # skip auto-opening browser

# Environment
DEBUG=ctxo:*                  # enable all debug output
DEBUG=ctxo:git,ctxo:storage   # enable specific namespaces
CTXO_RESPONSE_LIMIT=16384     # response truncation threshold (default 8192)
```

## Architecture

**pnpm monorepo + Hexagonal (Ports & Adapters)** — strict dependency direction inside `@ctxo/cli`:

```
packages/
├── cli/              @ctxo/cli             # primary CLI + MCP server (composition root)
├── plugin-api/       @ctxo/plugin-api      # plugin protocol v1 types (no runtime deps on cli)
├── lang-typescript/  @ctxo/lang-typescript # ts-morph, full tier
├── lang-go/          @ctxo/lang-go         # tree-sitter Go
└── lang-csharp/      @ctxo/lang-csharp     # Roslyn + tree-sitter + tools/ctxo-roslyn
```

### Key Rules

* **Hexagonal boundaries hold inside** **`@ctxo/cli`:**
  * **`core/`** **NEVER imports from** **`adapters/`** — pure domain logic only
  * **`core/`** **NEVER imports from** **`ports/`** — ports import from core types
  * **`ports/`** **NEVER imports from** **`adapters/`**
  * **`adapters/mcp/`** **may import from** **`core/`** **and** **`ports/`** **only**
  * **Composition root (`packages/cli/src/index.ts`)** is the ONLY file that wires adapters to ports
* **Plugins (`@ctxo/lang-*`) import only from** **`@ctxo/plugin-api`; never from** **`@ctxo/cli`.**
* **No barrel exports** (`index.ts` re-exports) — import directly from source file path
* **Port-first rule:** every adapter MUST implement a port interface

### Project Structure (inside `packages/cli/`)

```
packages/cli/src/
  index.ts                     # composition root + StdioServerTransport
  ports/                       # interfaces only (ILanguageAdapter, IStoragePort, IGitPort, IMaskingPort)
  core/                        # pure domain (graph, logic-slice, blast-radius, overlay, why-context, change-intelligence, masking, detail-levels)
    detection/detect-languages.ts
    install/package-manager.ts
  adapters/
    language/                  # plugin loader facade (ts-morph/Go/C# live in sibling packages)
      plugin-discovery.ts      # scans project package.json for @ctxo/lang-*, ctxo-lang-*
    storage/                   # SQLite cache + JSON index read/write
    git/                       # simple-git wrapper
    watcher/                   # chokidar file watcher
    workspace/single-package-workspace.ts
    diagnostics/checks/        # config, disk, git, index, runtime, storage,
                               # versions-check.ts, language-coverage-check.ts
    mcp/                       # MCP tool handlers (14 tools)
  cli/                         # index, init, sync, status, verify, watch, visualize,
                               # version-command.ts, install-command.ts,
                               # plugin-loader.ts, doctor-fix.ts
```

### Storage (ADR-STORAGE-01)

```
.ctxo/
  config.yaml                  # committed (team settings)
  index/                       # committed (per-file JSON, one per source file)
  .cache/                      # gitignored (local SQLite, rebuilt from index/)
```

#### `.ctxo/config.yaml` schema

Optional fields — all have sensible defaults.

```YAML
version: "1.0"
stats:
  enabled: true                # opt-out of session recording (default true)
index:
  ignore:                      # globs applied AFTER git ls-files (per-file filter)
    - "packages/**/fixtures/**"
    - "tools/legacy-*/**"
  ignoreProjects:              # globs applied to workspace roots (skip discovery)
    - "packages/experimental-*"
    - "examples/*"
```

* `index.ignore`: per-file picomatch globs, matched against repo-relative forward-slash paths.
* `index.ignoreProjects`: matched against workspace paths; skipped workspaces are never enumerated and their plugin deps are never imported.
* Invalid globs surface as warnings via `ctxo doctor`; schema violations surface as fails. The loader falls back to defaults on any error (warn-and-continue).

## Naming Conventions

| Context           | Convention           | Example                                          |
| ----------------- | -------------------- | ------------------------------------------------ |
| TypeScript types  | PascalCase           | `SymbolNode`, `GraphEdge`                        |
| Port interfaces   | IPascalCase          | `IStoragePort`, `ILanguageAdapter`               |
| Adapter classes   | PascalCase + Adapter | `SqliteStorageAdapter`, `TsMorphAdapter`         |
| Files             | kebab-case           | `sqlite-storage-adapter.ts`, `i-storage-port.ts` |
| SQLite columns    | snake\_case          | `symbol_id`, `file_path`, `edge_kind`            |
| JSON index fields | camelCase            | `lastModified`, `symbolId`, `antiPatterns`       |
| CLI commands      | kebab-case           | `ctxo index`, `ctxo verify-index`                |
| Symbol IDs        | deterministic        | `"<relativeFile>::<name>::<kind>"`               |

## Plugin Architecture

Language support ships as separate plugin packages discovered at runtime by scanning the consumer project's `package.json` for `@ctxo/lang-*` and `ctxo-lang-*` names. Each plugin implements the protocol v1 contract exported by `@ctxo/plugin-api` (a stable surface with zero runtime dependencies on `@ctxo/cli`). Users opt into languages by adding plugin packages to devDependencies (or running `ctxo install`); `ctxo doctor` surfaces missing plugins and `ctxo index --install-missing` auto-installs them. See [ADR-012](docs/architecture/ADR/adr-012-plugin-architecture-and-monorepo.md).

```JSON
// consumer project package.json
{
  "devDependencies": {
    "@ctxo/cli": "^0.7.0-alpha.0",
    "@ctxo/lang-typescript": "^0.7.0-alpha.0",
    "@ctxo/lang-go": "^0.7.0-alpha.0",
    "@ctxo/lang-csharp": "^0.7.0-alpha.0"
  }
}
```

## MCP Tools (14 total)

| Tool                        | Purpose                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `get_logic_slice`           | Symbol + transitive deps (L1-L4 progressive detail)                                                        |
| `get_blast_radius`          | Impact score + affected symbols (3-tier: confirmed/likely/potential)                                       |
| `get_architectural_overlay` | Project layer map (Domain/Infra/Adapters)                                                                  |
| `get_why_context`           | Git commit intent + anti-pattern warnings                                                                  |
| `get_change_intelligence`   | Complexity x churn composite score                                                                         |
| `find_dead_code`            | Unreachable symbols and files                                                                              |
| `get_context_for_task`      | Task-aware context (fix/extend/refactor/understand)                                                        |
| `get_ranked_context`        | Two-phase BM25 search (camelCase-aware, trigram fallback, fuzzy correction) + PageRank within token budget |
| `search_symbols`            | Symbol name/regex search across index (supports `mode: 'fts'` for BM25 search)                             |
| `get_changed_symbols`       | Symbols in recently changed files (git diff)                                                               |
| `find_importers`            | Reverse dependency lookup ("who uses this?")                                                               |
| `get_class_hierarchy`       | Class inheritance tree (ancestors + descendants)                                                           |
| `get_symbol_importance`     | PageRank centrality ranking                                                                                |
| `get_pr_impact`             | Full PR risk assessment (changes + blast radius + co-changes)                                              |

### Tool Selection Guide — When to Use Which Tool

```
Reviewing a PR or recent changes?
  → get_pr_impact (single call, full risk assessment)

About to modify a function or class?
  → get_blast_radius (what breaks if I change this?)
  → then get_why_context (any history of problems?)

Need to understand what a symbol does?
  → get_context_for_task(taskType: "understand")
  → or get_logic_slice (L2 for overview, L3 for full closure)

Fixing a bug?
  → get_context_for_task(taskType: "fix")
    (includes history, anti-patterns, and deps)

Adding a feature / extending code?
  → get_context_for_task(taskType: "extend")
    (includes deps and blast radius)

Refactoring?
  → get_context_for_task(taskType: "refactor")
    (includes importers, complexity, and churn)

Don't know the symbol name?
  → search_symbols (by name/regex)
  → get_ranked_context (by natural language query)

Onboarding to a new codebase?
  → get_architectural_overlay (layer map)
  → get_symbol_importance (most critical symbols)

Cleaning up code?
  → find_dead_code (unused symbols)
  → get_change_intelligence (complexity hotspots)

Checking if safe to delete/rename?
  → find_importers (who depends on this?)
  → get_blast_radius (full impact)

Working with class hierarchies?
  → get_class_hierarchy (extends/implements tree)
```

### MCP Tool Response Format (all tools)

```TypeScript
// Success — all responses include _meta with item counts and truncation info
{ content: [{ type: 'text', text: JSON.stringify({ ...payload, _meta: { totalItems, returnedItems, truncated, totalBytes, hint? } }) }] }
// Graceful miss
{ content: [{ type: 'text', text: JSON.stringify({ found: false, hint: '...' }) }] }
// Error — NEVER throw from tool handlers
{ content: [{ type: 'text', text: JSON.stringify({ error: true, message: '...' }) }] }
```

### MCP Resources

| Resource      | URI             | Purpose                                                               |
| ------------- | --------------- | --------------------------------------------------------------------- |
| `ctxo-status` | `ctxo://status` | Health check — prevents `-32601` from clients calling `listResources` |

### Cross-Cutting Features

* **Response envelope (`_meta`):** All tool responses include `_meta: { totalItems, returnedItems, truncated, totalBytes }`. Large responses auto-truncated at 8KB (configurable via `CTXO_RESPONSE_LIMIT` env).
* **Intent filtering:** `get_blast_radius`, `get_logic_slice`, `find_importers`, `find_dead_code` accept optional `intent` parameter for keyword-based result filtering.
* **Tool annotations:** All 14 tools declare `readOnlyHint`, `idempotentHint`, `openWorldHint` annotations for MCP clients.

## AI Assistant Rules (MCP Tool Usage — MANDATORY)

**ALWAYS use ctxo MCP tools before reading source files or making code changes.** The ctxo index contains dependency graphs, git intent, anti-patterns, and change health that cannot be derived from reading files alone. Skipping these tools leads to blind edits and broken dependencies.

### Before ANY Code Modification

1. Call `get_blast_radius` for the symbol you are about to change — understand what breaks
2. Call `get_why_context` for the same symbol — check for revert history or anti-patterns
3. Only then read and edit source files

### Before Starting a Task

| Task Type                  | REQUIRED First Call                            |
| -------------------------- | ---------------------------------------------- |
| Fixing a bug               | `get_context_for_task(taskType: "fix")`        |
| Adding/extending a feature | `get_context_for_task(taskType: "extend")`     |
| Refactoring                | `get_context_for_task(taskType: "refactor")`   |
| Understanding code         | `get_context_for_task(taskType: "understand")` |

### Before Reviewing a PR or Diff

* Call `get_pr_impact` — single call gives full risk assessment with co-change analysis

### When Exploring or Searching Code

* Use `search_symbols` for name/regex lookup — DO NOT grep source files for symbol discovery
* Use `get_ranked_context` for natural language queries — DO NOT manually browse directories

### Orientation in Unfamiliar Areas

* Call `get_architectural_overlay` to understand layer boundaries
* Call `get_symbol_importance` to identify critical symbols

### NEVER Do These

* NEVER edit a function without first calling `get_blast_radius` on it
* NEVER skip `get_why_context` — reverted code and anti-patterns are invisible without it
* NEVER grep source files to find symbols when `search_symbols` exists
* NEVER manually trace imports when `find_importers` gives the full reverse dependency graph

## Critical Rules

1. **NEVER use** **`console.log`** — MCP stdio uses stdout for JSON-RPC. Use `createLogger('ctxo:namespace')` from `packages/cli/src/core/logger.ts`. Extracted plugins bundle their own minimal logger (e.g. `packages/lang-csharp/src/logger.ts`) to avoid a runtime dep on `@ctxo/cli`. Debug output controlled via `DEBUG=ctxo:*` env.
2. **Error handling: warn-and-continue** — adapter boundary catches errors and returns fallback values. Core may throw.
3. **All MCP responses pass through masking pipeline** before delivery.
4. **Tests co-located** in `__tests__/` adjacent to source files.
5. **Testing framework:** `vitest` with `InMemoryTransport` for MCP integration tests.

## Error Handling Pattern

```TypeScript
// All adapter methods use createLogger:
import { createLogger } from '../../core/logger.js';
const log = createLogger('ctxo:adapterName');

try {
  return await doWork()
} catch (err) {
  log.error(`${(err as Error).message}`)
  return fallbackValue
}
```

| Failure                           | Behavior                                   |
| --------------------------------- | ------------------------------------------ |
| Parser throws on file             | Skip file, log stderr, mark `unindexed`    |
| git not found                     | intent/antiPatterns return `[]`            |
| SQLite corrupt                    | Delete and rebuild from JSON index         |
| Symbol not in index               | `{ found: false, hint: "run ctxo index" }` |
| ctxo-go-analyzer / Roslyn missing | Graceful degradation to tree-sitter        |

## Tech Stack

| Component         | Technology                                                |
| ----------------- | --------------------------------------------------------- |
| Language          | TypeScript 5.x (ESM, strict)                              |
| Build             | tsup (esbuild), `external: [better-sqlite3, tree-sitter]` |
| MCP SDK           | `@modelcontextprotocol/sdk`                               |
| TS/JS Parser      | ts-morph (full tier)                                      |
| Multi-lang Parser | tree-sitter + tree-sitter-language-pack (V1.5)            |
| Database          | sql.js (WASM SQLite)                                      |
| Git               | simple-git                                                |
| File Watcher      | chokidar                                                  |
| Validation        | zod                                                       |
| Testing           | vitest + @vitest/coverage-v8                              |
| Dev Runner        | tsx                                                       |
| Monorepo          | pnpm workspaces + changesets                              |

## Index JSON Schema (strict contract)

```JSON
{
  "file": "relative/path.ts",
  "lastModified": 1711620000,
  "symbols": [{ "symbolId": "packages/cli/src/foo.ts::myFn::function", "name": "myFn", "kind": "function", "startLine": 12, "endLine": 45 }],
  "edges": [{ "from": "packages/cli/src/foo.ts::myFn::function", "to": "packages/cli/src/bar.ts::TokenValidator::class", "kind": "imports" }],
  "intent": [{ "hash": "abc123", "message": "fix race condition", "date": "2024-03-15", "kind": "commit" }],
  "antiPatterns": [{ "hash": "def456", "message": "revert: remove mutex", "date": "2024-02-01" }]
}
```

* Valid symbol kinds: `function | class | interface | method | variable | type`
* Valid edge kinds: `imports | calls | extends | implements | uses`

## Release & npm Publishing

Driven by **changesets** + `.github/workflows/release.yml`. Per-package: only packages listed in a changeset get bumped and published.

**Flow:**
1. `pnpm changeset` → pick affected packages + bump type (patch/minor/major), write description (this becomes the release note)
2. Commit the `.changeset/*.md` file, push to master
3. Bot opens "chore(release): version packages" PR with proposed bumps + CHANGELOG diffs
4. Merge that PR → workflow publishes to npm + creates umbrella GitHub Release

**Workflow guarantees** (in order): NPM_TOKEN check → install → build → typecheck → test → `changeset publish` → dist-tag fix (prereleases moved to `alpha`/`beta`/`rc`/`next` channel, `latest` re-pinned to highest stable) → umbrella GitHub Release with Compatible Set matrix.

**GitHub Releases:** one umbrella release per publish run, tag = `v<cli-version>` (or highest plugin version if CLI not bumped, with `— Plugin Release` suffix). Per-package releases are disabled. Alpha/beta/rc/next versions auto-marked `--prerelease`.

**Manual repair:** `dist-tag-repair.yml` workflow_dispatch fixes npm dist-tags if `latest` gets clobbered (has `dry_run` input).

**Don't:** bypass changesets with manual `npm publish` (skips test gate, provenance, CHANGELOG, GitHub Release). If you need a single-package release, just create a changeset listing only that package.

## Roadmap & TODO

Open work and deferred/rejected decisions live in **[docs/roadmap.md](docs/roadmap.md)** (single source of truth). Shipped work is in [CHANGELOG.md](CHANGELOG.md) and [docs/artifacts/prd.md § Delivered Phases](docs/artifacts/prd.md#delivered-phases-post-v1). Per-story delivery status: [docs/artifacts/epics.md § Delivery Status](docs/artifacts/epics.md#delivery-status-as-of-2026-04-13).

## Documentation

Start at **[docs/index.md](docs/index.md)** — single entry point listing all active docs. Historical content (walkthroughs, old validation results, BMad sessions, consolidated phase PRDs) is preserved in [docs/archive/](docs/archive/README.md).

Frequently needed:

* [Project Idea](docs/Project-Idea.md) — vision and feature overview
* [PRD](docs/artifacts/prd.md) — product requirements + delivered phases
* [Roadmap](docs/roadmap.md) — open work, deferred, rejected
* [Architecture](docs/artifacts/architecture.md) — hexagonal layout + tech stack
* [Epics](docs/artifacts/epics.md) — 8 epics × 38 stories + delivery status
* [Agentic AI Integration](docs/agentic-ai-integration.md) — Claude Agent SDK, OpenAI Agents SDK, LangChain, raw MCP client usage
* [Changelog](CHANGELOG.md) — version history
* [MCP Validation Runbook](docs/runbook/mcp-validation/mcp-validation.md) — end-to-end validation
* [llms.txt](llms.txt) / [llms-full.txt](llms-full.txt) — LLM-friendly project documentation

<!-- ctxo-rules-start -->

## ctxo MCP Tool Usage (MANDATORY)

**ALWAYS use ctxo MCP tools before reading source files or making code changes.** The ctxo index contains dependency graphs, git intent, anti-patterns, and change health that cannot be derived from reading files alone. Skipping these tools leads to blind edits and broken dependencies.

### Before ANY Code Modification

1. Call `get_blast_radius` for the symbol you are about to change — understand what breaks
2. Call `get_why_context` for the same symbol — check for revert history or anti-patterns
3. Only then read and edit source files

### Before Starting a Task

| Task Type                  | REQUIRED First Call                            |
| -------------------------- | ---------------------------------------------- |
| Fixing a bug               | `get_context_for_task(taskType: "fix")`        |
| Adding/extending a feature | `get_context_for_task(taskType: "extend")`     |
| Refactoring                | `get_context_for_task(taskType: "refactor")`   |
| Understanding code         | `get_context_for_task(taskType: "understand")` |

### Before Reviewing a PR or Diff

* Call `get_pr_impact` — single call gives full risk assessment with co-change analysis

### When Exploring or Searching Code

* Use `search_symbols` for name/regex lookup — DO NOT grep source files for symbol discovery
* Use `get_ranked_context` for natural language queries — DO NOT manually browse directories

### Orientation in Unfamiliar Areas

* Call `get_architectural_overlay` to understand layer boundaries
* Call `get_symbol_importance` to identify critical symbols

### NEVER Do These

* NEVER edit a function without first calling `get_blast_radius` on it
* NEVER skip `get_why_context` — reverted code and anti-patterns are invisible without it
* NEVER grep source files to find symbols when `search_symbols` exists
* NEVER manually trace imports when `find_importers` gives the full reverse dependency graph

<!-- ctxo-rules-end -->
