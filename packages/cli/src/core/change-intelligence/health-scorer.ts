import type { ChangeIntelligenceScore, ScoreBand } from '../types.js';

export class HealthScorer {
  score(symbolId: string, complexity: number, churn: number): ChangeIntelligenceScore {
    const composite = complexity * churn;
    const band = this.toBand(composite);

    return { symbolId, complexity, churn, composite, band };
  }

  private toBand(composite: number): ScoreBand {
    if (composite < 0.3) return 'low';
    if (composite < 0.7) return 'medium';
    return 'high';
  }
}
