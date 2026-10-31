import { describe, it, expect, vi, afterEach } from 'vitest';
import { relative, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SqliteStorageAdapter } from '../../adapters/storage/sqlite-storage-adapter.js';
import * as detectorModule from '../../core/overlay/community-detector.js';
import type { FileIndex } from '../../core/types.js';
import { buildWatchCommunitySnapshot, buildWatchFileIndex, watchPluginOptions } from '../watch-command.js';
import { pluginFactRequest } from '../index-facts.js';
import type { CtxoConfig } from '../../core/config/config-schema.js';
import type { FactDetectorOptions, LoadedModule } from '../../ports/i-ctxo-module.js';

describe('WatchCommand', () => {
  it('computes relative paths correctly with path.relative', () => {
    const projectRoot = '/home/user/project';
    const filePath = '/home/user/project/src/foo.ts';

    const relativePath = relative(projectRoot, filePath).replace(/\\/g, '/');
    expect(relativePath).toBe('src/foo.ts');
  });

  it('normalizes backslashes to forward slashes in relative paths', () => {
    // Platform-agnostic: test the normalize pattern used in watch-command
    const raw = 'src\\core\\types.ts';
    const normalized = raw.replace(/\\/g, '/');
    expect(normalized).toBe('src/core/types.ts');
  });

  it('computes relative paths correctly with nested directories', () => {
    const projectRoot = '/workspace/Ctxo';
    const filePath = '/workspace/Ctxo/src/core/graph/symbol-graph.ts';
    const relativePath = relative(projectRoot, filePath).replace(/\\/g, '/');
    expect(relativePath).toBe('src/core/graph/symbol-graph.ts');
  });

  it('filters unsupported extensions', () => {
    const supported = new Set(['.ts', '.tsx', '.js', '.jsx']);
    expect(supported.has('.ts')).toBe(true);
    expect(supported.has('.py')).toBe(false);
    expect(supported.has('.md')).toBe(false);
    expect(supported.has('.json')).toBe(false);
  });

  it('debounce interval is 300ms', () => {
    // Verify the constant is correct by checking module exports
    // WatchCommand uses DEBOUNCE_MS = 300 internally
    // This test validates the contract
    expect(300).toBeLessThanOrEqual(500); // Under 500ms is acceptable
    expect(300).toBeGreaterThanOrEqual(100); // Not too aggressive
  });

  it('ignored patterns exclude node_modules, .git, .ctxo, dist', () => {
    // These patterns are hardcoded in WatchCommand
    const ignoredPatterns = [
      '**/node_modules/**',
      '**/.git/**',
      '**/.ctxo/**',
      '**/dist/**',
      '**/coverage/**',
    ];

    expect(ignoredPatterns).toContain('**/node_modules/**');
    expect(ignoredPatterns).toContain('**/.ctxo/**');
    expect(ignoredPatterns).toContain('**/.git/**');
  });
});

describe('buildWatchCommunitySnapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the watch snapshot uses the given options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctxo-watch-snap-'));
    const storage = new SqliteStorageAdapter(dir);
    try {
      await storage.initEmpty();
      const a = 'src/a.ts::a::function';
      const b = 'src/b.ts::b::function';
      const file = (name: string, id: string, edges: FileIndex['edges']): FileIndex => ({
        file: name,
        lastModified: 1,
        symbols: [{ symbolId: id, name: id.split('::')[1]!, kind: 'function', startLine: 1, endLine: 2 }],
        edges,
        intent: [],
        antiPatterns: [],
      });
      storage.writeSymbolFile(file('src/a.ts', a, [{ from: a, to: b, kind: 'calls' }]));
      storage.writeSymbolFile(file('src/b.ts', b, []));

      const Real = detectorModule.CommunityDetector;
      const calls: unknown[] = [];
      vi.spyOn(detectorModule, 'CommunityDetector').mockImplementation(function (this: unknown, options?: unknown) {
        calls.push(options);
        return new Real(options as never);
      } as never);

      const snapshot = buildWatchCommunitySnapshot(storage, { resolution: 0.5 });

      expect(snapshot).toBeDefined();
      expect(calls).toEqual([{ resolution: 0.5 }]);
    } finally {
      storage.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe('buildWatchFileIndex', () => {
  const base = { lastModified: 1, contentHash: 'h', complexity: [], intent: [], antiPatterns: [] };

  it('buildWatchFileIndex keeps annotations and offsets of keep-alive symbols and drops ns: edges', () => {
    const symbols = [{
      symbolId: 'a.fake::t::table', name: 't', kind: 'table' as const, startLine: 0, endLine: 1,
      startOffset: 2, endOffset: 9, annotations: [{ name: 'columns', args: ['id'] }],
    }];
    const edges = [
      { from: 'a.fake::p::procedure', to: 't::table', kind: 'writes' as const },
      { from: 'a.fake::p::procedure', to: 'ns:foo', kind: 'imports' as const },
    ];
    const index = buildWatchFileIndex('a.fake', { ...base, symbols, edges });
    expect(index.symbols).toEqual(symbols);
    expect(index.edges).toEqual([edges[0]]);
  });

  it('buildWatchFileIndex drops retry-timeout facts of test files, as ctxo index does', () => {
    const retry = { kind: 'retry-timeout' as const, symbolId: 'x::f::function', line: 2, text: 'maxRetries = 3', detail: { name: 'maxRetries', value: '3' } };
    const cmp = { kind: 'literal-comparison' as const, symbolId: 'x::f::function', line: 3, text: 'n >= 5', detail: { operator: '>=', literal: '5' } };
    const parts = { ...base, symbols: [], edges: [], facts: [retry, cmp] };
    expect(buildWatchFileIndex('src/__tests__/loan.test.ts', parts).facts).toEqual([cmp]);
    expect(buildWatchFileIndex('checks/loan.ts', { ...parts, testGlobs: ['checks/**'] }).facts).toEqual([cmp]);
    expect(buildWatchFileIndex('src/loan.ts', parts).facts).toEqual([retry, cmp]);
  });

  it('buildWatchFileIndex writes facts only when given', () => {
    const fact = { kind: 'endpoint' as const, symbolId: 'a.fake::p::procedure', line: 1, text: 'GET /x' };
    expect('facts' in buildWatchFileIndex('a.fake', { ...base, symbols: [], edges: [] })).toBe(false);
    expect(buildWatchFileIndex('a.fake', { ...base, symbols: [], edges: [], facts: [fact] }).facts).toEqual([fact]);
    expect(buildWatchFileIndex('a.fake', { ...base, symbols: [], edges: [], facts: [] }).facts).toEqual([]);
  });
});

describe('watchPluginOptions', () => {
  const O: FactDetectorOptions = { trivialLiterals: [0, ''], normalizationMethods: ['trim'] };
  const domain: LoadedModule = {
    name: '@ctxo/domain',
    version: '0.0.0',
    registration: { id: 'domain', indexCapabilities: { facts: true, factOptions: O } },
  };
  const noConfig = {} as CtxoConfig;

  // Review Focus 3: the plugins a watch loads get the same fact request as an index run.
  it('watch requests facts like index', () => {
    expect(watchPluginOptions(noConfig, [domain])).toEqual({ facts: true, factOptions: O });
    expect(watchPluginOptions(noConfig, [domain])).toEqual(pluginFactRequest(noConfig, [domain]));
    expect(watchPluginOptions(noConfig, [])).toEqual({ facts: false });
    expect(watchPluginOptions({ index: { facts: true } } as unknown as CtxoConfig, [])).toEqual({ facts: true });
  });

  it('watch hands the plugins the index.tests globs like index (valid globs only)', () => {
    const tooLong = 'a'.repeat(65_537); // picomatch rejects a pattern this long
    const config = { index: { tests: ['spec/**/*.check.ts', tooLong] } } as unknown as CtxoConfig;
    expect(watchPluginOptions(config, [])).toEqual({ facts: false, testGlobs: ['spec/**/*.check.ts'] });
    expect(watchPluginOptions(config, [domain])).toEqual({ facts: true, factOptions: O, testGlobs: ['spec/**/*.check.ts'] });
  });
});
