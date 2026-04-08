import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IStoragePort } from '../../ports/i-storage-port.js';
import type { IGitPort } from '../../ports/i-git-port.js';
import type { IMaskingPort } from '../../ports/i-masking-port.js';
import type { StalenessCheck } from './get-logic-slice.js';
import { buildGraphFromJsonIndex, buildGraphFromStorage } from './get-logic-slice.js';
import { BlastRadiusCalculator } from '../../core/blast-radius/blast-radius-calculator.js';
import { loadCoChangeMap } from '../../core/co-change/co-change-analyzer.js';
import type { CoChangeMatrix, CoChangeEntry } from '../../core/types.js';

const InputSchema = z.object({
  since: z.string().optional().default('HEAD~1'),
  maxFiles: z.number().int().min(1).optional().default(50),
  confidence: z.enum(['confirmed', 'likely', 'potential']).optional(),
});

function loadCoChanges(ctxoRoot: string): Map<string, CoChangeEntry[]> | undefined {
  const path = join(ctxoRoot, 'index', 'co-changes.json');
  if (!existsSync(path)) return undefined;
  try {
    const matrix: CoChangeMatrix = JSON.parse(readFileSync(path, 'utf-8'));
    return loadCoChangeMap(matrix);
  } catch {
    return undefined;
  }
}

export function handleGetPrImpact(
  storage: IStoragePort,
  git: IGitPort,
  masking: IMaskingPort,
  staleness?: StalenessCheck,
  ctxoRoot = '.ctxo',
) {
  const calculator = new BlastRadiusCalculator();
  const getGraph = () => {
    const jsonGraph = buildGraphFromJsonIndex(ctxoRoot);
    if (jsonGraph.nodeCount > 0) return jsonGraph;
    return buildGraphFromStorage(storage);
  };

  return async (args: Record<string, unknown>) => {
    try {
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: parsed.error.message }) }],
        };
      }

      const { since, maxFiles, confidence: confFilter } = parsed.data;

      // Step 1: Get changed files
      const changedPaths = await git.getChangedFiles(since);
      if (changedPaths.length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ since, changedFiles: 0, changedSymbols: 0, totalImpact: 0, riskLevel: 'low', files: [], summary: { confirmedTotal: 0, likelyTotal: 0, potentialTotal: 0, highRiskSymbols: [] } }) }],
        };
      }

      // Step 2: Build graph + load co-changes
      const graph = getGraph();
      const coChangeMap = loadCoChanges(ctxoRoot);

      // Step 3: Map files → symbols
      const allNodes = graph.allNodes();
      const nodesByFile = new Map<string, typeof allNodes>();
      for (const node of allNodes) {
        const file = node.symbolId.split('::')[0]!;
        let list = nodesByFile.get(file);
        if (!list) { list = []; nodesByFile.set(file, list); }
        list.push(node);
      }

      // Step 4: For each changed file, compute blast radius per symbol
      const limitedPaths = changedPaths.slice(0, maxFiles);
      let totalImpact = 0;
      let confirmedTotal = 0;
      let likelyTotal = 0;
      let potentialTotal = 0;
      const highRiskSymbols: string[] = [];

      const files: Array<{
        file: string;
        symbols: Array<{
          symbolId: string;
          name: string;
          kind: string;
          blast: {
            impactScore: number;
            confirmedCount: number;
            likelyCount: number;
            potentialCount: number;
            riskScore: number;
            topImpacted: Array<unknown>;
          };
        }>;
        coChangedWith?: string[];
      }> = [];

      for (const filePath of limitedPaths) {
        const symbols = nodesByFile.get(filePath);
        if (!symbols || symbols.length === 0) continue;

        const fileSymbols: typeof files[0]['symbols'] = [];

        for (const sym of symbols) {
          const result = calculator.calculate(graph, sym.symbolId, coChangeMap);

          let impacted = result.impactedSymbols;
          if (confFilter) {
            impacted = impacted.filter(s => s.confidence === confFilter);
          }

          const impactScore = impacted.length;
          const confirmed = impacted.filter(s => s.confidence === 'confirmed').length;
          const likely = impacted.filter(s => s.confidence === 'likely').length;
          const potential = impacted.filter(s => s.confidence === 'potential').length;

          totalImpact += impactScore;
          confirmedTotal += confirmed;
          likelyTotal += likely;
          potentialTotal += potential;

          if (result.overallRiskScore > 0.7) {
            highRiskSymbols.push(sym.symbolId);
          }

          const topImpacted = impacted
            .sort((a, b) => b.riskScore - a.riskScore)
            .slice(0, 10);

          fileSymbols.push({
            symbolId: sym.symbolId,
            name: sym.name,
            kind: sym.kind,
            blast: {
              impactScore,
              confirmedCount: confirmed,
              likelyCount: likely,
              potentialCount: potential,
              riskScore: result.overallRiskScore,
              topImpacted,
            },
          });
        }

        // Co-changed files for this file
        let coChangedWith: string[] | undefined;
        if (coChangeMap) {
          const entries = coChangeMap.get(filePath);
          if (entries && entries.length > 0) {
            coChangedWith = entries
              .sort((a, b) => b.frequency - a.frequency)
              .slice(0, 5)
              .map(e => e.file1 === filePath ? e.file2 : e.file1);
          }
        }

        files.push({
          file: filePath,
          symbols: fileSymbols,
          ...(coChangedWith ? { coChangedWith } : {}),
        });
      }

      // Step 5: Compute risk level
      const maxRisk = files.reduce((max, f) => {
        const fileMax = f.symbols.reduce((m, s) => Math.max(m, s.blast.riskScore), 0);
        return Math.max(max, fileMax);
      }, 0);
      const riskLevel = maxRisk > 0.7 ? 'high' : maxRisk > 0.3 ? 'medium' : 'low';

      const changedSymbols = files.reduce((sum, f) => sum + f.symbols.length, 0);

      const payload = masking.mask(JSON.stringify({
        since,
        changedFiles: files.length,
        changedSymbols,
        totalImpact,
        riskLevel,
        files,
        summary: {
          confirmedTotal,
          likelyTotal,
          potentialTotal,
          highRiskSymbols: highRiskSymbols.slice(0, 10),
        },
      }));

      const content: Array<{ type: 'text'; text: string }> = [];
      if (staleness) {
        const warning = staleness.check(storage.listIndexedFiles());
        if (warning) content.push({ type: 'text', text: `⚠️ ${warning.message}` });
      }
      content.push({ type: 'text', text: payload });

      return { content };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message: (err as Error).message }) }],
      };
    }
  };
}
