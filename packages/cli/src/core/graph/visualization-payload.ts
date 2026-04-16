import type { SymbolKind, EdgeKind } from '../types.js';

export interface VisNode {
  readonly id: string;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly file: string;
  readonly startLine: number;
  readonly layer: string;
  readonly pageRank: number;
  readonly isDead: boolean;
  readonly deadConfidence?: number;
  readonly deadReason?: string;
  readonly cyclomatic?: number;
  readonly hasAntiPattern: boolean;
  readonly inDegree: number;
  readonly outDegree: number;
  /**
   * Community assignment from the current Louvain snapshot. `-1` means
   * unassigned (symbol not present when the snapshot was computed).
   */
  readonly communityId: number;
  readonly communityLabel: string;
}

export interface VisEdge {
  readonly source: string;
  readonly target: string;
  readonly kind: EdgeKind;
  /**
   * Severity of the boundary violation this edge represents, when the
   * Louvain snapshot classifies it as cross-cluster rare. Absent for
   * normal edges.
   */
  readonly violationSeverity?: 'high' | 'medium';
}

export interface VisFileInfo {
  readonly file: string;
  readonly intent: readonly { hash: string; message: string; date: string }[];
  readonly antiPatterns: readonly { hash: string; message: string; date: string }[];
}

export interface VisCommunityLegend {
  readonly id: number;
  readonly label: string;
  readonly memberCount: number;
}

export interface VisualizationPayload {
  readonly projectName: string;
  readonly generatedAt: string;
  readonly totalSymbols: number;
  readonly shownSymbols: number;
  readonly nodes: VisNode[];
  readonly edges: VisEdge[];
  readonly layers: Record<string, string[]>;
  readonly files: VisFileInfo[];
  /**
   * Community metadata for legend + color mapping. Empty array when the
   * project has no community snapshot yet (e.g. --skip-community was used).
   */
  readonly communities: VisCommunityLegend[];
  /** Modularity score of the current snapshot, or 0 when unavailable. */
  readonly modularity: number;
  /** Number of violation edges in the full graph (pre-filter), for context. */
  readonly violationCount: number;
}
