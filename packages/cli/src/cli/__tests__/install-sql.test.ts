import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A dry run must never reach the package manager; mocking it makes that a hard guarantee.
const runPackageManager = vi.hoisted(() => vi.fn(async () => 0));
vi.mock('../../core/install/run-package-manager.js', () => ({ runPackageManager }));

import { InstallCommand, buildPluginSpecifiers } from '../install-command.js';

describe('ctxo install sql', () => {
  let dir: string;
  let errorSpy: MockInstance<typeof console.error>;
  let savedExitCode: typeof process.exitCode;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    runPackageManager.mockClear();
    dir = mkdtempSync(join(tmpdir(), 'ctxo-install-sql-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'library-app', version: '1.0.0' }), 'utf-8');
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function stderr(): string {
    return errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  async function dryRun(languages: string[]): Promise<void> {
    // force: a CI environment with a frozen lockfile would otherwise refuse before the plan is printed
    await new InstallCommand(dir).run({ languages, dryRun: true, pm: 'pnpm', force: true });
  }

  it('ctxo install sql plans @ctxo/lang-sql', async () => {
    expect(buildPluginSpecifiers(['sql'], { jreAvailable: false })).toEqual(['@ctxo/lang-sql']);
    expect(buildPluginSpecifiers(['sql'], { jreAvailable: false, version: '0.1.0' })).toEqual(['@ctxo/lang-sql@0.1.0']);

    await dryRun(['sql']);

    expect(stderr()).toContain('Plan: install @ctxo/lang-sql');
    expect(stderr()).toContain('--dry-run set; not executing.');
    expect(runPackageManager).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('tsql is an alias of sql', async () => {
    await dryRun(['tsql']);

    expect(stderr()).toContain('Plan: install @ctxo/lang-sql');
    expect(stderr()).not.toContain('Unknown language');
    expect(runPackageManager).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();

    // The alias is case-insensitive and folds into one package when both spellings are given.
    errorSpy.mockClear();
    await dryRun(['TSQL', 'sql']);
    const plans = stderr().split('\n').filter((line) => line.includes('Plan: install'));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toContain('Plan: install @ctxo/lang-sql');
    expect(plans[0]).not.toContain(',');
  });
});
