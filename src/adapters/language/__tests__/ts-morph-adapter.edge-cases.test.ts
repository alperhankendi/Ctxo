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

describe('TsMorphAdapter — preloading lifecycle', () => {
  it('extractEdges without preloading still works (backward compat)', () => {
    const adapter = new TsMorphAdapter();
    const source = `
      import { Foo } from './foo.js';
      export function bar(): void { Foo(); }
    `;
    // Never call loadProjectSources — legacy single-file mode
    const edges1 = adapter.extractEdges('src/bar.ts', source);
    const edges2 = adapter.extractEdges('src/bar.ts', source);

    // Both calls should work and produce same result
    expect(edges1).toEqual(edges2);
    expect(edges1.length).toBeGreaterThan(0);
  });

  it('extractSymbols and extractComplexity still clean up when preloaded', () => {
    const adapter = new TsMorphAdapter();

    const sources = new Map<string, string>();
    sources.set('src/a.ts', 'export function a(): void {}');
    adapter.loadProjectSources(sources);

    // extractSymbols should still work (it always cleans up)
    const symbols = adapter.extractSymbols('src/b.ts', 'export function b(): void {}');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.name).toBe('b');

    // extractComplexity should still work
    const metrics = adapter.extractComplexity('src/c.ts', 'export function c(): void { if (true) {} }');
    expect(metrics).toHaveLength(1);

    adapter.clearProjectSources();
  });

  it('clearProjectSources restores single-file cleanup behavior', () => {
    const adapter = new TsMorphAdapter();

    // Load, then clear
    const sources = new Map<string, string>();
    sources.set('src/a.ts', 'export type Foo = string;');
    adapter.loadProjectSources(sources);
    adapter.clearProjectSources();

    // After clear, single-file mode resumes — heuristic fallback expected
    const source = `
      import { Foo } from './a.js';
      export function use(f: Foo): void {}
    `;
    const edges = adapter.extractEdges('src/b.ts', source);
    const importEdge = edges.find(e => e.kind === 'imports' && e.to.includes('Foo'));
    expect(importEdge).toBeDefined();
    // File no longer preloaded — falls back to heuristic (PascalCase → class)
    expect(importEdge!.to).toBe('src/a.ts::Foo::class');
  });

  it('malformed source in preloaded map does not crash other files', () => {
    const adapter = new TsMorphAdapter();

    const sources = new Map<string, string>();
    sources.set('src/broken.ts', 'export function {{{ invalid');
    sources.set('src/valid.ts', 'export function valid(): void {}');
    sources.set('src/consumer.ts', `
      import { valid } from './valid.js';
      export function use(): void { valid(); }
    `);
    adapter.loadProjectSources(sources);

    // Should still extract edges from valid files
    const edges = adapter.extractEdges('src/consumer.ts', sources.get('src/consumer.ts')!);
    const importEdge = edges.find(e => e.kind === 'imports' && e.to.includes('valid'));
    expect(importEdge).toBeDefined();

    adapter.clearProjectSources();
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
