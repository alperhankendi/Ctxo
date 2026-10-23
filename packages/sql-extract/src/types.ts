export type SqlTokenKind = 'word' | 'quoted' | 'string' | 'number' | 'variable' | 'punct' | 'batch';

export interface SqlToken {
  readonly kind: SqlTokenKind;
  /** Raw source slice. */
  readonly text: string;
  /** Word as written (temp names keep '#'); quoted: delimiters removed, doubled closers collapsed; string: content. */
  readonly value: string;
  /** UTF-16 offsets into the source. */
  readonly start: number;
  readonly end: number;
  /** 0-based line of the token start. */
  readonly line: number;
}

export type SqlObjectKind = 'table' | 'view' | 'procedure' | 'function';

export type SqlAccessKind = 'reads' | 'writes' | 'executes';

export interface SqlAccess {
  readonly kind: SqlAccessKind;
  /** Canonical 2-part name: `schema.name`, ASCII A-Z folded, `dbo` when no schema is written. */
  readonly name: string;
}

export interface SqlDefinition {
  readonly kind: SqlObjectKind;
  /** Canonical 2-part name. */
  readonly name: string;
  /** The name as declared: delimiters removed, case kept, no schema added. */
  readonly declaredName: string;
  /** 0-based lines of the first and the last token of the definition. */
  readonly startLine: number;
  readonly endLine: number;
  /** UTF-16 offsets into the source; endOffset is exclusive. */
  readonly startOffset: number;
  readonly endOffset: number;
  /** Table columns, sorted, unique and ASCII-folded; [] for other kinds. */
  readonly columns: readonly string[];
  /** Accesses of a view, procedure or function body, unique and sorted by kind, then name; [] for tables. */
  readonly accesses: readonly SqlAccess[];
}

export interface SqlFileExtraction {
  /** Definitions in source order; a merged definition keeps the place of its first occurrence. */
  readonly definitions: readonly SqlDefinition[];
}

/** `statement`: SQL text as code sends it. `procedureName`: the name of a procedure to execute. */
export type SqlTextKind = 'statement' | 'procedureName';
