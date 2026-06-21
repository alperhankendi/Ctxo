import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Parse `java -version` text → major (handles 1.8 legacy). */
export function parseJavaMajor(output: string): number | undefined {
  const m = output.match(/version "([^"]+)"/);
  if (!m) return undefined;
  const parts = m[1]!.split('.');
  const major = parts[0] === '1' && parts[1] ? parseInt(parts[1]!, 10) : parseInt(parts[0]!, 10);
  return Number.isNaN(major) ? undefined : major;
}

/** True if a JRE >= 17 is reachable (CTXO_JAVA_HOME -> JAVA_HOME -> PATH). */
export function javaRuntimeAvailable(): boolean {
  const home = process.env['CTXO_JAVA_HOME'] || process.env['JAVA_HOME'];
  const bin = home ? join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  if (home && !existsSync(bin)) return false;
  const r = spawnSync(bin, ['-version'], { encoding: 'utf-8' });
  const major = parseJavaMajor(`${r.stderr ?? ''}${r.stdout ?? ''}`);
  return (major ?? 0) >= 17;
}
