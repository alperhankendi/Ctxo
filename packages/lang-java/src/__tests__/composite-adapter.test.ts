import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectJavaRuntime } from '../analyzer/toolchain-detect.js';

vi.mock('../analyzer/jar-resolve.js', () => ({
  resolveAnalyzerJar: vi.fn(() => null),
  analyzerPackageVersion: vi.fn(() => null),
  baseVersionMismatch: vi.fn((a: string, b: string) => {
    const base = (v: string) => (v.split('-')[0] ?? v).split('+')[0] ?? v;
    return base(a) !== base(b);
  }),
  PLUGIN_VERSION: '0.8.0',
}));

import { JavaCompositeAdapter } from '../composite-adapter.js';
import { resolveAnalyzerJar, analyzerPackageVersion } from '../analyzer/jar-resolve.js';

describe('JavaCompositeAdapter (syntax fallback)', () => {
  beforeEach(() => {
    vi.mocked(resolveAnalyzerJar).mockReturnValue(null);
    vi.mocked(analyzerPackageVersion).mockReturnValue(null);
  });

  it('falls back to syntax tier when full tier is unavailable', async () => {
    const adapter = new JavaCompositeAdapter();
    await adapter.initialize('/tmp/project');
    expect(adapter.getTier()).toBe('syntax');
    const symbols = await adapter.extractSymbols('A.java', 'class A { void m() {} }');
    expect(symbols.find((s) => s.name === 'A')?.kind).toBe('class');
    const complexity = await adapter.extractComplexity('A.java', 'class A { void m() { if (true) {} } }');
    expect(complexity.find((c) => c.symbolId === 'A.java::m::method')).toBeDefined();
  });

  it('reports .java support', () => {
    const adapter = new JavaCompositeAdapter();
    expect(adapter.isSupported('Foo.java')).toBe(true);
    expect(adapter.isSupported('Foo.go')).toBe(false);
  });

  it('getIncrementalReindex returns the same object reference on repeated calls (no duplicate-process risk)', async () => {
    // When full tier is unavailable both calls return null; the important property
    // is referential equality — same object (or same null) — not a new object each time.
    const adapter = new JavaCompositeAdapter();
    await adapter.initialize('/tmp/project');
    const a = adapter.getIncrementalReindex();
    const b = adapter.getIncrementalReindex();
    // Both null (syntax tier) or both the exact same capability instance (full tier).
    expect(a).toBe(b);
  });
});

const jar = process.env.CTXO_JDT_ANALYZER_JAR
  ?? resolve(import.meta.dirname, '../../../lang-java-analyzer/jar/ctxo-jdt-analyzer.jar');
const fixture = resolve(import.meta.dirname, '../../../lang-java-analyzer/java/src/test/resources/fixture');
const java = detectJavaRuntime();
const canRun = java.available && existsSync(jar) && existsSync(fixture);

describe.skipIf(!canRun)('JavaCompositeAdapter (full tier, real jar)', () => {
  beforeEach(() => {
    // Make resolveAnalyzerJar honor the env override so the full tier can activate
    vi.mocked(resolveAnalyzerJar).mockImplementation(() => {
      const jarPath = process.env.CTXO_JDT_ANALYZER_JAR;
      return jarPath && existsSync(jarPath) ? jarPath : null;
    });
    vi.mocked(analyzerPackageVersion).mockReturnValue('0.8.0');
  });

  it('selects full tier and serves resolved call edges; complexity still tree-sitter', async () => {
    process.env.CTXO_JDT_ANALYZER_JAR = jar;
    const adapter = new JavaCompositeAdapter();
    await adapter.initialize(fixture);
    expect(adapter.getTier()).toBe('full');
    const edges = await adapter.extractEdges('Foo.java', '');
    expect(edges.some((e) => e.kind === 'calls' && e.to.includes('helper'))).toBe(true);
    const src = 'package fixture;\npublic class Foo extends Bar {\n  public int add(int a, int b){ if(a>0){return a;} return helper(a)+b; }\n}\n';
    const complexity = await adapter.extractComplexity('Foo.java', src);
    expect(complexity.find((c) => c.symbolId === 'Foo.java::add::method')).toBeDefined();
    await adapter.dispose();
  }, 130_000);
});
