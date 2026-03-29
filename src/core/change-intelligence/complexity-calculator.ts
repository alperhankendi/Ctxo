import type { ComplexityMetrics } from '../types.js';

export class ComplexityCalculator {
  calculate(symbolId: string, cyclomaticComplexity: number): ComplexityMetrics {
    if (!Number.isFinite(cyclomaticComplexity) || cyclomaticComplexity < 1) {
      return { symbolId, cyclomatic: 1 };
    }
    return { symbolId, cyclomatic: cyclomaticComplexity };
  }
}
