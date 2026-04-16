---
"@ctxo/cli": minor
---

**Architectural intelligence, surfaced.** `ctxo visualize` now shows Layer vs Community side-by-side — node fill encodes the designed layer (Domain / Adapter / Test / ...), node border encodes the Louvain community, and boundary-violation edges render red. A first-load modal explains the distinction and the view now defaults to light theme.

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
