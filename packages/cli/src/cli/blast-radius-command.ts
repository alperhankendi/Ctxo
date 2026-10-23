import { join } from 'node:path';
import { loadGraph } from './graph-loader.js';
import { BlastRadiusCalculator } from '../core/blast-radius/blast-radius-calculator.js';
import { findCoChangedFilesForBlastRadius } from '../core/blast-radius/co-changed-files.js';
import { CoChangeReader } from '../adapters/storage/co-change-reader.js';

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
    // Resolve the id once, as the get_blast_radius tool does: a 2-part data id names its winning definition.
    const root = graph.getNode(options.symbolId);
    if (!root) {
      process.stdout.write(JSON.stringify({ found: false, symbolId: options.symbolId }) + '\n');
      return;
    }
    // Same tiering as the get_blast_radius tool: co-change upgrades a potential dependent to likely.
    const coChangeMap = new CoChangeReader(this.ctxoRoot).readCoChangeMap();
    const result = new BlastRadiusCalculator().calculate(graph, root.symbolId, coChangeMap);

    const coChangedFiles = findCoChangedFilesForBlastRadius(coChangeMap, root.symbolId, result.impactedSymbols);

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
      // Informational: files that change together with the symbol's file but have no dependency path to it.
      ...(coChangedFiles.length > 0 ? { coChangedFiles } : {}),
    };
    process.stdout.write(JSON.stringify(payload) + '\n');
  }
}
