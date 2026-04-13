# PRD: Monorepo Workspace Support

| Field | Value |
|---|---|
| **Status** | Deferred — Placeholder |
| **Owner** | Alper Hankendi |
| **Date** | 2026-04-13 |
| **Target Version** | v0.8 or v0.9 (post v0.7 user feedback) |
| **Epic** | Multi-Language Expansion (Phase 3) |
| **Related PRDs** | [Plugin Architecture & Language Expansion](prd-plugin-architecture-and-language-expansion.md) (v0.7) |

---

## Status Note

This PRD is a **placeholder** capturing the discussion that led to deferring monorepo workspace support from v0.7. It is **not actionable yet** — content will be shaped after v0.7 ships and real user feedback surfaces from monorepo users (Nx, Turborepo, pnpm workspaces).

**v0.7 does not block this.** See Section 6 for forward-compat design disciplines already applied in v0.7 so this feature can land without rework.

---

## 1. Problem Statement

Ctxo v0.7 supports **Scenario A** out of the box:

> Single workspace, mixed languages. Example: Django backend + React frontend in one repo, one `package.json` at root (or none), one `.ctxo/` index at root, files of different languages live side-by-side.

This works because ctxo scans from `cwd`, plugins auto-register by file extension, and the dependency graph is flat.

Ctxo v0.7 does **not** support **Scenario B**:

> Isolated package monorepo. Example: pnpm/npm/yarn/bun workspaces, Nx, Turborepo, Lerna. Each package under `packages/*` or `apps/*` has its own manifest, own dependencies, own tier requirements, own build tooling.

Symptoms a Scenario B user hits in v0.7:

1. Running `ctxo index` at monorepo root indexes everything under a single `.ctxo/`, which works but loses per-package boundaries
2. Cross-package imports via workspace aliases (`@my/shared`, `workspace:*`) are opaque to the resolver — TS full-tier can't follow them
3. Plugins installed in a sub-package's `node_modules` are invisible to ctxo (discovery scans root `package.json`)
4. `.ctxo/config.yaml` has no inheritance model — per-package overrides impossible
5. `ctxo index --check` gate is all-or-nothing, not per-package affected
6. MCP tool responses have no `package` context, so `web/src/foo.ts::bar` and `api/src/foo.ts::bar` collide in user mental model
7. Watch mode tries to observe the entire tree, hitting FS watcher limits in large monorepos
8. Graph metrics (PageRank, centrality) computed globally, hiding per-package topology

---

## 2. Goals (Draft — Subject to Revision)

### Primary (must-have when this PRD activates)

1. **Workspace auto-detection** — read `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `package.json#workspaces` and discover package boundaries
2. **Per-package plugin discovery** — each package's `node_modules` scanned, plugins aggregated at workspace level
3. **Workspace alias resolution** — `import "@my/shared"` resolved to `packages/shared/src/index.ts` for TS full-tier
4. **Per-package config inheritance** — root `.ctxo/config.yaml` + optional `packages/*/.ctxo/config.yaml` override
5. **MCP tool context enrichment** — responses include `package` field when applicable

### Secondary

- Affected-package detection for `ctxo index --check` (only reindex changed packages)
- Per-package PageRank as dimension alongside global
- Workspace-aware `ctxo install <lang>` (install to specific package or root)

### Non-Goals (for this future PRD)

- Bazel / Buck2 workspace support (separate PRD if demand arises)
- Flutter/Dart workspace integration
- Polyrepo / multi-repo orchestration (explicitly different problem)
- Cross-workspace dependency tracking (e.g., two separate monorepos referencing each other)

---

## 3. Open Questions

These 10 questions require resolution before implementation can begin. They are documented here so future-us has the full problem surface:

| # | Question |
|---|---|
| 1 | **Index scope:** Single root `.ctxo/` vs per-package `packages/*/.ctxo/` vs hybrid (root manifest + per-package cache)? |
| 2 | **Plugin install scope:** Root `package.json` (shared) vs per-package (isolated)? How does discovery aggregate? |
| 3 | **Config merge:** Root `.ctxo/config.yaml` + per-package override, or flat single-file? Merge precedence rules? |
| 4 | **Cross-package resolution:** TS paths, pnpm `workspace:*`, Nx `@nx/*` aliases — which resolver? |
| 5 | **Per-language project boundary:** Python `pyproject.toml` per package with different venvs — multiple Python adapter instances? |
| 6 | **Watch mode:** Root-level watcher with package-aware debounce, or per-package watchers? FS watcher limit mitigation? |
| 7 | **CI freshness gate:** Global `--check` vs `--check --affected` (changed-packages-only)? Monorepo tool integration? |
| 8 | **MCP server scope:** Single server for whole monorepo (current), vs per-package server? Tool responses carry `package` context? |
| 9 | **Graph centrality:** Global PageRank across all packages, per-package PageRank, or both (dimension added)? |
| 10 | **Workspace tool integration:** Nx `project.json`, Turborepo `turbo.json`, pnpm `pnpm-workspace.yaml`, Bazel `BUILD.bazel` — priority order? First-class support vs generic fallback? |

---

## 4. User Stories (Draft)

### US-1: Nx Monorepo Developer
> *As a dev on an Nx monorepo with 15 packages, I want `ctxo index` to understand package boundaries so my AI assistant gets correct cross-package blast radius when I change a shared lib.*

### US-2: pnpm Workspace with Mixed Languages
> *As a dev on a pnpm workspace containing `apps/api` (Python) and `apps/web` (TypeScript), I want ctxo to install language plugins in the right place and index each package with its own tier.*

### US-3: Turborepo CI Integration
> *As a dev using Turborepo for CI, I want `ctxo index --check --affected` to only verify the packages touched by my PR, matching `turbo run build --filter=...[HEAD^1]` semantics.*

### US-4: Workspace Alias Resolution
> *As a dev, when my TypeScript code does `import { x } from "@my/shared"`, I want `find_importers("x")` to return results across all packages that import it.*

---

## 5. Non-Goals Clarification (Out of Scope Even for This PRD)

- **Polyrepo dependencies:** Two separate GitHub repos with cross-refs. This is a different problem (federation, not workspace).
- **Private registry integration:** Nexus, Artifactory, Verdaccio plugin resolution. Assumed to work via standard npm config.
- **Yarn PnP zero-installs:** Scope debated; likely supported via standard resolver but not a goal.
- **Bazel/Buck2:** Separate PRD if demand surfaces. Different build semantics, not reducible to npm-style workspaces.

---

## 6. Forward-Compat Design Applied in v0.7

v0.7 makes three small design decisions so this PRD can land later without core rewrite. These are tracked in the v0.7 PRD but summarized here:

### 6.1 `IWorkspace` abstraction
v0.7 introduces a workspace interface even though the implementation is always single-package:

```typescript
interface IWorkspace {
  readonly root: string;
  readonly packages: readonly IPackage[];  // v0.7: always [{ root, manifest }]
}
```

Future Nx/Turborepo detectors implement `IWorkspace` without changing consumers.

### 6.2 Parameterized plugin discovery
v0.7's plugin discovery takes a manifest path argument:
```typescript
loadPluginsFromManifest(manifestPath: string): Plugin[]
```
Future version adds `loadPluginsFromWorkspace(workspace: IWorkspace): Plugin[]` that aggregates across packages.

### 6.3 Optional `workspace` field in MCP envelope
v0.7 MCP tool responses include an optional `workspace` field in `_meta`, always `undefined` in v0.7:
```typescript
_meta: {
  ...existing,
  workspace?: { root: string; package?: string };  // v0.7: undefined
}
```
Schema evolution is additive — no breaking change when workspace support lands.

---

## 7. Rollout Sketch

Rough ordering when this PRD activates. Subject to revision.

### Phase 1: pnpm Workspace Support (simplest — standard npm semantics)
- `pnpm-workspace.yaml` auto-detection
- Per-package `package.json` plugin aggregation
- Workspace alias resolution via `package.json#exports`

### Phase 2: Turborepo Integration
- `turbo.json` pipeline awareness (`ctxo index` integrates as turbo task)
- Affected-package detection via `turbo run --filter=...[HEAD^1]`
- Remote caching compatibility

### Phase 3: Nx Integration (most complex — project graph overlap)
- `nx.json` + `project.json` parsing
- Nx project graph ingestion (avoid rebuilding what Nx already knows)
- Conflict resolution: Nx graph edges vs ctxo graph edges
- Nx plugin companion (`@nx/ctxo`?)

---

## 8. Risks (Draft)

| Risk | Severity | Mitigation |
|---|---|---|
| Nx graph ingestion duplicates work already done | High | Partner with Nx team, consume their project graph API |
| Monorepo index size becomes unmanageable (100+ packages) | High | Per-package cache + affected indexing by default |
| Workspace alias resolution fragile across package managers | Medium | Start with one package manager (pnpm), expand incrementally |
| Cross-package edges explode graph and slow MCP tools | Medium | Bounded traversal, package-scope filter on tools |
| Users expect polyrepo support "because it's just monorepo++" | Low | Clear docs: polyrepo is a non-goal |

---

## 9. Success Metrics (Draft)

### Quantitative

- **Adoption:** 40% of ctxo users in monorepo environments (measured via opt-in stats) within 60 days of release
- **Performance:** p95 `ctxo index --check --affected` < 3s for 50-package monorepo with 1-package change
- **Correctness:** Cross-package `get_blast_radius` returns correct results for 95% of surveyed real-world refactors

### Qualitative

- At least 3 community success stories from Nx/Turborepo users within 90 days
- pnpm, Turborepo, or Nx teams publicly reference ctxo integration

---

## 10. References

- [PRD: Plugin Architecture & Language Expansion](prd-plugin-architecture-and-language-expansion.md) — v0.7 foundation
- [PRD: Main](prd.md) — product-wide scope
- [Architecture](architecture.md) — hexagonal pattern, workspace will extend `IPort` family
- [pnpm workspaces](https://pnpm.io/workspaces)
- [Turborepo](https://turbo.build/repo/docs)
- [Nx](https://nx.dev/)

---

## Change Log

| Date | Change |
|---|---|
| 2026-04-13 | Initial placeholder. Captures 10 open questions, forward-compat disciplines from v0.7 discussion. Deferred pending v0.7 ship + user feedback. |
