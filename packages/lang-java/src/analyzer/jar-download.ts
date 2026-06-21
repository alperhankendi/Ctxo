import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-java');

const JAR_NAME = 'ctxo-jdt-analyzer.jar';
const ENV_OVERRIDE = 'CTXO_JDT_ANALYZER_JAR';
/** Pinned by Plan 5's release pipeline. null = accept any cached jar (pre-release dev). */
export const EXPECTED_SHA256: string | null = null;
const RELEASE_URL = (version: string) =>
  `https://github.com/alperhankendi/Ctxo/releases/download/lang-java-v${version}/${JAR_NAME}`;

export interface ResolveOpts {
  cacheRoot?: string;
  expectedSha?: string | null;
}

export function verifySha256(filePath: string, expected: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
    return hash.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

function defaultCacheRoot(): string {
  return join(homedir(), '.ctxo', 'cache', 'lang-java');
}

/**
 * Resolve a usable analyzer JAR WITHOUT network access:
 *   1. CTXO_JDT_ANALYZER_JAR env override (if the file exists)
 *   2. cached jar at <cacheRoot>/<version>/ctxo-jdt-analyzer.jar (SHA-verified when a hash is pinned)
 *   3. null
 */
export function resolveAnalyzerJar(version: string, opts: ResolveOpts = {}): string | null {
  const override = process.env[ENV_OVERRIDE];
  if (override && existsSync(override)) {
    log.info(`Using analyzer jar from ${ENV_OVERRIDE}: ${override}`);
    return override;
  }
  const cacheRoot = opts.cacheRoot ?? defaultCacheRoot();
  const expected = opts.expectedSha === undefined ? EXPECTED_SHA256 : opts.expectedSha;
  const cached = join(cacheRoot, version, JAR_NAME);
  if (existsSync(cached)) {
    if (expected && !verifySha256(cached, expected)) {
      log.warn(`Cached analyzer jar failed SHA-256 verification: ${cached}`);
      return null;
    }
    return cached;
  }
  return null;
}

/**
 * Opt-in download from GitHub Releases -> verify SHA-256 -> cache. Returns the
 * cached path, or null on any failure. NEVER called automatically.
 */
export async function downloadAnalyzerJar(version: string, opts: ResolveOpts = {}): Promise<string | null> {
  const cacheRoot = opts.cacheRoot ?? defaultCacheRoot();
  const expected = opts.expectedSha === undefined ? EXPECTED_SHA256 : opts.expectedSha;
  const destDir = join(cacheRoot, version);
  const dest = join(destDir, JAR_NAME);
  try {
    const res = await fetch(RELEASE_URL(version));
    if (!res.ok) { log.warn(`Analyzer download failed: HTTP ${res.status}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(destDir, { recursive: true });
    writeFileSync(dest, buf);
    if (expected && !verifySha256(dest, expected)) {
      log.warn('Downloaded analyzer jar failed SHA-256 verification');
      return null;
    }
    log.info(`Downloaded analyzer jar to ${dest}`);
    return dest;
  } catch (err) {
    log.warn(`Analyzer download error: ${(err as Error).message}`);
    return null;
  }
}
