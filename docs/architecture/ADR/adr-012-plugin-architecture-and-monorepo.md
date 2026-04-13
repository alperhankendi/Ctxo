# ADR-012: Plugin Architecture and Monorepo Restructure

| Field | Value |
|---|---|
| **Status** | Accepted (v0.7.0 — planning) |
| **Date** | 2026-04-13 |
| **Deciders** | Alper Hankendi |
| **Decision** | Extract language adapters into independent npm packages discovered at runtime via a stable plugin protocol; restructure repo as a pnpm monorepo; rename primary package from `ctxo-mcp` to `@ctxo/cli` |
| **Relates to** | [PRD: Plugin Architecture & Language Expansion](../../artifacts/prd-plugin-architecture-and-language-expansion.md), [PRD: Monorepo Workspace Support](../../artifacts/prd-monorepo-workspace-support.md) |
| **Supersedes** | Bundled-adapter model established implicitly in v0.1–v0.6 |

---

## Context

Ctxo v0.6.x ships as a single `ctxo-mcp` npm package that contains core logic, MCP server, CLI, and all three language adapters (TypeScript via ts-morph, Go via tree-sitter, C# via Roslyn launcher). This model was correct for bootstrapping — fewer moving parts, single publish pipeline, no protocol coordination — but it has reached its scaling limit.

### Forces

Four concrete pressures drove this decision:

1. **Tarball and dependency bloat.** Each new language adds 0.8–1.5 MB of tree-sitter grammar plus native binaries to the base package. Adding Python and Java would push the base tarball ~3 MB higher. Users who only analyze Python would still download Go and C# grammars.

2. **Peer-dependency coupling.** All adapters share the same `tree-sitter` peer version. A single grammar maintainer bumping to `tree-sitter@0.25` blocks every other language from upgrading. The v0.7 Python/Java plan hit this ceiling immediately: both grammars' `0.25.x` lines required breaking core.

3. **Community extensibility.** No path exists for an external developer to add Kotlin, Rust, or Ruby support without upstreaming into the Ctxo repo. Every new language becomes core-team maintenance burden.

4. **Asymmetric coverage for mixed-language projects.** Django + React or Spring Boot + Angular monorepos get TypeScript analysis but silent zero-output for backend files. Users believe ctxo is working; it is not.

### Market Signal

Python and Java are the two largest backend ecosystems ctxo does not cover. Combined they represent roughly 40% of GitHub traffic. Competitive tools (Cody, Cursor's built-in indexer, GitHub CodeSearch) treat them as table stakes. Continuing the bundled model means accepting that ctxo is structurally unsuitable for a large fraction of its potential market.

---

## Decision

Adopt a **plugin architecture** with the following structural commitments.

### 1. Monorepo with pnpm Workspaces

All packages live in `packages/*` inside the existing `Ctxo` repo. Workspace managed by pnpm; release orchestrated by `changesets`. No Turbo or Nx initially — added when build times justify them.

```
Ctxo/
├── packages/
│   ├── cli/             # @ctxo/cli (primary)
│   ├── plugin-api/      # @ctxo/plugin-api (contracts)
│   ├── lang-typescript/ # @ctxo/lang-typescript
│   ├── lang-go/         # @ctxo/lang-go
│   ├── lang-csharp/     # @ctxo/lang-csharp
│   ├── lang-python/     # @ctxo/lang-python (Phase B)
│   └── lang-java/       # @ctxo/lang-java (Phase B)
```

### 2. Package Naming

- **`@ctxo/cli`** — primary CLI + MCP server. Ships a `ctxo` bin so user-facing invocation remains `ctxo init`, `ctxo index`, etc.
- **`@ctxo/plugin-api`** — shared plugin protocol contracts.
- **`@ctxo/lang-<id>`** — official language plugins (`@ctxo/lang-typescript`, `@ctxo/lang-python`, etc.).
- **`ctxo-lang-*`** — unscoped convention for community plugins outside the Ctxo organization.

The original intent was to claim the unscoped `ctxo` package name for `npx ctxo` zero-install ergonomics. On 2026-04-13 during placeholder publish, npm's typosquatting filter rejected the name due to similarity with existing packages `co`, `xo`, `cpx`, and `csso` — the 404 returned by `npm view ctxo` reflected absence of the package, not publishability. The scoped `@ctxo/cli` was chosen as the replacement because:

- The `@ctxo` organization is already owned; scoped publishing is unblocked.
- Pattern aligns with `@angular/cli`, `@vue/cli`, `@nestjs/cli`, `@stencil/cli` — established convention for scoped CLI tools.
- Because `@ctxo/cli` has a single bin entry (`ctxo`), `npx @ctxo/cli <args>` runs that bin regardless of name. Zero-install ergonomics are preserved (`npx @ctxo/cli init` works identically to the never-reachable `npx ctxo init`).
- After global install, the user experience is unchanged — the `ctxo` command runs directly.

An `@ctxo/core` alternative was considered but rejected: `core` conventionally implies an importable library package with satellites (`@angular/core` + `@angular/cli`), which misrepresents Ctxo's single-tool-with-plugins shape. `@ctxo/cli` signals user intent ("install the CLI to use the tool") correctly.

### 3. Plugin Protocol v1

`@ctxo/plugin-api` exports the stable contract. Plugins declare `apiVersion: '1'`; future breaking changes bump to `'2'` with a ≥12-month backward-compatible window in core.

```typescript
export interface CtxoLanguagePlugin {
  readonly apiVersion: '1';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly extensions: readonly string[];
  readonly tier: 'syntax' | 'full';
  createAdapter(ctx: PluginContext): ILanguageAdapter;
}
```

Core (`@ctxo/cli`) loads plugins via duck-typing against this shape; `@ctxo/plugin-api` is a types-only dependency for plugins at runtime.

### 4. Plugin Discovery

Default: scan project `package.json` (plus `devDependencies` and `peerDependencies`) for packages matching `@ctxo/lang-*` or `ctxo-lang-*`; dynamic `import()` each. Explicit override via `.ctxo/config.yaml#languages.plugins` for local-path plugins and CI determinism.

Discovery accepts a manifest path argument (not hardcoded to `cwd/package.json`) so the deferred Monorepo Workspace PRD can aggregate across packages without core changes.

### 5. Backward Compatibility Declined

`ctxo-mcp@0.6.6` stays on npm as-is and receives a deprecation message directing users to `@ctxo/cli`. No meta-package wrapper, no dependency shim. Users running `npm install ctxo-mcp` see the deprecation notice and migrate manually. This is a clean break accepted because v0.7 is pre-production (v0.x) and the maintenance cost of a wrapper outweighs the migration friction for the current user base.

### 6. Two-Phase Delivery

**Phase A (v0.7.0):** Monorepo migration + extract existing adapters (TS/Go/C#) as plugins + plugin protocol infrastructure + auto-install UX (`ctxo init`, `ctxo install`, `ctxo doctor --fix`) + version visibility. No new language support.

**Phase B (v0.7.x):** Python and Java plugins built on the validated protocol.

Phase A deliberately ships with zero new language support so that the plugin protocol is validated by known-good adapter code before Python/Java consume it. If the protocol has a design flaw, it surfaces while the problem surface is narrow.

### 7. Release Strategy

Independent per-package versioning (changesets `linked: []`). All packages start at `0.7.0` so users have a consistent origin version. Release PR and `npm publish` are manual for v0.7; automation deferred to v0.8. `latest` and `next` dist-tags only; no canary channel.

---

## Alternatives Considered

### Alternative A: Keep Bundled, Add Python/Java as Dependencies

Simplest incremental change: add `tree-sitter-python` and `tree-sitter-java` to core's dependencies, bump tarball size, ship.

**Rejected because:** solves the immediate feature gap but none of the four forces. Tarball grows ~3 MB. Peer-dependency coupling gets worse (six grammars instead of four). Community still cannot contribute Kotlin or Ruby. Hits the same ceiling again when the next language request arrives.

### Alternative B: Move Grammars to `optionalDependencies` with Lazy Load

Plugins stay inside core's codebase; grammars declared as `optionalDependencies` and loaded dynamically when matching files are seen.

**Rejected because:** solves tarball size but leaves the code monolithic. Community extensibility unchanged — contributor still needs to upstream Kotlin into core. Peer-dependency coupling partially mitigated but grammar versions remain core-controlled. Version skew between grammar and language-specific core logic becomes harder to manage.

### Alternative C: Per-Language Standalone MCP Servers

Publish `ctxo-mcp-python`, `ctxo-mcp-java` as independent MCP servers. Clients add each to `.mcp.json`; each server owns its index and tool surface.

**Rejected because:** catastrophic for ctxo's value proposition. Cross-language blast radius (the `shared/` library imported by Python service and TypeScript frontend) requires a unified graph. Per-server index fragments the graph across processes. Tool namespace triples (`ctxo_python_get_blast_radius`, `ctxo_java_get_blast_radius`...). MCP server startup overhead multiplies. PageRank and co-change analysis bifurcate per language. Even operationally: three `.mcp.json` entries, three `ctxo index` runs, three sets of git hooks.

### Alternative D: On-Demand Binary Download (Roslyn Pattern for All Languages)

First `ctxo index` downloads grammars from a CDN per platform, cached under `.ctxo/.cache/grammars/`. Core ships with zero grammar binaries.

**Rejected because:** operationally expensive (CDN, checksum infrastructure, supply-chain audit), breaks airgapped CI, duplicates what npm already solves for free. Roslyn is an exception because .NET runtime is not npm-installable; generalizing the pattern to every language would be reinventing npm for no benefit.

### Alternative E: Separate Core Repo + Plugin Repos (Multi-Repo)

Core in `Ctxo`, each language in its own GitHub repo (`github.com/alperhankendi/ctxo-lang-python`, etc.).

**Rejected because:** plugin protocol v0 will evolve rapidly. Breaking changes to `CtxoLanguagePlugin` would require coordinated PRs across N repos with version-matrix CI. Single maintainer cannot efficiently context-switch across 5+ repos. Integration testing requires fragile `npm link` chains instead of workspace-native resolution. Community plugins remain separate repos (their natural home), but core-team plugins belong together.

---

## Consequences

### Positive

1. **Base tarball stays flat** as languages are added. `@ctxo/cli@0.7.0` within ±10% of `ctxo-mcp@0.6.6` size.
2. **Peer-dependency isolation.** Each plugin owns its grammar range independently. A `tree-sitter@0.25` bump in one plugin does not block others.
3. **Community extensibility path opens.** `ctxo-lang-kotlin` can be published by any developer without upstreaming into core. Community plugin template scaffolding planned for v0.8.
4. **Synchronized-release coordination becomes optional.** Changesets lets unchanged packages stay at their current version; only packages with actual changes bump and publish.
5. **Plugin protocol enforces boundaries.** Core becomes language-agnostic. Adapter logic cannot leak into core domain code because it physically lives in a separate package.
6. **Forward-compat for monorepo workspace PRD** built in via `IWorkspace` abstraction, parameterized plugin discovery, and optional `workspace` field in MCP envelope. Workspace support lands later without core rewrite.

### Negative

1. **Monorepo migration risk.** Moving `src/` to `packages/cli/src/`, splitting `tsconfig.json`, reconfiguring CI, restructuring tests — multiple moving parts in one release. Mitigation: Phase A is dedicated to this migration; Python/Java deferred to Phase B to reduce the blast radius of any migration bug.

2. **Contributor learning curve increases.** pnpm workspaces and changesets are unfamiliar to contributors used to single-package npm projects. Mitigation: `CONTRIBUTING.md` documents common commands; pnpm workspaces are standard in modern TypeScript ecosystems (Vite, TypeScript ESLint, Biome).

3. **Plugin protocol v1 may have design flaws.** Once shipped with `apiVersion: '1'`, breaking changes require deprecation window and `apiVersion: '2'`. Mitigation: Phase A validates the protocol with three known-good adapters; protocol gets real-world exercise before Python/Java consume it.

4. **Plugin load failure mode surface expands.** Missing native binary, version mismatch, plugin throws in default export — each becomes a user-visible failure case. Mitigation: all plugin load sites wrapped in try/catch, failures logged with actionable guidance, core continues without the failed language.

5. **Plugin install UX becomes part of the product surface.** `ctxo init` auto-install, `ctxo doctor --fix`, package manager detection, lockfile-aware CI handling — all new code paths that must work across npm, pnpm, yarn, bun, and degrade gracefully when `package.json` is absent. Mitigation: explicit prompted consent by default; `--yes` and `--no-install` escape hatches; CI detection prevents silent mutations.

6. **`ctxo-mcp@0.6.6` users must migrate manually.** No backward-compat wrapper. Some users will stay on v0.6.x longer than ideal. Accepted because v0.7 is pre-production and wrapper maintenance overhead exceeds migration friction.

7. **Sustainability commitment for Tier 1 plugins.** Core team implicitly owns maintenance for `@ctxo/lang-*` packages. PRD caps Tier 1 at 8 languages; beyond that, the expectation is community plugins. Ongoing dependency updates via Renovate/Dependabot per plugin.

### Neutral

- Users who install globally (`npm i -g ctxo`) gain no plugin install benefit without additional steps — plugins still install per-project. This matches how `prettier` and `eslint` work in the wider ecosystem.
- Version-skew visibility (`ctxo --version --verbose`, `ctxo doctor`) is new user-facing output that may surprise users accustomed to a single version number, but solves real support questions ("which plugin version works with my ctxo?").

---

## Implementation Notes

- Phase A execution follows the 28-step rollout in [PRD §8.1](../../artifacts/prd-plugin-architecture-and-language-expansion.md#81-phase-a--infrastructure--extract-existing-adapters-v070). Pre-work completed 2026-04-13: `@ctxo/cli@0.0.1` and `@ctxo/plugin-api@0.0.1` placeholders published, 2FA enabled via Windows Hello security key. `packages/cli/` migration may begin.
- Plugin protocol contract changes during Phase A implementation are permitted (still Draft). Once Phase A tags as `0.7.0`, `apiVersion: '1'` is frozen and subsequent changes follow the deprecation window policy (NFR-7.2 in PRD).
- `ctxo-mcp` deprecation message: `npm deprecate ctxo-mcp "Renamed to @ctxo/cli. Install with: npm i -g @ctxo/cli"` — applied immediately after `@ctxo/cli@0.7.0` successfully publishes.

---

## Open Items Tracked Elsewhere

These remain open but are not ADR-level decisions; they are implementation details tracked in the PRD:

- Python private symbol visibility policy ([PRD §10 Q1](../../artifacts/prd-plugin-architecture-and-language-expansion.md#10-open-questions-must-resolve-before-phase-b-tag))
- Java package-private visibility policy (PRD §10 Q2)
- Java generics signature representation (PRD §10 Q3)
- Python module import resolution in syntax tier (PRD §10 Q4)
- `tree-sitter` upgrade trajectory to `0.25+` (PRD §10 Q5; separate future ADR)
- Short-name collision policy for `ctxo install <lang>` (PRD §10 Q7)

---

## Review History

| Date | Note |
|---|---|
| 2026-04-13 | Accepted. Decision captured during PRD drafting session; all architectural commitments locked before Phase A implementation begins. |
| 2026-04-13 | Primary package name changed from `ctxo` (unscoped, blocked by npm typosquatting filter — similarity to `co`, `xo`, `cpx`, `csso`) to `@ctxo/cli`. Decision §2 Package Naming section revised. Folder structure `packages/core/` renamed to `packages/cli/`. Placeholder packages `@ctxo/cli@0.0.1` and `@ctxo/plugin-api@0.0.1` published to reserve names. User-facing `ctxo` bin name unchanged. |
