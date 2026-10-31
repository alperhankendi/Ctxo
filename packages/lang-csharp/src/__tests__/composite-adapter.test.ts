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
import { DEFAULT_FACT_OPTIONS } from '../facts/fact-options.js';

const FACT_OPTIONS = { ...DEFAULT_FACT_OPTIONS, normalizationMethods: ['Trim'] };

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

describe('CSharpCompositeAdapter facts', () => {
  const KEY_FILE = 'Loans/Key.cs';
  const KEY_SOURCE = [
    'namespace Lending.Loans;',
    'public static class Key',
    '{',
    '    public static string Of(string email) => email.Trim().ToLower();',
    '}',
    '',
  ].join('\n');
  const KEY_METHOD = {
    symbolId: `${KEY_FILE}::Lending.Loans.Key.Of::method`,
    name: 'Lending.Loans.Key.Of',
    kind: 'method',
    startLine: 3,
    endLine: 3,
  };
  const ROUTE_METHOD = {
    symbolId: `${KEY_FILE}::Lending.Loans.Key.Find::method`,
    name: 'Lending.Loans.Key.Find',
    kind: 'method',
    startLine: 5,
    endLine: 6,
    annotations: [{ name: 'HttpGet', args: ['/keys/{id}'] }],
  };
  const EVIDENCE = [
    { kind: 'call', symbolId: KEY_METHOD.symbolId, line: 3, text: 'email.Trim()', method: 'Trim', qualifier: 'email' },
    { kind: 'comparison', symbolId: KEY_METHOD.symbolId, line: 3, text: 'tier == @"gold"', operator: '==', literal: '@"gold"', literalKind: 'string' },
    { kind: 'comparison', symbolId: KEY_METHOD.symbolId, line: 3, text: 'tier == @""', operator: '==', literal: '@""', literalKind: 'string' },
  ];

  function batchWithEvidence(): unknown {
    return {
      ok: true,
      files: [{ type: 'file', file: KEY_FILE, symbols: [KEY_METHOD, ROUTE_METHOD], edges: [], complexity: [], factEvidence: EVIDENCE }],
      projectGraph: null,
      totalFiles: 1,
      elapsed: '0.4s',
    };
  }

  it('extractFacts finishes the batch evidence and the attribute routes with the C# string decoder', async () => {
    helper.runBatchIndex.mockResolvedValue(batchWithEvidence());
    const composite = new CSharpCompositeAdapter({ facts: DEFAULT_FACT_OPTIONS });
    await composite.initialize(ROOT);
    await composite.getRoslynDelegate()!.batchIndex();

    const facts = await composite.extractFacts(KEY_FILE, '');
    // `@""` decodes to the empty string, which is trivial; `@"gold"` is not.
    expect(facts.map((f) => `${f.line} ${f.kind} ${f.text} ${f.symbolId}`)).toEqual([
      `3 literal-comparison tier == @"gold" ${KEY_METHOD.symbolId}`,
      `3 normalization email.Trim() ${KEY_METHOD.symbolId}`,
      `5 endpoint GET /keys/{id} ${ROUTE_METHOD.symbolId}`,
    ]);
  });

  it('extractFacts returns [] without the facts option, even with evidence', async () => {
    helper.runBatchIndex.mockResolvedValue(batchWithEvidence());
    const composite = await fullTierComposite();
    await composite.getRoslynDelegate()!.batchIndex();

    expect(await composite.extractFacts(KEY_FILE, '')).toEqual([]);
  });

  it('extractFacts falls back with the other extract methods when the batch fails', async () => {
    helper.runBatchIndex.mockResolvedValue(failedBatch());
    const composite = new CSharpCompositeAdapter({ facts: DEFAULT_FACT_OPTIONS });
    await composite.initialize(ROOT);
    await composite.getRoslynDelegate()!.batchIndex();

    expect(await composite.extractFacts(KEY_FILE, 'public class Key {}')).toEqual([]);
    expect(composite.getTier()).toBe('syntax');
    expect(composite.facts).toBe(DEFAULT_FACT_OPTIONS);
  });

  it('the tree-sitter fallback after a failed batch reports facts with the composite options', async () => {
    helper.runBatchIndex.mockResolvedValue(failedBatch());
    const composite = new CSharpCompositeAdapter({ facts: FACT_OPTIONS });
    await composite.initialize(ROOT);
    await composite.getRoslynDelegate()!.batchIndex();

    const facts = await composite.extractFacts(KEY_FILE, KEY_SOURCE);
    expect(composite.getTier()).toBe('syntax');
    // FACT_OPTIONS keeps only Trim, so ToLower is not a normalization fact.
    expect(facts.map((f) => `${f.line} ${f.kind} ${f.text} ${f.symbolId}`)).toEqual([
      `3 normalization email.Trim() ${KEY_FILE}::Lending.Loans.Key.Of(1)::method`,
    ]);
  });

  it('the syntax tier chosen at initialize reports facts', async () => {
    discovery.detectDotnetSdk.mockReturnValue({ available: false });
    const composite = new CSharpCompositeAdapter({ facts: DEFAULT_FACT_OPTIONS });
    await composite.initialize(ROOT);

    expect(composite.getTier()).toBe('syntax');
    // FC-4b: the chain is one fact, the outermost call.
    expect((await composite.extractFacts(KEY_FILE, KEY_SOURCE)).map((f) => f.text)).toEqual([
      'email.Trim().ToLower()',
    ]);
  });

  it('extractFacts returns [] before initialize', async () => {
    expect(await new CSharpCompositeAdapter({ facts: DEFAULT_FACT_OPTIONS }).extractFacts(KEY_FILE, '')).toEqual([]);
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

  it('passes facts to the Roslyn batch and keep-alive, next to sqlCallSites', async () => {
    helper.runBatchIndex.mockResolvedValue(successfulBatch());
    helper.keepAliveStart.mockResolvedValue(true);
    const composite = new CSharpCompositeAdapter({ sqlCallSites: true, facts: FACT_OPTIONS });
    await composite.initialize(ROOT);

    await composite.getRoslynDelegate()!.batchIndex();
    await composite.getIncrementalReindex()!.startKeepAlive();

    expect(composite.facts).toBe(FACT_OPTIONS);
    expect(helper.runBatchIndex.mock.calls).toEqual([[HELPER_DIR, SOLUTION, { sqlCallSites: true, facts: FACT_OPTIONS }]]);
    expect(helper.keepAliveArgs).toEqual([[HELPER_DIR, SOLUTION, { sqlCallSites: true, facts: FACT_OPTIONS }]]);
  });

  it('without facts the helper options carry no facts key', async () => {
    helper.runBatchIndex.mockResolvedValue(successfulBatch());
    helper.keepAliveStart.mockResolvedValue(true);
    const composite = await fullTierComposite();

    await composite.getRoslynDelegate()!.batchIndex();
    await composite.getIncrementalReindex()!.startKeepAlive();

    expect(composite.facts).toBeUndefined();
    expect(Object.keys(helper.runBatchIndex.mock.calls[0]![2] as object)).toEqual(['sqlCallSites']);
    expect(Object.keys(helper.keepAliveArgs[0]![2] as object)).toEqual(['sqlCallSites']);
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
