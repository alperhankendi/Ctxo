import { describe, it, expect, beforeEach } from 'vitest';
import type { ILanguageAdapter } from '@ctxo/plugin-api';
import { LanguageAdapterRegistry } from '../language-adapter-registry.js';

function makeMockAdapter(): ILanguageAdapter {
  return {
    extractSymbols: async () => [],
    extractEdges: async () => [],
    extractComplexity: async () => [],
    isSupported: (filePath) => /\.(ts|tsx|js|jsx)$/i.test(filePath),
  };
}

describe('LanguageAdapterRegistry', () => {
  let registry: LanguageAdapterRegistry;
  let mock: ILanguageAdapter;

  beforeEach(() => {
    registry = new LanguageAdapterRegistry();
    mock = makeMockAdapter();
    registry.register(['.ts', '.tsx', '.js', '.jsx'], mock);
  });

  it('returns registered adapter for .ts extension', () => {
    expect(registry.getAdapter('src/foo.ts')).toBe(mock);
  });

  it('returns registered adapter for .tsx extension', () => {
    expect(registry.getAdapter('src/App.tsx')).toBe(mock);
  });

  it('returns registered adapter for .js extension', () => {
    expect(registry.getAdapter('src/utils.js')).toBe(mock);
  });

  it('returns registered adapter for .jsx extension', () => {
    expect(registry.getAdapter('src/Component.jsx')).toBe(mock);
  });

  it('returns undefined for unsupported extension .py', () => {
    expect(registry.getAdapter('src/main.py')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(registry.getAdapter('')).toBeUndefined();
  });

  it('returns undefined for file without extension', () => {
    expect(registry.getAdapter('Makefile')).toBeUndefined();
  });

  it('handles case-insensitive extension matching', () => {
    expect(registry.getAdapter('src/foo.TS')).toBe(mock);
  });

  it('exposes the set of registered extensions', () => {
    expect(registry.getSupportedExtensions()).toEqual(new Set(['.ts', '.tsx', '.js', '.jsx']));
  });
});
