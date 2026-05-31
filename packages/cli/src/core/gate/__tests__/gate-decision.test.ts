import { describe, it, expect } from 'vitest';
import { shouldBlock, type GateInput } from '../gate-decision.js';

const thresholds = { enabled: true, percentile: 15, minDependents: 3 };

describe('shouldBlock', () => {
  it('blocks a high-impact, structurally-central symbol', () => {
    const input: GateInput = { riskCount: 5, importanceScore: 0.9, importanceCutoff: 0.5 };
    expect(shouldBlock(input, thresholds)).toBe(true);
  });
  it('does not block below the dependent floor', () => {
    const input: GateInput = { riskCount: 2, importanceScore: 0.9, importanceCutoff: 0.5 };
    expect(shouldBlock(input, thresholds)).toBe(false);
  });
  it('does not block a low-importance symbol even with many dependents', () => {
    const input: GateInput = { riskCount: 9, importanceScore: 0.1, importanceCutoff: 0.5 };
    expect(shouldBlock(input, thresholds)).toBe(false);
  });
});
