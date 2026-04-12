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
}

export interface VisEdge {
  readonly source: string;
  readonly target: string;
  readonly kind: EdgeKind;
}

export interface VisFileInfo {
  readonly file: string;
  readonly intent: readonly { hash: string; message: string; date: string }[];
  readonly antiPatterns: readonly { hash: string; message: string; date: string }[];
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
}
