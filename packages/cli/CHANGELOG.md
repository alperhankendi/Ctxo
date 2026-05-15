# @ctxo/cli

## 0.9.1

### Patch Changes

- a7d839a: **`ctxo init` next-steps now use bare `ctxo` commands.** After `ctxo init` completes, the "Next steps" box shown to the user now prints `ctxo index` and `ctxo doctor` instead of `npx ctxo …`. This matches the recommended setup (global install via `npm install -g @ctxo/cli`) and the rest of the documentation. The shorter form also works for users who installed `@ctxo/cli` as a devDependency, since pnpm/npm expose the `ctxo` bin in `node_modules/.bin/` on PATH for shell sessions inside the project.

  Internal: `http-server-transport.ts` JSDoc examples switched to the bare `ctxo` form for consistency (no runtime effect).

## 0.9.0

### Minor Changes

- 08e1cbb: **`ctxo update` — self-update mechanism.** Checks `registry.npmjs.org` for newer versions of `@ctxo/cli` and every installed `@ctxo/lang-*` / `ctxo-lang-*` plugin, then either runs the install or prints the install command for the user to run.

  - Flags: `--check`, `--print`, `--global`, `--json`, `--pm <npm|pnpm|yarn|bun>`, `--force`.
  - Per-package channel detection (alpha stays on alpha, stable stays on stable) with explicit `(latest)` annotation when the chosen channel is not published.
  - Auto-execute when the project lists `@ctxo/*` in `package.json`; otherwise prints the global install command without mutating an unrelated workspace.
  - Single JSON document in `--json` mode.
  - Defence-in-depth: rejects npm version specifiers containing shell metacharacters before passing them to the package manager.
  - Internal: extracted shared `runPackageManager` helper from `install-command.ts`; both `install` and `update` now route through `core/install/run-package-manager.ts`.

  Spec: `docs/superpowers/specs/2026-05-15-ctxo-update-design.md`. User docs: [`site/docs/cli/update.md`](https://ctxo.dev/cli/update.html).

## 0.8.2

### Patch Changes

- 55abc5e: `ctxo init` now supports **Gemini CLI** and **Continue** as installable AI tool targets, bringing the supported tool list to nine.

  - **Gemini CLI**: appends a marked rules block to `GEMINI.md` at the repo root and registers the ctxo MCP server at `.gemini/settings.json` (`mcpServers` key, same schema as Claude Code / Cursor).
  - **Continue**: writes `.continue/rules/ctxo.md` and registers the MCP server as a standalone file at `.continue/mcpServers/ctxo.json` (Continue picks up each file in that directory separately).

  Run `ctxo init` and pick `gemini-cli` and/or `continue` from the interactive list, or use `ctxo init --tools gemini-cli,continue --yes` for a non-interactive install. No existing platform behavior changes.

## 0.8.1

### Patch Changes

- e040bde: Fix plugin discovery failing under `npx @ctxo/cli` when language plugins are installed in the consumer project. Bare specifiers like `@ctxo/lang-csharp` were resolved relative to the CLI bundle's location (inside the npm `_npx` cache), not the user's project, so installed plugins reported `Cannot find package`. Discovery now anchors resolution at the consumer's `package.json` via `createRequire`, so plugins load regardless of where the CLI itself is executing.

## 0.8.0

### Minor Changes

- 35847bf: **Architectural intelligence, surfaced.** `ctxo visualize` now shows Layer vs Community side-by-side — node fill encodes the designed layer (Domain / Adapter / Test / ...), node border encodes the Louvain community, and boundary-violation edges render red. A first-load modal explains the distinction and the view now defaults to light theme.

  `pages/ctxo-visualizer.html` gains a new **Architecture** tab with four sub-views:

  - **Overview** — KPI cards for modularity, violations, drift events, and community count; modularity trend line across snapshot history; top god nodes.
  - **Drift** — community-migration event table sourced from the persisted drift artifact.
  - **Violations** — sortable boundary-violation table by severity.
  - **Hotspots** — complexity × churn top symbols.

  `ctxo index` persists two new artifacts next to `communities.json` so the browser reads them directly without re-running detectors:

  - `.ctxo/index/drift-events.json`
  - `.ctxo/index/boundary-violations.json`

  Other improvements:

  - `JsonIndexReader` skips the two new top-level artifacts.
  - `discoverFilesIn` filters stale `git ls-files --cached` entries for files deleted from the working tree — no more ENOENT spam during indexing.
  - Drops the short-lived `ctxo report` command, its template, build script, and cytoscape / d3-sankey / esbuild devDeps.
  - `core/overlay/snapshot-staleness.ts` no longer imports from `ports/`, restoring the hexagonal boundary.
  - Golden-snapshot test is CRLF-safe on Windows.
  - Three pre-existing test failures resolved — full suite now 1044 / 1044.

  Site nav is unified across the landing page and comparison pages (Docs link added, Go tier advertised as Full).

## 0.7.2

### Patch Changes

- 5b1ea92: Release pipeline hardening:

  - Release workflow now runs `pnpm -r typecheck` and `pnpm -r test` before publishing, so broken builds cannot ship to npm.
  - Verifies `NPM_TOKEN` secret is present before doing any work (fast fail with actionable message).
  - After publish, automatically fixes npm dist-tags so prerelease versions (`-alpha`, `-beta`, `-rc`, `-next`) move to the matching channel tag and `latest` stays pinned to the highest stable version.
  - All public packages now declare `publishConfig.access: public` and `publishConfig.provenance: true` so per-package npm publishes (manual or automated) keep provenance and visibility consistent.
  - New `dist-tag-repair` workflow available from the Actions tab to manually re-align dist-tags for any package, with a `dry_run` switch.

- Updated dependencies [5b1ea92]
  - @ctxo/plugin-api@0.7.1

## 0.7.1

### Patch Changes

- 35659c8: Improve GitHub Releases format. Per-package releases are replaced with a single umbrella release per published run, listing every package version published, the full compatible-set matrix across all `@ctxo/*` packages, and per-package CHANGELOG excerpts. Plugin-only releases also produce an umbrella entry. Alpha/beta/rc/next versions are auto-marked as pre-release.
