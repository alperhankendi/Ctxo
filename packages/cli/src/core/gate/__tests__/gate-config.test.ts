import { describe, it, expect } from 'vitest';
import { resolveGateThresholds } from '../gate-config.js';

describe('resolveGateThresholds', () => {
  it('defaults to balanced (top 15%, floor 3) when nothing is set', () => {
    expect(resolveGateThresholds(undefined)).toEqual({ enabled: true, percentile: 15, minDependents: 3 });
  });

  it('maps strict and lenient dials', () => {
    expect(resolveGateThresholds({ sensitivity: 'strict' })).toMatchObject({ percentile: 30, minDependents: 2 });
    expect(resolveGateThresholds({ sensitivity: 'lenient' })).toMatchObject({ percentile: 5, minDependents: 5 });
  });

  it('explicit overrides win over the dial', () => {
    expect(resolveGateThresholds({ sensitivity: 'lenient', percentile: 50, minDependents: 1 }))
      .toMatchObject({ percentile: 50, minDependents: 1 });
  });

  it('honors enabled:false', () => {
    expect(resolveGateThresholds({ enabled: false }).enabled).toBe(false);
  });
});
