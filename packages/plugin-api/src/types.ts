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
  symbolId: SymbolId;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  startOffset?: number;
  endOffset?: number;
}

export interface GraphEdge {
  from: SymbolId;
  to: SymbolId;
  kind: EdgeKind;
  typeOnly?: boolean;
}

export interface ComplexityMetrics {
  symbolId: SymbolId;
  cyclomatic: number;
}
