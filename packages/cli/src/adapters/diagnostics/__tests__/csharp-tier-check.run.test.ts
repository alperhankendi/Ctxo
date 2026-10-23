import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SpawnSyncReturns } from 'node:child_process';
import { CSharpTierCheck, resolveHelperProject } from '../checks/csharp-tier-check.js';
import { resetDotnetSdkCacheForTests } from '../../../core/detection/detect-dotnet-sdk.js';

// Every dotnet process is mocked: the SDK detection and the restore probe both go through spawnSync.
const spawnSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync,
}));

// The node_modules folder next to the CLI, or null when the CLI has no plugins around it.
const cli = vi.hoisted(() => ({ nodeModules: null as string | null }));

// Package resolution looks only in two places, never in the folders above the temp directory, so the
// outcome cannot depend on a @ctxo/lang-csharp installed somewhere on this machine: the project's own
// node_modules (a lookup anchored on its package.json) and `cli.nodeModules` (any other anchor, which
// is the plugin loader's own module URL, i.e. the CLI's location).
vi.mock('node:module', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:module')>()),
  createRequire: (from: string) => ({
    resolve: (id: string): string => {
      const nodeModules = from.endsWith('package.json') ? join(dirname(from), 'node_modules') : cli.nodeModules;
      const candidate = nodeModules === null ? null : join(nodeModules, id);
      if (candidate !== null && existsSync(candidate)) return candidate;
      throw Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' });
    },
  }),
}));

type Result = Partial<SpawnSyncReturns<string>>;

/** `dotnet --version` prints `sdk`; `dotnet restore` returns `restore`. */
function dotnet(sdk: string | null, restore: Result = { status: 0, stdout: '', stderr: '' }): void {
  spawnSync.mockImplementation((_command: string, args: readonly string[]): Result => {
    if (args[0] === '--version') return sdk === null ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: `${sdk}\n`, stderr: '' };
    if (args[0] === 'restore') return restore;
    throw new Error(`unexpected dotnet ${args.join(' ')}`);
  });
}

const restoreCalls = (): unknown[][] => spawnSync.mock.calls.filter((call) => (call[1] as string[])[0] === 'restore');

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Installs @ctxo/lang-csharp and its helper project into `nodeModules`; returns the helper project path. */
function installPlugin(nodeModules: string): string {
  const pkgDir = join(nodeModules, '@ctxo', 'lang-csharp');
  const helper = join(pkgDir, 'tools', 'ctxo-roslyn', 'ctxo-roslyn.csproj');
  mkdirSync(dirname(helper), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), '{"name":"@ctxo/lang-csharp","version":"0.0.0"}');
  writeFileSync(helper, '<Project />');
  return helper;
}

/** A project with C# sources; with `plugin`, it also has @ctxo/lang-csharp and its helper project. */
function lendingProject(plugin: boolean): { root: string; helper: string } {
  const root = tempDir('ctxo-cs-run-');
  writeFileSync(join(root, 'package.json'), '{"name":"lending-app"}');
  writeFileSync(join(root, 'Lending.csproj'), '<Project />');
  const nodeModules = join(root, 'node_modules');
  const helper = join(nodeModules, '@ctxo', 'lang-csharp', 'tools', 'ctxo-roslyn', 'ctxo-roslyn.csproj');
  if (plugin) installPlugin(nodeModules);
  return { root, helper };
}

/** A node_modules folder next to the CLI, holding @ctxo/lang-csharp; returns the helper project path. */
function cliPlugin(): string {
  const nodeModules = join(tempDir('ctxo-cs-cli-'), 'node_modules');
  cli.nodeModules = nodeModules;
  return installPlugin(nodeModules);
}

const run = (root: string) => new CSharpTierCheck().run({ projectRoot: root, ctxoRoot: join(root, '.ctxo') });

beforeEach(() => {
  spawnSync.mockReset();
  resetDotnetSdkCacheForTests();
  cli.nodeModules = null;
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveHelperProject (hermetic resolution)', () => {
  it('returns null when @ctxo/lang-csharp does not resolve from the project', () => {
    expect(resolveHelperProject(lendingProject(false).root)).toBeNull();
  });

  it('falls back to the CLI location when the project does not resolve it', () => {
    const cliHelper = cliPlugin();
    expect(resolveHelperProject(lendingProject(false).root)).toBe(cliHelper);
  });
});

describe('CSharpTierCheck.run', () => {
  it('passes without running dotnet when the project has no C#', async () => {
    dotnet('8.0.404');
    const r = await run(tempDir('ctxo-cs-run-empty-'));
    expect(r).toEqual({ id: 'csharp_tier', title: 'C# analysis tier', status: 'pass', message: 'no C# sources detected' });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('skips the restore probe below the .NET 8 SDK', async () => {
    for (const sdk of [null, '6.0.428']) {
      spawnSync.mockReset();
      resetDotnetSdkCacheForTests();
      dotnet(sdk);
      const r = await run(lendingProject(true).root);
      expect(r.message).toBe('syntax tier (install the .NET 8+ SDK for the full tier)');
      expect(restoreCalls()).toEqual([]);
    }
  });

  it('reports the syntax tier without a restore probe when @ctxo/lang-csharp is not installed', async () => {
    dotnet('8.0.404');
    const r = await run(lendingProject(false).root);
    expect(r).toEqual({ id: 'csharp_tier', title: 'C# analysis tier', status: 'pass', message: 'syntax tier (@ctxo/lang-csharp not installed)' });
    expect(restoreCalls()).toEqual([]);
  });

  it('restores the helper the project resolves, once, with a timeout', async () => {
    dotnet('8.0.404');
    const { root, helper } = lendingProject(true);
    const r = await run(root);
    expect(r.message).toBe('full tier (.NET SDK 8.0.404, Roslyn helper restores)');
    expect(restoreCalls()).toHaveLength(1);
    const [command, args, options] = restoreCalls()[0] as [string, string[], { timeout: number }];
    expect([command, ...args]).toEqual(['dotnet', 'restore', helper, '--nologo', '-v', 'q']);
    expect(options.timeout).toBe(120_000);
  });

  it('csharp_tier finds lang-csharp next to the CLI when the project has no package.json', async () => {
    dotnet('8.0.404');
    const cliHelper = cliPlugin();
    const root = tempDir('ctxo-cs-run-bare-');
    writeFileSync(join(root, 'Lending.csproj'), '<Project />');
    expect(existsSync(join(root, 'package.json'))).toBe(false);
    const r = await run(root);
    expect(r).toEqual({ id: 'csharp_tier', title: 'C# analysis tier', status: 'pass', message: 'full tier (.NET SDK 8.0.404, Roslyn helper restores)' });
    expect(restoreCalls()).toHaveLength(1);
    expect((restoreCalls()[0] as [string, string[]])[1][1]).toBe(cliHelper);
  });

  it("csharp_tier prefers the project's lang-csharp", async () => {
    dotnet('8.0.404');
    cliPlugin();
    const { root, helper } = lendingProject(true);
    const r = await run(root);
    expect(r.message).toBe('full tier (.NET SDK 8.0.404, Roslyn helper restores)');
    expect(restoreCalls()).toHaveLength(1);
    expect((restoreCalls()[0] as [string, string[]])[1][1]).toBe(helper);
  });

  it('reports a restore that runs past the timeout as timed out', async () => {
    const timeout = Object.assign(new Error('spawnSync dotnet ETIMEDOUT'), { code: 'ETIMEDOUT' });
    dotnet('8.0.404', { status: null, signal: 'SIGTERM', stdout: 'error: partial restore output\n', stderr: '', error: timeout });
    const r = await run(lendingProject(true).root);
    expect(r.status).toBe('warn');
    expect(r.message).toBe('syntax tier: the Roslyn helper could not restore (timed out)');
  });

  it('reports a dotnet that cannot start by its spawn error', async () => {
    const cannotStart = Object.assign(new Error('spawnSync dotnet EACCES'), { code: 'EACCES' });
    dotnet('8.0.404', { status: null, stdout: '', stderr: '', error: cannotStart });
    const r = await run(lendingProject(true).root);
    expect(r.message).toBe('syntax tier: the Roslyn helper could not restore (error: spawnSync dotnet EACCES)');
  });

  it('reports the restore error without the helper path', async () => {
    const { root, helper } = lendingProject(true);
    const stdout = `${helper} : error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.\n`;
    dotnet('9.0.100', { status: 1, stdout, stderr: '' });
    const r = await run(root);
    expect(r.message).toBe('syntax tier: the Roslyn helper could not restore (ctxo-roslyn.csproj : error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.)');
  });
});
