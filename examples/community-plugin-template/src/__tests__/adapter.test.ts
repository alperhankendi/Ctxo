import { describe, it, expect } from 'vitest';
import { ExampleAdapter } from '../adapter.js';
import plugin from '../index.js';

describe('plugin manifest', () => {
  it('declares supported apiVersion and tier', () => {
    expect(plugin.apiVersion).toBe('1');
    expect(plugin.tier).toBe('syntax');
    expect(plugin.extensions).toContain('.example');
  });

  it('createAdapter returns a live ILanguageAdapter', () => {
    const adapter = plugin.createAdapter({
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      projectRoot: '/tmp',
      workspace: { root: '/tmp', packages: [] },
      config: {},
    });
    expect(typeof adapter.extractSymbols).toBe('function');
    expect(typeof adapter.extractEdges).toBe('function');
    expect(typeof adapter.extractComplexity).toBe('function');
    expect(typeof adapter.isSupported).toBe('function');
    expect(adapter.isSupported('path/to/file.example')).toBe(true);
    expect(adapter.isSupported('path/to/other.ts')).toBe(false);
  });
});

describe('ExampleAdapter.extractSymbols', () => {
  const adapter = new ExampleAdapter();

  it('extracts a declared function with correct symbolId format', async () => {
    const source = 'declare function greet';
    const symbols = await adapter.extractSymbols('src/hello.example', source);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.symbolId).toBe('src/hello.example::greet::function');
    expect(symbols[0]!.kind).toBe('function');
  });

  it('returns an empty array for empty source', async () => {
    const symbols = await adapter.extractSymbols('src/empty.example', '');
    expect(symbols).toEqual([]);
  });

  it('extracts multiple kinds within a single file', async () => {
    const source = [
      'declare class Greeter',
      'declare interface IGreeter',
      'declare method greet',
    ].join('\n');
    const symbols = await adapter.extractSymbols('src/multi.example', source);
    expect(symbols.map((s) => s.kind)).toEqual(['class', 'interface', 'method']);
  });
});
