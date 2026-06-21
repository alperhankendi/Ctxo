import { describe, it, expect } from 'vitest';
import { JavaCompositeAdapter } from '../composite-adapter.js';

describe('JavaCompositeAdapter', () => {
  it('initializes to the syntax tier and delegates extraction to tree-sitter', async () => {
    const adapter = new JavaCompositeAdapter();
    await adapter.initialize('/tmp/project');
    expect(adapter.getTier()).toBe('syntax');

    const file = 'A.java';
    const symbols = await adapter.extractSymbols(file, 'class A { void m() {} }');
    expect(symbols.find((s) => s.name === 'A')?.kind).toBe('class');

    const complexity = await adapter.extractComplexity(file, 'class A { void m() { if (true) {} } }');
    expect(complexity.find((c) => c.symbolId === `${file}::m::method`)).toBeDefined();
  });

  it('reports .java support', () => {
    const adapter = new JavaCompositeAdapter();
    expect(adapter.isSupported('Foo.java')).toBe(true);
    expect(adapter.isSupported('Foo.go')).toBe(false);
  });
});
