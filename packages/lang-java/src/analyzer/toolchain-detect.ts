import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');
const MIN_MAJOR = 17;

export interface JavaToolchainInfo {
  available: boolean;
  major?: number;
  version?: string;
  javaBin: string;
}

/** Pure parser: extract {major, version} from `java -version` text. */
export function parseJavaVersion(output: string): { major: number; version: string } | null {
  const m = output.match(/version "([^"]+)"/);
  if (!m) return null;
  const version = m[1]!;
  const parts = version.split('.');
  let major: number;
  if (parts[0] === '1' && parts.length > 1) major = parseInt(parts[1]!, 10);
  else major = parseInt(parts[0]!, 10);
  if (Number.isNaN(major)) return null;
  return { major, version };
}

/** Resolve the java executable: CTXO_JAVA_HOME -> JAVA_HOME -> 'java' on PATH. */
export function resolveJavaBin(): string {
  const home = process.env.CTXO_JAVA_HOME || process.env.JAVA_HOME;
  if (home) {
    const bin = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (existsSync(bin)) return bin;
  }
  return 'java';
}

/** Probe the Java runtime. `available` gates full tier on JRE >= 17. */
export function detectJavaRuntime(): JavaToolchainInfo {
  const javaBin = resolveJavaBin();
  try {
    const out = execFileSync(javaBin, ['-version'], { encoding: 'utf-8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return finalize(javaBin, parseJavaVersion(out));
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const text = stderr ? stderr.toString() : '';
    const parsed = parseJavaVersion(text);
    if (parsed) return finalize(javaBin, parsed);
    log.info(`Java runtime not detected via ${javaBin}`);
    return { available: false, javaBin };
  }
}

function finalize(javaBin: string, parsed: { major: number; version: string } | null): JavaToolchainInfo {
  if (!parsed) return { available: false, javaBin };
  const available = parsed.major >= MIN_MAJOR;
  if (!available) log.info(`Java ${parsed.version} found but >= ${MIN_MAJOR} required for full tier`);
  return { available, major: parsed.major, version: parsed.version, javaBin };
}
