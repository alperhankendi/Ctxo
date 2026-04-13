import type {
  SymbolNode,
  GraphEdge,
  ComplexityMetrics,
  SymbolKind,
  ILanguageAdapter,
} from '@ctxo/plugin-api';

/**
 * Minimal example adapter. Replace the parse + traverse logic with your
 * language's parser (tree-sitter, a compiler API, a WASM module, whatever).
 *
 * Every method must be safe against malformed input — ctxo calls adapters
 * on every file found via its extension list, including files that may
 * not actually parse. Return `[]` instead of throwing when in doubt;
 * unexpected throws surface in the user's index command output.
 */
export class ExampleAdapter implements ILanguageAdapter {
  /**
   * Cross-file symbol registry populated by ctxo during pass 1. You can
   * use it in extractEdges to resolve import targets to the actual symbol
   * kind (helps with find_importers edge aggregation).
   */
  private symbolRegistry = new Map<string, SymbolKind>();

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.symbolRegistry = registry;
  }

  isSupported(filePath: string): boolean {
    return filePath.endsWith('.example');
  }

  async extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    // TODO: replace with your real parser output. This stub scans line-by-line
    // for `declare <kind> <name>` and emits a symbol per match.
    const symbols: SymbolNode[] = [];
    const lines = source.split('\n');
    const pattern = /^\s*declare\s+(function|class|interface|method|variable|type)\s+(\w+)/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i]!.match(pattern);
      if (!match) continue;
      const [, kind, name] = match;
      symbols.push({
        symbolId: `${filePath}::${name}::${kind}`,
        name: name!,
        kind: kind as SymbolKind,
        startLine: i,
        endLine: i,
      });
    }
    return symbols;
  }

  async extractEdges(_filePath: string, _source: string): Promise<GraphEdge[]> {
    // TODO: parse imports/calls/extends/implements/uses relationships.
    // Use this.symbolRegistry to reason about what kind an external name has.
    return [];
  }

  async extractComplexity(_filePath: string, _source: string): Promise<ComplexityMetrics[]> {
    // TODO: compute cyclomatic complexity per symbol. Skip by returning [] —
    // ctxo treats absent complexity data as "unknown" and omits it from scoring.
    return [];
  }
}
