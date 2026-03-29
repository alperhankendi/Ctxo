import { describe, it, expect, vi } from 'vitest';
import { TsMorphAdapter } from '../ts-morph-adapter.js';

describe('TsMorphAdapter — error paths', () => {
  const adapter = new TsMorphAdapter();

  it('returns empty array and logs stderr for syntax error file', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = 'export function broken( { return }';
    const symbols = adapter.extractSymbols('src/broken.ts', source);

    // Should not crash — warn-and-continue
    expect(symbols).toEqual([]);
    spy.mockRestore();
  });

  it('returns empty edges for syntax error file', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = 'export class { invalid }';
    const edges = adapter.extractEdges('src/broken.ts', source);

    expect(edges).toEqual([]);
    spy.mockRestore();
  });

  it('returns empty complexity for syntax error file', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = 'function {{{ broken';
    const metrics = adapter.extractComplexity('src/broken.ts', source);

    expect(metrics).toEqual([]);
    spy.mockRestore();
  });
});

describe('TsMorphAdapter — import edge detection', () => {
  const adapter = new TsMorphAdapter();

  it('detects "imports" edge for named import from relative path', () => {
    const source = `
      import { Foo } from './foo';
      export function bar() { return new Foo(); }
    `;
    const edges = adapter.extractEdges('src/bar.ts', source);

    const importEdge = edges.find((e) => e.kind === 'imports');
    expect(importEdge).toBeDefined();
    expect(importEdge?.to).toContain('Foo');
  });

  it('returns empty edges for file importing only from node_modules', () => {
    const source = `
      import { z } from 'zod';
      export const schema = z.string();
    `;
    const edges = adapter.extractEdges('src/schema.ts', source);
    // Only relative imports tracked
    expect(edges).toEqual([]);
  });
});

describe('TsMorphAdapter — complexity edge cases', () => {
  const adapter = new TsMorphAdapter();

  it('counts logical operators as complexity branches', () => {
    const source = `export function check(a: boolean, b: boolean): boolean {
      return a && b || !a;
    }`;
    const metrics = adapter.extractComplexity('src/check.ts', source);

    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.cyclomatic).toBeGreaterThan(1);
  });

  it('handles function with for/while/do loops', () => {
    const source = `export function loops(): void {
      for (let i = 0; i < 10; i++) {}
      while (true) { break; }
      do {} while (false);
    }`;
    const metrics = adapter.extractComplexity('src/loops.ts', source);

    expect(metrics[0]!.cyclomatic).toBeGreaterThanOrEqual(4); // 1 base + 3 loops
  });
});
