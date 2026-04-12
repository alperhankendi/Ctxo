import GoLanguage from 'tree-sitter-go';
import type { SyntaxNode } from 'tree-sitter';
import { TreeSitterAdapter } from './tree-sitter-adapter.js';
import type { SymbolNode, GraphEdge, ComplexityMetrics } from '../../core/types.js';

const GO_BRANCH_TYPES = [
  'if_statement', 'for_statement',
  'expression_switch_statement', 'type_switch_statement',
  'expression_case', 'type_case',
  'select_statement', 'communication_case',
];

export class GoAdapter extends TreeSitterAdapter {
  readonly extensions = ['.go'] as const;

  constructor() {
    super(GoLanguage);
  }

  async extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    try {
      const tree = this.parse(source);
      const symbols: SymbolNode[] = [];

      for (let i = 0; i < tree.rootNode.childCount; i++) {
        const node = tree.rootNode.child(i)!;

        if (node.type === 'function_declaration') {
          const name = node.childForFieldName('name')?.text;
          if (!name || !this.isExported(name)) continue;
          const range = this.nodeToLineRange(node);
          symbols.push({
            symbolId: this.buildSymbolId(filePath, name, 'function'),
            name,
            kind: 'function',
            ...range,
          });
        }

        if (node.type === 'method_declaration') {
          const methodName = node.childForFieldName('name')?.text;
          if (!methodName || !this.isExported(methodName)) continue;
          const receiverType = this.extractReceiverType(node);
          const qualifiedName = receiverType ? `${receiverType}.${methodName}` : methodName;
          const range = this.nodeToLineRange(node);
          symbols.push({
            symbolId: this.buildSymbolId(filePath, qualifiedName, 'method'),
            name: qualifiedName,
            kind: 'method',
            ...range,
          });
        }

        if (node.type === 'type_declaration') {
          this.extractTypeSymbols(node, filePath, symbols);
        }
      }

      return symbols;
    } catch (err) {
      console.error(`[ctxo:go] Symbol extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  async extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    try {
      const tree = this.parse(source);
      const edges: GraphEdge[] = [];
      const firstExportedSymbol = this.findFirstExportedSymbolId(tree.rootNode, filePath);
      if (!firstExportedSymbol) return edges;

      for (let i = 0; i < tree.rootNode.childCount; i++) {
        const node = tree.rootNode.child(i)!;

        if (node.type === 'import_declaration') {
          this.extractImportEdges(node, filePath, firstExportedSymbol, edges);
        }
      }

      return edges;
    } catch (err) {
      console.error(`[ctxo:go] Edge extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  async extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    try {
      const tree = this.parse(source);
      const metrics: ComplexityMetrics[] = [];

      for (let i = 0; i < tree.rootNode.childCount; i++) {
        const node = tree.rootNode.child(i)!;

        if (node.type === 'function_declaration') {
          const name = node.childForFieldName('name')?.text;
          if (!name || !this.isExported(name)) continue;
          metrics.push({
            symbolId: this.buildSymbolId(filePath, name, 'function'),
            cyclomatic: this.countCyclomaticComplexity(node, GO_BRANCH_TYPES),
          });
        }

        if (node.type === 'method_declaration') {
          const methodName = node.childForFieldName('name')?.text;
          if (!methodName || !this.isExported(methodName)) continue;
          const receiverType = this.extractReceiverType(node);
          const qualifiedName = receiverType ? `${receiverType}.${methodName}` : methodName;
          metrics.push({
            symbolId: this.buildSymbolId(filePath, qualifiedName, 'method'),
            cyclomatic: this.countCyclomaticComplexity(node, GO_BRANCH_TYPES),
          });
        }
      }

      return metrics;
    } catch (err) {
      console.error(`[ctxo:go] Complexity extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  private isExported(name: string): boolean {
    return name.length > 0 && name[0]! === name[0]!.toUpperCase() && name[0]! !== name[0]!.toLowerCase();
  }

  private extractReceiverType(methodNode: SyntaxNode): string | undefined {
    // method_declaration has parameter_list as first child (receiver)
    const params = methodNode.child(1);
    if (params?.type !== 'parameter_list') return undefined;

    for (let i = 0; i < params.childCount; i++) {
      const param = params.child(i)!;
      if (param.type === 'parameter_declaration') {
        // Find type identifier — may be pointer (*Type) or plain (Type)
        const typeNode = param.childForFieldName('type');
        if (typeNode) {
          const text = typeNode.text;
          return text.replace(/^\*/, '');
        }
      }
    }
    return undefined;
  }

  private extractTypeSymbols(typeDecl: SyntaxNode, filePath: string, symbols: SymbolNode[]): void {
    for (let i = 0; i < typeDecl.childCount; i++) {
      const spec = typeDecl.child(i)!;
      if (spec.type !== 'type_spec') continue;

      const name = spec.childForFieldName('name')?.text;
      if (!name || !this.isExported(name)) continue;

      // Determine kind from the type body
      const typeBody = spec.childForFieldName('type');
      let kind: 'class' | 'interface' | 'type' = 'type';
      if (typeBody?.type === 'struct_type') kind = 'class';
      else if (typeBody?.type === 'interface_type') kind = 'interface';

      const range = this.nodeToLineRange(spec);
      symbols.push({
        symbolId: this.buildSymbolId(filePath, name, kind),
        name,
        kind,
        ...range,
      });
    }
  }

  private extractImportEdges(
    importDecl: SyntaxNode,
    _filePath: string,
    fromSymbol: string,
    edges: GraphEdge[],
  ): void {
    const visit = (node: SyntaxNode) => {
      if (node.type === 'import_spec') {
        const pathNode = node.childForFieldName('path') ?? node.child(0);
        if (pathNode) {
          const importPath = pathNode.text.replace(/"/g, '');
          edges.push({
            from: fromSymbol,
            to: `${importPath}::${importPath.split('/').pop()}::variable`,
            kind: 'imports',
          });
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        visit(node.child(i)!);
      }
    };
    visit(importDecl);
  }

  private findFirstExportedSymbolId(rootNode: SyntaxNode, filePath: string): string | undefined {
    for (let i = 0; i < rootNode.childCount; i++) {
      const node = rootNode.child(i)!;

      if (node.type === 'function_declaration') {
        const name = node.childForFieldName('name')?.text;
        if (name && this.isExported(name)) return this.buildSymbolId(filePath, name, 'function');
      }
      if (node.type === 'type_declaration') {
        for (let j = 0; j < node.childCount; j++) {
          const spec = node.child(j)!;
          if (spec.type === 'type_spec') {
            const name = spec.childForFieldName('name')?.text;
            if (name && this.isExported(name)) {
              const typeBody = spec.childForFieldName('type');
              const kind = typeBody?.type === 'struct_type' ? 'class' : typeBody?.type === 'interface_type' ? 'interface' : 'type';
              return this.buildSymbolId(filePath, name, kind);
            }
          }
        }
      }
    }
    return undefined;
  }
}
