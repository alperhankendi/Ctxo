import { describe, it, expect, beforeEach } from 'vitest';
import { LanguageAdapterRegistry } from '../language-adapter-registry.js';
import { TsMorphAdapter } from '../ts-morph-adapter.js';

describe('LanguageAdapterRegistry', () => {
  let registry: LanguageAdapterRegistry;

  beforeEach(() => {
    registry = new LanguageAdapterRegistry();
    registry.register(new TsMorphAdapter());
  });

  it('returns TsMorphAdapter for .ts extension', () => {
    const adapter = registry.getAdapter('src/foo.ts');
    expect(adapter).toBeDefined();
    expect(adapter?.tier).toBe('full');
  });

  it('returns TsMorphAdapter for .tsx extension', () => {
    const adapter = registry.getAdapter('src/App.tsx');
    expect(adapter).toBeDefined();
  });

  it('returns TsMorphAdapter for .js extension', () => {
    const adapter = registry.getAdapter('src/utils.js');
    expect(adapter).toBeDefined();
  });

  it('returns TsMorphAdapter for .jsx extension', () => {
    const adapter = registry.getAdapter('src/Component.jsx');
    expect(adapter).toBeDefined();
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
    const adapter = registry.getAdapter('src/foo.TS');
    expect(adapter).toBeDefined();
  });
});
