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
  readonly cascadeDepth?: number;
}

export interface UnusedExportEntry {
  readonly symbolId: string;
  readonly file: string;
  readonly name: string;
  readonly kind: SymbolKind;
}

export interface ScaffoldingEntry {
  readonly file: string;
  readonly line: number;
  readonly pattern: string;
  readonly text: string;
}

export interface DeadCodeResult {
  readonly totalSymbols: number;
  readonly reachableSymbols: number;
  readonly deadSymbols: DeadSymbolEntry[];
  readonly unusedExports: UnusedExportEntry[];
  readonly deadFiles: string[];
  readonly scaffolding: ScaffoldingEntry[];
  readonly deadCodePercentage: number;
}

// Patterns for files to exclude from dead code analysis
const TEST_PATTERNS = [/__tests__/, /\.test\.ts$/, /\.spec\.ts$/, /\btests\//, /\bfixtures?\//];
const CONFIG_PATTERNS = [/\.(config|rc)\.(ts|js|json)$/, /tsconfig/, /eslint/, /\.d\.ts$/];

// Framework lifecycle symbols — should never be flagged as dead
const FRAMEWORK_PATTERNS = [
  // Vitest
  /^(describe|it|expect|beforeAll|beforeEach|afterAll|afterEach|vi)$/,
  // MCP SDK
  /^(registerTool|registerPrompt|connect|close)$/,
  // Zod schemas (conventionally exported for validation)
  /Schema$/,
  // Node.js lifecycle
  /^main$/,
];

// Scaffolding / AI artifact patterns
const SCAFFOLDING_PATTERNS = [
  { regex: /\bTODO\b/i, pattern: 'TODO' },
  { regex: /\bFIXME\b/i, pattern: 'FIXME' },
  { regex: /\bHACK\b/i, pattern: 'HACK' },
  { regex: /\bPLACEHOLDER\b/i, pattern: 'PLACEHOLDER' },
  { regex: /\bXXX\b/, pattern: 'XXX' },
  { regex: /Phase\s+\d|Step\s+\d/i, pattern: 'PHASE/STEP' },
  { regex: /not\s+(?:yet\s+)?implement/i, pattern: 'NOT_IMPLEMENTED' },
  { regex: /temporary|temp\s+fix/i, pattern: 'TEMPORARY' },
];

export class DeadCodeDetector {
  detect(
    graph: SymbolGraph,
    options: { includeTests?: boolean; sourceContents?: Map<string, string> } = {},
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
      return { totalSymbols: 0, reachableSymbols: 0, deadSymbols: [], unusedExports: [], deadFiles: [], scaffolding: this.detectScaffolding(options.sourceContents), deadCodePercentage: 0 };
    }

    // Dynamic entry point detection: symbols with zero reverse edges (no one imports them)
    const candidateIds = new Set(candidates.map((n) => n.symbolId));
    const entryPoints = new Set<string>();

    for (const node of candidates) {
      // Framework lifecycle symbols are always entry points (never dead)
      if (this.isFrameworkSymbol(node.name)) {
        entryPoints.add(node.symbolId);
        continue;
      }

      const reverseEdges = graph.getReverseEdges(node.symbolId);
      const forwardEdges = graph.getForwardEdges(node.symbolId);

      // Filter: only count reverse edges from OTHER candidates
      const incomingFromCandidates = reverseEdges.filter((e) => candidateIds.has(e.from) && e.from !== node.symbolId);

      if (incomingFromCandidates.length === 0) {
        const hasOutgoing = forwardEdges.some((e) => candidateIds.has(e.to));
        if (hasOutgoing || reverseEdges.length > 0) {
          entryPoints.add(node.symbolId);
        }
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

    // Compute cascade depth: how deep in the dead chain is this symbol?
    const cascadeDepthMap = this.computeCascadeDepths(graph, deadIds, candidateIds);

    // Compute confidence per dead symbol
    const deadSymbols: DeadSymbolEntry[] = [];
    for (const node of candidates) {
      if (!deadIds.has(node.symbolId)) continue;

      const file = node.symbolId.split('::')[0] ?? '';
      const confidence = this.computeConfidence(graph, node.symbolId, deadIds);
      const cascadeDepth = cascadeDepthMap.get(node.symbolId);

      deadSymbols.push({
        symbolId: node.symbolId,
        file,
        name: node.name,
        kind: node.kind,
        confidence,
        reason: this.describeReason(confidence),
        ...(cascadeDepth !== undefined && cascadeDepth > 0 ? { cascadeDepth } : {}),
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

    // Scaffolding detection: scan source contents for TODO/FIXME/HACK patterns
    const scaffolding = this.detectScaffolding(options.sourceContents);

    const deadCodePercentage = Math.round((deadSymbols.length / candidates.length) * 100 * 10) / 10;

    return {
      totalSymbols: candidates.length,
      reachableSymbols: reachable.size,
      deadSymbols,
      unusedExports,
      deadFiles,
      scaffolding,
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

  private isFrameworkSymbol(name: string): boolean {
    return FRAMEWORK_PATTERNS.some((p) => p.test(name));
  }

  private computeCascadeDepths(
    graph: SymbolGraph,
    deadIds: Set<string>,
    candidateIds: Set<string>,
  ): Map<string, number> {
    const depths = new Map<string, number>();

    // Find root dead symbols (zero reverse edges from other dead symbols)
    const rootDead = new Set<string>();
    for (const id of deadIds) {
      const reverseEdges = graph.getReverseEdges(id);
      const deadImporters = reverseEdges.filter((e) => deadIds.has(e.from) && e.from !== id);
      if (deadImporters.length === 0) {
        rootDead.add(id);
        depths.set(id, 0);
      }
    }

    // BFS from root dead symbols to compute cascade depth
    const queue = [...rootDead].map((id) => ({ id, depth: 0 }));
    const visited = new Set(rootDead);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of graph.getForwardEdges(current.id)) {
        if (deadIds.has(edge.to) && !visited.has(edge.to) && candidateIds.has(edge.to)) {
          const newDepth = current.depth + 1;
          depths.set(edge.to, newDepth);
          visited.add(edge.to);
          queue.push({ id: edge.to, depth: newDepth });
        }
      }
    }

    return depths;
  }

  private detectScaffolding(sourceContents?: Map<string, string>): ScaffoldingEntry[] {
    if (!sourceContents || sourceContents.size === 0) return [];

    const results: ScaffoldingEntry[] = [];

    for (const [file, content] of sourceContents) {
      // Skip test/config files
      if (this.matchesAny(file, TEST_PATTERNS) || this.matchesAny(file, CONFIG_PATTERNS)) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const { regex, pattern } of SCAFFOLDING_PATTERNS) {
          if (regex.test(line)) {
            results.push({
              file,
              line: i + 1,
              pattern,
              text: line.trim().slice(0, 120),
            });
            break; // One match per line
          }
        }
      }
    }

    return results;
  }

  private matchesAny(value: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(value));
  }
}
