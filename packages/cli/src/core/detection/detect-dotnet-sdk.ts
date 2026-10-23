import { spawnSync } from 'node:child_process';

/** Major version of a `dotnet --version` string (`8.0.404` -> 8, `10.0.100-rc.1` -> 10). Pure/uncached. */
export function parseDotnetSdkMajor(version: string): number | undefined {
  const m = /^\s*(\d+)\./.exec(version);
  if (!m) return undefined;
  const major = parseInt(m[1]!, 10);
  return Number.isNaN(major) ? undefined : major;
}

/** Module-level memo: undefined = not yet computed; null = computed as absent */
let _sdkVersionCache: string | null | undefined = undefined;

/**
 * Spawn `dotnet --version` once and return the SDK version it prints, trimmed.
 * Returns undefined when dotnet is not on PATH, has no SDK (a runtime-only
 * install exits non-zero) or prints nothing. Always respects a 10 s timeout so
 * a hanging dotnet cannot stall the CLI.
 *
 * Result is memoized at module scope after the first spawn, so repeated calls
 * within the same process are free.
 */
export function detectDotnetSdkVersion(): string | undefined {
  if (_sdkVersionCache !== undefined) {
    // null sentinel means "computed, result was undefined"
    return _sdkVersionCache === null ? undefined : _sdkVersionCache;
  }

  const r = spawnSync('dotnet', ['--version'], {
    encoding: 'utf-8',
    timeout: 10_000,
    windowsHide: true,
  });
  const version = r.error || r.status !== 0 ? '' : (r.stdout ?? '').trim();
  _sdkVersionCache = version || null;
  return version || undefined;
}

/**
 * Reset the memoized SDK version. Intended for tests only: it lets
 * successive test cases start from a fresh detection.
 */
export function resetDotnetSdkCacheForTests(): void {
  _sdkVersionCache = undefined;
}
