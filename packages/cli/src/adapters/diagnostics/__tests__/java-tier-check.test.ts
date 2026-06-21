import { describe, it, expect } from 'vitest';
import { evaluateJavaTier } from '../checks/java-tier-check.js';

describe('evaluateJavaTier', () => {
  it('pass: full tier when JRE>=17 and analyzer installed', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: 21, analyzerInstalled: true });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('full');
  });
  it('warn: JRE present but analyzer missing -> install hint', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: 21, analyzerInstalled: false });
    expect(r.status).toBe('warn');
    expect(r.fix).toContain('--full-tier');
  });
  it('warn: analyzer present but no JRE -> JRE hint', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: undefined, analyzerInstalled: true });
    expect(r.status).toBe('warn');
    expect((r.fix ?? '').toLowerCase()).toContain('jre');
  });
  it('pass(syntax): java present, no jre, no analyzer -> syntax tier, status pass with hint in message', () => {
    const r = evaluateJavaTier({ hasJava: true, jreMajor: 16, analyzerInstalled: false });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('syntax');
  });
  it('pass: no java sources -> no nag', () => {
    const r = evaluateJavaTier({ hasJava: false, jreMajor: undefined, analyzerInstalled: false });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('no Java');
  });
});
