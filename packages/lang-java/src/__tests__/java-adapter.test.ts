import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../java-adapter.js';

const FILE = 'src/main/java/com/example/Foo.java';

const SOURCE = `package com.example;

public class Foo extends Bar implements Baz {
  private int count;
  public Foo() {}
  public int add(int a, int b) { return a + b; }
}

interface Service { void run(); }
enum Color { RED, GREEN }
record Point(int x, int y) {}
@interface MyAnno {}
`;

describe('JavaAdapter.extractSymbols', () => {
  it('extracts class/interface/enum/record/annotation/method/constructor/field with mapped kinds', async () => {
    const adapter = new JavaAdapter();
    const symbols = await adapter.extractSymbols(FILE, SOURCE);
    const byName = (n: string) => symbols.find((s) => s.name === n);

    expect(byName('Foo')).toMatchObject({ kind: 'class', symbolId: `${FILE}::Foo::class` });
    expect(byName('Service')).toMatchObject({ kind: 'interface', symbolId: `${FILE}::Service::interface` });
    expect(byName('Color')).toMatchObject({ kind: 'type', symbolId: `${FILE}::Color::type` });
    expect(byName('Point')).toMatchObject({ kind: 'class', symbolId: `${FILE}::Point::class` });
    expect(byName('MyAnno')).toMatchObject({ kind: 'interface' });
    expect(byName('add')).toMatchObject({ kind: 'method' });
    const fooMethods = symbols.filter((s) => s.name === 'Foo' && s.kind === 'method');
    expect(fooMethods).toHaveLength(1); // the constructor
    expect(byName('count')).toMatchObject({ kind: 'variable' });
    expect(byName('run')).toMatchObject({ kind: 'method' });
  });

  it('returns [] on unparseable source without throwing', async () => {
    const adapter = new JavaAdapter();
    const symbols = await adapter.extractSymbols(FILE, 'class {{{ broken');
    expect(Array.isArray(symbols)).toBe(true);
  });
});

describe('JavaAdapter.extractEdges', () => {
  it('emits imports, extends, implements edges from the declaring type', async () => {
    const adapter = new JavaAdapter();
    const src = `package com.example;
import java.util.List;
public class Foo extends Bar implements Baz, Qux {}
`;
    const edges = await adapter.extractEdges(FILE, src);
    const kinds = edges.map((e) => e.kind);
    expect(kinds).toContain('imports');
    expect(kinds).toContain('extends');
    expect(kinds.filter((k) => k === 'implements').length).toBe(2);

    const ext = edges.find((e) => e.kind === 'extends');
    expect(ext!.from).toBe(`${FILE}::Foo::class`);
    expect(ext!.to).toBe('Bar::class');

    expect(edges.find((e) => e.kind === 'imports')!.to).toBe('java.util.List::List::class');
  });

  it('emits extends edge for interface extends-interfaces (incl. qualified)', async () => {
    const adapter = new JavaAdapter();
    const edges = await adapter.extractEdges(FILE, 'interface Sortable extends java.lang.Comparable {}');
    expect(edges.find((e) => e.kind === 'extends' && e.to.includes('Comparable'))).toBeDefined();
  });

  it('returns [] on broken source without throwing', async () => {
    const adapter = new JavaAdapter();
    expect(await adapter.extractEdges(FILE, '@@@ not java')).toEqual([]);
  });
});

describe('JavaAdapter.extractComplexity', () => {
  it('counts branches per method (base 1 + each branch)', async () => {
    const adapter = new JavaAdapter();
    const src = `class Foo {
  int f(int a) {
    if (a > 0) { return 1; }
    for (int i = 0; i < a; i++) {}
    return a > 1 ? 2 : 3;
  }
}`;
    const metrics = await adapter.extractComplexity(FILE, src);
    const f = metrics.find((m) => m.symbolId === `${FILE}::f::method`);
    expect(f).toBeDefined();
    expect(f!.cyclomatic).toBe(4);
  });

  it('counts && and || operators toward complexity', async () => {
    const adapter = new JavaAdapter();
    const src = `class Foo { int g(int a, int b) { if (a > 0 && b > 0 || a < 0) { return 1; } return 0; } }`;
    const metrics = await adapter.extractComplexity(FILE, src);
    const g = metrics.find((m) => m.symbolId === `${FILE}::g::method`);
    expect(g).toBeDefined();
    // base 1 + if 1 + && 1 + || 1 = 4
    expect(g!.cyclomatic).toBe(4);
  });
});
