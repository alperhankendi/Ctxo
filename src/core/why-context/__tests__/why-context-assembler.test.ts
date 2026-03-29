import { describe, it, expect } from 'vitest';
import { WhyContextAssembler } from '../why-context-assembler.js';

describe('WhyContextAssembler', () => {
  const assembler = new WhyContextAssembler();

  it('assembles result with commit history and anti-pattern warnings', () => {
    const history = [{ hash: 'a1', message: 'feat: add login', date: '2024-01-01', kind: 'commit' as const }];
    const warnings = [{ hash: 'b1', message: 'Revert "add login"', date: '2024-01-02' }];

    const result = assembler.assemble(history, warnings);
    expect(result.commitHistory).toHaveLength(1);
    expect(result.antiPatternWarnings).toHaveLength(1);
  });

  it('returns empty commitHistory when no history provided', () => {
    const result = assembler.assemble([], []);
    expect(result.commitHistory).toEqual([]);
  });

  it('includes anti-pattern warnings when revert commits present', () => {
    const warnings = [{ hash: 'b1', message: 'revert: undo cache', date: '2024-01-02' }];
    const result = assembler.assemble([], warnings);
    expect(result.antiPatternWarnings).toHaveLength(1);
    expect(result.antiPatternWarnings[0]?.message).toBe('revert: undo cache');
  });

  it('returns empty antiPatternWarnings when no reverts found', () => {
    const history = [{ hash: 'a1', message: 'fix: typo', date: '2024-01-01', kind: 'commit' as const }];
    const result = assembler.assemble(history, []);
    expect(result.antiPatternWarnings).toEqual([]);
  });

  it('includes changeIntelligence when provided', () => {
    const score = { symbolId: 'a::b::function', complexity: 0.5, churn: 0.3, composite: 0.15, band: 'low' as const };
    const result = assembler.assemble([], [], score);
    expect(result.changeIntelligence).toEqual(score);
  });

  it('changeIntelligence is undefined when not provided', () => {
    const result = assembler.assemble([], []);
    expect(result.changeIntelligence).toBeUndefined();
  });
});
