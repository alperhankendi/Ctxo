import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
// Only the composite test below loads the adapter; discovery then finds a helper and a solution.
const discovery = vi.hoisted(() => ({
  detectDotnetSdk: vi.fn(),
  findCtxoRoslynProject: vi.fn(),
  discoverSolution: vi.fn(),
}));
vi.mock('../roslyn/solution-discovery.js', () => discovery);

import { spawn } from 'node:child_process';
import { runBatchIndex, RoslynKeepAlive } from '../roslyn/roslyn-process.js';
import { CSharpCompositeAdapter } from '../composite-adapter.js';

/** A child process that the test drives: it emits what `dotnet run` would. */
class FakeProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = { writable: true, write: vi.fn(), end: vi.fn() };
  killed = false;
  readonly kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
}

function nextProcess(): FakeProcess {
  const proc = new FakeProcess();
  vi.mocked(spawn).mockReturnValueOnce(proc as unknown as ChildProcess);
  return proc;
}

const PENDING = Symbol('pending');

/** The promise's value, or PENDING when it has not settled within `ms`. */
async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | typeof PENDING> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof PENDING>((resolve) => {
    timer = setTimeout(() => resolve(PENDING), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const HELPER_DIR = '/opt/ctxo/tools/ctxo-roslyn';
const SOLUTION = '/work/lending/Lending.sln';

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  // The plugin logger writes to stderr; keep the test output clean.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runBatchIndex', () => {
  it('runBatchIndex reports failure with the stderr tail on a non-zero exit', async () => {
    const proc = nextProcess();
    const pending = runBatchIndex(HELPER_DIR, SOLUTION);

    // dotnet run prints the restore errors with the build output on stdout and the verdict on stderr.
    proc.stdout.emit(
      'data',
      Buffer.from(`${HELPER_DIR}/ctxo-roslyn.csproj : error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.\n`),
    );
    proc.stderr.emit('data', Buffer.from('The build failed. Fix the build errors and run again.\n'));
    proc.emit('close', 1);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('The build failed. Fix the build errors and run again.');
    expect(result.error).toContain('error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.');
    expect(result.files).toEqual([]);
    expect(result.projectGraph).toBeNull();
  });

  it('a warning that mentions Error is not taken for a build error', async () => {
    const proc = nextProcess();
    const pending = runBatchIndex(HELPER_DIR, SOLUTION);

    proc.stdout.emit(
      'data',
      Buffer.from(
        `${HELPER_DIR}/ctxo-roslyn.csproj : warning NU1900: Error occurred while getting package vulnerability data: loans feed offline\n` +
          `${HELPER_DIR}/ctxo-roslyn.csproj : error NU1101: Unable to find package Lending.Feed.\n`,
      ),
    );
    proc.emit('close', 1);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('error NU1101: Unable to find package Lending.Feed.');
  });

  it('with no MSBuild error line, a line that mentions error in any case still counts', async () => {
    const proc = nextProcess();
    const pending = runBatchIndex(HELPER_DIR, SOLUTION);

    proc.stdout.emit('data', Buffer.from('Restoring the loans project...\nUnhandled Error: the members catalog could not be loaded\n'));
    proc.emit('close', 1);

    const result = await pending;
    expect(result.error).toBe('Error: the members catalog could not be loaded');
  });

  it('runBatchIndex reports success on exit 0', async () => {
    const proc = nextProcess();
    const pending = runBatchIndex(HELPER_DIR, SOLUTION);

    const file = { type: 'file', file: 'Loans/LoanService.cs', symbols: [], edges: [], complexity: [] };
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify(file)}\n`));
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'done', totalFiles: 1, elapsed: '0.4s' })}\n`));
    proc.emit('close', 0);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.files).toEqual([file]);
    expect(result.totalFiles).toBe(1);
    expect(result).not.toHaveProperty('sql');
  });

  it('runBatchIndex reports failure when the helper is killed and keeps at most 500 characters', async () => {
    const proc = nextProcess();
    const pending = runBatchIndex(HELPER_DIR, SOLUTION);

    proc.stderr.emit('data', Buffer.from(`${'x'.repeat(700)}loans overdue\n`));
    proc.emit('close', null, 'SIGTERM');

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error!.length).toBeLessThanOrEqual(500);
    expect(result.error!.endsWith('loans overdue')).toBe(true);
  });

  it('runBatchIndex appends --sql-call-sites only when enabled', async () => {
    for (const options of [undefined, { sqlCallSites: false }, { sqlCallSites: true }]) {
      const proc = nextProcess();
      const pending = runBatchIndex(HELPER_DIR, SOLUTION, options);
      proc.emit('close', 0);
      await pending;
    }

    const calls = vi.mocked(spawn).mock.calls;
    expect(calls.map((call) => call[1])).toEqual([
      ['run', '--project', HELPER_DIR, '--', SOLUTION],
      ['run', '--project', HELPER_DIR, '--', SOLUTION],
      ['run', '--project', HELPER_DIR, '--', SOLUTION, '--sql-call-sites'],
    ]);
    expect(calls.map((call) => (call[2] as { timeout?: number }).timeout)).toEqual([120_000, 120_000, 120_000]);
  });

  it('runBatchIndex reads the sql stats from the done line', async () => {
    const proc = nextProcess();
    const pending = runBatchIndex(HELPER_DIR, SOLUTION, { sqlCallSites: true, timeoutMs: 5_000 });

    const sql = { constant: 9, nonConstant: 2, unparsable: 1 };
    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'done', totalFiles: 4, elapsed: '1.2s', sql })}\n`));
    proc.emit('close', 0);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.sql).toEqual(sql);
    expect((vi.mocked(spawn).mock.calls[0]![2] as { timeout?: number }).timeout).toBe(5_000);
  });

  it('runBatchIndex reports failure when spawn throws', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('spawn EINVAL');
    });

    const result = await settledWithin(runBatchIndex(HELPER_DIR, SOLUTION), 1_000);
    expect(result).toMatchObject({ ok: false, files: [], projectGraph: null, error: 'spawn EINVAL' });
  });

  it('a failed batch logs its error text once', async () => {
    discovery.detectDotnetSdk.mockReturnValue({ available: true, version: '8.0.404' });
    discovery.findCtxoRoslynProject.mockReturnValue(HELPER_DIR);
    discovery.discoverSolution.mockReturnValue(SOLUTION);
    const composite = new CSharpCompositeAdapter();
    await composite.initialize('/work/lending');

    const proc = nextProcess();
    const batch = composite.getRoslynDelegate()!.batchIndex();
    proc.stdout.emit('data', Buffer.from(`${HELPER_DIR}/ctxo-roslyn.csproj : error NU1101: Unable to find package Lending.Feed.\n`));
    proc.stderr.emit('data', Buffer.from('The build failed. Fix the build errors and run again.\n'));
    proc.emit('close', 1);
    await batch;
    await composite.extractSymbols('Loans/LoanService.cs', 'public class LoanService {}');

    const written = vi.mocked(process.stderr.write).mock.calls.map((call) => String(call[0])).join('');
    expect(written.split('error NU1101: Unable to find package Lending.Feed.')).toHaveLength(2);
    expect(written.split('The build failed.')).toHaveLength(2);
    // The batch still says that it failed and why, in short.
    expect(written).toContain('[ctxo:roslyn] ctxo-roslyn failed (exit code 1)');
    expect(composite.getTier()).toBe('syntax');
  });

  it('runBatchIndex reports failure when dotnet cannot be spawned', async () => {
    const proc = nextProcess();
    const pending = runBatchIndex(HELPER_DIR, SOLUTION);

    proc.emit('error', new Error('spawn dotnet ENOENT'));
    proc.emit('close', -4058);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('spawn dotnet ENOENT');
  });
});

describe('RoslynKeepAlive', () => {
  it('keep-alive start resolves false when the helper exits before ready', async () => {
    const proc = nextProcess();
    const keepAlive = new RoslynKeepAlive(HELPER_DIR, SOLUTION);
    const started = keepAlive.start();

    proc.stderr.emit('data', Buffer.from('The build failed. Fix the build errors and run again.\n'));
    proc.emit('close', 1);

    expect(await settledWithin(started, 1_000)).toBe(false);
    expect(keepAlive.isAlive()).toBe(false);
  });

  it('the keep-alive process gets the same flag', async () => {
    for (const options of [undefined, { sqlCallSites: false }, { sqlCallSites: true }]) {
      const proc = nextProcess();
      const started = new RoslynKeepAlive(HELPER_DIR, SOLUTION, options).start();
      proc.emit('close', 1);
      expect(await settledWithin(started, 1_000)).toBe(false);
    }

    expect(vi.mocked(spawn).mock.calls.map((call) => call[1])).toEqual([
      ['run', '--project', HELPER_DIR, '--', SOLUTION, '--keep-alive'],
      ['run', '--project', HELPER_DIR, '--', SOLUTION, '--keep-alive'],
      ['run', '--project', HELPER_DIR, '--', SOLUTION, '--keep-alive', '--sql-call-sites'],
    ]);
  });

  it('keep-alive start resolves false when spawn throws', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('spawn EINVAL');
    });
    const keepAlive = new RoslynKeepAlive(HELPER_DIR, SOLUTION);

    expect(await settledWithin(keepAlive.start(), 1_000)).toBe(false);
    expect(keepAlive.isAlive()).toBe(false);
  });

  it('keep-alive start resolves true on ready', async () => {
    const proc = nextProcess();
    const keepAlive = new RoslynKeepAlive(HELPER_DIR, SOLUTION);
    const started = keepAlive.start();

    proc.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'ready', projectCount: 1, fileCount: 3 })}\n`));

    expect(await settledWithin(started, 1_000)).toBe(true);
    expect(keepAlive.isAlive()).toBe(true);
    await keepAlive.shutdown();
  });
});
