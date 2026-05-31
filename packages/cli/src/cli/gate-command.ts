import { join } from 'node:path';
import { loadConfig } from '../core/config/load-config.js';
import { resolveGateThresholds } from '../core/gate/gate-config.js';
import { loadGraph } from './graph-loader.js';
import { BlastRadiusCalculator } from '../core/blast-radius/blast-radius-calculator.js';
import { PageRankCalculator } from '../core/importance/pagerank-calculator.js';
import { percentileCutoff } from '../core/gate/percentile.js';
import { shouldBlock } from '../core/gate/gate-decision.js';

const RANK_ALL = 100_000;

export interface GatePreviewOptions { json?: boolean; }

export class GateCommand {
  private readonly ctxoRoot: string;
  constructor(projectRoot: string) {
    this.ctxoRoot = join(projectRoot, '.ctxo');
  }

  preview(options: GatePreviewOptions = {}): void {
    const gate = loadConfig(this.ctxoRoot).config.gate;
    const thresholds = resolveGateThresholds(gate);
    const { graph } = loadGraph(this.ctxoRoot);
    const pr = new PageRankCalculator().calculate(graph, { limit: RANK_ALL });
    const prMap = new Map(pr.rankings.map((r) => [r.symbolId, r.score]));
    const cutoff = percentileCutoff([...prMap.values()], thresholds.percentile);

    const calc = new BlastRadiusCalculator();
    const firing: Array<{ symbolId: string; riskCount: number; importance: number }> = [];
    for (const [symbolId, importance] of prMap) {
      if (importance < cutoff) continue;
      const blast = calc.calculate(graph, symbolId);
      const riskCount = blast.confirmedCount + blast.likelyCount;
      if (shouldBlock({ riskCount, importanceScore: importance, importanceCutoff: cutoff }, thresholds)) {
        firing.push({ symbolId, riskCount, importance: Math.round(importance * 1e4) / 1e4 });
      }
    }
    firing.sort((a, b) => b.riskCount - a.riskCount);

    const payload = {
      sensitivity: gate?.sensitivity ?? 'balanced',
      thresholds,
      totalSymbols: graph.nodeCount,
      wouldFireCount: firing.length,
      symbols: firing.slice(0, 50),
    };
    if (options.json) { process.stdout.write(JSON.stringify(payload, null, 2) + '\n'); return; }
    console.error(`[ctxo] gate preview (${payload.sensitivity}): ${firing.length}/${graph.nodeCount} symbols would gate.`);
    for (const f of firing.slice(0, 25)) console.error(`  ${f.riskCount} dep  ${f.symbolId}`);
  }
}
