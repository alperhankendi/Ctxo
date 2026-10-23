import { extname } from 'node:path';
import { extractSqlDefinitions } from '@ctxo/sql-extract';
import type { SqlDefinition, SqlFileExtraction } from '@ctxo/sql-extract';
import type { ComplexityMetrics, GraphEdge, ILanguageAdapter, SymbolNode } from '@ctxo/plugin-api';
import { createLogger } from './logger.js';

const log = createLogger('ctxo:lang-sql');

/** Orders by UTF-16 code unit, like the CLI's compareCodepoint and C#'s StringComparer.Ordinal. */
function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function symbolIdOf(filePath: string, def: SqlDefinition): string {
  return `${filePath}::${def.name}::${def.kind}`;
}

/** Targets use the canonical 2-part name; core resolves them across data resource kinds, procedures included. */
function targetOf(access: SqlDefinition['accesses'][number]): string {
  return access.kind === 'executes' ? `${access.name}::procedure` : `${access.name}::table`;
}

const NO_DEFINITIONS: SqlFileExtraction = { definitions: [] };

const MIB = 1024 * 1024;

/**
 * Largest `.sql` source the adapter extracts, in UTF-8 bytes of the decoded text (5 MiB). The
 * extraction holds every token of a file at once and grows the heap by about 30 times the file size,
 * which can exhaust it on seed scripts and schema dumps; a larger file is skipped with a warning.
 */
export const MAX_SQL_SOURCE_BYTES = 5 * MIB;

/** Mebibytes rounded up to one decimal, so a file just over the limit never reads as 5.0. */
function mebibytes(bytes: number): string {
  return (Math.ceil((bytes * 10) / MIB) / 10).toFixed(1);
}

/**
 * Syntax-tier adapter for `.sql` files. Definitions become table, view,
 * procedure and function symbols; the body of a view, procedure or function
 * becomes reads, writes and executes edges. SQL objects have no complexity
 * metrics, and calls to SQL functions are not edges. A source over
 * MAX_SQL_SOURCE_BYTES gives nothing and one warning.
 */
export class SqlAdapter implements ILanguageAdapter {
  readonly extensions = ['.sql'] as const;

  /**
   * One extraction per file, shared by extractSymbols and extractEdges; replaced when the source changes.
   * The core runs extractSymbols for every file first and extractEdges for every file second, so
   * extractEdges releases the entry: a batch index frees entries as it goes and a watch session keeps none.
   */
  private readonly extractions = new Map<string, { readonly source: string; readonly extraction: SqlFileExtraction }>();

  isSupported(filePath: string): boolean {
    return extname(filePath).toLowerCase() === '.sql';
  }

  async extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    return this.extract(filePath, source).definitions.map((def): SymbolNode => {
      const symbol: SymbolNode = {
        symbolId: symbolIdOf(filePath, def),
        name: def.declaredName,
        kind: def.kind,
        startLine: def.startLine,
        endLine: def.endLine,
        startOffset: def.startOffset,
        endOffset: def.endOffset,
      };
      if (def.kind === 'table' && def.columns.length > 0) {
        return { ...symbol, annotations: [{ name: 'columns', args: [...def.columns] }] };
      }
      return symbol;
    });
  }

  async extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    const edges: GraphEdge[] = [];
    const extraction = this.extract(filePath, source);
    this.extractions.delete(filePath);
    for (const def of extraction.definitions) {
      const from = symbolIdOf(filePath, def);
      for (const access of def.accesses) {
        if (access.name === def.name) continue; // a recursive procedure is not coupled to itself
        edges.push({ from, to: targetOf(access), kind: access.kind });
      }
    }
    return edges.sort(
      (a, b) => compareCodepoint(a.from, b.from) || compareCodepoint(a.kind, b.kind) || compareCodepoint(a.to, b.to),
    );
  }

  async extractComplexity(_filePath: string, _source: string): Promise<ComplexityMetrics[]> {
    return [];
  }

  async dispose(): Promise<void> {
    this.extractions.clear();
  }

  private extract(filePath: string, source: string): SqlFileExtraction {
    const cached = this.extractions.get(filePath);
    if (cached !== undefined && cached.source === source) return cached.extraction;
    const bytes = Buffer.byteLength(source, 'utf8');
    if (bytes > MAX_SQL_SOURCE_BYTES) {
      // Cached like a failure: the file and source warn once and yield no symbols or edges.
      log.warn(`skipped ${filePath}: ${mebibytes(bytes)} MiB is over the ${MAX_SQL_SOURCE_BYTES / MIB} MiB SQL size limit`);
      this.extractions.set(filePath, { source, extraction: NO_DEFINITIONS });
      return NO_DEFINITIONS;
    }
    try {
      const extraction = extractSqlDefinitions(source);
      this.extractions.set(filePath, { source, extraction });
      return extraction;
    } catch (err) {
      // Cache the empty result too, so the failure is logged once per file and source.
      log.error(`SQL extraction failed for ${filePath}: ${(err as Error).message}`);
      this.extractions.set(filePath, { source, extraction: NO_DEFINITIONS });
      return NO_DEFINITIONS;
    }
  }
}
