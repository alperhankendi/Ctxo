import type {
  LogicSliceResult,
  FormattedSlice,
  DetailLevel,
  SymbolNode,
  GraphEdge,
} from '../types.js';

const L1_MAX_LINES = 150;
const L4_TOKEN_BUDGET = 8000;

export class DetailFormatter {
  format(slice: LogicSliceResult, level: DetailLevel): FormattedSlice {
    switch (level) {
      case 1:
        return this.formatL1(slice);
      case 2:
        return this.formatL2(slice);
      case 3:
        return this.formatL3(slice);
      case 4:
        return this.formatL4(slice);
    }
  }

  private formatL1(slice: LogicSliceResult): FormattedSlice {
    const root = slice.root;
    const lineCount = root.endLine - root.startLine + 1;

    // Enforce ≤ 150 lines: clamp endLine if symbol is too large
    const clampedRoot: SymbolNode = lineCount > L1_MAX_LINES
      ? { ...root, endLine: root.startLine + L1_MAX_LINES - 1 }
      : root;

    return {
      root: clampedRoot,
      dependencies: [],
      edges: [],
      level: 1,
      ...(lineCount > L1_MAX_LINES ? { truncation: { truncated: true as const, reason: 'token_budget_exceeded' as const } } : {}),
    };
  }

  private formatL2(slice: LogicSliceResult): FormattedSlice {
    // L2: root + depth-1 direct dependencies
    const directEdges = slice.edges.filter((e) => e.from === slice.root.symbolId);
    const directDepIds = new Set(directEdges.map((e) => e.to));
    const directDeps = slice.dependencies.filter((d) => directDepIds.has(d.symbolId));

    return {
      root: slice.root,
      dependencies: directDeps,
      edges: directEdges,
      level: 2,
    };
  }

  private formatL3(slice: LogicSliceResult): FormattedSlice {
    // L3: full transitive closure
    return {
      root: slice.root,
      dependencies: slice.dependencies,
      edges: slice.edges,
      level: 3,
    };
  }

  private formatL4(slice: LogicSliceResult): FormattedSlice {
    // L4: full closure with token budget enforcement
    const estimatedTokens = this.estimateTokens(slice);

    if (estimatedTokens > L4_TOKEN_BUDGET) {
      // Truncate dependencies to fit budget
      const truncated = this.truncateToTokenBudget(slice, L4_TOKEN_BUDGET);
      return {
        ...truncated,
        level: 4,
        truncation: {
          truncated: true,
          reason: 'token_budget_exceeded',
        },
      };
    }

    return {
      root: slice.root,
      dependencies: slice.dependencies,
      edges: slice.edges,
      level: 4,
    };
  }

  private estimateTokens(slice: LogicSliceResult): number {
    // Rough estimate: ~4 chars per token
    let chars = this.symbolCharEstimate(slice.root);
    for (const dep of slice.dependencies) {
      chars += this.symbolCharEstimate(dep);
    }
    for (const edge of slice.edges) {
      chars += (edge.from.length + edge.to.length + edge.kind.length + 10);
    }
    return Math.ceil(chars / 4);
  }

  private symbolCharEstimate(node: SymbolNode): number {
    // Estimate based on line count (average ~40 chars per line)
    return (node.endLine - node.startLine + 1) * 40;
  }

  private truncateToTokenBudget(
    slice: LogicSliceResult,
    budget: number,
  ): { root: SymbolNode; dependencies: SymbolNode[]; edges: GraphEdge[] } {
    let currentTokens = this.symbolCharEstimate(slice.root) / 4;
    const deps: SymbolNode[] = [];
    const includedIds = new Set<string>([slice.root.symbolId]);

    for (const dep of slice.dependencies) {
      const depTokens = this.symbolCharEstimate(dep) / 4;
      if (currentTokens + depTokens > budget) break;
      currentTokens += depTokens;
      deps.push(dep);
      includedIds.add(dep.symbolId);
    }

    const edges = slice.edges.filter(
      (e) => includedIds.has(e.from) && includedIds.has(e.to),
    );

    return { root: slice.root, dependencies: deps, edges };
  }
}
