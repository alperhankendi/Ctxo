export const SYMBOL_KINDS = [
  'function',
  'class',
  'interface',
  'method',
  'variable',
  'type',
] as const;

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export const EDGE_KINDS = [
  'imports',
  'calls',
  'extends',
  'implements',
  'uses',
] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];

/**
 * Symbol ID format: "<relativeFile>::<name>::<kind>"
 * Example: "src/foo.ts::myFn::function"
 */
export type SymbolId = string;

export interface SymbolNode {
  readonly symbolId: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly startOffset?: number;
  readonly endOffset?: number;
}

export interface GraphEdge {
  readonly from: SymbolId;
  readonly to: SymbolId;
  readonly kind: EdgeKind;
  readonly typeOnly?: boolean;
}

export interface ComplexityMetrics {
  readonly symbolId: SymbolId;
  readonly cyclomatic: number;
}
