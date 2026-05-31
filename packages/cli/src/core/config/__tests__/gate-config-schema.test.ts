import { describe, it, expect } from 'vitest';
import { CtxoConfigSchema, DEFAULT_CONFIG } from '../config-schema.js';

describe('GateConfigSchema', () => {
  it('accepts a valid gate block', () => {
    const parsed = CtxoConfigSchema.parse({
      gate: { enabled: true, sensitivity: 'balanced', minDependents: 3, percentile: 15 },
    });
    expect(parsed.gate?.sensitivity).toBe('balanced');
  });

  it('rejects an unknown sensitivity', () => {
    const result = CtxoConfigSchema.safeParse({ gate: { sensitivity: 'aggressive' } });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys under gate (typo protection)', () => {
    const result = CtxoConfigSchema.safeParse({ gate: { enable: true } });
    expect(result.success).toBe(false);
  });

  it('DEFAULT_CONFIG enables the gate at balanced', () => {
    expect(DEFAULT_CONFIG.gate).toEqual({ enabled: true, sensitivity: 'balanced' });
  });
});
