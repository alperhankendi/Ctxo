# @ctxo/cli

## 0.11.2

### Patch Changes

- e05f62f: Discover the Java plugin in global installs. `@ctxo/lang-java` was missing from the CLI's plugin manifest (its `devDependencies`), which is the registry that global-mode plugin discovery walks when a project has no `@ctxo/lang-*` of its own. As a result `ctxo install java --global` installed the plugin but `ctxo index` never loaded it, silently skipping every Java file (only other detected languages were indexed). Adding `@ctxo/lang-java` to that list puts it on par with the Go, C#, and TypeScript plugins, so a globally installed Java plugin is found and the full tier engages.

## 0.11.1

### Patch Changes

- f3210c6: Fix `spawn EINVAL` on Windows during `ctxo install` / `ctxo update` / `ctxo init` plugin installs. Node's CVE-2024-27980 hardening (>=18.20.2 / >=20.12.2 / all 21+) refuses to spawn the `.cmd` package-manager shims (npm, pnpm, yarn) without a shell, so the install aborted with `[ctxo] ERROR Fatal: spawn EINVAL`. The package-manager runner now spawns a single shell command string on Windows so the shell resolves the shim, while POSIX keeps the direct argv + `shell:false` path. This avoids both the EINVAL crash and the DEP0190 deprecation that a `shell:true` + argv-array combination would raise on Node 22.

## 0.11.0

### Minor Changes

- c8165d8: Ship the CLI-side Java support that pairs with `@ctxo/lang-java` and `@ctxo/lang-java-analyzer` 0.8.0. Without this release the published Java plugins do not work end to end, because the CLI half was missing.

  - `ctxo install java --full-tier` / `--syntax-only` with a JRE-aware smart default (installs the analyzer companion package when a JRE 17+ is detected).
  - `ctxo doctor` Java tier check (runtime + analyzer presence + actionable hint); `ctxo index` surfaces the active Java tier.
  - core: accept name-reference edge targets (`EdgeTargetSchema`) plus a resilient index read, and resolve those targets by unambiguous name+kind in the symbol graph. Without these, Java `extends`/`implements`/`uses`/`calls` edges are dropped on read or left unresolved, so blast-radius, find-importers, and class-hierarchy return nothing for Java.
  - watch: a generic `IIncrementalReindex` keep-alive capability (new in `@ctxo/plugin-api`) replaces the C#-hardcoded path. `@ctxo/lang-csharp` now exposes `getIncrementalReindex()` so C# watch keep-alive keeps working with the generalized watch command.

### Patch Changes

- Updated dependencies [c8165d8]
  - @ctxo/plugin-api@0.7.2

## 0.10.0

### Minor Changes

- 487f994: Safe-edit guard + ctxo skills: a PreToolUse hook (Claude Code) blocks edits to high-impact symbols until blast radius is checked, plus model-invoked skills and new `ctxo blast-radius` / `ctxo gate --preview` commands. Cursor and other tools get skills + rules.

## 0.9.3

### Patch Changes

- 4a9f353: **Fix: `ctxo update` no longer tries to "upgrade" workspace-linked plugins.**

  When the project's `package.json` declares a dep as `workspace:*` (or `workspace:^`, `workspace:~`, etc), the package's source lives locally and is intentionally not consumed from the registry. Previously, `ctxo update` would compare the workspace-link's discovered version to the npm registry's latest and propose a "fix" — installing a pinned registry version, which silently unlinks the workspace and downgrades to whatever npm has published.

  Now those rows show up as `workspace link` with `(local)` in the LATEST column, and the install plan excludes them. Example in the Ctxo monorepo itself:

  ```
  PACKAGE                CURRENT        LATEST (latest)  STATUS
  @ctxo/cli              0.9.1          0.9.2            update
  @ctxo/lang-csharp      0.7.0-alpha.0  (local)          workspace link
  @ctxo/lang-go          0.8.0-alpha.0  (local)          workspace link
  @ctxo/lang-typescript  0.7.0-alpha.0  (local)          workspace link

  To update, run:
    pnpm add -D -w @ctxo/cli@0.9.2
  ```

  Adds `readWorkspaceLinks(projectRoot)` to `core/install/package-manager.ts` and `markWorkspaceLinks(states, names)` plus a new `'workspace'` value in `PackageStatus` to `core/update/update-plan.ts`.

## 0.9.2

### Patch Changes

- 3fbf124: **Fix: `ctxo install` / `ctxo update` now work inside pnpm workspaces.**

  Two bugs surfaced when running these commands inside a pnpm monorepo:

  - **`ERR_PNPM_ADDING_TO_ROOT`** — pnpm 8+ requires `-w` for `pnpm add -D` at a workspace root. ctxo never appended the flag, so installs failed with the pnpm safety check. Fix: detect workspace root (`pnpm-workspace.yaml` or `package.json.workspaces`) and append `-w` to the pnpm command when applicable. Global installs and non-workspace projects are unaffected. Other package managers (npm / yarn / bun) need no equivalent flag.
  - **`DEP0190` deprecation warning** on Node 22+ — `spawn(cmd, args, { shell: true })` is now deprecated because args are concatenated unescaped. Fix: drop `shell: true`; on Windows, append the right extension manually (`.cmd` for npm/pnpm/yarn, `.exe` for bun). No security regression — `isSafeVersionSpecifier` already filters shell metacharacters upstream.

  Exposes a new `isWorkspaceRoot(projectRoot)` helper in `core/install/package-manager.ts` and extends `buildInstallCommand` with a `workspaceRoot` option (defaults to `false`).

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
