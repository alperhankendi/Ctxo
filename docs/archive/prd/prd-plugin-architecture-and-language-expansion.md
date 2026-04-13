# PRD: Plugin Architecture & Language Expansion

| Field | Value |
|---|---|
| **Status** | Draft — Decisions Locked |
| **Owner** | Alper Hankendi |
| **Date** | 2026-04-13 |
| **Target Version** | v0.7.x series (Phase A → Phase B minor releases) |
| **Epic** | Multi-Language Expansion (Phase 2) + Monorepo Refactor |
| **Related ADRs** | ADR-007 (C# Roslyn), ADR-012 (Plugin Protocol — to be written) |
| **Related PRDs** | [Monorepo Workspace Support](prd-monorepo-workspace-support.md) (deferred, v0.8+) |

---

## 0. Executive Summary

Ctxo currently bundles 3 language adapters (TypeScript full-tier, Go syntax-tier, C# full-tier via Roslyn) as part of the single `ctxo-mcp` npm package. Adding Python and Java — the two largest unsupported ecosystems — using the same bundled approach would bloat the base tarball, increase peer-dependency conflict risk, and create a maintenance model that does not scale to more languages.

This PRD replaces the bundled model with a **plugin architecture** published across a monorepo of small packages:

- `@ctxo/cli` — core CLI + MCP server (primary invocation target, ships `ctxo` bin)
- `@ctxo/plugin-api` — shared plugin contract types
- `@ctxo/lang-typescript`, `@ctxo/lang-go`, `@ctxo/lang-csharp` — existing adapters, extracted as plugins
- `@ctxo/lang-python`, `@ctxo/lang-java` — new plugins

Note on the primary package name: the unscoped name `ctxo` was confirmed unavailable on npm registry (typosquatting filter against `co`, `xo`, `cpx`, `csso`). The scoped `@ctxo/cli` is the final choice — consistent with `@angular/cli`, `@vue/cli`, `@nestjs/cli` patterns. Global install produces a `ctxo` bin so user-facing invocation (`ctxo init`, `ctxo index`) is unaffected.

Existing languages are extracted first to validate the plugin protocol with known-good code (Phase A), then Python and Java are added on top of the validated infrastructure (Phase B). The v0.7 release is explicitly a **major architectural refactor** rather than a conservative feature add — backward compatibility for the old `ctxo-mcp` package name is declined in favor of a clean break.

The PRD also defines three user-facing behaviors layered on top of the plugin model:
- **Auto language detection + interactive plugin installation** during `ctxo init`
- **Language coverage diagnostics** in `ctxo doctor` with an opt-in `--fix` mode
- **Version visibility** across core and plugins via `ctxo --version` and doctor output

---

## 1. Problem Statement

### 1.1 Today's Constraints

Ctxo v0.6.6 ships as a single `ctxo-mcp` npm package containing core logic plus all three language adapters. Adding any new language means:

1. Growing the base tarball (tree-sitter grammars + native binaries are ~800KB–1.5MB each)
2. Coupling every language's dependency range to core's `tree-sitter` peer version — a single grammar's major bump blocks all others
3. Shipping Python-only users a Go grammar they never load, and vice versa
4. Testing and releasing all languages in lockstep whether they changed or not
5. Preventing community contribution: anyone wanting Kotlin or Rust support has to upstream into the core repo

Python and Java developers — the two largest unserved ecosystems — surface this pain concretely:

- Indexing a Django/Spring project produces zero useful output silently
- AI assistants fall back to `grep`/`read_file` for Python/Java files, defeating ctxo's value proposition
- Mixed-language projects (Django + React, Spring Boot + Angular) get asymmetric coverage — frontend indexed, backend invisible

### 1.2 Why Not Just Bundle Two More Adapters?

Tried-and-rejected alternatives considered during planning:

| Alternative | Why rejected |
|---|---|
| Add Python/Java to bundled package | Tarball grows ~3MB, peer conflict surface doubles, no path forward for Kotlin/Rust/Ruby |
| Move grammars to `optionalDependencies` | Solves tarball, doesn't solve peer conflict or community extensibility |
| Standalone per-language MCP servers (e.g. `ctxo-mcp-python`) | Fragments the graph across processes, destroys cross-language blast radius, 3× MCP tool namespace, operational nightmare |
| Per-language CLI binary download (Roslyn pattern for everyone) | Operationally expensive (CDN, checksums, airgapped), duplicates what npm already solves |

The plugin architecture solves all three axes simultaneously: tarball size, peer conflict isolation, community extensibility.

---

## 2. Goals

### 2.1 Primary Goals (must ship in v0.7 series)

1. **Plugin protocol v1** — stable `CtxoLanguagePlugin` contract with `apiVersion: '1'`
2. **Monorepo migration** — current code restructured under `packages/cli/`, plugins under `packages/lang-*/`
3. **Package rename** — `ctxo-mcp` → `@ctxo/cli` (primary) + `@ctxo/*` ecosystem scope
4. **Phase A: Extract existing adapters** — TS, Go, C# become `@ctxo/lang-typescript`, `@ctxo/lang-go`, `@ctxo/lang-csharp`
5. **Phase B: Ship Python and Java plugins** — syntax-tier analysis for `.py`, `.pyi`, `.java` files
6. **Auto language detection + plugin installation** — `ctxo init` detects languages and prompts to install plugins
7. **Language coverage diagnostics** — `ctxo doctor` reports missing plugins; `ctxo doctor --fix` installs them with consent
8. **Version visibility** — `ctxo --version` shows core + all installed plugins + API version

### 2.2 Secondary Goals

- `ctxo install <lang>` convenience command for explicit plugin install
- Plugin staleness detection (newer version available on registry)
- Graceful fallback when a plugin fails to load (warn, continue)
- Forward-compat hooks for the deferred [Monorepo Workspace Support PRD](prd-monorepo-workspace-support.md)

### 2.3 Non-Goals

- **Full-tier analysis for Python or Java** — no Pyright LSP, no JDT LS, no type resolution. Syntax tier only. Full-tier is deferred to future PRDs per language.
- **Framework-aware analysis** — no Django ORM relationships, no Spring `@Autowired` DI graph, no FastAPI route extraction. Syntax tier only.
- **Python virtualenv / site-packages introspection** — out of scope
- **Java build tool integration** — no `pom.xml`/`build.gradle` dependency resolution
- **Community plugin registry** — template repo and discovery conventions defined in v0.7, registry tooling deferred to v0.8
- **Backward compatibility for `ctxo-mcp` package name** — declined. `ctxo-mcp@0.6.6` stays as-is on npm and gets deprecated. No meta-package wrapper.
- **Nx/Turborepo/pnpm workspace isolated-package support** — deferred to [Monorepo Workspace Support PRD](prd-monorepo-workspace-support.md). v0.7 supports Scenario A (single workspace, mixed languages) only.
- **Automated release pipeline** — v0.7 uses manual `pnpm changeset version && pnpm publish`. Automation deferred to v0.8.

---

## 3. Decision Log

All decisions below were locked through iterative discussion before drafting this PRD. They are recorded here as the authoritative source of "what was decided and why" for future reference.

### 3.1 Monorepo & Packaging

| # | Decision | Rationale |
|---|---|---|
| D1.1 | **Single monorepo** with pnpm workspaces | Atomic breaking changes in plugin protocol evolution, tek maintainer context switch minimum, integration tests workspace-native |
| D1.2 | **`@ctxo/cli` scoped primary package** | Unscoped `ctxo` blocked by npm typosquatting filter (similarity to `co`, `xo`, `cpx`, `csso`). Scoped `@ctxo/cli` publishes cleanly under owned `@ctxo` organization. Matches `@angular/cli`, `@vue/cli`, `@nestjs/cli` convention. Ships `ctxo` bin so user-facing invocation unchanged |
| D1.3 | **`@ctxo/*` scope for all ecosystem packages including primary** | Organization owned on npm. Homogeneous namespace: `@ctxo/cli`, `@ctxo/plugin-api`, `@ctxo/lang-*`. Community plugins under `ctxo-lang-*` mirrors ESLint/Vite conventions |
| D1.4 | **pnpm + changesets**; no Turbo/Nx initially | Start simple, add build caching when build time justifies complexity |
| D1.5 | **v0.7.0 extracts all 3 existing adapters** (TS/Go/C#) | One refactor, no half-migrated state, no backward-compat shim debt |
| D1.6 | **No `ctxo-mcp` backward-compat wrapper** | Clean cut. `ctxo-mcp@0.6.6` deprecated on npm with migration message pointing to `@ctxo/cli`. Zero maintenance overhead |
| D1.7 | **Community plugin template repo deferred to v0.8** | v0.7 scope discipline. Template can be extracted from monorepo plugin pattern later |
| D1.8 | **Two-phase delivery: Phase A infrastructure + extract, Phase B new languages** | De-risks the new plugin protocol by validating with known-good code first |

### 3.2 Release Strategy

| # | Decision | Rationale |
|---|---|---|
| D2.1 | **Independent versioning** (changesets `linked: []`) | Unchanged packages don't bump; npm changelog stays meaningful; mirrors Vite/Prettier/Rollup pattern |
| D2.2 | **All packages start at 0.7.0** | Shared origin, user mental model: "v0.7.x installs work together at release time" |
| D2.3 | **`latest` + `next` npm dist-tags** | Canary deferred until community size justifies it |
| D2.4 | **Manual release PR** for v0.7 | Maintainer runs `pnpm changeset version` locally and opens the version PR; automation via changesets-action deferred to v0.8 |
| D2.5 | **Manual `npm publish`** for v0.7 | Maintainer runs `pnpm publish -r` locally with 2FA; CI-based publish deferred to v0.8 |

### 3.3 Auto-Install Mechanics

| # | Decision | Rationale |
|---|---|---|
| D3.1 | **Hybrid language detection** | Manifest files (`pyproject.toml`, `pom.xml`, `go.mod`, etc.) are high-confidence signals; extension scan covers projects without manifests. Threshold: 1 file with manifest, ≥5 files extension-only |
| D3.2 | **`ctxo init` runs full setup + install prompt** (Opsiyon A) | Zero-config first run UX. Edge cases: missing `package.json` prompts global install; CI environment skips install unless `--yes`; `--no-install` for airgapped |
| D3.3 | **`ctxo index` warns and skips missing plugins by default** (Opsiyon C) | Indexing must stay predictable — no surprise `npm install` in CI, watch mode, incremental runs. `--install-missing` flag opts in |
| D3.4 | **`ctxo doctor` is read-only by default** (Opsiyon A) | Doctor's "health check" semantics preserved. Install behavior behind `--fix` flag |
| D3.5 | **`ctxo install <lang>` is a new command** | Short names map to scoped packages (`python` → `@ctxo/lang-python`). Argsless invocation offers all missing plugins. Flags: `--yes`, `--global`, `--dry-run` |
| D3.6 | **Package manager resolution priority:** CLI flag > env var > `.ctxo/config.yaml` > lockfile > npm default | Covers per-command override, shell session override, project-committed preference, auto-detection, safe fallback |
| D3.7 | **Interactive prompts via `@inquirer/prompts`** | TTY-aware, ESM-native, TypeScript-first. TTY absent → non-interactive, requires explicit `--yes` or `--no-install` |

### 3.4 Doctor `--fix` + Version Visibility

| # | Decision | Rationale |
|---|---|---|
| D4.1 | **`--fix` fixes all applicable checks** (Opsiyon A) | One mental model — "auto-repair everything I can." Granular `--fix-<area>` flags deferred to v0.8 if demand surfaces |
| D4.2 | **Prompted by default**, `--yes` bypasses prompts | User sees the chain of changes; can decline any step |
| D4.3 | **CI environments require `--fix --yes`** (Opsiyon B) | Explicit consent for mutations in CI. Prevents accidental lockfile drift on test runs |
| D4.4 | **Fix execution dependency order:** runtime → disk → git → config → hooks → plugins → index → storage | Maximizes fix success: later fixes depend on earlier ones being applied |
| D4.5 | **`--dry-run` + `--fix` combination supported** | Preview the change chain; audit trail for security-conscious users |
| D4.6 | **Dependency-aware continue-on-error** (Opsiyon C) | Independent fixes proceed even if one fails; dependent fixes skip with clear reason |
| D4.7 | **`--fix --json` for automation** | CI/scripts can parse which fixes were applied. `--yes` required (JSON mode is non-interactive) |
| D4.8 | **`.ctxo/doctor-fix.log` audit trail** | Records timestamp, action, target. Supports supply-chain investigation and reproducibility |
| D4.9 | **`ctxo --version`** short by default, `--verbose` for full plugin list | Fast default (~200ms), detailed view opt-in. JSON output supported |
| D4.10 | **`ctxo doctor` leads with a Versions section** | First thing the user sees. Essential context for every other diagnostic signal |

---

## 4. Architecture

### 4.1 Monorepo Physical Structure

```
Ctxo/
├── packages/
│   ├── cli/                       # @ctxo/cli (primary)
│   │   ├── src/
│   │   │   ├── index.ts           # composition root
│   │   │   ├── ports/             # IStoragePort, IGitPort, ILanguageAdapter, IWorkspace
│   │   │   ├── core/              # pure domain logic (unchanged from v0.6)
│   │   │   ├── adapters/
│   │   │   │   ├── mcp/
│   │   │   │   ├── storage/
│   │   │   │   ├── git/
│   │   │   │   └── watcher/
│   │   │   └── cli/
│   │   │       ├── init-command.ts
│   │   │       ├── index-command.ts
│   │   │       ├── doctor-command.ts
│   │   │       ├── install-command.ts     # NEW
│   │   │       └── version-command.ts     # NEW (or extend cli root)
│   │   ├── package.json           # name: "@ctxo/cli", bin: { "ctxo": "..." }
│   │   └── tsconfig.json
│   ├── plugin-api/                # @ctxo/plugin-api (shared contracts)
│   │   ├── src/
│   │   │   ├── i-language-adapter.ts
│   │   │   ├── i-language-plugin.ts
│   │   │   └── types.ts
│   │   └── package.json
│   ├── lang-typescript/           # @ctxo/lang-typescript (Phase A extract)
│   │   ├── src/
│   │   │   ├── index.ts           # default export: CtxoLanguagePlugin
│   │   │   └── ts-morph-adapter.ts
│   │   └── package.json
│   ├── lang-go/                   # @ctxo/lang-go (Phase A extract)
│   ├── lang-csharp/               # @ctxo/lang-csharp (Phase A extract, Roslyn launcher)
│   ├── lang-python/               # @ctxo/lang-python (Phase B new)
│   └── lang-java/                 # @ctxo/lang-java (Phase B new)
├── pnpm-workspace.yaml
├── package.json                   # root, workspace config + changesets scripts
├── tsconfig.base.json
├── .changeset/
│   └── config.json                # independent versioning
├── .github/workflows/
│   └── ci.yml                     # build, test, type-check
├── CLAUDE.md
├── README.md
└── llms.txt
```

### 4.2 Dependency Rules

- `packages/cli/` **does not depend on** any `@ctxo/lang-*` package — plugins are discovered at runtime
- All plugins **depend on** `@ctxo/plugin-api` (type-only, shared contracts)
- All plugins declare `@ctxo/cli` in `peerDependencies` (not `dependencies`), range `^0.7.0`
- `packages/cli/` re-exports `@ctxo/plugin-api` types for convenience, but runs the plugin protocol via duck-typing against the `CtxoLanguagePlugin` shape

### 4.3 Plugin Protocol v1

`@ctxo/plugin-api` exports:

```typescript
export interface CtxoLanguagePlugin {
  /** Protocol version. v0.7 introduces '1'. Future breaking changes bump to '2'. */
  readonly apiVersion: '1';

  /** Short identifier. Used for CLI (`ctxo install python` → id: 'python'). */
  readonly id: string;

  /** Human-readable name for diagnostics. */
  readonly name: string;

  /** File extensions this plugin handles. Must be lowercase, dot-prefixed. */
  readonly extensions: readonly string[];

  /** Analysis tier. Determines whether ctxo calls full-tier APIs. */
  readonly tier: 'syntax' | 'full';

  /** Plugin package version, from package.json at build time. */
  readonly version: string;

  /** Factory. Called once per indexing session. Adapter instance is reused. */
  createAdapter(ctx: PluginContext): ILanguageAdapter;
}

export interface PluginContext {
  readonly logger: Logger;
  readonly projectRoot: string;
  readonly workspace: IWorkspace;  // forward-compat: always single-package in v0.7
  readonly config: Record<string, unknown>;  // per-plugin config from .ctxo/config.yaml
}

export interface ILanguageAdapter {
  extractSymbols(filePath: string, source: string): SymbolNode[];
  extractEdges(filePath: string, source: string, symbols: readonly SymbolNode[]): GraphEdge[];
  computeComplexity(filePath: string, source: string, symbol: SymbolNode): number;
}
```

### 4.4 Plugin Discovery Algorithm

```typescript
// packages/cli/src/adapters/language/plugin-discovery.ts

function discoverPlugins(manifestPath: string): CtxoLanguagePlugin[] {
  const manifest = readJson(manifestPath);
  const allDeps = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };

  const candidates = Object.keys(allDeps).filter(name =>
    name.startsWith('@ctxo/lang-') || name.startsWith('ctxo-lang-')
  );

  return candidates
    .map(name => tryLoadPlugin(name))
    .filter((p): p is CtxoLanguagePlugin => p !== null);
}

function tryLoadPlugin(packageName: string): CtxoLanguagePlugin | null {
  try {
    const mod = require(packageName);
    const plugin = mod.default ?? mod;

    if (plugin.apiVersion !== '1') {
      log.warn(`${packageName} uses unsupported apiVersion ${plugin.apiVersion}. Skipping.`);
      return null;
    }
    return plugin;
  } catch (err) {
    log.warn(`Failed to load ${packageName}: ${(err as Error).message}`);
    return null;
  }
}
```

Config-driven override (`.ctxo/config.yaml`):

```yaml
languages:
  plugins:
    - "@ctxo/lang-typescript"
    - "@ctxo/lang-go"
    - "./local-plugins/lang-custom"  # local path for development
```

When config block present, auto-discovery is suppressed and only listed plugins load.

### 4.5 Workspace Abstraction (Forward-Compat)

```typescript
// packages/cli/src/ports/i-workspace.ts

export interface IWorkspace {
  readonly root: string;
  readonly packages: readonly IPackage[];
}

export interface IPackage {
  readonly root: string;
  readonly manifest: string;  // path to package.json / pyproject.toml / pom.xml
  readonly name?: string;
}

// v0.7 implementation: always returns single-package workspace
export function detectWorkspace(cwd: string): IWorkspace {
  return {
    root: cwd,
    packages: [{ root: cwd, manifest: findManifest(cwd) }],
  };
}
```

Future Nx/Turborepo/pnpm workspace detectors implement the same interface without breaking callers.

### 4.6 Language Detection

```typescript
interface DetectionResult {
  byManifest: Record<string, string>;     // { python: 'pyproject.toml', java: 'pom.xml' }
  byExtension: Record<string, number>;    // { python: 312, java: 89, typescript: 45 }
  totalFiles: number;
}

function detectLanguages(root: string): DetectionResult {
  return {
    byManifest: {
      ...(exists('pyproject.toml') || exists('setup.py') ? { python: 'pyproject.toml' } : {}),
      ...(exists('pom.xml') || exists('build.gradle') ? { java: 'pom.xml' } : {}),
      ...(exists('go.mod') ? { go: 'go.mod' } : {}),
      ...(exists('*.csproj') || exists('*.sln') ? { csharp: '*.csproj' } : {}),
    },
    byExtension: countExtensionsViaGitLs(root),
    totalFiles: ...,
  };
}
```

Decision rule:
- Language with manifest → **always** included in "needed plugins" list
- Language without manifest → included if file count ≥ 5 **and** ratio ≥ 2% of total files
- Supported languages with installed plugin → excluded from "missing" list
- Detected extensions with no known plugin → included in "unsupported languages" warning

### 4.7 MCP Response Envelope (Forward-Compat)

All MCP tool responses extend the existing `_meta` envelope:

```typescript
// packages/cli/src/adapters/mcp/envelope.ts

interface MetaEnvelope {
  // existing v0.6 fields
  totalItems: number;
  returnedItems: number;
  truncated: boolean;
  totalBytes: number;
  hint?: string;

  // NEW in v0.7 (forward-compat for Monorepo Workspace PRD)
  workspace?: {
    root: string;
    package?: string;  // v0.7: always undefined
  };
}
```

Schema evolution is additive — v0.6 MCP clients that don't parse `workspace` continue working. v0.8+ workspace feature adds `package` value without schema migration.

---

## 5. Command Behavior Specifications

### 5.1 `ctxo init`

```
ctxo init [--yes] [--no-install] [--pm <npm|pnpm|yarn|bun>]
```

**Steps:**

1. Install git hooks (`post-commit`, `post-merge`) — existing v0.6 behavior
2. Create `.ctxo/config.yaml` from template if missing
3. Create `.ctxo/` directory skeleton (`.cache/`, `index/`)
4. **NEW**: Detect languages via `detectLanguages()`
5. **NEW**: Identify missing plugins (detected languages without installed plugin)
6. **NEW**: Prompt to install missing plugins (if TTY + !`--no-install`, or `--yes`)
7. **NEW**: Run `<pm> install -D <plugin>...` for confirmed languages
8. Print summary (installed plugins, next-step hint: `ctxo index`)

**Edge cases:**

| Condition | Behavior |
|---|---|
| No `package.json` in project | Prompt: [create one / install globally / skip] |
| CI environment (`CI=true` or no TTY) without `--yes` | Skip install, print manual install commands |
| `--no-install` flag | Skip plugin prompts entirely, print hint |
| Plugin install command fails | Warn with fallback instructions, `init` exits 0 (setup succeeded) |
| Language detected but not supported by any `@ctxo/lang-*` plugin | Print warning listing unsupported extensions, link to issue tracker |

**Exit codes:**
- 0 — setup complete (install may have warnings)
- 1 — setup failed (git repo missing, permissions, etc.)

### 5.2 `ctxo index`

```
ctxo index [--check] [--install-missing] [--skip-history] [--max-history N]
```

Unchanged from v0.6 except:

1. **NEW**: Language detection at start. For each detected language without a loaded plugin:
   - Default: log warning `[ctxo] Warning: detected X .py files but @ctxo/lang-python not installed. Run: ctxo install python`
   - With `--install-missing`: prompt for install (or auto-yes if TTY absent + `--yes`)
2. Index only files whose extension is claimed by a loaded plugin
3. Summary output includes per-language file counts + tier:
   ```
   [ctxo] Index complete: 357 files
   [ctxo]   TypeScript: 245 files (full-tier)
   [ctxo]   Python:      98 files (syntax-tier)
   [ctxo]   Java:        14 files (syntax-tier)
   [ctxo]   Skipped:     23 files (.rb, .rs — no plugin)
   ```

### 5.3 `ctxo doctor`

```
ctxo doctor [--fix] [--dry-run] [--yes] [--json] [--check-updates] [--quiet]
```

**Read-only output structure:**

```
[ctxo] Versions
  ctxo                      0.7.0
  Plugin API                v1
  @ctxo/lang-typescript     0.7.0  OK
  @ctxo/lang-go             0.7.0  OK
  @ctxo/lang-python         0.7.1  OK  (update available: 0.7.2)
  @ctxo/lang-java           not installed  WARN
  Node.js                   v20.11.0
  Platform                  win32 x64

[ctxo] Checks
  OK   Runtime (Node >= 20)
  OK   Disk space (42 GB free)
  OK   Git repository
  OK   Config file
  OK   Git hooks
  WARN Language coverage (1 plugin missing — see Versions)
  OK   Index freshness
  OK   SQLite cache

[ctxo] Status: WARN (1 warning)
  Fix with: ctxo doctor --fix
```

**`--check-updates`** adds a network call to registry for latest versions; off by default (CI-safe, network-free).

**`--fix` mode:**

Prompts interactively for each fixable issue (D4.4 dependency order):
1. Runtime — never fixable (print remediation)
2. Disk — never fixable
3. Git repository — never fixable (cannot create repo implicitly)
4. Config — create from template if missing
5. Git hooks — reinstall via `ctxo init` hook logic
6. Language coverage — run `ctxo install <lang>` per missing plugin
7. Index — run `ctxo index` if stale/missing (requires plugins loaded)
8. SQLite cache — delete + rebuild from JSON index

**CI behavior:** `--fix` without `--yes` in CI prints error and exits 2.

**`--dry-run --fix`** prints the planned change chain without applying:

```
[ctxo] Would apply the following fixes:
  [1] Install @ctxo/lang-java
      Command: npm install -D @ctxo/lang-java@^0.7
  [2] Rebuild SQLite cache
      Delete: .ctxo/.cache/index.db
      Rebuild from: .ctxo/index/*.json
```

**Fix error handling** (D4.6): dependency-aware continue.
- If config fix fails → skip hooks, plugins, index
- If plugin install fails → skip index (can't rebuild without adapters) but continue cache rebuild
- Record every attempt to `.ctxo/doctor-fix.log`

**JSON output** (`--json`):

```json
{
  "versions": {
    "ctxo": "0.7.0",
    "pluginApiVersion": "1",
    "plugins": [
      { "name": "@ctxo/lang-typescript", "version": "0.7.0", "apiVersion": "1", "compatible": true }
    ],
    "runtime": { "node": "v20.11.0", "platform": "win32", "arch": "x64" }
  },
  "checks": [
    { "name": "languageCoverage", "status": "warn", "missing": ["@ctxo/lang-java"] }
  ],
  "summary": { "status": "warn", "warnings": 1, "errors": 0 }
}
```

With `--fix --json --yes`:
```json
{
  "fixes": [
    { "name": "languageCoverage", "action": "install", "packages": ["@ctxo/lang-java"], "result": "success", "durationMs": 4200 }
  ]
}
```

### 5.4 `ctxo install` (NEW)

```
ctxo install [<lang>...] [--yes] [--global] [--dry-run] [--pm <manager>] [--version <range>]
```

**Behavior:**

- `ctxo install` — detect missing plugins, prompt to install all
- `ctxo install python` — resolve `python` → `@ctxo/lang-python`, install with prompt
- `ctxo install python java --yes` — batch, no prompts
- `ctxo install python --global` — global install (`npm i -g`)
- `ctxo install python --dry-run` — print the command, don't execute
- `ctxo install python --version 0.7.1` — pin to specific version (otherwise uses `^<core-major-minor>`)

**Package manager resolution** (D3.6):
1. `--pm` flag if provided
2. `CTXO_PM` env var
3. `.ctxo/config.yaml` `packageManager:` field
4. Lockfile detection: `bun.lockb` > `pnpm-lock.yaml` > `yarn.lock` > `package-lock.json`
5. Default: `npm`

**Edge cases:**

| Condition | Behavior |
|---|---|
| No `package.json` | Prompt: [create one / `--global` / abort] |
| Unknown language name (e.g. `ctxo install cobol`) | Error listing supported short names + community plugin template hint |
| Lockfile is frozen (CI detected) | Refuse with clear message — user must use `--force` or switch to `--global` |
| Install fails | Non-zero exit, error includes underlying package manager output |

### 5.5 `ctxo --version` (EXTENDED)

```
ctxo --version                # short: "ctxo 0.7.0"
ctxo --version --verbose      # full: core + plugins + runtime
ctxo version                  # subcommand, defaults to verbose
ctxo --version --json         # machine-readable
```

**Implementation:** plugin versions read from two sources, preferring runtime over disk:
1. Loaded plugin's `version` field (declared by plugin in its default export)
2. Fallback: `node_modules/<package>/package.json` on disk

Single source of truth is each plugin's own `package.json`, imported at build time:

```typescript
// @ctxo/lang-python/src/index.ts
import pkg from '../package.json' with { type: 'json' };

export default {
  apiVersion: '1',
  id: 'python',
  name: 'Python',
  version: pkg.version,
  extensions: ['.py', '.pyi'],
  tier: 'syntax',
  createAdapter: (ctx) => new PythonAdapter(ctx),
} satisfies CtxoLanguagePlugin;
```

---

## 6. Functional Requirements

### 6.1 Plugin Protocol

- **FR-1.1** `@ctxo/plugin-api` package exports `CtxoLanguagePlugin`, `ILanguageAdapter`, `PluginContext`, `IWorkspace` types
- **FR-1.2** Plugin protocol version declared as `apiVersion: '1'` string literal
- **FR-1.3** Core loads plugins via duck-typing against `CtxoLanguagePlugin` shape; does not require `@ctxo/plugin-api` at runtime for plugin (types only)
- **FR-1.4** Plugins declaring unsupported `apiVersion` are skipped with warning
- **FR-1.5** Plugin load failure (missing grammar binary, throw in default export) logged and skipped; core continues

### 6.2 Plugin Discovery

- **FR-2.1** Default discovery scans project `package.json` `dependencies`, `devDependencies`, `peerDependencies` for packages matching `@ctxo/lang-*` or `ctxo-lang-*`
- **FR-2.2** Explicit config in `.ctxo/config.yaml#languages.plugins` overrides auto-discovery (useful for monorepo local plugins)
- **FR-2.3** Discovery accepts a manifest path parameter (not hardcoded to `cwd/package.json`) — forward-compat for workspace PRD
- **FR-2.4** Multiple plugins claiming same file extension → warning + first-loaded wins (stable based on plugin discovery order)

### 6.3 Language Detection

- **FR-3.1** Manifest signals: `pyproject.toml`, `setup.py`, `requirements.txt` → Python; `pom.xml`, `build.gradle`, `build.gradle.kts` → Java; `go.mod` → Go; `*.csproj`, `*.sln` → C#; `package.json` → TypeScript/JavaScript
- **FR-3.2** Extension-only detection: language reported as "detected" if file count ≥ 5 and ratio ≥ 2% of total files
- **FR-3.3** Manifest signal alone (file count 0) is sufficient to report language as "detected"
- **FR-3.4** Detected-but-unsupported languages (no plugin available) are bucketed separately and printed with install guidance + community plugin link

### 6.4 `ctxo init`

- **FR-4.1** Detect languages after git hook install
- **FR-4.2** If any detected language has no installed plugin and TTY + !`--no-install`, prompt to install
- **FR-4.3** `--yes` flag accepts all default answers without prompt
- **FR-4.4** `--no-install` flag suppresses all install prompts and executions
- **FR-4.5** Without `package.json`, offer: create package.json, install globally, or skip
- **FR-4.6** CI environment (CI=true or no TTY) without `--yes` skips install and prints manual command
- **FR-4.7** Plugin install uses the package manager resolved per D3.6

### 6.5 `ctxo index`

- **FR-5.1** Detect languages at start of index run; print warning for each missing plugin
- **FR-5.2** Warning includes actionable install command (`ctxo install <lang>`)
- **FR-5.3** Default behavior does not install; `--install-missing` flag enables install prompt (or auto-yes with `--yes`)
- **FR-5.4** Summary output groups files by language with tier annotation
- **FR-5.5** Unsupported-language file count shown if ratio > 5% of total files (existing PRD behavior, unchanged)

### 6.6 `ctxo doctor`

- **FR-6.1** Versions section printed first, before checks
- **FR-6.2** Plugins shown with version, `apiVersion`, compatibility marker (OK/stale/incompatible)
- **FR-6.3** Detected-but-missing plugins shown as WARN with install hint
- **FR-6.4** `--check-updates` triggers registry queries for latest versions (off by default for CI safety)
- **FR-6.5** Language coverage becomes one of the existing `HealthCheck` implementations; JSON output schema extended with `versions` and `plugins` keys
- **FR-6.6** `--fix` flag enables mutations; fixes execute in dependency order (D4.4)
- **FR-6.7** `--fix` in CI without `--yes` exits 2 with error message
- **FR-6.8** `--dry-run --fix` prints planned changes without applying
- **FR-6.9** Fix failures logged to `.ctxo/doctor-fix.log` (append-only, timestamped)
- **FR-6.10** `--fix --json` output includes `fixes[]` array with per-action result

### 6.7 `ctxo install`

- **FR-7.1** Resolve short language name (`python`) to `@ctxo/lang-python` via internal map; accept full package name directly
- **FR-7.2** No arguments → detect missing plugins and offer all
- **FR-7.3** Package manager resolved per D3.6 priority chain
- **FR-7.4** `--global` installs globally; `--dry-run` prints command only
- **FR-7.5** `--version <range>` pins version; default is `^<core-major>.<core-minor>`
- **FR-7.6** Missing `package.json` triggers create/global/abort prompt
- **FR-7.7** Install failure surfaces package manager output, non-zero exit

### 6.8 `ctxo --version`

- **FR-8.1** `--version` alone prints `ctxo X.Y.Z`
- **FR-8.2** `--version --verbose` or `version` subcommand prints core + plugins + Plugin API version + runtime info
- **FR-8.3** `--json` flag produces machine-readable output matching schema in Section 5.5
- **FR-8.4** Plugin version read from plugin's runtime-declared `version` field, with `package.json` fallback

### 6.9 Python Adapter (Phase B)

- **FR-9.1** Extract classes, functions, methods from `.py` and `.pyi` files
- **FR-9.2** Filter private symbols: names starting with `_` excluded except dunder methods (`__init__`, `__repr__`, etc.)
- **FR-9.3** Extract `import X`, `from X import Y` edges (module-level string, no filesystem resolution in syntax tier)
- **FR-9.4** Extract `class Foo(Base):` as `extends` edges
- **FR-9.5** Decorated functions/classes (`@staticmethod`, `@property`, custom decorators) extracted correctly
- **FR-9.6** Cyclomatic complexity nodes: `if`, `elif`, `for`, `while`, `try`, `except`, `match`, ternary, `and`, `or`
- **FR-9.7** Symbol ID format: `<relativeFile>::<ClassName>.<methodName>::method` or `<relativeFile>::<funcName>::function`
- **FR-9.8** Syntax errors return empty arrays; errors logged to stderr

### 6.10 Java Adapter (Phase B)

- **FR-10.1** Extract classes, interfaces, enums, records, methods, constructors from `.java` files
- **FR-10.2** Filter by visibility: `public` and `protected` symbols only. **Open question — see Section 10**: whether to include package-private with `visibility` field
- **FR-10.3** Extract `import com.foo.Bar` edges with qualified name
- **FR-10.4** Distinguish `extends Base` as `extends` edge from `implements Interface` as `implements` edge (semantic, from AST node type)
- **FR-10.5** Handle nested/inner classes with `Outer.Inner` qualified naming
- **FR-10.6** Generics in method signatures: preserve type parameters (**open question — see Section 10**: erased JVM-style vs source form)
- **FR-10.7** Cyclomatic complexity nodes: `if`, `for`, `while`, `do`, `case`, `catch`, ternary, `&&`, `||`
- **FR-10.8** Symbol ID format: `<relativeFile>::<package>.<ClassName>.<methodName>::method`
- **FR-10.9** Syntax errors return empty arrays

---

## 7. Non-Functional Requirements

### 7.1 Performance

- **NFR-1.1** Python adapter: < 100 ms per file for files up to 1000 LOC
- **NFR-1.2** Java adapter: < 150 ms per file for files up to 1000 LOC
- **NFR-1.3** `ctxo --version --verbose` returns in < 200 ms (no network calls)
- **NFR-1.4** `ctxo doctor` without `--check-updates` returns in < 500 ms
- **NFR-1.5** Plugin load overhead: < 50 ms per plugin

### 7.2 Package Size

- **NFR-2.1** `@ctxo/cli` core package unchanged in size from `ctxo-mcp@0.6.6` (no bundled grammars)
- **NFR-2.2** Each `@ctxo/lang-*` plugin < 2 MB on disk (tree-sitter grammar + prebuild binaries)
- **NFR-2.3** C# plugin may be larger due to Roslyn launcher; documented exception

### 7.3 Compatibility

- **NFR-3.1** Node.js >= 20 (unchanged from v0.6)
- **NFR-3.2** tree-sitter peer range `^0.21` (unchanged); each plugin pins its grammar version to match
- **NFR-3.3** Platform prebuild coverage: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64 required; win32-arm64 and alpine-musl best-effort
- **NFR-3.4** MCP protocol response schema additive-only (new optional fields, no removals or renames)

### 7.4 Error Handling

- **NFR-4.1** Plugin load failure → warn, continue without that language
- **NFR-4.2** Per-file parse error → skip file, log to stderr with `[ctxo:<plugin-id>]` namespace, index run continues
- **NFR-4.3** `ctxo install` failure → non-zero exit, package manager output surfaced, `.ctxo/install.log` entry
- **NFR-4.4** MCP tool handlers never throw; always return error envelope

### 7.5 Testing

- **NFR-5.1** Each plugin has unit tests covering: primary symbol extraction, edge extraction, complexity calculation, error handling
- **NFR-5.2** Integration test: `ctxo index` on per-language fixture directory produces expected JSON output
- **NFR-5.3** Minimum 20 tests per plugin (up from C# baseline of 15, reflecting generics/nested class complexity)
- **NFR-5.4** E2E test covers `ctxo install <lang>` → `ctxo index` → `ctxo doctor` happy path
- **NFR-5.5** Test matrix includes "plugin installed" and "plugin not installed" paths for each command

### 7.6 Documentation

- **NFR-6.1** ADR-012 documents plugin protocol decision (this PRD's architectural rationale)
- **NFR-6.2** `CLAUDE.md` language matrix updated; plugin architecture section added
- **NFR-6.3** `README.md` installation section shows `npm i @ctxo/cli @ctxo/lang-python` pattern
- **NFR-6.4** Landing page `pages/lang/python.md` and `pages/lang/java.md` match C# page structure
- **NFR-6.5** Each plugin package has README explaining extensions, tier, limitations
- **NFR-6.6** Migration guide `docs/migration-v0.7.md` for users upgrading from `ctxo-mcp`

### 7.7 Sustainability

- **NFR-7.1** Tier 1 plugin limit: core team commits to maintaining no more than 8 languages. Beyond this, community plugins (Tier 2/3) are expected
- **NFR-7.2** `apiVersion` backward-compat window: at least 12 months between major bump and removal of old version support
- **NFR-7.3** Renovate/Dependabot active on each plugin for weekly dep updates
- **NFR-7.4** `.ctxo/install.log` and `.ctxo/doctor-fix.log` preserve audit trail for supply-chain investigation

---

## 8. Rollout Plan

### 8.1 Phase A — Infrastructure + Extract Existing Adapters (v0.7.0)

**Pre-work (DONE 2026-04-13):**
1. ~~Reserve `ctxo` on npm~~ — blocked by typosquatting filter; `@ctxo/cli` chosen instead
2. ✅ Reserve `@ctxo/cli@0.0.1` placeholder published
3. ✅ Reserve `@ctxo/plugin-api@0.0.1` placeholder published
4. ✅ `@ctxo` organization confirmed owned; 2FA enabled (Windows Hello security key)
5. ⏳ Set up `NPM_TOKEN` secret in GitHub repo (deferred until CI publish in v0.8)

**Monorepo migration:**
5. Restructure: `src/` → `packages/cli/src/`
6. Create `pnpm-workspace.yaml`, root `package.json` with workspace scripts
7. Set up `changesets` with `linked: []`, `access: public`
8. Move `tsconfig.json` → `tsconfig.base.json` + per-package overrides
9. Update GitHub Actions CI to use pnpm install + workspace-aware test/build

**Plugin protocol:**
10. Create `packages/plugin-api/` with `CtxoLanguagePlugin`, `ILanguageAdapter`, `PluginContext`, `IWorkspace` types
11. Implement plugin discovery in `packages/cli/src/adapters/language/plugin-discovery.ts`
12. Implement `IWorkspace` with single-package implementation
13. Extend MCP envelope with optional `workspace` field

**Adapter extraction:**
14. Extract `@ctxo/lang-typescript` from current `ts-morph-adapter.ts`
15. Extract `@ctxo/lang-go` from current Go adapter
16. Extract `@ctxo/lang-csharp` from current C# adapter + Roslyn launcher
17. Update `packages/cli/` to discover extracted plugins; remove direct imports

**User-facing commands:**
18. Add language detection (`detectLanguages()` utility)
19. Extend `ctxo init` with detection + install prompt
20. Extend `ctxo index` with `--install-missing` flag + language-aware summary
21. Extend `ctxo doctor` with Versions section + language coverage check
22. Implement `ctxo doctor --fix` with dependency-ordered execution
23. Add new `ctxo install` command
24. Extend `ctxo --version` with verbose + JSON modes

**Release:**
25. Write ADR-012
26. Deprecate `ctxo-mcp` on npm with migration message
27. Update `CLAUDE.md`, `README.md`, `llms.txt`
28. Tag and publish `@ctxo/cli@0.7.0`, `@ctxo/plugin-api@0.7.0`, `@ctxo/lang-*@0.7.0`; `npm deprecate ctxo-mcp "Renamed to @ctxo/cli. Install with: npm i -g @ctxo/cli"`

### 8.2 Phase B — Python + Java Plugins (v0.7.x)

29. Add `packages/lang-python/` with tree-sitter-python adapter
30. Add `packages/lang-java/` with tree-sitter-java adapter
31. Unit tests (20+ per plugin)
32. E2E fixtures: `tests/e2e/fixtures/python-sample/`, `tests/e2e/fixtures/java-sample/`
33. Add `python` and `java` short names to `ctxo install` resolver
34. Landing page docs: `pages/lang/python.md`, `pages/lang/java.md`
35. Resolve open questions from Section 10 before tagging
36. Tag and publish `@ctxo/lang-python@0.7.x`, `@ctxo/lang-java@0.7.x`

### 8.3 Phase C — Polish + Community Foundation (v0.8.0)

37. Community plugin template repo (`ctxo-lang-template`) with scaffolding
38. Plugin registry / awesome list curation
39. Benchmark harness validating NFR-1 performance budgets
40. Real-world validation: index OSS projects (Django PetClinic for Python, Spring PetClinic for Java)
41. `changesets-action` automated release PR bot
42. CI-based `npm publish` (manual trigger kept for now, automated next)

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Plugin protocol v1 design flaw discovered after release | High | Phase A validates protocol with 3 known-good adapters before Phase B. Can iterate `apiVersion` as '1.1' for additive changes |
| Monorepo migration breaks existing CI or publish | Medium | Pre-work step (reserve packages + test workspace locally) before merging. Dry-run publish with `--dry-run` flag |
| `ctxo-mcp` users don't notice deprecation, stay on v0.6.6 | Medium | Deprecation message prints on every `npm install ctxo-mcp`. README/landing page updated. Social post on release |
| Auto-install creates lockfile drift in CI | Medium | CI detection + `--yes` requirement + `--no-install` escape hatch. `ctxo index` never installs without `--install-missing` |
| tree-sitter peer conflict when grammar major bumps | Medium | Each plugin pins its grammar range. Core's peer range unchanged from v0.6. Upgrade deferred to dedicated tree-sitter upgrade ADR |
| Native binary compile fails on exotic platforms (win32-arm64, musl) | Medium | Documented platform support matrix. Graceful fallback mesage on install failure. Community plugin template documents prebuild requirements |
| Users expect framework-aware analysis (Spring annotations, Django ORM) | Low | README and landing page explicitly scope syntax tier. Framework-aware analysis is roadmap for future full-tier PRDs |
| Monorepo forces contributors through unfamiliar pnpm/changesets workflow | Low | CONTRIBUTING.md with commands. pnpm workspaces are standard in modern TS ecosystem |
| `@ctxo` scope squatted or lost | Low | Organization already owned. 2FA enforced. Placeholder packages reserve names |
| Plugin load order nondeterministic causing extension conflict | Low | Explicit order via config or alphabetical by package name. Warning on conflict |
| Doctor `--fix` applies unwanted change in user repo | Low | Prompted by default, `--yes` required for CI. `--dry-run` supported. `.ctxo/doctor-fix.log` audit trail |

---

## 10. Open Questions (Must Resolve Before Phase B Tag)

Carried over from prior review; must be answered before Python/Java plugins tag as stable.

1. **Python private symbols visibility**
   Current plan: exclude leading-underscore names (except dunders). Alternative: include all with a `visibility: 'public' | 'private'` field letting consumers filter. Leaning toward inclusion — more data is better than hidden data, filtering is cheap.

2. **Java package-private visibility**
   Current plan: `public`/`protected` only. Problem: most Spring `@Service` classes are package-private, so the "BaseService refactor" user story under-reports. Leaning toward inclusion with `visibility` field, same pattern as Q1.

3. **Java generics representation in symbol names**
   Current plan: preserve source form (`List<String>`). Problem: JVM erases generics so `add(List<String>)` and `add(List<Integer>)` are the same symbol at runtime. Alternative: use JVM-erased signatures (`add(Ljava/util/List;)V`) for precision. Source form is more user-friendly; erased form is more accurate. Likely keep source form + document the limitation.

4. **Python module import resolution**
   FR-9.3 says "module-level string, no filesystem resolution." User Story US-1 expects `find_importers("UserSerializer")` to return non-empty. Resolve mismatch: either implement simple `sys.path`-agnostic module→file mapping or loosen the user story to name-based match. Leaning toward name-based match with a `moduleResolved: boolean` field — full resolution belongs in full-tier Pyright PRD.

5. **tree-sitter version upgrade trajectory**
   Current pin `^0.21` is aging (2024 release). When do we plan the upgrade to 0.25+? Not a Phase A/B blocker but needs an ADR reserved in the roadmap. Don't attempt inside this PRD.

6. **Python/Java plugin default install behavior in monorepo root**
   When `ctxo init` runs at the root of a Scenario B monorepo (Nx/Turborepo), where should plugins install? Current answer: root `package.json` per D3.2. Risk: unused in packages that don't need Python. Acceptable trade-off; Monorepo Workspace PRD will revisit with per-package scope.

7. **Short-name collision on `ctxo install <lang>`**
   If community publishes both `@ctxo/lang-kotlin` and `ctxo-lang-kotlin`, which does `ctxo install kotlin` resolve to? Propose: prefer scoped (`@ctxo/*`); warn if both present; community package can be installed by full name.

---

## 11. Success Metrics

### Quantitative

- **Coverage**: ctxo supports 5 languages post-Phase B (TypeScript, Go, C#, Python, Java), covering ~80% of top-10 GitHub languages by usage
- **Adoption**: 30% of new ctxo installations on Python or Java projects within 30 days of Phase B release
- **Tarball**: `@ctxo/cli` core tarball size within ±10% of `ctxo-mcp@0.6.6` (plugin externalization succeeded)
- **Performance**: p95 index time < 150 ms per file for Python and Java
- **Plugin quality**: each Tier 1 plugin has ≥ 20 tests, 100% of acceptance criteria passing
- **Version clarity**: 0 support issues related to "which plugin version works with my ctxo" within 90 days

### Qualitative

- Python developer completes US-1 (Django onboarding) end-to-end in under 5 minutes
- Java developer completes US-2 (Spring refactor blast radius) with semantically correct `extends`/`implements` distinction
- Plugin protocol documentation enables an external contributor to publish a community plugin (e.g. Ruby, Kotlin) without core team assistance by v0.8
- At least one community success story (blog, tweet, discussion) about Python or Java support within 60 days

---

## 12. References

- [Monorepo Workspace Support PRD](prd-monorepo-workspace-support.md) — deferred follow-up for Nx/Turborepo/pnpm workspace scenarios
- [CLAUDE.md](../../CLAUDE.md) — project-wide conventions, will be updated with plugin architecture
- [ADR-007: C# Full-Tier via Roslyn](adr-007-csharp-roslyn-lsp.md) — template for language-specific ADR
- [PRD: Main](prd.md) — FR-12 Multi-Language Support
- [Architecture](architecture.md) — hexagonal adapter pattern, extended with plugin discovery
- [tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python)
- [tree-sitter-java](https://github.com/tree-sitter/tree-sitter-java)
- [changesets](https://github.com/changesets/changesets)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [npm optional dependencies trade-offs — Puppeteer case study](https://github.com/puppeteer/puppeteer/issues/8148)

---

## 13. Change Log

| Date | Change |
|---|---|
| 2026-04-13 | Complete rewrite. Original v1 (Python/Java syntax-tier only, bundled package) replaced with plugin architecture + monorepo + auto-install + doctor fix + version visibility. Decision Log inlined. Multi-language monorepo split into separate deferred PRD. |
| 2026-04-13 | Primary package renamed from proposed `ctxo` (unscoped, blocked by npm typosquatting filter) to `@ctxo/cli` (scoped). Decision D1.2 and D1.3 updated. `@ctxo/cli@0.0.1` and `@ctxo/plugin-api@0.0.1` placeholders published. Monorepo folder `packages/core/` → `packages/cli/`. User-facing bin name remains `ctxo` — no UX change. |
