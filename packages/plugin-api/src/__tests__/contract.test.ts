import { describe, it, expect, assertType } from 'vitest';
import {
  SUPPORTED_API_VERSION,
  SYMBOL_KINDS,
  EDGE_KINDS,
  type CtxoLanguagePlugin,
  type ILanguageAdapter,
  type PluginContext,
  type IWorkspace,
  type SymbolKind,
  type EdgeKind,
} from '../index.js';

describe('@ctxo/plugin-api exports', () => {
  it('freezes the supported protocol version at "1"', () => {
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
    ]);
  });

  it('enumerates all edge kinds', () => {
    expect([...EDGE_KINDS]).toEqual([
      'imports',
      'calls',
      'extends',
      'implements',
      'uses',
    ]);
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
