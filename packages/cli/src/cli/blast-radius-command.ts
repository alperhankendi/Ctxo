import { join } from 'node:path';
import { loadGraph } from './graph-loader.js';
import { BlastRadiusCalculator } from '../core/blast-radius/blast-radius-calculator.js';

export interface BlastRadiusOptions {
  symbolId: string;
  json?: boolean;
}

export class BlastRadiusCommand {
  private readonly ctxoRoot: string;
  constructor(projectRoot: string) {
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  run(options: BlastRadiusOptions): void {
    const { graph } = loadGraph(this.ctxoRoot);
    if (!graph.hasNode(options.symbolId)) {
      process.stdout.write(JSON.stringify({ found: false, symbolId: options.symbolId }) + '\n');
      return;
    }
    const result = new BlastRadiusCalculator().calculate(graph, options.symbolId);
    const payload = {
      found: true,
      symbolId: options.symbolId,
      directDependentsCount: result.directDependentsCount,
      confirmedCount: result.confirmedCount,
      likelyCount: result.likelyCount,
      potentialCount: result.potentialCount,
      overallRiskScore: result.overallRiskScore,
      impactedSymbols: result.impactedSymbols.map((s) => ({
        symbolId: s.symbolId, confidence: s.confidence, depth: s.depth,
      })),
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
  }
}
