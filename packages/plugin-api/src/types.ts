export const SYMBOL_KINDS = [
  'function',
  'class',
  'interface',
  'method',
  'variable',
  'type',
  'table',
  'view',
  'procedure',
] as const;

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

/**
 * Symbol kinds that are data resources (protocol v2). Core analyses use this
 * list, never the literal 'table'. Every entry is also a symbol kind.
 */
export const DATA_RESOURCE_KINDS = ['table', 'view'] as const;

export type DataResourceKind = (typeof DATA_RESOURCE_KINDS)[number];

export const EDGE_KINDS = [
  'imports',
  'calls',
  'extends',
  'implements',
  'uses',
  'reads',
  'writes',
  'executes',
] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];

/**
 * Symbol ID format: "<relativeFile>::<name>::<kind>"
 * Example: "src/foo.ts::myFn::function"
 */
export type SymbolId = string;

/**
 * A host-language attribute or decorator attached to a symbol (protocol v2).
 * `name` is the attribute name as written, without namespace and without an
 * `Attribute` suffix. `named.type` is reserved: it carries the fully qualified
 * type name when known, and a source argument named `type` is dropped. Plugins
 * cap host-language attributes at 20 per symbol, 10 positional entries and at
 * most 10 named entries plus the reserved `type` per annotation, and 200
 * characters per value; longer values are truncated. `args` and `named` are
 * omitted when empty. Core checks shape only, not caps.
 */
export interface SymbolAnnotation {
  readonly name: string;
  readonly args?: readonly string[];
  readonly named?: Readonly<Record<string, string>>;
}

export interface SymbolNode {
  symbolId: SymbolId;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  startOffset?: number;
  endOffset?: number;
  /** Protocol v2. Always indexed; ignored by v1 cores. */
  readonly annotations?: readonly SymbolAnnotation[];
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
