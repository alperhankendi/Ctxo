import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:lang-go');
const IGNORE_DIRS = new Set(['node_modules', '.git', '.ctxo', 'vendor', 'dist', 'build']);

/**
 * Locate the Go module (or go.work) root for a given project directory.
 * Walks up from rootDir first; if nothing matches, does a shallow recursive
 * search to support consumers whose Go code lives in a subdirectory.
 */
export function discoverGoModule(rootDir: string): string | null {
  let dir = resolve(rootDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'go.work'))) return dir;
    if (existsSync(join(dir, 'go.mod'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return findShallow(rootDir, 3);
}

function findShallow(dir: string, maxDepth: number, depth = 0): string | null {
  if (depth > maxDepth) return null;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && (e.name === 'go.work' || e.name === 'go.mod')) {
        return dir;
      }
    }
    for (const e of entries) {
      if (e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) {
        const found = findShallow(join(dir, e.name), maxDepth, depth + 1);
        if (found) return found;
      }
    }
  } catch {
    // permission denied — ignore
  }
  return null;
}

function findPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findMonorepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Locate the ctxo-go-analyzer source tree shipped inside the @ctxo/lang-go
 * package. Mirrors the candidate-list strategy from lang-csharp so it works
 * across monorepo dev runs, bundled dist, and consumer node_modules installs.
 */
export function findCtxoGoAnalyzerSource(): string | null {
  const pkgRoot = findPackageRoot(import.meta.dirname);
  const monorepoRoot = findMonorepoRoot(import.meta.dirname);
  const candidates = [
    ...(pkgRoot ? [join(pkgRoot, 'tools/ctxo-go-analyzer')] : []),
    ...(monorepoRoot ? [join(monorepoRoot, 'packages/lang-go/tools/ctxo-go-analyzer')] : []),
    join(import.meta.dirname, '../tools/ctxo-go-analyzer'),
    join(import.meta.dirname, '../../tools/ctxo-go-analyzer'),
    join(import.meta.dirname, '../../../tools/ctxo-go-analyzer'),
    join(process.cwd(), 'node_modules/@ctxo/lang-go/tools/ctxo-go-analyzer'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'go.mod')) && existsSync(join(candidate, 'main.go'))) {
      return candidate;
    }
  }
  log.info('ctxo-go-analyzer source not found in any candidate location');
  return null;
}
