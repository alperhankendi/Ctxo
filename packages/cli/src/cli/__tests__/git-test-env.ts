import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Environment variables that make git look somewhere other than the cwd's own repository, or that
 * pull in the machine's git configuration. Hook tests must see neither: an inherited `GIT_DIR` (a
 * hook-driven test run exports it) or the owner's global `core.hooksPath` would redirect
 * `git rev-parse --git-path hooks` at live hooks.
 */
const ISOLATED_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
] as const;

/** Forward slashes: a backslash is an escape character in git config values. */
function hooksPathConfig(hooksDir: string): string {
  return `[core]\n\thooksPath = ${hooksDir.replace(/\\/g, '/')}\n`;
}

export interface IsolatedGitEnv {
  /** The `GIT_CONFIG_GLOBAL` file. Empty until a test writes to it. */
  readonly globalConfigPath: string;
  /** Makes the isolated global git config set `core.hooksPath` to `hooksDir` (a shared hooks directory). */
  setGlobalHooksPath(hooksDir: string): void;
  /** Same, but through a system-scope config file (`GIT_CONFIG_SYSTEM`). */
  setSystemHooksPath(hooksDir: string): void;
  /** Puts every touched variable back and removes the temp config file. */
  restore(): void;
}

/**
 * Isolates git from the machine: scrubs `GIT_DIR` and friends, points `GIT_CONFIG_GLOBAL` at an
 * empty temp file and sets `GIT_CONFIG_NOSYSTEM=1`. Call from `beforeEach`, call `restore()` from
 * `afterEach`.
 */
export function isolateGitEnv(): IsolatedGitEnv {
  const saved = new Map<string, string | undefined>();
  for (const key of ISOLATED_VARS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  const configDir = mkdtempSync(join(tmpdir(), 'ctxo-gitenv-'));
  const globalConfigPath = join(configDir, 'gitconfig');
  writeFileSync(globalConfigPath, '', 'utf-8');
  process.env['GIT_CONFIG_GLOBAL'] = globalConfigPath;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';

  return {
    globalConfigPath,
    setGlobalHooksPath(hooksDir: string): void {
      writeFileSync(globalConfigPath, hooksPathConfig(hooksDir), 'utf-8');
    },
    setSystemHooksPath(hooksDir: string): void {
      const systemConfigPath = join(configDir, 'system-gitconfig');
      writeFileSync(systemConfigPath, hooksPathConfig(hooksDir), 'utf-8');
      process.env['GIT_CONFIG_SYSTEM'] = systemConfigPath;
      delete process.env['GIT_CONFIG_NOSYSTEM'];
    },
    restore(): void {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(configDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
