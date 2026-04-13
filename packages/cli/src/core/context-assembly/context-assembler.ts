import type { SymbolGraph } from '../graph/symbol-graph.js';
import type { SymbolNode, SymbolKind, FileIndex } from '../types.js';
import { LogicSliceQuery } from '../logic-slice/logic-slice-query.js';
import { BlastRadiusCalculator } from '../blast-radius/blast-radius-calculator.js';
import { type TaskType, type ScoringWeights, getWeightsForTask } from './task-context-strategy.js';

export interface ContextEntry {
  readonly symbolId: string;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly file: string;
  readonly relevanceScore: number;
  readonly reason: string;
  readonly lines: number;
  readonly tokens: number;
}

export interface TaskContextResult {
  readonly target: SymbolNode;
  readonly taskType: TaskType;
  readonly context: ContextEntry[];
  readonly totalTokens: number;
  readonly tokenBudget: number;
  readonly warnings: string[];
}

export interface RankedContextResult {
  readonly query: string;
  readonly strategy: string;
  readonly results: Array<{
    readonly symbolId: string;
    readonly name: string;
    readonly kind: SymbolKind;
    readonly file: string;
    readonly relevanceScore: number;
    readonly importanceScore: number;
    readonly combinedScore: number;
    readonly tokens: number;
  }>;
  readonly totalTokens: number;
  readonly tokenBudget: number;
}

const DEFAULT_TOKEN_BUDGET = 4000;

export class ContextAssembler {
  private readonly logicSlice = new LogicSliceQuery();
  private readonly blastRadius = new BlastRadiusCalculator();

  assembleForTask(
    graph: SymbolGraph,
    symbolId: string,
    taskType: TaskType,
    indices: readonly FileIndex[],
    tokenBudget = DEFAULT_TOKEN_BUDGET,
  ): TaskContextResult | undefined {
    const target = graph.getNode(symbolId);
    if (!target) return undefined;

    const weights = getWeightsForTask(taskType);

    // Gather forward deps + reverse deps
    const slice = this.logicSlice.getLogicSlice(graph, symbolId);
    const blastResult = this.blastRadius.calculate(graph, symbolId);

    // Build candidate pool (deduplicated)
    const candidateMap = new Map<string, { node: SymbolNode; signals: Signals }>();

    // Forward dependencies
    if (slice) {
      for (const dep of slice.dependencies) {
        candidateMap.set(dep.symbolId, {
          node: dep,
          signals: { isDirectDep: true, isInterfaceOrType: this.isInterfaceOrType(dep.kind), isDependent: false, complexity: 0, hasAntiPattern: false },
        });
      }
    }

    // Reverse dependents (blast radius) — fall back to a synthetic node when
    // the edge source has no matching symbols[] entry (e.g. test files that
    // only import). Without this, symbols whose importers are all such files
    // would produce an empty context even when reverse edges clearly exist.
    for (const entry of blastResult.impactedSymbols) {
      const node = graph.getNode(entry.symbolId) ?? synthesizeNodeFromId(entry.symbolId);
      if (!node) continue;

      const existing = candidateMap.get(entry.symbolId);
      if (existing) {
        existing.signals.isDependent = true;
      } else {
        candidateMap.set(entry.symbolId, {
          node,
          signals: { isDirectDep: false, isInterfaceOrType: this.isInterfaceOrType(node.kind), isDependent: true, complexity: 0, hasAntiPattern: false },
        });
      }
    }

    // Enrich with complexity + anti-patterns from index
    const fileIndexMap = new Map(indices.map((i) => [i.file, i]));
    for (const [sid, candidate] of candidateMap) {
      const file = sid.split('::')[0] ?? '';
      const fileIndex = fileIndexMap.get(file);

      if (fileIndex) {
        const complexity = fileIndex.complexity?.find((c) => c.symbolId === sid);
        candidate.signals.complexity = complexity?.cyclomatic ?? 0;
        candidate.signals.hasAntiPattern = fileIndex.antiPatterns.length > 0;
      }
    }

    // Score and rank
    const scored = [...candidateMap.entries()].map(([, { node, signals }]) => ({
      entry: this.buildContextEntry(node, signals, weights),
      score: this.computeScore(signals, weights),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Greedy pack within token budget
    const context: ContextEntry[] = [];
    let totalTokens = 0;

    for (const { entry } of scored) {
      if (totalTokens + entry.tokens > tokenBudget) continue;
      context.push(entry);
      totalTokens += entry.tokens;
    }

    // Warnings
    const warnings: string[] = [];
    const targetFile = symbolId.split('::')[0] ?? '';
    const targetIndex = fileIndexMap.get(targetFile);
    if (targetIndex && targetIndex.antiPatterns.length > 0) {
      warnings.push(`⚠ Target symbol has ${targetIndex.antiPatterns.length} anti-pattern(s) in file history`);
    }

    return { target, taskType, context, totalTokens, tokenBudget, warnings };
  }

  assembleRanked(
    graph: SymbolGraph,
    query: string,
    strategy: 'combined' | 'dependency' | 'importance' = 'combined',
    tokenBudget = DEFAULT_TOKEN_BUDGET,
  ): RankedContextResult {
    const allNodes = graph.allNodes();
    const queryLower = query.toLowerCase();

    // Compute max reverse edges for importance normalization
    let maxReverseEdges = 1;
    for (const node of allNodes) {
      const count = graph.getReverseEdges(node.symbolId).length;
      if (count > maxReverseEdges) maxReverseEdges = count;
    }

    // Score each symbol
    const scored = allNodes.map((node) => {
      const relevanceScore = this.computeTextRelevance(node.name, queryLower);
      const importanceScore = graph.getReverseEdges(node.symbolId).length / maxReverseEdges;

      let combinedScore: number;
      switch (strategy) {
        case 'dependency':
          combinedScore = relevanceScore;
          break;
        case 'importance':
          combinedScore = importanceScore;
          break;
        default:
          combinedScore = relevanceScore * 0.6 + importanceScore * 0.4;
      }

      return {
        symbolId: node.symbolId,
        name: node.name,
        kind: node.kind,
        file: node.symbolId.split('::')[0] ?? '',
        relevanceScore: Math.round(relevanceScore * 1000) / 1000,
        importanceScore: Math.round(importanceScore * 1000) / 1000,
        combinedScore: Math.round(combinedScore * 1000) / 1000,
        tokens: this.estimateTokens(node),
      };
    });

    // Filter zero-relevance for text-based strategies
    const filtered = strategy === 'importance'
      ? scored
      : scored.filter((s) => s.relevanceScore > 0 || s.importanceScore > 0.1);

    filtered.sort((a, b) => b.combinedScore - a.combinedScore);

    // Greedy pack
    const results: typeof filtered = [];
    let totalTokens = 0;

    for (const item of filtered) {
      if (totalTokens + item.tokens > tokenBudget) continue;
      results.push(item);
      totalTokens += item.tokens;
    }

    return { query, strategy, results, totalTokens, tokenBudget };
  }

  private computeTextRelevance(name: string, queryLower: string): number {
    const nameLower = name.toLowerCase();
    if (nameLower === queryLower) return 1.0;
    if (nameLower.includes(queryLower)) return 0.7;
    if (queryLower.split(/\s+/).some((word) => nameLower.includes(word))) return 0.4;
    return 0;
  }

  private computeScore(signals: Signals, weights: ScoringWeights): number {
    let score = 0;
    if (signals.isDirectDep) score += weights.directDependency;
    if (signals.isInterfaceOrType) score += weights.interfaceTypeDef;
    if (signals.isDependent) score += weights.blastRadiusDependent;
    if (signals.complexity > 5) score += weights.highComplexity;
    if (signals.hasAntiPattern) score += weights.antiPatternHistory;
    return Math.round(score * 1000) / 1000;
  }

  private buildContextEntry(node: SymbolNode, signals: Signals, weights: ScoringWeights): ContextEntry {
    const reasons: string[] = [];
    if (signals.isDirectDep) reasons.push('direct dependency');
    if (signals.isInterfaceOrType) reasons.push('type/interface definition');
    if (signals.isDependent) reasons.push('blast radius dependent');
    if (signals.complexity > 5) reasons.push(`high complexity (CC=${signals.complexity})`);
    if (signals.hasAntiPattern) reasons.push('anti-pattern history');

    return {
      symbolId: node.symbolId,
      name: node.name,
      kind: node.kind,
      file: node.symbolId.split('::')[0] ?? '',
      relevanceScore: this.computeScore(signals, weights),
      reason: reasons.join(', ') || 'related symbol',
      lines: node.endLine - node.startLine + 1,
      tokens: this.estimateTokens(node),
    };
  }

  private isInterfaceOrType(kind: SymbolKind): boolean {
    return kind === 'interface' || kind === 'type';
  }

  estimateTokensPublic(node: SymbolNode): number {
    return this.estimateTokens(node);
  }

  private estimateTokens(node: SymbolNode): number {
    // Use byte offsets for accurate estimation when available (~4 chars per token)
    if (node.startOffset !== undefined && node.endOffset !== undefined) {
      return Math.ceil((node.endOffset - node.startOffset) / 4);
    }
    return (node.endLine - node.startLine + 1) * 10;
  }
}

interface Signals {
  isDirectDep: boolean;
  isInterfaceOrType: boolean;
  isDependent: boolean;
  complexity: number;
  hasAntiPattern: boolean;
}

const VALID_SYMBOL_KINDS = new Set<SymbolKind>([
  'function', 'class', 'interface', 'method', 'variable', 'type',
]);

/**
 * Build a minimal SymbolNode from a symbolId string. Used when a blast-radius
 * entry points at an orphan edge source (no matching symbols[] entry in the
 * index). startLine/endLine are 0 so token estimation falls back to a small
 * default without over-counting missing source ranges.
 */
function synthesizeNodeFromId(symbolId: string): SymbolNode | undefined {
  const parts = symbolId.split('::');
  if (parts.length !== 3) return undefined;
  const [file, name, kindRaw] = parts;
  if (!file || !name || !kindRaw) return undefined;
  const kind = VALID_SYMBOL_KINDS.has(kindRaw as SymbolKind) ? (kindRaw as SymbolKind) : 'variable';
  return { symbolId, name, kind, startLine: 0, endLine: 0 };
}
