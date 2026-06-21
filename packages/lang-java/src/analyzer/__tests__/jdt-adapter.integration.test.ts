import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectJavaRuntime } from '../toolchain-detect.js';
import { JdtAnalyzerAdapter } from '../jdt-adapter.js';

const jar =
  process.env.CTXO_JDT_ANALYZER_JAR ??
  resolve(import.meta.dirname, '../../../../lang-java-analyzer/jar/ctxo-jdt-analyzer.jar');
const fixture = resolve(import.meta.dirname, '../../../../lang-java-analyzer/java/src/test/resources/fixture');
const java = detectJavaRuntime();
const canRun = java.available && existsSync(jar) && existsSync(fixture);

describe.skipIf(!canRun)('JdtAnalyzerAdapter (real jar)', () => {
  it('initializes ready and serves symbols + resolved edges per file', async () => {
    process.env.CTXO_JDT_ANALYZER_JAR = jar;
    const a = new JdtAnalyzerAdapter();
    await a.initialize(fixture);
    expect(a.isReady()).toBe(true);
    const symbols = await a.extractSymbols('Foo.java', '');
    expect(symbols.find((s) => s.name === 'Foo')?.kind).toBe('class');
    const edges = await a.extractEdges('Foo.java', '');
    expect(edges.some((e) => e.kind === 'calls' && e.to.includes('helper'))).toBe(true);
    expect(await a.extractComplexity('Foo.java', '')).toEqual([]);
    await a.dispose();
  }, 130_000);
});
