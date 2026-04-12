import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  const lockHit = detectFromLockfile(options.projectRoot);
  if (lockHit) return { manager: lockHit.manager, source: 'lockfile', detail: lockHit.detail };

  return { manager: 'npm', source: 'default' };
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

function detectFromLockfile(projectRoot: string): LockHit | null {
  const probes: Array<{ file: string; manager: PackageManager }> = [
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'package-lock.json', manager: 'npm' },
  ];
  for (const probe of probes) {
    if (existsSync(join(projectRoot, probe.file))) {
      return { manager: probe.manager, detail: probe.file };
    }
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
