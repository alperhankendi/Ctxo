# ctxo update — Self-Update Mechanism

**Status:** Draft
**Date:** 2026-05-15
**Owner:** Alper Hankendi

## Goal

Add a `ctxo update` subcommand that tells the user whether `@ctxo/cli` and their installed `@ctxo/lang-*` plugins have newer releases on npm, and either installs the updates or prints the exact command the user should run.

Removes the inertia of "is my ctxo current?" — today the user must manually run `npm outdated` or check the changelog. Standard hygiene feature for CLIs.

## Non-Goals

- No background/auto-update at server start.
- No self-replace of a globally-installed binary; we shell out to the user's package manager just like `ctxo install` does.
- No CHANGELOG diff rendering — point at the npm page or GitHub release in the output, do not fetch and parse changelogs.
- No telemetry beyond what `stats` already collects.

## User Surface

```
ctxo update                       # check + execute (or print fallback)
ctxo update --check               # check only, do not install; exit 0 always
ctxo update --print               # check + print command; never execute
ctxo update --global              # force a global install
ctxo update --json                # machine-readable output
ctxo update --pm <npm|pnpm|yarn|bun>   # override package manager
ctxo update --force                # bypass CI lockfile guard (mirrors `ctxo install`)
```

`--check` exits 0 unconditionally. The output communicates state; CI scripts that want to gate on "no updates available" can parse the JSON output.

## Behavior

### 1. Discovery

Reuse `plugin-discovery.ts` to enumerate installed `@ctxo/lang-*` and `ctxo-lang-*` plugin packages. Always include `@ctxo/cli` itself. The current version of `@ctxo/cli` comes from `getVersion()` in `cli-router.ts`.

### 2. Channel detection

Parse each package's current version with a minimal semver split:

- If the version contains a prerelease tag (e.g. `0.7.0-alpha.0`), the channel is the first dotted segment of that tag (`alpha`, `beta`, `rc`, `next`).
- Otherwise, the channel is `latest`.

Each package picks its own channel from its own current version. An alpha CLI does not force plugins onto alpha — if a plugin is currently on a stable version, its update target stays on `latest`.

### 3. Registry lookup

For each package, fetch `https://registry.npmjs.org/<encoded-pkg-name>` over `node:https`. Parse the JSON and read the `dist-tags` map. The "target version" for the package is `dist-tags[channel]` (e.g. `dist-tags.alpha`). If the chosen channel does not exist in `dist-tags`, fall back to `dist-tags.latest` (so a plugin published only as stable still surfaces a recommendation for an alpha-tracked user).

Requests run concurrently via `Promise.all`. Per-request timeout: 5 seconds.

#### Error policy

| Condition | Behavior |
| --- | --- |
| Connectivity failure for every request (DNS, ECONNRESET, all timing out) | Print error to stderr, exit code 1 (`fail loud`) |
| HTTP 404 for an individual package (private/community plugin not on the public registry) | Render row as `not found on registry`, status `unknown`, continue with others |
| HTTP non-2xx other than 404 | Render row as `error <status>`, status `unknown`, continue |
| Body is not valid JSON | Same as non-2xx |

The overall command fails only when *every* fetch fails. Mixed success/failure surfaces per-row and the command still exits 0 — the user sees which packages got checked.

### 4. Comparison

For each package, compare `current` vs `target`:

- If `current === target` → status `current`.
- If `current < target` (semver) → status `update`.
- If `current > target` (somehow ahead, e.g. running a locally-built dev build) → status `ahead`, not included in the install plan.

A minimal semver comparator lives in `update-plan.ts`. No new dependency.

### 5. Install plan

Collect all packages with status `update` into a single install invocation:

1. Resolve package manager via existing `resolvePackageManager` from `core/install/package-manager.ts` (respects `--pm`, `CTXO_PM`, `.ctxo/config.yaml`, lockfile, default npm).
2. Build the install command via `buildInstallCommand`, passing every updatable specifier as `<pkg>@<target>`.

### 6. Install strategy (auto-execute with --print fallback)

| Situation | Action |
| --- | --- |
| `--print` flag passed | Print the command and exit 0. |
| `--global` flag passed | Build install with `global: true` and execute. |
| No `package.json` at the project root | Build a global install command and **print** it (do not execute). User must copy/run with their own privileges. |
| `package.json` exists but lists no `@ctxo/*` in deps/devDependencies | Same as previous row — print global command, do not execute. |
| `package.json` exists and lists at least one `@ctxo/*` | Local install: execute the install command via `spawn` (`stdio: 'inherit'`), `cwd = projectRoot`, `shell: process.platform === 'win32'`. |
| `--check` flag passed | Never reach this step — exit after rendering the table. |

This matches the spec's "Print command rather than auto-execute" risk note for the genuinely risky case (global install) while keeping the happy path (local devDependency) frictionless.

The CI guard from `install-command.ts` (`CI=true` + frozen lockfile refusal) is preserved — refuse to mutate in CI unless `--force` or `--global` is passed.

### 7. Output

**Text mode (default):**

```
ctxo update — checking registry for updates…

PACKAGE                  CURRENT          LATEST (alpha)   STATUS
@ctxo/cli                0.7.0-alpha.0    0.7.0-alpha.3    update
@ctxo/lang-typescript    0.7.0-alpha.0    0.7.0-alpha.0    up to date
@ctxo/lang-go            0.7.0-alpha.0    0.7.0-alpha.2    update
@ctxo/lang-csharp        0.6.2            0.7.0            update (latest)
ctxo-lang-kotlin         0.1.0            (not found)      skipped

Plan: pnpm add -D @ctxo/cli@0.7.0-alpha.3 @ctxo/lang-go@0.7.0-alpha.2 @ctxo/lang-csharp@0.7.0
Using pnpm (lockfile: pnpm-lock.yaml)

Running…
```

The `LATEST (<channel>)` column header reflects the dominant channel (CLI's channel). Rows where the chosen channel differs from the row's channel get a trailing `(<channel>)` next to their status, like `update (latest)`.

When the strategy is print-only:

```
To update, run:
  pnpm add -D @ctxo/cli@0.7.0-alpha.3 @ctxo/lang-go@0.7.0-alpha.2
```

When nothing to update:

```
ctxo update — checking registry for updates…

All 4 packages are up to date.
```

**JSON mode (`--json`):**

```json
{
  "ctxo": "0.7.0-alpha.0",
  "channel": "alpha",
  "packages": [
    { "name": "@ctxo/cli", "current": "0.7.0-alpha.0", "latest": "0.7.0-alpha.3", "channel": "alpha", "status": "update" },
    { "name": "@ctxo/lang-typescript", "current": "0.7.0-alpha.0", "latest": "0.7.0-alpha.0", "channel": "alpha", "status": "current" },
    { "name": "@ctxo/lang-csharp", "current": "0.6.2", "latest": "0.7.0", "channel": "latest", "status": "update" },
    { "name": "ctxo-lang-kotlin", "current": "0.1.0", "latest": null, "status": "unknown", "reason": "registry-404" }
  ],
  "plan": {
    "manager": "pnpm",
    "managerSource": "lockfile",
    "global": false,
    "command": "pnpm",
    "args": ["add", "-D", "@ctxo/cli@0.7.0-alpha.3", "@ctxo/lang-csharp@0.7.0"]
  },
  "executed": true,
  "exitCode": 0
}
```

For `--check`, `plan` is still computed and returned but never executed; `executed` is `false` and `exitCode` is omitted.

## Files

```
packages/cli/src/core/update/
  registry-client.ts        # pure fetcher: dist-tags via node:https
  update-plan.ts            # pure: channel pick, semver compare, plan assembly
  __tests__/
    registry-client.test.ts
    update-plan.test.ts

packages/cli/src/cli/
  update-command.ts         # CLI orchestration: discover, fetch, render, execute/print
  __tests__/
    update-command.test.ts
```

### `core/update/registry-client.ts`

Pure interface:

```ts
export interface RegistryDistTags { readonly [tag: string]: string }

export interface RegistryHit {
  readonly name: string;
  readonly distTags: RegistryDistTags;
}

export interface RegistryMiss {
  readonly name: string;
  readonly reason: 'registry-404' | 'registry-error' | 'timeout' | 'network';
  readonly status?: number;
  readonly message?: string;
}

export type RegistryResult = RegistryHit | RegistryMiss;

export interface FetchOptions {
  readonly timeoutMs?: number;        // default 5000
  readonly fetcher?: HttpsFetcher;    // injectable for tests
}

export type HttpsFetcher = (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>;

export async function fetchDistTags(
  packageName: string,
  options?: FetchOptions,
): Promise<RegistryResult>;

export async function fetchDistTagsBatch(
  packageNames: readonly string[],
  options?: FetchOptions,
): Promise<RegistryResult[]>;
```

The default `HttpsFetcher` uses `node:https`. Tests inject a fake fetcher so no network is touched.

### `core/update/update-plan.ts`

Pure functions:

```ts
export type Channel = 'latest' | 'alpha' | 'beta' | 'rc' | 'next' | string;

export function detectChannel(version: string): Channel;

export interface PackageState {
  readonly name: string;
  readonly current: string;
  readonly latest: string | null;          // null if registry miss
  readonly channel: Channel;
  readonly status: 'current' | 'update' | 'ahead' | 'unknown';
  readonly reason?: 'registry-404' | 'registry-error' | 'timeout' | 'network';
}

export function computePackageStates(
  installed: ReadonlyArray<{ name: string; version: string }>,
  results: readonly RegistryResult[],
): PackageState[];

export function selectInstallTargets(states: readonly PackageState[]): ReadonlyArray<{ name: string; version: string }>;

// Minimal semver: compare two version strings; treats prerelease per semver §11.
export function compareSemver(a: string, b: string): -1 | 0 | 1;
```

### `cli/update-command.ts`

`UpdateCommand` class mirroring `InstallCommand` shape:

```ts
export interface UpdateOptions {
  readonly check?: boolean;
  readonly print?: boolean;
  readonly global?: boolean;
  readonly json?: boolean;
  readonly pm?: string;
  readonly force?: boolean;
}

export class UpdateCommand {
  constructor(private readonly projectRoot: string) {}
  async run(options: UpdateOptions = {}): Promise<void>;
}
```

Pure renderer functions exported alongside the class (mirroring `version-command.ts` `formatVerbose` / `formatJson`) so the test can verify formatting without running the whole pipeline.

### `cli/cli-router.ts`

Add a `case 'update'` block that parses `--check`, `--print`, `--global`, `--json`, `--pm <value>`, `--force`. Add a `ctxo update` entry to the help text.

## Tests

### `registry-client.test.ts`

- Happy path: injected fetcher returns 200 with valid body containing `dist-tags`.
- 404: returns `RegistryMiss` with `reason: 'registry-404'`.
- Non-200 / non-404: returns `RegistryMiss` with `reason: 'registry-error'` and status.
- Timeout: fetcher rejects with timeout error → `reason: 'timeout'`.
- Network refusal: fetcher rejects with ECONNREFUSED → `reason: 'network'`.
- Body is not JSON → `reason: 'registry-error'`.
- Batch with mixed results: order preserved, no early abort.

### `update-plan.test.ts`

- `detectChannel`: stable, alpha, beta, rc, next, weird tags.
- `compareSemver`: standard cases, prerelease vs release, multi-digit segments, equal.
- `computePackageStates`:
  - Hit with `dist-tags.alpha` present → `update`.
  - Hit with chosen channel missing, `latest` present → `update` against `latest`.
  - Hit with `current === latest` → `current`.
  - Hit with `current > latest` → `ahead`.
  - Miss → `unknown` with reason carried through.
- `selectInstallTargets`: only `status === 'update'` packages emit specifiers.

### `update-command.test.ts`

Integration with mocked dependencies (vitest `vi.mock` for `registry-client` and `spawn`):

- `--check`: runs discovery + fetch, prints table, never spawns.
- `--print`: builds plan, prints command, never spawns.
- Default with `package.json` listing `@ctxo/cli`: spawns the install command, exits 0 on child exit 0.
- Default without `package.json`: prints global install command, never spawns.
- `--global`: spawns the global install command.
- `--json`: produces well-formed JSON for both check and execute modes.
- Network failure (every fetch fails): exits 1, prints error.
- Mixed success/404 plugin: still exits 0, plan excludes the 404 package.
- `--pm pnpm` overrides resolution.
- CI lockfile guard: `CI=true` without `--force` and without `--global` refuses; with `--force` proceeds; with `--global` proceeds.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Permission errors on global install | Default never executes global; prints command. `--global` is opt-in and inherits the user's shell. |
| Registry rate-limiting on bursty calls | One request per installed package, run once per invocation; npm registry has generous limits for unauthenticated reads. Timeout caps blast radius. |
| Slow network blocks the user | 5s timeout per request and `Promise.all`. Worst case: 5s for the whole command if registry is down. |
| Hand-rolled semver comparator getting subtle cases wrong | Cover with focused unit tests including prerelease ordering. If maintenance burden grows, swap to `semver` package in a follow-up. |
| Prerelease user gets pushed onto stable | Per-package channel detection: alpha stays alpha unless the chosen channel does not exist on registry, in which case latest is the fallback (with explicit `(latest)` annotation in output). |
| `package.json` exists but is unrelated to ctxo (e.g. a sibling repo where ctxo is global) | Strategy treats absence of `@ctxo/*` in deps as "global install needed" and prints rather than mutating an unrelated `package.json`. |

## Out of scope (deferred)

- Caching the registry response. Always fetches.
- Update notifications on `ctxo` server start. Separate UX concern; can land in a follow-up that pings the registry asynchronously and surfaces a one-line notice.
- Auto-update plugins discovered for languages the user has not opted into. We only touch what is already installed.
- Changelog rendering. Output points at npm/GitHub Releases.
