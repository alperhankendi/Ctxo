import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Parse `java -version` text → major (handles 1.8 legacy). Pure/uncached. */
export function parseJavaMajor(output: string): number | undefined {
  const m = output.match(/version "([^"]+)"/);
  if (!m) return undefined;
  const parts = m[1]!.split('.');
  const major = parts[0] === '1' && parts[1] ? parseInt(parts[1]!, 10) : parseInt(parts[0]!, 10);
  return Number.isNaN(major) ? undefined : major;
}

/** Module-level memo: undefined = not yet computed; null = computed as absent */
let _javaMajorCache: number | null | undefined = undefined;

/**
 * Spawn `java -version` once (CTXO_JAVA_HOME → JAVA_HOME → PATH), return the
 * parsed major version.  Returns undefined when java is not found or the
 * version string cannot be parsed.  Always respects a 10 s timeout so
 * a hanging JVM on a broken JAVA_HOME / network mount cannot stall the CLI.
 *
 * Result is memoized at module scope after the first spawn — repeated calls
 * within the same process are free.
 */
export function detectJavaMajor(): number | undefined {
  if (_javaMajorCache !== undefined) {
    // null sentinel means "computed, result was undefined"
    return _javaMajorCache === null ? undefined : _javaMajorCache;
  }

  const home = process.env['CTXO_JAVA_HOME'] || process.env['JAVA_HOME'];
  const bin = home
    ? join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  if (home && !existsSync(bin)) {
    _javaMajorCache = null;
    return undefined;
  }
  const r = spawnSync(bin, ['-version'], {
    encoding: 'utf-8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (r.error || r.status === null) {
    _javaMajorCache = null;
    return undefined;
  }
  // java writes version to stderr; stdout may also carry it in some JVMs
  const major = parseJavaMajor(`${r.stderr ?? ''}${r.stdout ?? ''}`);
  _javaMajorCache = major ?? null;
  return major;
}

/**
 * Reset the memoized java major cache.  Intended for tests only — allows
 * successive test cases to exercise different java-not-found / version
 * scenarios without cross-test contamination.
 */
export function resetJavaRuntimeCacheForTests(): void {
  _javaMajorCache = undefined;
}

/** True if a JRE >= 17 is reachable (CTXO_JAVA_HOME -> JAVA_HOME -> PATH). */
export function javaRuntimeAvailable(): boolean {
  return (detectJavaMajor() ?? 0) >= 17;
}
