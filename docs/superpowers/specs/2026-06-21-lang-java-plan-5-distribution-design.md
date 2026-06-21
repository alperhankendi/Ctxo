# Design — `@ctxo/lang-java` Plan 5: Distribution & Integration

| Field | Value |
|---|---|
| **Date** | 2026-06-21 |
| **Status** | Approved (brainstorming complete; ready for implementation plan) |
| **Author** | Alper Hankendi |
| **Decision record** | [ADR-014](../../architecture/ADR/adr-014-java-full-tier-via-eclipse-jdt.md) (Revision 2) |
| **Builds on** | Plans 1-3 (tree-sitter tier, JDT analyzer JAR, TS full-tier wiring — all DONE) |

## Goal

Make `@ctxo/lang-java`'s full tier actually reachable by end users, production-ready, and publishable — without complicating the day-to-day CI pipeline and without committing binaries. Decided across five points (D1-D5) in a brainstorming tech-session backed by deep prior-art research.

## The five decisions

### D1 — Distribution channel: separate opt-in npm package
The ~15 MB Eclipse JDT uber-JAR ships as its own npm package **`@ctxo/lang-java-analyzer`** (the JAR lives inside that package's published tarball). The `@ctxo/lang-java` plugin does **not** bundle the JAR and does **not** download it from GitHub Releases; at runtime it resolves the JAR from `node_modules` via `require.resolve('@ctxo/lang-java-analyzer/package.json')` (hoisting-safe). Rationale (research-backed): the modern ecosystem (esbuild, sharp, rollup, biome) migrated *away* from postinstall/first-run downloads toward npm-package delivery because downloads break on proxies/offline/`--ignore-scripts` and miss integrity metadata; npm packages get SRI integrity + SLSA provenance for free; the artifact is platform-independent so no per-platform matrix is needed.

### D2 — Integrity: handled by npm (no custom SHA pin)
Because the JAR rides inside an npm package, npm's lockfile `integrity` (SRI) verifies it on install and npm provenance (Ctxo already publishes with `--provenance`) attests its CI origin. The manual `EXPECTED_SHA256` pin and the `downloadAnalyzerJar` network path from Plan 3 are **removed**.

### D3 — Acquisition UX: smart default + total transparency
- **Smart default:** `ctxo install java` detects a JRE 17+ (`java -version`). If present → installs **both** `@ctxo/lang-java` and `@ctxo/lang-java-analyzer` (full tier). If absent → installs only `@ctxo/lang-java` (syntax) and prints a clear message ("JRE 17+ not found; installed syntax tier. Install a JRE then run `ctxo install java --full-tier`."). This is an explicit `ctxo install` decision, not a postinstall script — no supply-chain footgun; only users who ran `ctxo install java` *and* have a JRE get the 15 MB.
- **Overrides:** `--full-tier` (force-add the analyzer package), `--syntax-only` (skip it even with a JRE).
- **Transparency (everywhere):** the active Java tier is surfaced on `ctxo index` output, `ctxo status`, `ctxo doctor`, and MCP response `_meta` — always "full" or "syntax (fallback — reason)". A degraded fallback is never silent.
- **No interactive prompt** during `ctxo index` (would break non-interactive/agent/CI runs).

### D4 — CI build: release-only, no committed binary
- `@ctxo/lang-java-analyzer` **owns its Maven source** (the `ctxo-jdt-analyzer` project moves into this package). Its `build` runs `mvn package` and places the resulting `ctxo-jdt-analyzer.jar` into the package's published `files`.
- The JAR is built in CI **only at release time**: `release.yml` gains a `setup-java` + Maven step so the analyzer package's tarball contains a fresh, source-matched JAR before `changeset publish`.
- The **PR pipeline (`ci.yml`) stays Node-only** — no JDK/Maven added there. JUnit + TS-integration tests run locally and at release; the JDT API is stable enough that per-PR Java builds are not worth the added pipeline complexity.
- The JAR is **never committed** to git (avoids permanent repo bloat + source/artifact drift; preserves provenance).

### D5 — `ctxo doctor`: action-oriented Java check
`ctxo doctor` reports, for Java: JRE present + version + ≥17?; `@ctxo/lang-java-analyzer` installed + version matches the plugin?; effective tier (full/syntax); and an actionable hint when degraded (e.g. "JRE 17 found but analyzer package missing → `ctxo install java --full-tier`"). Per-run binding statistics belong in index `_meta`, not in the static doctor check.

## Architecture & components

```
packages/
├── lang-java/                       # the plugin (small, syntax tier + full-tier wiring)
│   └── src/analyzer/
│       ├── jar-resolve.ts           # NEW: require.resolve('@ctxo/lang-java-analyzer') → jar path | null
│       ├── toolchain-detect.ts      # exists (Plan 3): detect JRE >=17 + javaBin
│       ├── jdt-process.ts           # exists (Plan 3): spawn java -jar + JSONL
│       └── jdt-adapter.ts           # MODIFY: resolve jar via jar-resolve (drop jar-download)
│   └── (remove) jar-download.ts     # superseded by jar-resolve.ts
├── lang-java-analyzer/              # NEW package: carries the JAR
│   ├── package.json                 # files: ["jar/ctxo-jdt-analyzer.jar"], build: mvn package
│   ├── java/  (= former tools/ctxo-jdt-analyzer/)  # Maven source moves here
│   ├── jar/ctxo-jdt-analyzer.jar    # build output (gitignored; produced in CI at release)
│   └── index.js                     # tiny: exports the resolved jar path (jarPath())
cli/
└── src/cli/install-command.ts       # MODIFY: --full-tier / --syntax-only + JRE-detect smart default
└── src/adapters/diagnostics/checks/ # MODIFY/ADD: java-tier-check.ts (doctor)
.github/workflows/release.yml        # MODIFY: setup-java + mvn package before publish
```

- **`jar-resolve.ts`** (lang-java): `resolveAnalyzerJar(): string | null` — `require.resolve('@ctxo/lang-java-analyzer/package.json')` → `jar/ctxo-jdt-analyzer.jar`; null if the package isn't installed or the jar is absent. Replaces the env/cache/download logic (keep `CTXO_JDT_ANALYZER_JAR` env override as a dev/test escape hatch).
- **`@ctxo/lang-java-analyzer`**: a near-empty npm package whose value is the bundled JAR. Exposes `jarPath()` returning the absolute path to its own JAR. Version-locked to `@ctxo/lang-java` (same changeset bump). The plugin verifies version match at runtime; mismatch → clear error + tree-sitter fallback.
- **`install-command.ts`**: extend `InstallOptions` with `fullTier?: boolean` / `syntaxOnly?: boolean`; when language includes `java`, resolve the package set by JRE detection + flags.
- **doctor `java-tier-check.ts`**: a diagnostics check following the existing `language-coverage-check` / `versions-check` pattern.

## Data flow (acquisition + runtime)

```
ctxo install java
  └─ detect JRE>=17 ─ yes ─> install @ctxo/lang-java + @ctxo/lang-java-analyzer
                    └ no  ─> install @ctxo/lang-java only + "install JRE for full tier" message

ctxo index (runtime)
  └─ JavaCompositeAdapter.initialize()
       └─ detectJavaRuntime() >=17  AND  jar-resolve finds @ctxo/lang-java-analyzer jar
            ├ yes ─> full tier (spawn java -jar … batch)
            └ no  ─> tree-sitter syntax tier
       └─ report active tier in index output + _meta
```

## Testing

- **Unit (PR CI, Node-only):** `jar-resolve` (resolves when package present, null when absent, env override); install-command plan logic (JRE present → both packages; absent → syntax only; `--syntax-only`/`--full-tier` overrides) with JRE detection mocked; doctor java-tier-check output for each state (full / syntax-no-jre / syntax-no-analyzer).
- **Integration (local + release, gated on Java):** full-tier composite against the real built JAR (already exists from Plan 3, now resolving via the analyzer package).
- **Release CI:** `mvn package` produces the JAR; analyzer package tarball contains it; JUnit suite runs in the release job.

## Out of scope (later)
- Plan 4 (watch / keep-alive integration).
- JRE 21 second tier (deferred per ADR-014).
- Bundling a JRE (rejected: platform matrix + bloat).

## Risks & mitigations
- **Plugin ↔ analyzer version drift:** bump both in one changeset; runtime version-match check + graceful degrade. (sharp's platform-package version check is the precedent.)
- **`require.resolve` under pnpm hoisting:** resolve via `@ctxo/lang-java-analyzer/package.json` (always present), not a deep path guess.
- **Release job gains a Java toolchain:** isolated to `release.yml`; cached Maven deps; PR pipeline untouched.
- **User has analyzer package but no JRE:** doctor + index message; tree-sitter fallback (never blocks).
