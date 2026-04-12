import type { CommitIntent, AntiPattern, WhyContextResult, ChangeIntelligenceScore } from '../types.js';

export class WhyContextAssembler {
  assemble(
    commitHistory: readonly CommitIntent[],
    antiPatternWarnings: readonly AntiPattern[],
    changeIntelligence?: ChangeIntelligenceScore,
  ): WhyContextResult {
    return {
      commitHistory,
      antiPatternWarnings,
      changeIntelligence,
    };
  }
}
