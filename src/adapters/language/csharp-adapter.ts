import CSharpLanguage from 'tree-sitter-c-sharp';
import type { SyntaxNode } from 'tree-sitter';
import { TreeSitterAdapter } from './tree-sitter-adapter.js';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '../../core/types.js';

const CSHARP_BRANCH_TYPES = [
  'if_statement', 'for_statement', 'foreach_statement',
  'while_statement', 'do_statement', 'switch_section',
  'catch_clause', 'conditional_expression',
];

export class CSharpAdapter extends TreeSitterAdapter {
  readonly extensions = ['.cs'] as const;

  constructor() {
    super(CSharpLanguage);
  }

  extractSymbols(filePath: string, source: string): SymbolNode[] {
    try {
      const tree = this.parse(source);
      const symbols: SymbolNode[] = [];
      this.visitSymbols(tree.rootNode, filePath, '', symbols);
      return symbols;
    } catch (err) {
      console.error(`[ctxo:csharp] Symbol extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  extractEdges(filePath: string, source: string): GraphEdge[] {
    try {
      const tree = this.parse(source);
      const edges: GraphEdge[] = [];
      const symbols = this.extractSymbols(filePath, source);
      const firstSymbol = symbols.length > 0 ? symbols[0]!.symbolId : undefined;
      if (!firstSymbol) return edges;

      this.visitEdges(tree.rootNode, filePath, firstSymbol, '', edges);
      return edges;
    } catch (err) {
      console.error(`[ctxo:csharp] Edge extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  extractComplexity(filePath: string, source: string): ComplexityMetrics[] {
    try {
      const tree = this.parse(source);
      const metrics: ComplexityMetrics[] = [];
      this.visitComplexity(tree.rootNode, filePath, '', metrics);
      return metrics;
    } catch (err) {
      console.error(`[ctxo:csharp] Complexity extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  // ── Symbol visitor ──────────────────────────────────────────

  private visitSymbols(
    node: SyntaxNode,
    filePath: string,
    namespace: string,
    symbols: SymbolNode[],
  ): void {
    if (node.type === 'namespace_declaration') {
      const name = node.childForFieldName('name')?.text ?? '';
      const ns = namespace ? `${namespace}.${name}` : name;
      for (let i = 0; i < node.childCount; i++) {
        this.visitSymbols(node.child(i)!, filePath, ns, symbols);
      }
      return;
    }

    if (node.type === 'declaration_list') {
      for (let i = 0; i < node.childCount; i++) {
        this.visitSymbols(node.child(i)!, filePath, namespace, symbols);
      }
      return;
    }

    const typeMapping: Record<string, SymbolKind> = {
      class_declaration: 'class',
      struct_declaration: 'class',
      record_declaration: 'class',
      interface_declaration: 'interface',
      enum_declaration: 'type',
    };

    const kind = typeMapping[node.type];
    if (kind) {
      if (!this.isPublic(node)) return;
      const name = node.childForFieldName('name')?.text;
      if (!name) return;

      const qualifiedName = namespace ? `${namespace}.${name}` : name;
      const range = this.nodeToLineRange(node);
      symbols.push({
        symbolId: this.buildSymbolId(filePath, qualifiedName, kind),
        name: qualifiedName,
        kind,
        ...range,
      });

      // Extract methods inside the class/struct/record
      if (kind === 'class') {
        this.extractMethodSymbols(node, filePath, qualifiedName, symbols);
      }
      return;
    }

    // Recurse into compilation_unit and other containers
    for (let i = 0; i < node.childCount; i++) {
      this.visitSymbols(node.child(i)!, filePath, namespace, symbols);
    }
  }

  private extractMethodSymbols(
    classNode: SyntaxNode,
    filePath: string,
    className: string,
    symbols: SymbolNode[],
  ): void {
    const declList = classNode.children.find(c => c.type === 'declaration_list');
    if (!declList) return;

    for (let i = 0; i < declList.childCount; i++) {
      const child = declList.child(i)!;
      if (child.type !== 'method_declaration' && child.type !== 'constructor_declaration') continue;
      if (!this.isPublic(child)) continue;

      const name = child.childForFieldName('name')?.text;
      if (!name) continue;

      const paramCount = this.countParameters(child);
      const qualifiedName = `${className}.${name}(${paramCount})`;
      const range = this.nodeToLineRange(child);
      symbols.push({
        symbolId: this.buildSymbolId(filePath, qualifiedName, 'method'),
        name: qualifiedName,
        kind: 'method',
        ...range,
      });
    }
  }

  // ── Edge visitor ────────────────────────────────────────────

  private visitEdges(
    node: SyntaxNode,
    filePath: string,
    fromSymbol: string,
    namespace: string,
    edges: GraphEdge[],
  ): void {
    if (node.type === 'using_directive') {
      const nameNode = node.children.find(c => c.type === 'identifier' || c.type === 'qualified_name');
      if (nameNode) {
        edges.push({
          from: fromSymbol,
          to: `${nameNode.text}::${nameNode.text.split('.').pop()}::variable`,
          kind: 'imports',
        });
      }
      return;
    }

    if (node.type === 'namespace_declaration') {
      const name = node.childForFieldName('name')?.text ?? '';
      const ns = namespace ? `${namespace}.${name}` : name;
      for (let i = 0; i < node.childCount; i++) {
        this.visitEdges(node.child(i)!, filePath, fromSymbol, ns, edges);
      }
      return;
    }

    if (node.type === 'class_declaration' || node.type === 'struct_declaration') {
      if (!this.isPublic(node)) return;
      const name = node.childForFieldName('name')?.text;
      if (!name) return;

      const qualifiedName = namespace ? `${namespace}.${name}` : name;
      const classSymbolId = this.buildSymbolId(filePath, qualifiedName, 'class');

      // Check base_list for extends/implements
      const baseList = node.children.find(c => c.type === 'base_list');
      if (baseList) {
        for (let i = 0; i < baseList.childCount; i++) {
          const child = baseList.child(i)!;
          if (child.type === 'identifier' || child.type === 'qualified_name') {
            const baseName = child.text;
            // Heuristic: I-prefix = interface → implements, otherwise extends
            const edgeKind = baseName.match(/^I[A-Z]/) ? 'implements' : 'extends';
            const targetKind = edgeKind === 'implements' ? 'interface' : 'class';
            edges.push({
              from: classSymbolId,
              to: this.resolveBaseType(baseName, namespace, targetKind),
              kind: edgeKind,
            });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.visitEdges(node.child(i)!, filePath, fromSymbol, namespace, edges);
    }
  }

  // ── Complexity visitor ──────────────────────────────────────

  private visitComplexity(
    node: SyntaxNode,
    filePath: string,
    namespace: string,
    metrics: ComplexityMetrics[],
  ): void {
    if (node.type === 'namespace_declaration') {
      const name = node.childForFieldName('name')?.text ?? '';
      const ns = namespace ? `${namespace}.${name}` : name;
      for (let i = 0; i < node.childCount; i++) {
        this.visitComplexity(node.child(i)!, filePath, ns, metrics);
      }
      return;
    }

    const typeMapping: Record<string, true> = {
      class_declaration: true,
      struct_declaration: true,
      record_declaration: true,
    };

    if (typeMapping[node.type]) {
      if (!this.isPublic(node)) return;
      const className = node.childForFieldName('name')?.text;
      if (!className) return;

      const qualifiedClass = namespace ? `${namespace}.${className}` : className;
      const declList = node.children.find(c => c.type === 'declaration_list');
      if (!declList) return;

      for (let i = 0; i < declList.childCount; i++) {
        const child = declList.child(i)!;
        if (child.type !== 'method_declaration') continue;
        if (!this.isPublic(child)) continue;

        const methodName = child.childForFieldName('name')?.text;
        if (!methodName) continue;

        const paramCount = this.countParameters(child);
        metrics.push({
          symbolId: this.buildSymbolId(filePath, `${qualifiedClass}.${methodName}(${paramCount})`, 'method'),
          cyclomatic: this.countCyclomaticComplexity(child, CSHARP_BRANCH_TYPES),
        });
      }
      return;
    }

    for (let i = 0; i < node.childCount; i++) {
      this.visitComplexity(node.child(i)!, filePath, namespace, metrics);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private countParameters(methodNode: SyntaxNode): number {
    const paramList = methodNode.childForFieldName('parameters');
    if (!paramList) return 0;
    let count = 0;
    for (let i = 0; i < paramList.childCount; i++) {
      if (paramList.child(i)!.type === 'parameter') count++;
    }
    return count;
  }

  private isPublic(node: SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === 'modifier' && child.text === 'public') return true;
    }
    return false;
  }

  private resolveBaseType(baseName: string, namespace: string, defaultKind: SymbolKind): string {
    // Check symbol registry first
    const prefix = namespace ? `${namespace}.${baseName}` : baseName;
    for (const [id] of this.symbolRegistry) {
      if (id.includes(`::${prefix}::`)) return id;
      if (id.includes(`::${baseName}::`)) return id;
    }
    // Fallback: assume same namespace
    const qualifiedName = namespace ? `${namespace}.${baseName}` : baseName;
    return `${qualifiedName}::${baseName}::${defaultKind}`;
  }
}
