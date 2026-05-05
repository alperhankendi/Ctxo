import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JavaAdapter } from '../java-adapter.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('JavaAdapter — symbol extraction', () => {
  const adapter = new JavaAdapter();

  it('extracts public class as class kind', async () => {
    const source = readFixture('Payment.java.fixture');
    const symbols = await adapter.extractSymbols('src/Payment.java', source);

    const cls = symbols.find((s) => s.name === 'CardProcessor');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
    expect(cls!.symbolId).toBe('src/Payment.java::CardProcessor::class');
  });

  it('extracts package-private class', async () => {
    const source = readFixture('Payment.java.fixture');
    const symbols = await adapter.extractSymbols('src/Payment.java', source);

    const cls = symbols.find((s) => s.name === 'PaymentResult');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
  });

  it('extracts interface as interface kind', async () => {
    const source = readFixture('Payment.java.fixture');
    const symbols = await adapter.extractSymbols('src/Payment.java', source);

    const iface = symbols.find((s) => s.name === 'Processor');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
  });

  it('qualifies method names with enclosing type', async () => {
    const source = readFixture('Payment.java.fixture');
    const symbols = await adapter.extractSymbols('src/Payment.java', source);

    const method = symbols.find((s) => s.name === 'CardProcessor.process');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
    expect(method!.symbolId).toBe('src/Payment.java::CardProcessor.process::method');
  });

  it('extracts static method', async () => {
    const source = readFixture('Payment.java.fixture');
    const symbols = await adapter.extractSymbols('src/Payment.java', source);

    const method = symbols.find((s) => s.name === 'CardProcessor.formatAmount');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
  });

  it('extracts constructor as method named ClassName.ClassName', async () => {
    const source = readFixture('Payment.java.fixture');
    const symbols = await adapter.extractSymbols('src/Payment.java', source);

    const ctor = symbols.find((s) => s.name === 'CardProcessor.CardProcessor');
    expect(ctor).toBeDefined();
    expect(ctor!.kind).toBe('method');
  });

  it('includes byte offsets on all symbols', async () => {
    const source = readFixture('Payment.java.fixture');
    const symbols = await adapter.extractSymbols('src/Payment.java', source);

    for (const sym of symbols) {
      expect(sym.startOffset).toBeDefined();
      expect(sym.endOffset).toBeDefined();
      expect(sym.startOffset).toBeLessThan(sym.endOffset!);
    }
  });

  it('extracts enum as class kind', async () => {
    const source = `package x;
public enum Status { OK, FAIL }
`;
    const symbols = await adapter.extractSymbols('src/Status.java', source);
    const e = symbols.find((s) => s.name === 'Status');
    expect(e).toBeDefined();
    expect(e!.kind).toBe('class');
  });

  it('extracts record as class kind', async () => {
    const source = `package x;
public record Point(int x, int y) {}
`;
    const symbols = await adapter.extractSymbols('src/Point.java', source);
    const r = symbols.find((s) => s.name === 'Point');
    expect(r).toBeDefined();
    expect(r!.kind).toBe('class');
  });

  it('qualifies nested class name with outer class', async () => {
    const source = `package x;
public class Outer {
    public static class Inner {
        public void run() {}
    }
}
`;
    const symbols = await adapter.extractSymbols('src/Outer.java', source);
    const inner = symbols.find((s) => s.name === 'Outer.Inner');
    expect(inner).toBeDefined();
    expect(inner!.kind).toBe('class');
    const innerMethod = symbols.find((s) => s.name === 'Outer.Inner.run');
    expect(innerMethod).toBeDefined();
    expect(innerMethod!.kind).toBe('method');
  });
});

describe('JavaAdapter — edge extraction', () => {
  const adapter = new JavaAdapter();

  it('extracts import edges anchored on the first declared type', async () => {
    const source = readFixture('Payment.java.fixture');
    const edges = await adapter.extractEdges('src/Payment.java', source);

    const importEdges = edges.filter((e) => e.kind === 'imports');
    expect(importEdges.length).toBeGreaterThanOrEqual(3);
    expect(importEdges.some((e) => e.to.startsWith('java.util.List'))).toBe(true);
    expect(importEdges.some((e) => e.to.startsWith('com.example.gateway.Gateway'))).toBe(true);
    // The first declared top-level type in the fixture is the Processor interface.
    expect(importEdges[0]!.from).toBe('src/Payment.java::Processor::interface');
  });

  it('emits name-keyed import targets (no __unresolved__ sentinel)', async () => {
    const source = readFixture('Payment.java.fixture');
    const edges = await adapter.extractEdges('src/Payment.java', source);
    for (const e of edges) {
      expect(e.to).not.toMatch(/^__unresolved__::/);
    }
  });

  it('skips wildcard imports (no actionable target)', async () => {
    const source = `package x;
import java.util.*;
public class A {}
`;
    const edges = await adapter.extractEdges('src/A.java', source);
    const wildcards = edges.filter((e) => e.kind === 'imports' && e.to.includes('*'));
    expect(wildcards).toEqual([]);
  });

  it('normalizes static member imports to the enclosing class', async () => {
    const source = `package x;
import static java.lang.Math.PI;
public class A {}
`;
    const edges = await adapter.extractEdges('src/A.java', source);
    const importEdge = edges.find((e) => e.kind === 'imports');
    expect(importEdge).toBeDefined();
    // Should resolve to the enclosing class, not the member.
    expect(importEdge!.to).toMatch(/^java\.lang\.Math::Math::class$/);
  });

  it('extracts implements edges for class implements interface', async () => {
    const source = readFixture('Payment.java.fixture');
    const edges = await adapter.extractEdges('src/Payment.java', source);

    const impl = edges.find(
      (e) => e.kind === 'implements' && e.from.includes('CardProcessor') && e.to.endsWith('::Processor::interface'),
    );
    expect(impl).toBeDefined();
  });

  it('extracts extends edge for class extends class', async () => {
    const source = readFixture('Payment.java.fixture');
    const edges = await adapter.extractEdges('src/Payment.java', source);

    const ext = edges.find(
      (e) => e.kind === 'extends' && e.from.includes('PremiumProcessor') && e.to.endsWith('::CardProcessor::class'),
    );
    expect(ext).toBeDefined();
  });

  it('treats interface extends as extends edge', async () => {
    const source = `package x;
public interface A {}
public interface B extends A {}
`;
    const edges = await adapter.extractEdges('src/A.java', source);
    const ext = edges.find((e) => e.kind === 'extends' && e.from.includes('::B::') && e.to.endsWith('::A::interface'));
    expect(ext).toBeDefined();
  });

  it('strips generic parameters from extends/implements targets', async () => {
    const source = `package x;
public class A<T> {}
public class B extends A<String> {}
`;
    const edges = await adapter.extractEdges('src/A.java', source);
    const ext = edges.find((e) => e.kind === 'extends' && e.from.includes('::B::'));
    expect(ext).toBeDefined();
    expect(ext!.to).toBe('A::A::class');
  });

  it('uses cross-file symbol registry to resolve extends to the real symbol id', async () => {
    const registry = new Map([
      ['src/Discount.java::Discount::interface', 'interface' as const],
    ]);
    adapter.setSymbolRegistry(registry);
    const source = `package x;
public class PercentageDiscount implements Discount {}
`;
    const edges = await adapter.extractEdges('src/PercentageDiscount.java', source);
    const impl = edges.find((e) => e.kind === 'implements');
    expect(impl).toBeDefined();
    expect(impl!.to).toBe('src/Discount.java::Discount::interface');
    // Reset registry for downstream tests.
    adapter.setSymbolRegistry(new Map());
  });

  it('returns no import edges when file has no top-level type', async () => {
    const source = `package x;
import java.util.List;
`;
    const edges = await adapter.extractEdges('src/empty.java', source);
    expect(edges.filter((e) => e.kind === 'imports')).toEqual([]);
  });
});

describe('JavaAdapter — complexity extraction', () => {
  const adapter = new JavaAdapter();

  it('returns complexity 1 for method with no branches', async () => {
    const source = `package x;
public class Simple {
    public int answer() { return 42; }
}
`;
    const metrics = await adapter.extractComplexity('src/Simple.java', source);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.cyclomatic).toBe(1);
  });

  it('counts if/for/catch branches in process()', async () => {
    const source = readFixture('Payment.java.fixture');
    const metrics = await adapter.extractComplexity('src/Payment.java', source);

    const m = metrics.find((x) => x.symbolId.includes('CardProcessor.process'));
    expect(m).toBeDefined();
    // 1 base + if + nested-if + for + catch = at least 5
    expect(m!.cyclomatic).toBeGreaterThanOrEqual(4);
  });

  it('counts && / || short-circuits and ternary', async () => {
    const source = readFixture('Payment.java.fixture');
    const metrics = await adapter.extractComplexity('src/Payment.java', source);

    const m = metrics.find((x) => x.symbolId.includes('CardProcessor.formatAmount'));
    expect(m).toBeDefined();
    // 1 base + 1 ternary + 1 `&&` = 3
    expect(m!.cyclomatic).toBeGreaterThanOrEqual(3);
  });

  it('emits complexity for constructors', async () => {
    const source = readFixture('Payment.java.fixture');
    const metrics = await adapter.extractComplexity('src/Payment.java', source);

    const m = metrics.find((x) => x.symbolId.includes('CardProcessor.CardProcessor'));
    expect(m).toBeDefined();
    expect(m!.cyclomatic).toBe(1);
  });
});

describe('JavaAdapter — isSupported', () => {
  const adapter = new JavaAdapter();

  it('returns true for .java files', () => {
    expect(adapter.isSupported('src/Foo.java')).toBe(true);
  });

  it('is case-insensitive on extension', () => {
    expect(adapter.isSupported('src/Foo.JAVA')).toBe(true);
  });

  it('returns false for non-java files', () => {
    expect(adapter.isSupported('src/main.go')).toBe(false);
    expect(adapter.isSupported('src/main.ts')).toBe(false);
    expect(adapter.isSupported('src/main.kt')).toBe(false);
  });

  it('has syntax tier', () => {
    expect(adapter.tier).toBe('syntax');
  });
});

describe('JavaAdapter plugin export', () => {
  it('declares correct plugin metadata', async () => {
    const mod = await import('../index.js');
    expect(mod.plugin.id).toBe('java');
    expect(mod.plugin.apiVersion).toBe('1');
    expect(mod.plugin.tier).toBe('syntax');
    expect(mod.plugin.extensions).toEqual(['.java']);
  });
});
