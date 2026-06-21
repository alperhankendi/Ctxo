import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectJavaRuntime } from '../toolchain-detect.js';
import { runBatchIndex } from '../jdt-process.js';

const jar =
  process.env.CTXO_JDT_ANALYZER_JAR ??
  resolve(import.meta.dirname, '../../../tools/ctxo-jdt-analyzer/target/ctxo-jdt-analyzer.jar');
const fixture = resolve(import.meta.dirname, '../../../tools/ctxo-jdt-analyzer/src/test/resources/fixture');
const java = detectJavaRuntime();
const canRun = java.available && existsSync(jar) && existsSync(fixture);

describe.skipIf(!canRun)('runBatchIndex (real jar)', () => {
  it('emits file results with resolved call edges', async () => {
    const result = await runBatchIndex(java.javaBin, jar, fixture, { timeoutMs: 120_000 });
    expect(result.files.length).toBeGreaterThan(0);
    const foo = result.files.find((f) => f.file.endsWith('Foo.java'));
    expect(foo).toBeDefined();
    expect(foo!.edges.some((e) => e.kind === 'calls' && e.to.includes('helper'))).toBe(true);
    expect(foo!.edges.some((e) => e.kind === 'extends')).toBe(true);
  }, 130_000);
});
