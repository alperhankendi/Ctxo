import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ctxo:roslyn');

const IGNORE_DIRS = new Set(['bin', 'obj', 'node_modules', '.git', '.ctxo', 'packages']);

function findPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findMonorepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function detectDotnetSdk(): { available: boolean; version?: string } {
  try {
    const version = execFileSync('dotnet', ['--version'], { encoding: 'utf-8', timeout: 10_000 }).trim();
    const major = parseInt(version.split('.')[0]!, 10);
    if (major < 8) {
      log.info(`dotnet SDK ${version} found but < 8.0 required`);
      return { available: false, version };
    }
    return { available: true, version };
  } catch {
    return { available: false };
  }
}

export function discoverSolution(rootDir: string): string | null {
  // 1. .sln in root
  const rootSlns = findFiles(rootDir, '.sln', 0);
  if (rootSlns.length === 1) return rootSlns[0]!;
  if (rootSlns.length > 1) {
    log.info(`Multiple .sln in root, picking first: ${rootSlns[0]}`);
    return rootSlns[0]!;
  }

  // 2. .sln recursive (shallowest first)
  const allSlns = findFiles(rootDir, '.sln', 3);
  if (allSlns.length > 0) {
    allSlns.sort((a, b) => a.split('/').length - b.split('/').length);
    return allSlns[0]!;
  }

  // 3. .csproj fallback
  const csprojFiles = findFiles(rootDir, '.csproj', 3);
  if (csprojFiles.length > 0) {
    log.info(`No .sln found, using .csproj: ${csprojFiles[0]}`);
    return csprojFiles[0]!;
  }

  return null;
}

function findFiles(dir: string, ext: string, maxDepth: number, currentDepth = 0): string[] {
  const results: string[] = [];
  if (currentDepth > maxDepth) return results;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(join(dir, entry.name));
      } else if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name)) {
        results.push(...findFiles(join(dir, entry.name), ext, maxDepth, currentDepth + 1));
      }
    }
  } catch {
    // permission denied, etc.
  }

  return results;
}

export function findCtxoRoslynProject(): string | null {
  // Look for the ctxo-roslyn project relative to this package
  // tsup bundles all code into dist/*.js, so import.meta.dirname = dist/
  // We need to find the package root by walking up from import.meta.dirname
  const pkgRoot = findPackageRoot(import.meta.dirname);
  const monorepoRoot = findMonorepoRoot(import.meta.dirname);
  const candidates = [
    // Plugin package root — tools/ctxo-roslyn ships inside @ctxo/lang-csharp
    ...(pkgRoot ? [join(pkgRoot, 'tools/ctxo-roslyn')] : []),
    // Monorepo dev: packages/lang-csharp/tools/ctxo-roslyn
    ...(monorepoRoot ? [join(monorepoRoot, 'packages/lang-csharp/tools/ctxo-roslyn')] : []),
    // Bundled dist: dist/roslyn -> ../tools (tsup preserves relative layout)
    join(import.meta.dirname, '../tools/ctxo-roslyn'),
    // Unbundled src layout: src/roslyn -> ../../tools
    join(import.meta.dirname, '../../tools/ctxo-roslyn'),
    // Consumer node_modules installs
    join(process.cwd(), 'node_modules/@ctxo/lang-csharp/tools/ctxo-roslyn'),
    // Legacy paths kept for migration window
    join(process.cwd(), 'node_modules/@ctxo/cli/tools/ctxo-roslyn'),
    join(process.cwd(), 'node_modules/ctxo-mcp/tools/ctxo-roslyn'),
  ];

  for (const candidate of candidates) {
    const csproj = join(candidate, 'ctxo-roslyn.csproj');
    if (existsSync(csproj)) return candidate;
  }

  return null;
}
