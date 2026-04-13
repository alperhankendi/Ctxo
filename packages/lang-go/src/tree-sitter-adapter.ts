import Parser from 'tree-sitter';
import type { Tree, SyntaxNode } from 'tree-sitter';
// Grammars (tree-sitter-go etc.) ship their own Language type which can drift
// against tree-sitter's parameter type across major versions. Accept any
// structurally compatible value and hand it to the parser as the runtime API
// expects (the parser does its own validation).
type Language = Parameters<InstanceType<typeof Parser>['setLanguage']>[0] | object;
import { extname } from 'node:path';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, ILanguageAdapter } from '@ctxo/plugin-api';

export abstract class TreeSitterAdapter implements ILanguageAdapter {
  abstract readonly extensions: readonly string[];
  readonly tier = 'syntax' as const;

  protected parser: Parser;
  protected symbolRegistry = new Map<string, SymbolKind>();

  constructor(language: Language) {
    this.parser = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.parser.setLanguage(language as any);
  }

  isSupported(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return (this.extensions as readonly string[]).includes(ext);
  }

  setSymbolRegistry(registry: Map<string, SymbolKind>): void {
    this.symbolRegistry = registry;
  }

  protected parse(source: string): Tree {
    return this.parser.parse(source);
  }

  protected buildSymbolId(filePath: string, name: string, kind: SymbolKind): string {
    return `${filePath}::${name}::${kind}`;
  }

  protected nodeToLineRange(node: SyntaxNode): {
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  } {
    return {
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startOffset: node.startIndex,
      endOffset: node.endIndex,
    };
  }

  protected countCyclomaticComplexity(node: SyntaxNode, branchTypes: string[]): number {
    let complexity = 1;
    const visit = (n: SyntaxNode) => {
      if (branchTypes.includes(n.type)) {
        complexity++;
      }
      for (let i = 0; i < n.childCount; i++) {
        visit(n.child(i)!);
      }
    };
    visit(node);
    return complexity;
  }

  abstract extractSymbols(filePath: string, source: string): Promise<SymbolNode[]>;
  abstract extractEdges(filePath: string, source: string): Promise<GraphEdge[]>;
  abstract extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]>;
}
