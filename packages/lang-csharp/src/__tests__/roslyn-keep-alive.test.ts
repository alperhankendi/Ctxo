import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChildProcess } from 'node:child_process';

// No dotnet runs here: discovery finds a helper and a solution, and every helper process is a fake
// that the real RoslynKeepAlive drives through stdin and stdout.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const discovery = vi.hoisted(() => ({
  detectDotnetSdk: vi.fn(),
  findCtxoRoslynProject: vi.fn(),
  discoverSolution: vi.fn(),
}));
vi.mock('../roslyn/solution-discovery.js', () => discovery);

import { spawn } from 'node:child_process';
import type { IIncrementalReindex } from '@ctxo/plugin-api';
import { CSharpCompositeAdapter } from '../composite-adapter.js';

const ROOT = resolve(tmpdir(), 'ctxo-lending');
const LOAN_SERVICE = 'Loans/LoanService.cs';
const SOURCE = 'public class LoanService {}';
const ROSLYN_SYMBOL = {
  symbolId: `${LOAN_SERVICE}::Lending.Loans.LoanService::class`,
  name: 'Lending.Loans.LoanService',
  kind: 'class',
  startLine: 0,
  endLine: 0,
};
/** The keep-alive's default inactivity timeout. */
const IDLE_MS = 300_000;

type Outcome = 'starts' | 'fails';

/** A `dotnet run --keep-alive` process: it reports `ready` (or exits) and answers each file request. */
class FakeHelper extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly requests: string[] = [];
  killed = false;
  /** When set, the helper exits on a request instead of answering it. */
  crashOnRequest = false;
  readonly kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
  readonly stdin = {
    writable: true,
    end: vi.fn(),
    write: vi.fn((line: string) => {
      const { file } = JSON.parse(line) as { file: string };
      this.requests.push(file);
      queueMicrotask(() => (this.crashOnRequest ? this.emit('close', 134) : this.answer(file)));
      return true;
    }),
  };

  private answer(file: string): void {
    const result = { type: 'file', file, symbols: [ROSLYN_SYMBOL], edges: [], complexity: [] };
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(result)}\n`));
  }
}

/** The next spawned helper: it reports `ready`, or exits with code 1 before that. */
function nextHelper(outcome: Outcome): FakeHelper {
  const helper = new FakeHelper();
  vi.mocked(spawn).mockImplementationOnce(() => {
    queueMicrotask(() => {
      if (outcome === 'starts') {
        helper.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'ready', projectCount: 1, fileCount: 1 })}\n`));
      } else {
        helper.emit('close', 1);
      }
    });
    return helper as unknown as ChildProcess;
  });
  return helper;
}

let stderrWrite: ReturnType<typeof vi.spyOn>;

function fallbackWarnings(): string[] {
  return stderrWrite.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('Roslyn helper failed'));
}

/** A full-tier composite whose keep-alive has started. */
async function watching(): Promise<{ composite: CSharpCompositeAdapter; keepAlive: IIncrementalReindex; first: FakeHelper }> {
  const first = nextHelper('starts');
  const composite = new CSharpCompositeAdapter();
  await composite.initialize(ROOT);
  const keepAlive = composite.getIncrementalReindex()!;
  expect(await keepAlive.startKeepAlive()).toBe(true);
  return { composite, keepAlive, first };
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  discovery.detectDotnetSdk.mockReturnValue({ available: true, version: '8.0.404' });
  discovery.findCtxoRoslynProject.mockReturnValue(join(ROOT, 'tools', 'ctxo-roslyn'));
  discovery.discoverSolution.mockReturnValue(join(ROOT, 'Lending.sln'));
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Roslyn keep-alive after ready', () => {
  it('reindexFile restarts an idle keep-alive', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { composite, keepAlive, first } = await watching();

    // Five minutes without a request: the keep-alive shuts itself down.
    vi.advanceTimersByTime(IDLE_MS);
    expect(first.kill).toHaveBeenCalledOnce();

    const second = nextHelper('starts');
    const result = await keepAlive.reindexFile(LOAN_SERVICE);

    expect(result?.symbols.map((s) => s.symbolId)).toEqual([ROSLYN_SYMBOL.symbolId]);
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2);
    expect(first.requests).toEqual([]);
    expect(second.requests).toEqual([LOAN_SERVICE]);
    expect(keepAlive.isReady()).toBe(true);
    expect(composite.getTier()).toBe('full');
    expect(fallbackWarnings()).toEqual([]);
    await composite.dispose();
  });

  it('reindexFile restarts a keep-alive that exited', async () => {
    const { composite, keepAlive, first } = await watching();
    first.emit('close', 134);

    const second = nextHelper('starts');
    const result = await keepAlive.reindexFile(LOAN_SERVICE);

    expect(result?.symbols.map((s) => s.symbolId)).toEqual([ROSLYN_SYMBOL.symbolId]);
    expect(second.requests).toEqual([LOAN_SERVICE]);
    expect(composite.getTier()).toBe('full');
    await composite.dispose();
  });

  it('concurrent requests share one restart', async () => {
    const { composite, keepAlive, first } = await watching();
    first.emit('close', 134);

    const second = nextHelper('starts');
    const results = await Promise.all([keepAlive.reindexFile(LOAN_SERVICE), keepAlive.reindexFile('Loans/Fine.cs')]);

    expect(results.map((r) => r !== null)).toEqual([true, true]);
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2);
    expect([...second.requests].sort()).toEqual(['Loans/Fine.cs', LOAN_SERVICE]);
    await composite.dispose();
  });

  it('a keep-alive that exits during a request restarts once and is asked again', async () => {
    const { composite, keepAlive, first } = await watching();
    first.crashOnRequest = true;

    const second = nextHelper('starts');
    const result = await keepAlive.reindexFile(LOAN_SERVICE);

    expect(result?.symbols.map((s) => s.symbolId)).toEqual([ROSLYN_SYMBOL.symbolId]);
    expect(first.requests).toEqual([LOAN_SERVICE]);
    expect(second.requests).toEqual([LOAN_SERVICE]);
    expect(composite.getTier()).toBe('full');
    await composite.dispose();
  });

  it('a keep-alive that cannot restart triggers the tree-sitter fallback', async () => {
    const { composite, keepAlive, first } = await watching();
    first.emit('close', 134);

    nextHelper('fails');
    expect(await keepAlive.reindexFile(LOAN_SERVICE)).toBeNull();

    // Watch checks isReady() first, then reads the composite, which now runs tree-sitter.
    expect(keepAlive.isReady()).toBe(false);
    expect(composite.getTier()).toBe('syntax');
    expect(composite.getIncrementalReindex()).toBeNull();
    const symbols = await composite.extractSymbols(LOAN_SERVICE, SOURCE);
    expect(symbols.map((s) => s.symbolId)).toEqual([`${LOAN_SERVICE}::LoanService::class`]);
    expect(fallbackWarnings()).toEqual([
      '[ctxo:lang-csharp] Roslyn helper failed (the keep-alive helper stopped and did not restart); C# falls back to the tree-sitter syntax tier. Run "ctxo doctor".\n',
    ]);
    await composite.dispose();
  });

  it('a keep-alive that exits on the same request after its restart triggers the tree-sitter fallback', async () => {
    const { composite, keepAlive, first } = await watching();
    first.crashOnRequest = true;

    const second = nextHelper('starts');
    second.crashOnRequest = true;
    expect(await keepAlive.reindexFile(LOAN_SERVICE)).toBeNull();

    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2);
    expect(keepAlive.isReady()).toBe(false);
    expect(composite.getTier()).toBe('syntax');
    expect(fallbackWarnings()).toHaveLength(1);
    expect(fallbackWarnings()[0]).toContain('the keep-alive helper exited again after a restart');
    await composite.dispose();
  });
});
