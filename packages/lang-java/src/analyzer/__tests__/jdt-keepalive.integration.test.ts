import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectJavaRuntime } from '../toolchain-detect.js';
import { JavaCompositeAdapter } from '../../composite-adapter.js';

const jar = process.env.CTXO_JDT_ANALYZER_JAR
  ?? resolve(import.meta.dirname, '../../../../lang-java-analyzer/jar/ctxo-jdt-analyzer.jar');
const fixture = resolve(import.meta.dirname, '../../../../lang-java-analyzer/java/src/test/resources/fixture');
const java = detectJavaRuntime();
const canRun = java.available && existsSync(jar) && existsSync(fixture);

describe.skipIf(!canRun)('Java watch keep-alive (real jar)', () => {
  it('reindexFile returns resolved edges + tree-sitter complexity for one file', async () => {
    process.env.CTXO_JDT_ANALYZER_JAR = jar;
    const composite = new JavaCompositeAdapter();
    await composite.initialize(fixture);
    const cap = composite.getIncrementalReindex();
    expect(cap).not.toBeNull();
    expect(cap!.isReady()).toBe(true);
    expect(await cap!.startKeepAlive()).toBe(true);
    const result = await cap!.reindexFile('Foo.java');
    expect(result).not.toBeNull();
    expect(result!.edges.some((e) => e.kind === 'calls' && e.to.includes('helper'))).toBe(true);
    expect(Array.isArray(result!.complexity)).toBe(true);
    await cap!.dispose();
  }, 130_000);
});
