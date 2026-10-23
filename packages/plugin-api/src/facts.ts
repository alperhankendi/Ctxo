import type { SymbolId } from './types.js';

export const FACT_KINDS = [
  'literal-comparison',
  'normalization',
  'retry-timeout',
  'endpoint',
] as const;

export type FactKind = (typeof FACT_KINDS)[number];

/**
 * A code fact extracted from a symbol body (protocol v2). Produced only when
 * the host requests facts.
 */
export interface CodeFact {
  readonly kind: FactKind;
  readonly symbolId: SymbolId;
  /** 0-based line, like `SymbolNode.startLine`. */
  readonly line: number;
  /** Single-line, trimmed, at most 200 characters. */
  readonly text: string;
  readonly detail?: Readonly<Record<string, string>>;
}
