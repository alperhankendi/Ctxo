import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { SymbolKind } from '@ctxo/plugin-api';

// No dotnet runs here: discovery finds a helper and a solution, and the helper process is a fake.
const discovery = vi.hoisted(() => ({
  detectDotnetSdk: vi.fn(),
  findCtxoRoslynProject: vi.fn(),
  discoverSolution: vi.fn(),
}));
const helper = vi.hoisted(() => ({
  runBatchIndex: vi.fn(),
  keepAliveStart: vi.fn(),
  keepAliveArgs: [] as unknown[][],
}));

vi.mock('../roslyn/solution-discovery.js', () => discovery);
vi.mock('../roslyn/roslyn-process.js', () => ({
  runBatchIndex: helper.runBatchIndex,
  RoslynKeepAlive: class {
    constructor(...args: unknown[]) {
      helper.keepAliveArgs.push(args);
    }
    start = helper.keepAliveStart;
    isAlive = (): boolean => false;
    analyzeFile = async (): Promise<null> => null;
    shutdown = async (): Promise<void> => {};
  },
}));

import { CSharpCompositeAdapter } from '../composite-adapter.js';

const ROOT = resolve(tmpdir(), 'ctxo-lending');
const SOLUTION = join(ROOT, 'Lending.sln');
const LOAN_SERVICE = 'Loans/LoanService.cs';
const SOURCE = 'public class LoanService {}';
const RESTORE_ERROR = 'error NU1101: Unable to find package Microsoft.SqlServer.TransactSql.ScriptDom.';

const ROSLYN_SYMBOL = {
  symbolId: `${LOAN_SERVICE}::Lending.Loans.LoanService::class`,
  name: 'Lending.Loans.LoanService',
  kind: 'class',
  startLine: 0,
  endLine: 0,
};

function failedBatch(): unknown {
  return { ok: false, error: RESTORE_ERROR, files: [], projectGraph: null, totalFiles: 0, elapsed: '' };
}

function successfulBatch(): unknown {
  return {
    ok: true,
    files: [{ type: 'file', file: LOAN_SERVICE, symbols: [ROSLYN_SYMBOL], edges: [], complexity: [] }],
    projectGraph: null,
    totalFiles: 1,
    elapsed: '0.4s',
  };
}

let stderrWrite: ReturnType<typeof vi.spyOn>;

function fallbackWarnings(): string[] {
  return stderrWrite.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('Roslyn helper failed'));
}

async function fullTierComposite(): Promise<CSharpCompositeAdapter> {
  const composite = new CSharpCompositeAdapter();
  await composite.initialize(ROOT);
  expect(composite.getTier()).toBe('full');
  return composite;
}

beforeEach(() => {
  discovery.detectDotnetSdk.mockReturnValue({ available: true, version: '8.0.404' });
  discovery.findCtxoRoslynProject.mockReturnValue(join(ROOT, 'tools', 'ctxo-roslyn'));
  discovery.discoverSolution.mockReturnValue(SOLUTION);
  helper.runBatchIndex.mockReset();
  helper.keepAliveStart.mockReset();
  helper.keepAliveArgs.length = 0;
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CSharpCompositeAdapter Roslyn fallback', () => {
  it('falls back to tree-sitter when the Roslyn batch fails', async () => {
    helper.runBatchIndex.mockResolvedValue(failedBatch());
    const composite = await fullTierComposite();

    await composite.getRoslynDelegate()!.batchIndex();
    const symbols = await composite.extractSymbols(LOAN_SERVICE, SOURCE);

    expect(symbols.map((s) => s.symbolId)).toEqual([`${LOAN_SERVICE}::LoanService::class`]);
    expect(composite.getTier()).toBe('syntax');
    expect(composite.getIncrementalReindex()).toBeNull();
    expect(composite.getRoslynDelegate()).toBeNull();
  });

  it('passes the symbol registry to the tree-sitter fallback', async () => {
    helper.runBatchIndex.mockResolvedValue(failedBatch());
    const composite = await fullTierComposite();
    const loanBase = 'Loans/LoanBase.cs::Lending.LoanBase::class';
    composite.setSymbolRegistry(new Map<string, SymbolKind>([[loanBase, 'class']]));

    await composite.getRoslynDelegate()!.batchIndex();
    const edges = await composite.extractEdges(
      LOAN_SERVICE,
      'namespace Lending { public class LoanService : LoanBase {} }',
    );

    // Without the registry the syntax tier guesses `Lending.LoanBase::LoanBase::class`.
    expect(edges).toContainEqual({ from: `${LOAN_SERVICE}::Lending.LoanService::class`, to: loanBase, kind: 'extends' });
  });

  it('warns once about the fallback', async () => {
    helper.runBatchIndex.mockResolvedValue(failedBatch());
    const composite = await fullTierComposite();

    await composite.getRoslynDelegate()!.batchIndex();
    await composite.extractSymbols(LOAN_SERVICE, SOURCE);
    await composite.extractEdges(LOAN_SERVICE, SOURCE);

    expect(fallbackWarnings()).toEqual([
      `[ctxo:lang-csharp] Roslyn helper failed (${RESTORE_ERROR}); C# falls back to the tree-sitter syntax tier. Run "ctxo doctor".\n`,
    ]);
  });

  it('stays on Roslyn when the batch succeeds', async () => {
    helper.runBatchIndex.mockResolvedValue(successfulBatch());
    const composite = await fullTierComposite();

    await composite.getRoslynDelegate()!.batchIndex();
    const symbols = await composite.extractSymbols(LOAN_SERVICE, SOURCE);

    expect(symbols.map((s) => s.symbolId)).toEqual([ROSLYN_SYMBOL.symbolId]);
    expect(composite.getTier()).toBe('full');
    expect(composite.getIncrementalReindex()).not.toBeNull();
    expect(composite.getRoslynDelegate()).not.toBeNull();
    expect(fallbackWarnings()).toEqual([]);
  });

  it('falls back when the keep-alive cannot start', async () => {
    helper.keepAliveStart.mockResolvedValue(false);
    const composite = await fullTierComposite();

    const keepAlive = composite.getIncrementalReindex()!;
    expect(await keepAlive.startKeepAlive()).toBe(false);

    expect(composite.getTier()).toBe('syntax');
    expect(composite.getIncrementalReindex()).toBeNull();
    const symbols = await composite.extractSymbols(LOAN_SERVICE, SOURCE);
    expect(symbols.map((s) => s.symbolId)).toEqual([`${LOAN_SERVICE}::LoanService::class`]);
    expect(fallbackWarnings()).toHaveLength(1);
  });
});

describe('CSharpCompositeAdapter SQL call sites', () => {
  const HELPER_DIR = join(ROOT, 'tools', 'ctxo-roslyn');

  it('passes sqlCallSites to the Roslyn batch and keep-alive', async () => {
    helper.runBatchIndex.mockResolvedValue(successfulBatch());
    helper.keepAliveStart.mockResolvedValue(true);
    const composite = new CSharpCompositeAdapter({ sqlCallSites: true });
    await composite.initialize(ROOT);

    await composite.getRoslynDelegate()!.batchIndex();
    await composite.getIncrementalReindex()!.startKeepAlive();

    expect(helper.runBatchIndex).toHaveBeenCalledWith(HELPER_DIR, SOLUTION, { sqlCallSites: true });
    expect(helper.keepAliveArgs).toEqual([[HELPER_DIR, SOLUTION, { sqlCallSites: true }]]);
  });

  it('runs the helper without SQL call sites by default', async () => {
    helper.runBatchIndex.mockResolvedValue(successfulBatch());
    const composite = await fullTierComposite();

    await composite.getRoslynDelegate()!.batchIndex();

    expect(composite.sqlCallSites).toBe(false);
    expect(helper.runBatchIndex).toHaveBeenCalledWith(HELPER_DIR, SOLUTION, { sqlCallSites: false });
  });

  it('sqlCallSites reports the option as constructed after a fallback to tree-sitter', async () => {
    helper.runBatchIndex.mockResolvedValue(failedBatch());
    const composite = new CSharpCompositeAdapter({ sqlCallSites: true });
    await composite.initialize(ROOT);

    await composite.getRoslynDelegate()!.batchIndex();

    expect(composite.getTier()).toBe('syntax');
    expect(composite.sqlCallSites).toBe(true);
  });
});
