import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '../core/types.js';

export interface ILanguageAdapter {
  readonly extensions: readonly string[];
  readonly tier: 'full' | 'syntax';
  extractSymbols(filePath: string, source: string): Promise<SymbolNode[]>;
  extractEdges(filePath: string, source: string): Promise<GraphEdge[]>;
  extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]>;
  isSupported(filePath: string): boolean;
  setSymbolRegistry?(registry: Map<string, SymbolKind>): void;
  initialize?(rootDir: string): Promise<void>;
  dispose?(): Promise<void>;
}
