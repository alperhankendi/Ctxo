import Parser from 'tree-sitter';
import type { Tree, SyntaxNode } from 'tree-sitter';
type Language = Parameters<InstanceType<typeof Parser>['setLanguage']>[0];
import { extname } from 'node:path';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '../../core/types.js';
import type { ILanguageAdapter } from '../../ports/i-language-adapter.js';

export abstract class TreeSitterAdapter implements ILanguageAdapter {
  abstract readonly extensions: readonly string[];
  readonly tier = 'syntax' as const;

  protected parser: Parser;
  protected symbolRegistry = new Map<string, SymbolKind>();

  constructor(language: Language) {
    this.parser = new Parser();
    this.parser.setLanguage(language);
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

  abstract extractSymbols(filePath: string, source: string): SymbolNode[];
  abstract extractEdges(filePath: string, source: string): GraphEdge[];
  abstract extractComplexity(filePath: string, source: string): ComplexityMetrics[];
}
