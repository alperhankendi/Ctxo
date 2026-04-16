# @ctxo/cli

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
