import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export const PACKAGE_MANAGERS: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

export function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

export interface ResolveOptions {
  /** CLI flag value (highest priority). */
  readonly flag?: string;
  /** process.env lookup (can inject for tests). */
  readonly env?: NodeJS.ProcessEnv;
  /** Project root where package.json, lockfiles, and .ctxo live. */
  readonly projectRoot: string;
}

export interface Resolution {
  readonly manager: PackageManager;
  readonly source: 'flag' | 'env' | 'config' | 'lockfile' | 'default';
  readonly detail?: string;
}

/**
 * Resolve the package manager to use for install operations.
 *
 * Order (PRD §5.4 D3.6):
 *   1. `--pm` flag
 *   2. `CTXO_PM` env var
 *   3. `.ctxo/config.yaml` packageManager field
 *   4. Lockfile detection: bun.lockb > pnpm-lock.yaml > yarn.lock > package-lock.json
 *   5. Default: npm
 */
export function resolvePackageManager(options: ResolveOptions): Resolution {
  const env = options.env ?? process.env;

  if (options.flag) {
    if (!isPackageManager(options.flag)) {
      throw new Error(
        `Unknown --pm value "${options.flag}". Supported: ${PACKAGE_MANAGERS.join(', ')}`,
      );
    }
    return { manager: options.flag, source: 'flag' };
  }

  const envValue = env['CTXO_PM'];
  if (envValue) {
    if (!isPackageManager(envValue)) {
      throw new Error(
        `CTXO_PM="${envValue}" is not a supported package manager. Expected one of: ${PACKAGE_MANAGERS.join(', ')}`,
      );
    }
    return { manager: envValue, source: 'env' };
  }

  const configured = readConfigPackageManager(options.projectRoot);
  if (configured) return { manager: configured, source: 'config' };

  const corepack = readPackageManagerField(options.projectRoot);
  if (corepack) return { manager: corepack.manager, source: 'config', detail: corepack.detail };

  const lockHit = detectFromLockfileWalkUp(options.projectRoot);
  if (lockHit) return { manager: lockHit.manager, source: 'lockfile', detail: lockHit.detail };

  return { manager: 'npm', source: 'default' };
}

/**
 * Honor the corepack `packageManager` field in the nearest package.json walking
 * up from projectRoot. Format: "pnpm@10.9.0" | "yarn@4.0.0" | "npm@10.0.0".
 */
function readPackageManagerField(startDir: string): LockHit | null {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf-8')) as { packageManager?: string };
        const value = parsed.packageManager;
        if (typeof value === 'string') {
          const [nameRaw] = value.split('@');
          const name = (nameRaw ?? '').trim();
          if (isPackageManager(name)) {
            return { manager: name, detail: `packageManager: ${value}` };
          }
        }
      } catch {
        // ignore malformed manifests; try parent
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readConfigPackageManager(projectRoot: string): PackageManager | null {
  const path = join(projectRoot, '.ctxo', 'config.yaml');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    // Minimal parse — single top-level `packageManager: <value>` line.
    const match = raw.match(/^packageManager:\s*(\S+)\s*$/m);
    if (!match) return null;
    const value = match[1]!;
    return isPackageManager(value) ? value : null;
  } catch {
    return null;
  }
}

interface LockHit {
  manager: PackageManager;
  detail: string;
}

/**
 * Look for a lockfile at `projectRoot` or any ancestor (monorepo-aware).
 * pnpm-workspace.yaml is also a strong pnpm signal even when the lockfile
 * lives only at the workspace root.
 */
function detectFromLockfileWalkUp(startDir: string): LockHit | null {
  const probes: Array<{ file: string; manager: PackageManager }> = [
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'pnpm-workspace.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'package-lock.json', manager: 'npm' },
  ];
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    for (const probe of probes) {
      const path = join(dir, probe.file);
      if (existsSync(path)) {
        return { manager: probe.manager, detail: probe.file };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface InstallInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Build the install invocation for a chosen package manager. `global` produces
 * a globally-scoped install; otherwise the install targets devDependencies.
 */
export function buildInstallCommand(
  manager: PackageManager,
  packages: readonly string[],
  options: { global?: boolean } = {},
): InstallInvocation {
  if (packages.length === 0) {
    throw new Error('buildInstallCommand requires at least one package');
  }
  switch (manager) {
    case 'npm':
      return {
        command: 'npm',
        args: options.global ? ['install', '-g', ...packages] : ['install', '-D', ...packages],
      };
    case 'pnpm':
      return {
        command: 'pnpm',
        args: options.global ? ['add', '-g', ...packages] : ['add', '-D', ...packages],
      };
    case 'yarn':
      return {
        command: 'yarn',
        args: options.global
          ? ['global', 'add', ...packages]
          : ['add', '--dev', ...packages],
      };
    case 'bun':
      return {
        command: 'bun',
        args: options.global ? ['add', '-g', ...packages] : ['add', '-d', ...packages],
      };
  }
}
