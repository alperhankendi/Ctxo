import { describe, it, expect } from 'vitest';
import { delimiter } from 'node:path';
import { buildAnalyzerArgs } from '../jdt-process.js';

describe('buildAnalyzerArgs', () => {
  it('produces basic args ["-jar", jar, root] when no opts', () => {
    const args = buildAnalyzerArgs('/path/to/app.jar', '/project/root');
    expect(args).toEqual(['-jar', '/path/to/app.jar', '/project/root']);
  });

  it('includes --classpath with platform delimiter when classpathOverride provided', () => {
    const args = buildAnalyzerArgs('/app.jar', '/root', { classpathOverride: ['/a', '/b'] });
    const cpIdx = args.indexOf('--classpath');
    expect(cpIdx).toBeGreaterThan(-1);
    expect(args[cpIdx + 1]).toBe(['/a', '/b'].join(delimiter));
  });

  it('uses the correct platform delimiter (os.delimiter)', () => {
    const args = buildAnalyzerArgs('/app.jar', '/root', { classpathOverride: ['/x', '/y', '/z'] });
    const cpIdx = args.indexOf('--classpath');
    const joined = args[cpIdx + 1];
    const parts = joined.split(delimiter);
    expect(parts).toEqual(['/x', '/y', '/z']);
  });

  it('does NOT include --classpath when classpathOverride is empty', () => {
    const args = buildAnalyzerArgs('/app.jar', '/root', { classpathOverride: [] });
    expect(args.includes('--classpath')).toBe(false);
  });

  it('does NOT include --classpath when classpathOverride is absent', () => {
    const args = buildAnalyzerArgs('/app.jar', '/root', {});
    expect(args.includes('--classpath')).toBe(false);
  });

  it('includes --allow-build-tools when allowBuildTools is true', () => {
    const args = buildAnalyzerArgs('/app.jar', '/root', { allowBuildTools: true });
    expect(args.includes('--allow-build-tools')).toBe(true);
  });

  it('does NOT include --allow-build-tools when allowBuildTools is false', () => {
    const args = buildAnalyzerArgs('/app.jar', '/root', { allowBuildTools: false });
    expect(args.includes('--allow-build-tools')).toBe(false);
  });
});
