import type { SymbolGraph } from '../graph/symbol-graph.js';
import type { SymbolKind } from '../types.js';

export type DeadCodeConfidence = 1.0 | 0.9 | 0.7;

export interface DeadSymbolEntry {
  readonly symbolId: string;
  readonly file: string;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly confidence: DeadCodeConfidence;
  readonly reason: string;
}

export interface UnusedExportEntry {
  readonly symbolId: string;
  readonly file: string;
  readonly name: string;
  readonly kind: SymbolKind;
}

export interface DeadCodeResult {
  readonly totalSymbols: number;
  readonly reachableSymbols: number;
  readonly deadSymbols: DeadSymbolEntry[];
  readonly unusedExports: UnusedExportEntry[];
  readonly deadFiles: string[];
  readonly deadCodePercentage: number;
}

// Patterns for files to exclude from dead code analysis
const TEST_PATTERNS = [/__tests__/, /\.test\.ts$/, /\.spec\.ts$/, /\btests\//, /\bfixtures?\//];
const CONFIG_PATTERNS = [/\.(config|rc)\.(ts|js|json)$/, /tsconfig/, /eslint/, /\.d\.ts$/];

export class DeadCodeDetector {
  detect(
    graph: SymbolGraph,
    options: { includeTests?: boolean } = {},
  ): DeadCodeResult {
    const allNodes = graph.allNodes();

    // Filter candidates — exclude tests/config by default
    const candidates = options.includeTests
      ? allNodes
      : allNodes.filter((n) => {
          const file = n.symbolId.split('::')[0] ?? '';
          return !this.matchesAny(file, TEST_PATTERNS) && !this.matchesAny(file, CONFIG_PATTERNS);
        });

    if (candidates.length === 0) {
      return { totalSymbols: 0, reachableSymbols: 0, deadSymbols: [], unusedExports: [], deadFiles: [], deadCodePercentage: 0 };
    }

    // Dynamic entry point detection: symbols with zero reverse edges (no one imports them)
    const candidateIds = new Set(candidates.map((n) => n.symbolId));
    const entryPoints = new Set<string>();

    for (const node of candidates) {
      const reverseEdges = graph.getReverseEdges(node.symbolId);
      const forwardEdges = graph.getForwardEdges(node.symbolId);

      // Filter: only count reverse edges from OTHER candidates
      const incomingFromCandidates = reverseEdges.filter((e) => candidateIds.has(e.from) && e.from !== node.symbolId);

      if (incomingFromCandidates.length === 0) {
        // Isolated symbols (zero forward AND zero reverse) are dead, not entry points
        const hasOutgoing = forwardEdges.some((e) => candidateIds.has(e.to));
        if (hasOutgoing || reverseEdges.length > 0) {
          // Has outgoing deps → entry point (composition root, CLI command)
          // Has reverse from excluded files → still an entry point
          entryPoints.add(node.symbolId);
        }
        // else: truly isolated → stays out of entry points → will be marked dead
      }
    }

    // Forward BFS from all entry points — mark reachable symbols
    const reachable = new Set<string>();
    const queue = [...entryPoints];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);

      for (const edge of graph.getForwardEdges(current)) {
        if (!reachable.has(edge.to) && candidateIds.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }

    // Dead = candidates not reachable from any entry point
    // These are "island" symbols — circular deps where the whole cluster is unreachable
    const deadIds = new Set<string>();
    for (const node of candidates) {
      if (!reachable.has(node.symbolId)) {
        deadIds.add(node.symbolId);
      }
    }

    // Compute confidence per dead symbol
    const deadSymbols: DeadSymbolEntry[] = [];
    for (const node of candidates) {
      if (!deadIds.has(node.symbolId)) continue;

      const file = node.symbolId.split('::')[0] ?? '';
      const confidence = this.computeConfidence(graph, node.symbolId, deadIds);

      deadSymbols.push({
        symbolId: node.symbolId,
        file,
        name: node.name,
        kind: node.kind,
        confidence,
        reason: this.describeReason(confidence),
      });
    }

    // Dead files = files where ALL candidate symbols are dead
    const fileStats = new Map<string, { total: number; dead: number }>();
    for (const node of candidates) {
      const file = node.symbolId.split('::')[0] ?? '';
      const stats = fileStats.get(file) ?? { total: 0, dead: 0 };
      stats.total++;
      if (deadIds.has(node.symbolId)) stats.dead++;
      fileStats.set(file, stats);
    }

    const deadFiles = [...fileStats.entries()]
      .filter(([, s]) => s.total > 0 && s.dead === s.total)
      .map(([file]) => file);

    // Unused exports: symbols with zero reverse edges from other candidates
    // Different from dead code: an unused export may be an entry point (reachable)
    // but still never imported by anyone
    const unusedExports: UnusedExportEntry[] = [];
    for (const node of candidates) {
      const reverseEdges = graph.getReverseEdges(node.symbolId);
      const externalImporters = reverseEdges.filter((e) =>
        candidateIds.has(e.from) && e.from !== node.symbolId,
      );

      if (externalImporters.length === 0 && !deadIds.has(node.symbolId)) {
        // Exported, reachable (entry point), but nobody imports it
        unusedExports.push({
          symbolId: node.symbolId,
          file: node.symbolId.split('::')[0] ?? '',
          name: node.name,
          kind: node.kind,
        });
      }
    }

    const deadCodePercentage = Math.round((deadSymbols.length / candidates.length) * 100 * 10) / 10;

    return {
      totalSymbols: candidates.length,
      reachableSymbols: reachable.size,
      deadSymbols,
      unusedExports,
      deadFiles,
      deadCodePercentage,
    };
  }

  private computeConfidence(
    graph: SymbolGraph,
    symbolId: string,
    deadIds: Set<string>,
  ): DeadCodeConfidence {
    const reverseEdges = graph.getReverseEdges(symbolId);

    // 1.0: Zero importers at all — definitely dead
    if (reverseEdges.length === 0) {
      return 1.0;
    }

    // 0.9: Has importers but they're all from test/config files
    const allImportersExcluded = reverseEdges.every((e) => {
      const importerFile = e.from.split('::')[0] ?? '';
      return this.matchesAny(importerFile, TEST_PATTERNS) || this.matchesAny(importerFile, CONFIG_PATTERNS);
    });
    if (allImportersExcluded) {
      return 0.9;
    }

    // 0.7: All importers are themselves dead (cascading dead code)
    const allImportersDead = reverseEdges.every((e) => deadIds.has(e.from));
    if (allImportersDead) {
      return 0.7;
    }

    // Shouldn't reach here if symbol is truly dead, but default to 0.7
    return 0.7;
  }

  private describeReason(confidence: DeadCodeConfidence): string {
    switch (confidence) {
      case 1.0:
        return 'Zero importers — no code references this symbol';
      case 0.9:
        return 'Only referenced from test/config files';
      case 0.7:
        return 'All importers are themselves dead (cascading)';
    }
  }

  private matchesAny(value: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(value));
  }
}
