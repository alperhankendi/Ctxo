import type { RegistryResult } from './registry-client.js';

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
  if (pa.prerelease.length === 0) return 1; // release > prerelease
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
      const an = Number(ai);
      const bn = Number(bi);
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

export type PackageStatus = 'current' | 'update' | 'ahead' | 'unknown' | 'workspace';

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
    .filter((s) => isSafeVersionSpecifier(s.latest))
    .map((s) => ({ name: s.name, version: s.latest }));
}

/**
 * Override the status of any package whose name appears in `workspaceLinkNames`
 * to `'workspace'`. Workspace-linked packages (pnpm `workspace:*` / yarn
 * `workspace:^`) are local source, not registry consumers — they must never
 * appear in the install plan or be "upgraded" to a registry version. They are
 * still shown in the report table so users see why a row is being skipped.
 */
export function markWorkspaceLinks(
  states: readonly PackageState[],
  workspaceLinkNames: ReadonlySet<string>,
): PackageState[] {
  return states.map((s) =>
    workspaceLinkNames.has(s.name)
      ? { ...s, status: 'workspace' as const, latest: null }
      : s,
  );
}

// Strict semver-ish regex: digits, letters, dots, plus, minus only. Matches the
// SEMVER_RE prefix without anchoring full structure (safe enough to feed to a
// shell when shell:true is in effect on Windows).
const SAFE_SPECIFIER_RE = /^[0-9A-Za-z.+-]+$/;

export function isSafeVersionSpecifier(version: string): boolean {
  return SAFE_SPECIFIER_RE.test(version);
}
