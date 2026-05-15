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
