import { describe, it, expect, assertType } from 'vitest';
import {
  SUPPORTED_API_VERSION,
  SUPPORTED_API_VERSIONS,
  SYMBOL_KINDS,
  EDGE_KINDS,
  DATA_RESOURCE_KINDS,
  FACT_KINDS,
  type CodeFact,
  type SymbolNode,
  type CtxoLanguagePlugin,
  type ILanguageAdapter,
  type PluginContext,
  type IWorkspace,
  type SymbolKind,
  type EdgeKind,
} from '../index.js';

describe('@ctxo/plugin-api exports', () => {
  it('supports protocol versions 1 and 2', () => {
    expect([...SUPPORTED_API_VERSIONS]).toEqual(['1', '2']);
  });

  it('keeps the deprecated SUPPORTED_API_VERSION at "1"', () => {
    expect(SUPPORTED_API_VERSION).toBe('1');
  });

  it('enumerates all symbol kinds', () => {
    expect([...SYMBOL_KINDS]).toEqual([
      'function',
      'class',
      'interface',
      'method',
      'variable',
      'type',
      'table',
      'view',
      'procedure',
    ]);
  });

  it('enumerates all edge kinds', () => {
    expect([...EDGE_KINDS]).toEqual([
      'imports',
      'calls',
      'extends',
      'implements',
      'uses',
      'reads',
      'writes',
      'executes',
    ]);
  });

  it('data resource kinds are table and view, both symbol kinds', () => {
    expect([...DATA_RESOURCE_KINDS]).toEqual(['table', 'view']);
    for (const k of DATA_RESOURCE_KINDS) expect(SYMBOL_KINDS).toContain(k);
  });

  it('enumerates the fact kinds', () => {
    expect([...FACT_KINDS]).toEqual(['literal-comparison', 'normalization', 'retry-timeout', 'endpoint']);
  });

  it('admits a v2 plugin literal with capabilities, annotations and facts', () => {
    const symbol: SymbolNode = {
      symbolId: 'db/loans.sql::dbo.loans::table',
      name: 'loans',
      kind: 'table',
      startLine: 0,
      endLine: 3,
      annotations: [{ name: 'columns', args: ['id'] }],
    };
    const fact: CodeFact = { kind: 'endpoint', symbolId: symbol.symbolId, line: 0, text: 'GET /loans' };
    const adapter: ILanguageAdapter = {
      extractSymbols: async () => [symbol],
      extractEdges: async () => [],
      extractComplexity: async () => [],
      extractFacts: async () => [fact],
      isSupported: () => true,
    };
    const ctx: PluginContext = {
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
      projectRoot: '/tmp',
      workspace: { root: '/tmp', packages: [] } satisfies IWorkspace,
      config: {},
      capabilities: { facts: true, sqlCallSites: true },
    };
    const plugin: CtxoLanguagePlugin = {
      apiVersion: '2',
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      extensions: ['.sql'],
      tier: 'syntax',
      createAdapter: () => adapter,
    };
    expect(plugin.createAdapter(ctx).extractFacts).toBeTypeOf('function');
  });

  it('admits a structurally valid CtxoLanguagePlugin literal', () => {
    const adapter: ILanguageAdapter = {
      extractSymbols: async () => [],
      extractEdges: async () => [],
      extractComplexity: async () => [],
      isSupported: () => true,
    };
    const ctx: PluginContext = {
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      projectRoot: '/tmp',
      workspace: { root: '/tmp', packages: [] } satisfies IWorkspace,
      config: {},
    };
    const plugin: CtxoLanguagePlugin = {
      apiVersion: '1',
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      extensions: ['.ex'],
      tier: 'syntax',
      createAdapter: (c) => {
        assertType<PluginContext>(c);
        return adapter;
      },
    };
    const built = plugin.createAdapter(ctx);
    expect(typeof built.extractSymbols).toBe('function');
  });

  it('type-checks SymbolKind and EdgeKind as string literal unions', () => {
    const k: SymbolKind = 'function';
    const e: EdgeKind = 'imports';
    expect([k, e]).toEqual(['function', 'imports']);
  });
});
