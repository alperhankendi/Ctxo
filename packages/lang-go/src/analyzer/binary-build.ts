import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-go');
const BINARY_NAME = platform() === 'win32' ? 'ctxo-go-analyzer.exe' : 'ctxo-go-analyzer';
const BUILD_TIMEOUT_MS = 180_000;

/**
 * Hash the analyzer source tree + go version into a cache key, then build
 * the binary into ~/.cache/ctxo/lang-go-analyzer/<key>/ on first use. ADR-013
 * §4 Q2 — postinstall rejected (breaks sandboxed npm); `go run` rejected
 * (3-5s overhead per invocation).
 */
export function ensureAnalyzerBinary(sourceDir: string, goVersion: string): string {
  const key = `${hashSourceTree(sourceDir)}-go${goVersion}`;
  const cacheDir = join(homedir(), '.cache', 'ctxo', 'lang-go-analyzer', key);
  const binaryPath = join(cacheDir, BINARY_NAME);

  if (existsSync(binaryPath)) return binaryPath;

  mkdirSync(cacheDir, { recursive: true });
  log.info(`Building ctxo-go-analyzer (first run): ${binaryPath}`);
  try {
    execFileSync('go', ['build', '-trimpath', '-o', binaryPath, '.'], {
      cwd: sourceDir,
      timeout: BUILD_TIMEOUT_MS,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (err) {
    throw new Error(`go build failed: ${(err as Error).message}`);
  }
  if (!existsSync(binaryPath)) {
    throw new Error('go build completed but expected binary is missing');
  }
  return binaryPath;
}

function hashSourceTree(dir: string): string {
  const hash = createHash('sha1');
  const files: string[] = [];
  walk(dir, (path) => {
    if (path.endsWith('.go') || path.endsWith('go.mod') || path.endsWith('go.sum')) {
      files.push(path);
    }
  });
  files.sort();
  for (const f of files) {
    hash.update(f);
    hash.update(readFileSync(f));
  }
  return hash.digest('hex').slice(0, 12);
}

function walk(dir: string, cb: (path: string) => void): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('node:fs').Dirent[];
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, String(entry.name));
    if (entry.isDirectory()) walk(path, cb);
    else if (entry.isFile()) cb(path);
  }
}
