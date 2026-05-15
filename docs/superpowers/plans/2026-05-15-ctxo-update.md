# ctxo update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ctxo update` subcommand that checks the npm registry for newer versions of `@ctxo/cli` and installed `@ctxo/lang-*` / `ctxo-lang-*` plugins, then either executes a local install or prints the install command for the user to run.

**Architecture:** Two pure modules in `core/update/` (registry fetcher and semver/plan helpers) feed an orchestrating `UpdateCommand` class in `cli/`. Channel detection is per-package (alpha stays alpha, stable stays stable). Install strategy is auto-execute when the project has `@ctxo/*` in its `package.json`, otherwise print the command. The CLI router gains a new `update` case. No new runtime dependencies — uses `node:https` and the existing `package-manager.ts` install builder.

**Tech Stack:** TypeScript 5.x (strict ESM), vitest with `vi.mock` for spawn and HTTPS, existing `plugin-discovery.ts` for package enumeration, existing `resolvePackageManager` / `buildInstallCommand` for install plumbing.

---

## File Map

**New:**
- `packages/cli/src/core/update/registry-client.ts` — pure HTTPS fetcher returning `RegistryHit | RegistryMiss`.
- `packages/cli/src/core/update/update-plan.ts` — pure: channel detection, semver compare, state computation, install target selection.
- `packages/cli/src/core/update/__tests__/registry-client.test.ts`
- `packages/cli/src/core/update/__tests__/update-plan.test.ts`
- `packages/cli/src/core/install/run-package-manager.ts` — extract the spawn helper so both `install` and `update` reuse it.
- `packages/cli/src/cli/update-command.ts` — `UpdateCommand` class + pure `formatText` / `formatJson` renderers.
- `packages/cli/src/cli/__tests__/update-command.test.ts`

**Modified:**
- `packages/cli/src/cli/install-command.ts` — replace inline `spawnInstall` with import from `run-package-manager.ts`.
- `packages/cli/src/cli/cli-router.ts` — add `update` case + help text.
- `packages/cli/src/cli/__tests__/cli-router.test.ts` — assert routing for `update` and its flags.
- `CLAUDE.md` — add `ctxo update` to the Quick Reference block.

---

## Task 1: Extract spawn helper into a shared module

**Files:**
- Create: `packages/cli/src/core/install/run-package-manager.ts`
- Modify: `packages/cli/src/cli/install-command.ts`

Lift the existing private `spawnInstall` out of `install-command.ts` so `update-command.ts` can reuse it without duplicating the platform-shell logic. Pure refactor — no behavior change.

- [ ] **Step 1.1: Move the spawn helper to a shared module**

Read the current `spawnInstall` function in `packages/cli/src/cli/install-command.ts` (last function in the file). Create `packages/cli/src/core/install/run-package-manager.ts` and paste the same function there, renamed to `runPackageManager`. Export it as a named export. Keep the same signature: `(command: string, args: readonly string[], cwd: string) => Promise<number>`.

- [ ] **Step 1.2: Update install-command.ts to use the shared helper**

In `packages/cli/src/cli/install-command.ts`:
- Remove the import of `spawn` from `node:child_process`.
- Remove the local `spawnInstall` function definition.
- Add `import { runPackageManager } from '../core/install/run-package-manager.js';`.
- Replace the single call site `await spawnInstall(...)` with `await runPackageManager(...)`.

- [ ] **Step 1.3: Run the existing test suite to confirm no behavior change**

Run: `pnpm --filter @ctxo/cli test`
Expected: ALL existing tests pass.

- [ ] **Step 1.4: Commit**

```bash
git add packages/cli/src/core/install/run-package-manager.ts packages/cli/src/cli/install-command.ts
git commit -m "refactor(install): extract spawn helper for shared use"
```

---

## Task 2: Registry client — pure HTTPS fetch + result types

**Files:**
- Create: `packages/cli/src/core/update/registry-client.ts`
- Test: `packages/cli/src/core/update/__tests__/registry-client.test.ts`

Pure function that takes a package name and returns either the `dist-tags` map or a typed miss. The HTTPS fetcher is injectable so tests never touch the network.

- [ ] **Step 2.1: Write the failing tests**

Create `packages/cli/src/core/update/__tests__/registry-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  fetchDistTags,
  fetchDistTagsBatch,
  type HttpsFetcher,
  type RegistryHit,
  type RegistryMiss,
} from '../registry-client.js';

function fakeFetcher(map: Record<string, { status: number; body: string } | Error>): HttpsFetcher {
  return async (url) => {
    const entry = Object.entries(map).find(([key]) => url.includes(encodeURIComponent(key)) || url.includes(key));
    if (!entry) throw new Error(`unexpected URL ${url}`);
    const value = entry[1];
    if (value instanceof Error) throw value;
    return value;
  };
}

describe('fetchDistTags', () => {
  it('returns a RegistryHit with dist-tags on 200 response', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { latest: '0.7.0', alpha: '0.7.1-alpha.0' } }) },
    });
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toEqual<RegistryHit>({
      name: '@ctxo/cli',
      distTags: { latest: '0.7.0', alpha: '0.7.1-alpha.0' },
    });
  });

  it('returns a registry-404 miss when status is 404', async () => {
    const fetcher = fakeFetcher({
      'ctxo-lang-kotlin': { status: 404, body: '{"error":"Not found"}' },
    });
    const result = await fetchDistTags('ctxo-lang-kotlin', { fetcher });
    expect(result).toEqual<RegistryMiss>({
      name: 'ctxo-lang-kotlin',
      reason: 'registry-404',
      status: 404,
    });
  });

  it('returns a registry-error miss for non-2xx, non-404 statuses', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 503, body: 'temporarily unavailable' },
    });
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'registry-error', status: 503 });
  });

  it('returns a registry-error miss when body is not JSON', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 200, body: 'not-json{' },
    });
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'registry-error' });
  });

  it('returns a registry-error miss when dist-tags is missing or not an object', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 200, body: JSON.stringify({ name: '@ctxo/cli' }) },
    });
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'registry-error' });
  });

  it('returns a timeout miss when fetcher throws a timeout error', async () => {
    const fetcher: HttpsFetcher = async () => { const e: NodeJS.ErrnoException = new Error('timeout'); e.code = 'ETIMEDOUT'; throw e; };
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'timeout' });
  });

  it('returns a network miss when fetcher throws a connection error', async () => {
    const fetcher: HttpsFetcher = async () => { const e: NodeJS.ErrnoException = new Error('refused'); e.code = 'ECONNREFUSED'; throw e; };
    const result = await fetchDistTags('@ctxo/cli', { fetcher });
    expect(result).toMatchObject({ name: '@ctxo/cli', reason: 'network' });
  });

  it('url-encodes scoped package names', async () => {
    let seenUrl = '';
    const fetcher: HttpsFetcher = async (url) => { seenUrl = url; return { status: 200, body: JSON.stringify({ 'dist-tags': { latest: '1.0.0' } }) }; };
    await fetchDistTags('@ctxo/cli', { fetcher });
    expect(seenUrl).toBe('https://registry.npmjs.org/@ctxo%2Fcli');
  });
});

describe('fetchDistTagsBatch', () => {
  it('preserves input order and mixes hits with misses', async () => {
    const fetcher = fakeFetcher({
      '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { latest: '0.7.0' } }) },
      'ctxo-lang-kotlin': { status: 404, body: '{}' },
    });
    const results = await fetchDistTagsBatch(['@ctxo/cli', 'ctxo-lang-kotlin'], { fetcher });
    expect(results.map((r) => r.name)).toEqual(['@ctxo/cli', 'ctxo-lang-kotlin']);
    expect((results[0] as RegistryHit).distTags.latest).toBe('0.7.0');
    expect((results[1] as RegistryMiss).reason).toBe('registry-404');
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `pnpm --filter @ctxo/cli test -- registry-client`
Expected: FAIL with module-not-found error for `../registry-client.js`.

- [ ] **Step 2.3: Implement the registry client**

Create `packages/cli/src/core/update/registry-client.ts`:

```ts
import { request } from 'node:https';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:update:registry');

export interface RegistryDistTags {
  readonly [tag: string]: string;
}

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
  readonly timeoutMs?: number;
  readonly fetcher?: HttpsFetcher;
}

export type HttpsFetcher = (url: string, timeoutMs: number) => Promise<{ status: number; body: string }>;

const DEFAULT_TIMEOUT_MS = 5_000;

export async function fetchDistTags(
  packageName: string,
  options: FetchOptions = {},
): Promise<RegistryResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetcher = options.fetcher ?? defaultHttpsFetcher;
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;

  let response: { status: number; body: string };
  try {
    response = await fetcher(url, timeoutMs);
  } catch (err) {
    return classifyFetchError(packageName, err);
  }

  if (response.status === 404) {
    return { name: packageName, reason: 'registry-404', status: 404 };
  }
  if (response.status < 200 || response.status >= 300) {
    return { name: packageName, reason: 'registry-error', status: response.status };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return { name: packageName, reason: 'registry-error', status: response.status, message: 'invalid JSON' };
  }
  const distTags = (parsed as { 'dist-tags'?: unknown })['dist-tags'];
  if (!distTags || typeof distTags !== 'object') {
    return { name: packageName, reason: 'registry-error', status: response.status, message: 'missing dist-tags' };
  }
  return { name: packageName, distTags: distTags as RegistryDistTags };
}

export async function fetchDistTagsBatch(
  packageNames: readonly string[],
  options: FetchOptions = {},
): Promise<RegistryResult[]> {
  return Promise.all(packageNames.map((name) => fetchDistTags(name, options)));
}

function classifyFetchError(name: string, err: unknown): RegistryMiss {
  const code = (err as NodeJS.ErrnoException)?.code;
  const message = (err as Error)?.message ?? String(err);
  if (code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return { name, reason: 'timeout', message };
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { name, reason: 'network', message };
  }
  log.error(`unexpected fetch error for ${name}: ${message}`);
  return { name, reason: 'network', message };
}

const defaultHttpsFetcher: HttpsFetcher = (url, timeoutMs) => new Promise((resolve, reject) => {
  const req = request(url, { method: 'GET', headers: { 'user-agent': 'ctxo-update', accept: 'application/json' } }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    res.on('error', reject);
  });
  req.setTimeout(timeoutMs, () => {
    req.destroy(Object.assign(new Error(`timeout after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }));
  });
  req.on('error', reject);
  req.end();
});
```

- [ ] **Step 2.4: Run the tests to verify they pass**

Run: `pnpm --filter @ctxo/cli test -- registry-client`
Expected: PASS for every case.

- [ ] **Step 2.5: Commit**

```bash
git add packages/cli/src/core/update/registry-client.ts packages/cli/src/core/update/__tests__/registry-client.test.ts
git commit -m "feat(update): add npm registry dist-tags client"
```

---

## Task 3: Channel detection + semver compare

**Files:**
- Create: `packages/cli/src/core/update/update-plan.ts` (partial — channel + compareSemver only)
- Test: `packages/cli/src/core/update/__tests__/update-plan.test.ts`

Pure helpers needed before computing per-package states. The state machinery follows in Task 4.

- [ ] **Step 3.1: Write the failing tests**

Create `packages/cli/src/core/update/__tests__/update-plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectChannel, compareSemver } from '../update-plan.js';

describe('detectChannel', () => {
  it('returns "latest" for stable versions', () => {
    expect(detectChannel('0.7.0')).toBe('latest');
    expect(detectChannel('10.20.30')).toBe('latest');
  });

  it('returns the prerelease channel for tagged versions', () => {
    expect(detectChannel('0.7.0-alpha.0')).toBe('alpha');
    expect(detectChannel('1.0.0-beta.3')).toBe('beta');
    expect(detectChannel('2.0.0-rc.1')).toBe('rc');
    expect(detectChannel('3.0.0-next.4')).toBe('next');
  });

  it('falls back to "latest" when prerelease label is missing or numeric-only', () => {
    expect(detectChannel('1.0.0-')).toBe('latest');
    expect(detectChannel('1.0.0-0')).toBe('latest');
  });
});

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('0.7.0-alpha.0', '0.7.0-alpha.0')).toBe(0);
  });

  it('orders by major, then minor, then patch', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.2.0', '1.3.0')).toBe(-1);
    expect(compareSemver('1.2.10', '1.2.9')).toBe(1);
  });

  it('treats prerelease as lower precedence than the equivalent release', () => {
    expect(compareSemver('1.0.0-alpha.0', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-alpha.0')).toBe(1);
  });

  it('orders prerelease identifiers per semver section 11', () => {
    expect(compareSemver('1.0.0-alpha.0', '1.0.0-alpha.1')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1); // numeric, not lexical
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1); // numeric < non-numeric
  });

  it('ignores build metadata', () => {
    expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `pnpm --filter @ctxo/cli test -- update-plan`
Expected: FAIL with module-not-found.

- [ ] **Step 3.3: Implement channel detection and semver compare**

Create `packages/cli/src/core/update/update-plan.ts`:

```ts
export type Channel = 'latest' | 'alpha' | 'beta' | 'rc' | 'next' | string;

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[]; // empty array means release
}

function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_RE.exec(version.trim());
  if (!match) return null;
  const prereleaseRaw = match[4] ?? '';
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: prereleaseRaw ? prereleaseRaw.split('.') : [],
  };
}

export function detectChannel(version: string): Channel {
  const parsed = parseSemver(version);
  if (!parsed || parsed.prerelease.length === 0) return 'latest';
  const first = parsed.prerelease[0]!;
  if (/^\d+$/.test(first)) return 'latest';
  return first;
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  // Prerelease ordering per semver section 11.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;  // release > prerelease
  if (pb.prerelease.length === 0) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const an = Number(ai); const bn = Number(bi);
      if (an !== bn) return an < bn ? -1 : 1;
    } else if (aNum && !bNum) {
      return -1; // numeric < non-numeric
    } else if (!aNum && bNum) {
      return 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

Run: `pnpm --filter @ctxo/cli test -- update-plan`
Expected: PASS for every case in this task.

- [ ] **Step 3.5: Commit**

```bash
git add packages/cli/src/core/update/update-plan.ts packages/cli/src/core/update/__tests__/update-plan.test.ts
git commit -m "feat(update): add channel detection and semver comparator"
```

---

## Task 4: Package state computation + install target selection

**Files:**
- Modify: `packages/cli/src/core/update/update-plan.ts`
- Modify: `packages/cli/src/core/update/__tests__/update-plan.test.ts`

Adds `PackageState`, `computePackageStates`, and `selectInstallTargets`. Reuses Task 3's helpers.

- [ ] **Step 4.1: Append the failing tests**

Append to `packages/cli/src/core/update/__tests__/update-plan.test.ts`:

```ts
import { computePackageStates, selectInstallTargets } from '../update-plan.js';
import type { RegistryResult } from '../registry-client.js';

describe('computePackageStates', () => {
  const installed = [
    { name: '@ctxo/cli', version: '0.7.0-alpha.0' },
    { name: '@ctxo/lang-typescript', version: '0.7.0-alpha.0' },
    { name: '@ctxo/lang-csharp', version: '0.6.2' },
    { name: 'ctxo-lang-kotlin', version: '0.1.0' },
  ];

  it('marks packages with newer dist-tag as update', () => {
    const results: RegistryResult[] = [
      { name: '@ctxo/cli', distTags: { latest: '0.7.0', alpha: '0.7.0-alpha.3' } },
      { name: '@ctxo/lang-typescript', distTags: { latest: '0.7.0', alpha: '0.7.0-alpha.0' } },
      { name: '@ctxo/lang-csharp', distTags: { latest: '0.7.0' } },
      { name: 'ctxo-lang-kotlin', reason: 'registry-404', status: 404 },
    ];
    const states = computePackageStates(installed, results);
    expect(states[0]).toMatchObject({ name: '@ctxo/cli', current: '0.7.0-alpha.0', latest: '0.7.0-alpha.3', channel: 'alpha', status: 'update' });
    expect(states[1]).toMatchObject({ name: '@ctxo/lang-typescript', latest: '0.7.0-alpha.0', status: 'current' });
    expect(states[2]).toMatchObject({ name: '@ctxo/lang-csharp', latest: '0.7.0', channel: 'latest', status: 'update' });
    expect(states[3]).toMatchObject({ name: 'ctxo-lang-kotlin', latest: null, status: 'unknown', reason: 'registry-404' });
  });

  it('falls back to dist-tags.latest and reports channel=latest when the chosen channel is missing', () => {
    const states = computePackageStates(
      [{ name: '@ctxo/lang-go', version: '0.6.0-alpha.0' }],
      [{ name: '@ctxo/lang-go', distTags: { latest: '0.7.0' } }],
    );
    expect(states[0]).toMatchObject({ name: '@ctxo/lang-go', latest: '0.7.0', channel: 'latest', status: 'update' });
  });

  it('marks ahead when installed version is greater than registry target', () => {
    const states = computePackageStates(
      [{ name: '@ctxo/cli', version: '0.8.0' }],
      [{ name: '@ctxo/cli', distTags: { latest: '0.7.0' } }],
    );
    expect(states[0]).toMatchObject({ status: 'ahead' });
  });

  it('preserves input order when matching registry results by name', () => {
    const states = computePackageStates(
      [{ name: 'a', version: '1.0.0' }, { name: 'b', version: '1.0.0' }],
      [{ name: 'b', distTags: { latest: '1.0.0' } }, { name: 'a', distTags: { latest: '2.0.0' } }],
    );
    expect(states.map((s) => s.name)).toEqual(['a', 'b']);
    expect(states[0]).toMatchObject({ status: 'update', latest: '2.0.0' });
    expect(states[1]).toMatchObject({ status: 'current' });
  });

  it('treats a missing registry result the same as an unknown miss', () => {
    const states = computePackageStates(
      [{ name: 'x', version: '1.0.0' }],
      [],
    );
    expect(states[0]).toMatchObject({ status: 'unknown' });
  });
});

describe('selectInstallTargets', () => {
  it('returns only packages with status update', () => {
    const targets = selectInstallTargets([
      { name: 'a', current: '1.0.0', latest: '2.0.0', channel: 'latest', status: 'update' },
      { name: 'b', current: '1.0.0', latest: '1.0.0', channel: 'latest', status: 'current' },
      { name: 'c', current: '2.0.0', latest: '1.0.0', channel: 'latest', status: 'ahead' },
      { name: 'd', current: '1.0.0', latest: null, channel: 'latest', status: 'unknown' },
    ]);
    expect(targets).toEqual([{ name: 'a', version: '2.0.0' }]);
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `pnpm --filter @ctxo/cli test -- update-plan`
Expected: FAIL with import errors for `computePackageStates`, `selectInstallTargets`.

- [ ] **Step 4.3: Extend `update-plan.ts` with state computation**

Append to `packages/cli/src/core/update/update-plan.ts`:

```ts
import type { RegistryResult } from './registry-client.js';

export type PackageStatus = 'current' | 'update' | 'ahead' | 'unknown';

export interface PackageState {
  readonly name: string;
  readonly current: string;
  readonly latest: string | null;
  readonly channel: Channel;
  readonly status: PackageStatus;
  readonly reason?: 'registry-404' | 'registry-error' | 'timeout' | 'network';
}

export interface InstalledPackage {
  readonly name: string;
  readonly version: string;
}

export function computePackageStates(
  installed: readonly InstalledPackage[],
  results: readonly RegistryResult[],
): PackageState[] {
  const byName = new Map<string, RegistryResult>();
  for (const r of results) byName.set(r.name, r);

  return installed.map((pkg) => {
    const installedChannel = detectChannel(pkg.version);
    const result = byName.get(pkg.name);

    if (!result) {
      return { name: pkg.name, current: pkg.version, latest: null, channel: installedChannel, status: 'unknown' as const };
    }
    if (!('distTags' in result)) {
      return { name: pkg.name, current: pkg.version, latest: null, channel: installedChannel, status: 'unknown' as const, reason: result.reason };
    }

    // Pick the channel we actually have a version for. If the installed channel
    // is not published, fall back to "latest" so the row reports the real source.
    const hasInstalledChannel = typeof result.distTags[installedChannel] === 'string';
    const targetChannel: Channel = hasInstalledChannel ? installedChannel : 'latest';
    const target = result.distTags[targetChannel] ?? null;
    if (!target) {
      return { name: pkg.name, current: pkg.version, latest: null, channel: installedChannel, status: 'unknown' as const };
    }
    const cmp = compareSemver(pkg.version, target);
    const status: PackageStatus = cmp === 0 ? 'current' : cmp < 0 ? 'update' : 'ahead';
    return { name: pkg.name, current: pkg.version, latest: target, channel: targetChannel, status };
  });
}

export function selectInstallTargets(states: readonly PackageState[]): ReadonlyArray<{ name: string; version: string }> {
  return states
    .filter((s): s is PackageState & { latest: string } => s.status === 'update' && typeof s.latest === 'string')
    .map((s) => ({ name: s.name, version: s.latest }));
}
```

- [ ] **Step 4.4: Run the tests to verify they pass**

Run: `pnpm --filter @ctxo/cli test -- update-plan`
Expected: PASS, including new and existing cases.

- [ ] **Step 4.5: Commit**

```bash
git add packages/cli/src/core/update/update-plan.ts packages/cli/src/core/update/__tests__/update-plan.test.ts
git commit -m "feat(update): compute package update states and install targets"
```

---

## Task 5: UpdateCommand renderers (text + JSON)

**Files:**
- Create: `packages/cli/src/cli/update-command.ts` (initial — types and pure formatters only)
- Create: `packages/cli/src/cli/__tests__/update-command.test.ts` (renderer tests only in this task)

Build the output formatters first. They consume the types from Task 4 and have no I/O, so they can be tested without mocking anything. Task 6 will add the `UpdateCommand` class.

- [ ] **Step 5.1: Write the failing tests**

Create `packages/cli/src/cli/__tests__/update-command.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  formatText,
  formatJson,
  type UpdateReport,
} from '../update-command.js';

const baseReport: UpdateReport = {
  ctxo: '0.7.0-alpha.0',
  channel: 'alpha',
  packages: [
    { name: '@ctxo/cli', current: '0.7.0-alpha.0', latest: '0.7.0-alpha.3', channel: 'alpha', status: 'update' },
    { name: '@ctxo/lang-typescript', current: '0.7.0-alpha.0', latest: '0.7.0-alpha.0', channel: 'alpha', status: 'current' },
    { name: '@ctxo/lang-csharp', current: '0.6.2', latest: '0.7.0', channel: 'latest', status: 'update' },
    { name: 'ctxo-lang-kotlin', current: '0.1.0', latest: null, channel: 'latest', status: 'unknown', reason: 'registry-404' },
  ],
  plan: {
    manager: 'pnpm',
    managerSource: 'lockfile',
    managerDetail: 'pnpm-lock.yaml',
    global: false,
    command: 'pnpm',
    args: ['add', '-D', '@ctxo/cli@0.7.0-alpha.3', '@ctxo/lang-csharp@0.7.0'],
  },
  strategy: 'execute',
  executed: true,
  exitCode: 0,
};

describe('formatText', () => {
  it('renders a header and a table of packages', () => {
    const out = formatText(baseReport);
    expect(out).toMatch(/checking registry for updates/);
    expect(out).toMatch(/PACKAGE\s+CURRENT\s+LATEST \(alpha\)\s+STATUS/);
    expect(out).toContain('@ctxo/cli');
    expect(out).toContain('0.7.0-alpha.3');
    expect(out).toContain('up to date');
    expect(out).toContain('update (latest)');
    expect(out).toContain('(not found)');
  });

  it('shows the install plan and a Running line when executing', () => {
    const out = formatText(baseReport);
    expect(out).toMatch(/Plan: pnpm add -D @ctxo\/cli@0\.7\.0-alpha\.3 @ctxo\/lang-csharp@0\.7\.0/);
    expect(out).toMatch(/Using pnpm \(lockfile: pnpm-lock\.yaml\)/);
    expect(out).toContain('Running');
  });

  it('switches to a print-only suggestion block when strategy is print', () => {
    const out = formatText({ ...baseReport, strategy: 'print', executed: false, exitCode: undefined });
    expect(out).toContain('To update, run:');
    expect(out).toMatch(/pnpm add -D @ctxo\/cli@/);
    expect(out).not.toContain('Running');
  });

  it('says everything is up to date when no updates exist', () => {
    const all: UpdateReport = {
      ...baseReport,
      packages: [
        { name: '@ctxo/cli', current: '0.7.0', latest: '0.7.0', channel: 'latest', status: 'current' },
      ],
      plan: null,
      strategy: 'none',
      executed: false,
    };
    const out = formatText(all);
    expect(out).toMatch(/All 1 packages? are up to date\./);
    expect(out).not.toContain('Plan:');
  });
});

describe('formatJson', () => {
  it('emits the documented JSON shape', () => {
    const parsed = JSON.parse(formatJson(baseReport));
    expect(parsed).toMatchObject({
      ctxo: '0.7.0-alpha.0',
      channel: 'alpha',
      packages: [
        { name: '@ctxo/cli', status: 'update' },
        { name: '@ctxo/lang-typescript', status: 'current' },
        { name: '@ctxo/lang-csharp', status: 'update' },
        { name: 'ctxo-lang-kotlin', status: 'unknown', reason: 'registry-404' },
      ],
      plan: {
        manager: 'pnpm',
        managerSource: 'lockfile',
        global: false,
        command: 'pnpm',
        args: ['add', '-D', '@ctxo/cli@0.7.0-alpha.3', '@ctxo/lang-csharp@0.7.0'],
      },
      executed: true,
      exitCode: 0,
    });
  });

  it('omits exitCode and plan when not applicable', () => {
    const parsed = JSON.parse(formatJson({ ...baseReport, plan: null, strategy: 'none', executed: false, exitCode: undefined }));
    expect(parsed.plan).toBeNull();
    expect(parsed.executed).toBe(false);
    expect(parsed.exitCode).toBeUndefined();
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `pnpm --filter @ctxo/cli test -- update-command`
Expected: FAIL — module `../update-command.js` not found.

- [ ] **Step 5.3: Implement the renderer skeleton**

Create `packages/cli/src/cli/update-command.ts`:

```ts
import type { PackageManager, Resolution } from '../core/install/package-manager.js';
import type { PackageState, Channel } from '../core/update/update-plan.js';

export type UpdateStrategy = 'execute' | 'print' | 'none';

export interface UpdatePlanShape {
  readonly manager: PackageManager;
  readonly managerSource: Resolution['source'];
  readonly managerDetail?: string;
  readonly global: boolean;
  readonly command: string;
  readonly args: readonly string[];
}

export interface UpdateReport {
  readonly ctxo: string;
  readonly channel: Channel;
  readonly packages: readonly PackageState[];
  readonly plan: UpdatePlanShape | null;
  readonly strategy: UpdateStrategy;
  readonly executed: boolean;
  readonly exitCode?: number;
}

export function formatText(report: UpdateReport): string {
  const lines: string[] = [];
  lines.push('ctxo update — checking registry for updates...');
  lines.push('');

  const updatesExist = report.packages.some((p) => p.status === 'update');
  if (!updatesExist && report.strategy !== 'print') {
    const total = report.packages.length;
    lines.push(`All ${total} package${total === 1 ? '' : 's'} are up to date.`);
    return lines.join('\n');
  }

  const nameCol = Math.max(7, ...report.packages.map((p) => p.name.length));
  const curCol = Math.max(7, ...report.packages.map((p) => p.current.length));
  const latestCol = Math.max(15, ...report.packages.map((p) => (p.latest ?? '(not found)').length));

  lines.push(
    `${'PACKAGE'.padEnd(nameCol)}  ${'CURRENT'.padEnd(curCol)}  ${`LATEST (${report.channel})`.padEnd(latestCol)}  STATUS`,
  );
  for (const pkg of report.packages) {
    const latestText = pkg.latest ?? '(not found)';
    const statusText = renderStatus(pkg, report.channel);
    lines.push(
      `${pkg.name.padEnd(nameCol)}  ${pkg.current.padEnd(curCol)}  ${latestText.padEnd(latestCol)}  ${statusText}`,
    );
  }

  if (report.plan && report.strategy === 'execute') {
    lines.push('');
    lines.push(`Plan: ${report.plan.command} ${report.plan.args.join(' ')}`);
    lines.push(`Using ${report.plan.manager} (${formatManagerSource(report.plan)})`);
    lines.push('');
    lines.push('Running...');
  } else if (report.plan && report.strategy === 'print') {
    lines.push('');
    lines.push('To update, run:');
    lines.push(`  ${report.plan.command} ${report.plan.args.join(' ')}`);
  }

  return lines.join('\n');
}

function renderStatus(pkg: PackageState, reportChannel: Channel): string {
  switch (pkg.status) {
    case 'current': return 'up to date';
    case 'ahead': return 'ahead of registry';
    case 'unknown': return pkg.reason === 'registry-404' ? 'skipped' : `error${pkg.reason ? ` (${pkg.reason})` : ''}`;
    case 'update':
      return pkg.channel === reportChannel ? 'update' : `update (${pkg.channel})`;
  }
}

function formatManagerSource(plan: UpdatePlanShape): string {
  return plan.managerDetail ? `${plan.managerSource}: ${plan.managerDetail}` : plan.managerSource;
}

export function formatJson(report: UpdateReport): string {
  return JSON.stringify(
    {
      ctxo: report.ctxo,
      channel: report.channel,
      packages: report.packages,
      plan: report.plan,
      executed: report.executed,
      ...(report.exitCode !== undefined ? { exitCode: report.exitCode } : {}),
    },
    null,
    2,
  );
}
```

- [ ] **Step 5.4: Run the tests to verify they pass**

Run: `pnpm --filter @ctxo/cli test -- update-command`
Expected: PASS for every formatter test.

- [ ] **Step 5.5: Commit**

```bash
git add packages/cli/src/cli/update-command.ts packages/cli/src/cli/__tests__/update-command.test.ts
git commit -m "feat(update): add text and JSON renderers for update report"
```

---

## Task 6: UpdateCommand orchestration (discover, fetch, render, execute/print)

**Files:**
- Modify: `packages/cli/src/cli/update-command.ts`
- Modify: `packages/cli/src/cli/__tests__/update-command.test.ts`

Wire discovery, fetch, plan computation, install strategy, and process orchestration. Inject collaborators (`discoverInstalled`, fetcher, runner) so the test never touches the network or spawns real processes.

- [ ] **Step 6.1: Append the failing tests**

Append to `packages/cli/src/cli/__tests__/update-command.test.ts`:

```ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateCommand } from '../update-command.js';
import type { HttpsFetcher } from '../../core/update/registry-client.js';

interface Captured {
  stdout: string;
  stderr: string;
  exitCode?: number;
  runs: Array<{ command: string; args: readonly string[]; cwd: string }>;
}

function makeCapture(): { capture: Captured; restore: () => void; deps: { runner: (command: string, args: readonly string[], cwd: string) => Promise<number>; setExitCode: (code: number) => void } } {
  const capture: Captured = { stdout: '', stderr: '', runs: [] };
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: any) => { capture.stdout += String(chunk); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: any) => { capture.stderr += String(chunk); return true; }) as typeof process.stderr.write;

  const runner = async (command: string, args: readonly string[], cwd: string): Promise<number> => {
    capture.runs.push({ command, args, cwd });
    return 0;
  };
  const setExitCode = (code: number) => { capture.exitCode = code; };

  return {
    capture,
    restore: () => { process.stdout.write = origOut; process.stderr.write = origErr; },
    deps: { runner, setExitCode },
  };
}

function makeFetcher(map: Record<string, { status: number; body: string } | Error>): HttpsFetcher {
  return async (url) => {
    const entry = Object.entries(map).find(([key]) => url.includes(encodeURIComponent(key)) || url.includes(key));
    if (!entry) return { status: 404, body: '{}' };
    const v = entry[1];
    if (v instanceof Error) throw v;
    return v;
  };
}

function makeTempProject(opts: { withCtxoDep?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'ctxo-update-'));
  if (opts.withCtxoDep) {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { '@ctxo/cli': '0.7.0-alpha.0' } }, null, 2),
    );
  }
  return dir;
}

describe('UpdateCommand', () => {
  it('--check prints the report and never runs the package manager', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [
          { name: '@ctxo/cli', version: '0.7.0-alpha.0' },
          { name: '@ctxo/lang-typescript', version: '0.7.0-alpha.0' },
        ],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
          '@ctxo/lang-typescript': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.0' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true });
      expect(cap.capture.stdout).toMatch(/checking registry/);
      expect(cap.capture.stdout).toMatch(/up to date/);
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.exitCode).toBeUndefined();
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('default mode runs the local install command when @ctxo/* is a devDependency', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({});
      expect(cap.capture.runs).toHaveLength(1);
      const call = cap.capture.runs[0]!;
      expect(call.args.join(' ')).toContain('@ctxo/cli@0.7.0-alpha.3');
      expect(call.cwd).toBe(dir);
      expect(cap.capture.exitCode ?? 0).toBe(0);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('prints the global command without running when no package.json exists', async () => {
    const dir = makeTempProject({ withCtxoDep: false });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({});
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.stdout).toContain('To update, run:');
      expect(cap.capture.stdout).toMatch(/(npm install -g|pnpm add -g|yarn global add|bun add -g) @ctxo\/cli@/);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--print never runs even when a project package.json exists', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ print: true });
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.stdout).toContain('To update, run:');
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--global builds and runs a global install command', async () => {
    const dir = makeTempProject({ withCtxoDep: false });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ global: true, pm: 'npm' });
      expect(cap.capture.runs).toHaveLength(1);
      expect(cap.capture.runs[0]!.args).toEqual(['install', '-g', '@ctxo/cli@0.7.0-alpha.3']);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('--json emits structured output for check mode', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true, json: true });
      const parsed = JSON.parse(cap.capture.stdout);
      expect(parsed.packages[0]).toMatchObject({ name: '@ctxo/cli', status: 'update' });
      expect(parsed.executed).toBe(false);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('exits 1 when every fetch fails', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: async () => { const e: NodeJS.ErrnoException = new Error('down'); e.code = 'ECONNREFUSED'; throw e; },
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
      });
      await cmd.run({ check: true });
      expect(cap.capture.exitCode).toBe(1);
      expect(cap.capture.stderr).toMatch(/registry/i);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses to mutate in CI unless --force or --global is set', async () => {
    const dir = makeTempProject({ withCtxoDep: true });
    const cap = makeCapture();
    try {
      const cmd = new UpdateCommand(dir, {
        discoverInstalled: async () => [{ name: '@ctxo/cli', version: '0.7.0-alpha.0' }],
        fetcher: makeFetcher({
          '@ctxo/cli': { status: 200, body: JSON.stringify({ 'dist-tags': { alpha: '0.7.0-alpha.3' } }) },
        }),
        runner: cap.deps.runner,
        setExitCode: cap.deps.setExitCode,
        env: { CI: 'true' },
      });
      await cmd.run({});
      expect(cap.capture.runs).toHaveLength(0);
      expect(cap.capture.exitCode).toBe(1);
    } finally { cap.restore(); rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `pnpm --filter @ctxo/cli test -- update-command`
Expected: FAIL — `UpdateCommand` does not yet exist as a class (renderer-only file from Task 5).

- [ ] **Step 6.3: Implement the orchestrator**

Append to `packages/cli/src/cli/update-command.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVersion } from './cli-router.js';
import { discoverPlugins } from '../adapters/language/plugin-discovery.js';
import { loadManifestPath } from './plugin-loader.js';
import { fetchDistTagsBatch, type HttpsFetcher, type RegistryResult } from '../core/update/registry-client.js';
import {
  computePackageStates,
  detectChannel,
  selectInstallTargets,
} from '../core/update/update-plan.js';
import {
  resolvePackageManager,
  buildInstallCommand,
  isPackageManager,
} from '../core/install/package-manager.js';
import { runPackageManager } from '../core/install/run-package-manager.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('ctxo:update');
const CTXO_CLI_PACKAGE = '@ctxo/cli';

export interface UpdateOptions {
  readonly check?: boolean;
  readonly print?: boolean;
  readonly global?: boolean;
  readonly json?: boolean;
  readonly pm?: string;
  readonly force?: boolean;
}

export interface UpdateCommandDeps {
  readonly discoverInstalled?: (projectRoot: string) => Promise<ReadonlyArray<{ name: string; version: string }>>;
  readonly fetcher?: HttpsFetcher;
  readonly runner?: (command: string, args: readonly string[], cwd: string) => Promise<number>;
  readonly setExitCode?: (code: number) => void;
  readonly env?: NodeJS.ProcessEnv;
}

export class UpdateCommand {
  constructor(
    private readonly projectRoot: string,
    private readonly deps: UpdateCommandDeps = {},
  ) {}

  async run(options: UpdateOptions = {}): Promise<void> {
    if (options.pm && !isPackageManager(options.pm)) {
      this.emitError(`Unknown --pm value "${options.pm}".`);
      this.deps.setExitCode?.(1);
      return;
    }

    const discover = this.deps.discoverInstalled ?? defaultDiscoverInstalled;
    const installed = await discover(this.projectRoot);
    if (installed.length === 0) {
      this.emit(options.json ? '{}\n' : 'ctxo update — no @ctxo/* packages discovered.\n');
      return;
    }

    const names = installed.map((p) => p.name);
    let results: RegistryResult[];
    try {
      results = await fetchDistTagsBatch(names, { fetcher: this.deps.fetcher });
    } catch (err) {
      this.emitError(`registry fetch failed: ${(err as Error).message}`);
      this.deps.setExitCode?.(1);
      return;
    }

    const allMissed = results.every((r) => !('distTags' in r));
    if (allMissed) {
      this.emitError('registry unreachable for every package; aborting.');
      this.deps.setExitCode?.(1);
      return;
    }

    const states = computePackageStates(installed, results);
    const targets = selectInstallTargets(states);

    const cliVersion = getVersion();
    const channel = detectChannel(cliVersion);
    const plan = targets.length === 0 ? null : this.buildPlan(targets, options);
    const strategy = this.pickStrategy(targets, options);

    const baseReport: UpdateReport = {
      ctxo: cliVersion,
      channel,
      packages: states,
      plan,
      strategy,
      executed: false,
    };

    if (options.check) {
      this.emitReport(baseReport, options.json ?? false);
      return;
    }

    if (strategy === 'none' || strategy === 'print' || !plan) {
      this.emitReport(baseReport, options.json ?? false);
      return;
    }

    if (!options.force && !options.global && isLockedCI(this.deps.env ?? process.env)) {
      this.emitReport({ ...baseReport, strategy: 'print' }, options.json ?? false);
      this.emitError('CI environment with frozen lockfile detected. Refusing to mutate. Use --force or --global.');
      this.deps.setExitCode?.(1);
      return;
    }

    this.emitReport(baseReport, options.json ?? false);
    const run = this.deps.runner ?? runPackageManager;
    const code = await run(plan.command, plan.args, this.projectRoot);
    const finalReport: UpdateReport = { ...baseReport, executed: true, exitCode: code };
    if (options.json) this.emit(formatJson(finalReport) + '\n');
    if (code !== 0) this.deps.setExitCode?.(code);
  }

  private buildPlan(
    targets: ReadonlyArray<{ name: string; version: string }>,
    options: UpdateOptions,
  ): UpdatePlanShape {
    const resolution = resolvePackageManager({
      flag: options.pm,
      projectRoot: this.projectRoot,
      env: this.deps.env,
    });
    const specifiers = targets.map((t) => `${t.name}@${t.version}`);
    const useGlobal = options.global || !this.projectHasCtxoDep();
    const invocation = buildInstallCommand(resolution.manager, specifiers, { global: useGlobal });
    return {
      manager: resolution.manager,
      managerSource: resolution.source,
      managerDetail: resolution.detail,
      global: useGlobal,
      command: invocation.command,
      args: invocation.args,
    };
  }

  private pickStrategy(
    targets: ReadonlyArray<{ name: string; version: string }>,
    options: UpdateOptions,
  ): UpdateStrategy {
    if (targets.length === 0) return 'none';
    if (options.print) return 'print';
    if (options.global) return 'execute';
    return this.projectHasCtxoDep() ? 'execute' : 'print';
  }

  private projectHasCtxoDep(): boolean {
    const pkg = join(this.projectRoot, 'package.json');
    if (!existsSync(pkg)) return false;
    try {
      const json = JSON.parse(readFileSync(pkg, 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const merged = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
      return Object.keys(merged).some(
        (name) => name === CTXO_CLI_PACKAGE || name.startsWith('@ctxo/lang-') || name.startsWith('ctxo-lang-'),
      );
    } catch (err) {
      log.error(`failed to read project package.json: ${(err as Error).message}`);
      return false;
    }
  }

  private emit(text: string): void { process.stdout.write(text); }
  private emitError(text: string): void { process.stderr.write(`[ctxo] ${text}\n`); }

  private emitReport(report: UpdateReport, json: boolean): void {
    if (json) this.emit(formatJson(report) + '\n');
    else this.emit(formatText(report) + '\n');
  }
}

async function defaultDiscoverInstalled(projectRoot: string): Promise<ReadonlyArray<{ name: string; version: string }>> {
  const out: Array<{ name: string; version: string }> = [{ name: CTXO_CLI_PACKAGE, version: getVersion() }];
  const manifestPath = loadManifestPath(projectRoot);
  if (!manifestPath) return out;
  const { plugins } = await discoverPlugins({ manifestPath });
  for (const p of plugins) out.push({ name: p.specifier, version: p.plugin.version });
  return out;
}

function isLockedCI(env: NodeJS.ProcessEnv): boolean {
  return env['CI'] === 'true' || env['CI'] === '1';
}
```

- [ ] **Step 6.4: Run the tests to verify they pass**

Run: `pnpm --filter @ctxo/cli test -- update-command`
Expected: PASS for all renderer + orchestrator tests.

- [ ] **Step 6.5: Commit**

```bash
git add packages/cli/src/cli/update-command.ts packages/cli/src/cli/__tests__/update-command.test.ts
git commit -m "feat(update): orchestrate discovery, fetch, install strategy"
```

---

## Task 7: Router wiring + help + CLAUDE.md

**Files:**
- Modify: `packages/cli/src/cli/cli-router.ts`
- Modify: `packages/cli/src/cli/__tests__/cli-router.test.ts`
- Modify: `CLAUDE.md`

Hook `update` into the CLI dispatcher, parse its flags, and expose it in `--help`.

- [ ] **Step 7.1: Append the failing router test**

Open `packages/cli/src/cli/__tests__/cli-router.test.ts`. Confirm the file already imports `vi` from `vitest`; if not, add `import { vi } from 'vitest';` to the top imports.

Append:

```ts
describe('cli-router update command', () => {
  it('parses update flags and dispatches to UpdateCommand.run', async () => {
    const calls: Array<{ projectRoot: string; options: unknown }> = [];
    const router = new CliRouter(process.cwd());
    const original = await import('../update-command.js');
    const spy = vi.spyOn(original, 'UpdateCommand' as any).mockImplementation(((projectRoot: string) => ({
      run: async (options: unknown) => { calls.push({ projectRoot, options }); },
    })) as any);

    await router.route(['update', '--check', '--json', '--pm', 'pnpm', '--print', '--global', '--force']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options).toMatchObject({
      check: true,
      json: true,
      pm: 'pnpm',
      print: true,
      global: true,
      force: true,
    });
    spy.mockRestore();
  });
});
```

- [ ] **Step 7.2: Run the failing test**

Run: `pnpm --filter @ctxo/cli test -- cli-router`
Expected: FAIL — router does not handle `update` yet (likely prints `Unknown command`).

- [ ] **Step 7.3: Add the router case and help line**

Edit `packages/cli/src/cli/cli-router.ts`:

After the `import { InstallCommand } from './install-command.js';` line, add:

```ts
import { UpdateCommand } from './update-command.js';
```

Inside the `switch (command)` block in `route`, add a new case before `default`:

```ts
case 'update': {
  const flagValues: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--check') flagValues['check'] = true;
    else if (a === '--print') flagValues['print'] = true;
    else if (a === '--global' || a === '-g') flagValues['global'] = true;
    else if (a === '--json') flagValues['json'] = true;
    else if (a === '--force') flagValues['force'] = true;
    else if (a === '--pm') {
      const next = args[++i];
      if (!next) { console.error('[ctxo] --pm requires a value'); process.exit(1); return; }
      flagValues['pm'] = next;
    } else {
      console.error(`[ctxo] Unknown update flag: ${a}`);
      process.exit(1);
      return;
    }
  }
  await new UpdateCommand(this.projectRoot).run({
    check: flagValues['check'] === true,
    print: flagValues['print'] === true,
    global: flagValues['global'] === true,
    json: flagValues['json'] === true,
    force: flagValues['force'] === true,
    pm: typeof flagValues['pm'] === 'string' ? flagValues['pm'] : undefined,
  });
  break;
}
```

In `printHelp`, insert these lines right after the `ctxo install` group (before `ctxo --version`):

```
  ctxo update              Check + apply updates for ctxo + plugins
  ctxo update --check      Check only, no install
  ctxo update --print      Print install command, never execute
  ctxo update --global     Force a global install
  ctxo update --json       Machine-readable output
```

- [ ] **Step 7.4: Run the router test to verify it passes**

Run: `pnpm --filter @ctxo/cli test -- cli-router`
Expected: PASS.

- [ ] **Step 7.5: Update CLAUDE.md Quick Reference**

In `CLAUDE.md`, locate the `# Usage (consumer)` block inside the `Quick Reference` section. Add these lines right after the `npx ctxo install --dry-run --pm pnpm` line:

```
npx ctxo update                      # check + apply updates for ctxo + plugins
npx ctxo update --check              # check only, exit 0
npx ctxo update --print              # print install command, never execute
npx ctxo update --global             # force a global install
npx ctxo update --json               # machine-readable output
```

- [ ] **Step 7.6: Run the full CLI suite to confirm no regressions**

Run: `pnpm --filter @ctxo/cli test`
Expected: ALL pass.

- [ ] **Step 7.7: Typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 7.8: Commit**

```bash
git add packages/cli/src/cli/cli-router.ts packages/cli/src/cli/__tests__/cli-router.test.ts CLAUDE.md
git commit -m "feat(update): wire ctxo update into the CLI router + help"
```

---

## Task 8: Manual smoke check (no commit)

Verifies the real end-to-end path with a live network call. Run locally; stop if anything looks wrong.

- [ ] **Step 8.1: Build the package**

Run: `pnpm --filter @ctxo/cli build`
Expected: build succeeds.

- [ ] **Step 8.2: Dry check in dev mode**

Run: `pnpm --filter @ctxo/cli dev -- update --check`
Expected: prints a table of `@ctxo/cli` + installed plugins, exits 0. No crash on the actual `registry.npmjs.org` response.

- [ ] **Step 8.3: JSON variant**

Run: `pnpm --filter @ctxo/cli dev -- update --check --json`
Expected: valid JSON with the documented shape.

- [ ] **Step 8.4: Print mode**

Run: `pnpm --filter @ctxo/cli dev -- update --print`
Expected: prints `To update, run:` and a valid pnpm/npm command. Does not execute it.

- [ ] **Step 8.5: Stop. Do not run** `**ctxo update**` **without** `**--print**` **on this repo** — it would mutate the workspace devDependencies.

---

## Notes for the implementer

- `loadManifestPath` already returns `null` when there is no project manifest; `discoverPlugins` returns an empty array in that case. The default discovery routine adds `@ctxo/cli` itself even when nothing else is found, so updates can still be reported on a bare global install.
- The `@ctxo/cli` row's version is sourced from `getVersion()` (root-of-monorepo lookup). Tests inject discovery so they don't depend on the local version.
- `process.exit` is intentionally NOT called inside `UpdateCommand.run` — set `process.exitCode` via the injected `setExitCode` so tests can assert deterministically.
- `defaultHttpsFetcher` writes no logs on the happy path. Errors flow through `classifyFetchError` which logs only on the unrecognized branch.
- The shared `runPackageManager` helper (Task 1) is the only place that spawns child processes; both `ctxo install` and `ctxo update` go through it. Do not duplicate the spawn logic.
- The router test currently lives in `__tests__/cli-router.test.ts` — keep the new test inside the same file; do not split it out.
