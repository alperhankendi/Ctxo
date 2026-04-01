import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '../core/types.js';

export interface ILanguageAdapter {
  readonly extensions: readonly string[];
  readonly tier: 'full' | 'syntax';
  extractSymbols(filePath: string, source: string): SymbolNode[];
  extractEdges(filePath: string, source: string): GraphEdge[];
  extractComplexity(filePath: string, source: string): ComplexityMetrics[];
  isSupported(filePath: string): boolean;
  setSymbolRegistry?(registry: Map<string, SymbolKind>): void;
}
