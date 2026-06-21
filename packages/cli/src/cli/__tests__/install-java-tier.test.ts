import { describe, it, expect } from 'vitest';
import { resolveJavaPackages } from '../install-command.js';

describe('resolveJavaPackages', () => {
  it('adds analyzer when JRE present and not syntax-only', () => {
    expect(resolveJavaPackages({ jreAvailable: true })).toEqual(['@ctxo/lang-java', '@ctxo/lang-java-analyzer']);
  });
  it('syntax only when no JRE', () => {
    expect(resolveJavaPackages({ jreAvailable: false })).toEqual(['@ctxo/lang-java']);
  });
  it('--syntax-only forces syntax even with JRE', () => {
    expect(resolveJavaPackages({ jreAvailable: true, syntaxOnly: true })).toEqual(['@ctxo/lang-java']);
  });
  it('--full-tier forces analyzer even without detected JRE', () => {
    expect(resolveJavaPackages({ jreAvailable: false, fullTier: true })).toEqual(['@ctxo/lang-java', '@ctxo/lang-java-analyzer']);
  });
});
