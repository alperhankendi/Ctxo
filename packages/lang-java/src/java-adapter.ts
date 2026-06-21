import JavaLanguage from 'tree-sitter-java';
import type { SyntaxNode } from 'tree-sitter';
import { TreeSitterAdapter } from './tree-sitter-adapter.js';
import { createLogger } from './logger.js';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '@ctxo/plugin-api';

const log = createLogger('ctxo:lang-java');

/** Java declaration node type -> Ctxo SymbolKind. */
const TYPE_DECL_KIND: Record<string, SymbolKind> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'type',
  record_declaration: 'class',
  annotation_type_declaration: 'interface',
};

/**
 * Branch node types for cyclomatic complexity per the tree-sitter-java 0.23.x grammar.
 * Spike-verified names:
 *   - switch uses `switch_expression` (not switch_statement); `switch_label` inside switch_block_statement_group
 *   - enhanced_for_statement confirmed
 */
const JAVA_BRANCH_TYPES = [
  'if_statement',
  'for_statement',
  'enhanced_for_statement',
  'while_statement',
  'do_statement',
  'switch_label',
  'catch_clause',
  'ternary_expression',
];

export class JavaAdapter extends TreeSitterAdapter {
  readonly extensions = ['.java'] as const;

  constructor() {
    super(JavaLanguage);
  }

  // ── Task 4: extractSymbols ──────────────────────────────────

  async extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    try {
      const tree = this.parse(source);
      const symbols: SymbolNode[] = [];
      this.walkTypeDecls(tree.rootNode, filePath, symbols);
      return symbols;
    } catch (err) {
      log.error(`Symbol extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  private walkTypeDecls(node: SyntaxNode, filePath: string, out: SymbolNode[]): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      const kind = TYPE_DECL_KIND[child.type];
      if (kind) {
        const name = child.childForFieldName('name')?.text;
        if (name) {
          out.push({
            symbolId: this.buildSymbolId(filePath, name, kind),
            name,
            kind,
            ...this.nodeToLineRange(child),
          });
        }
        // Extract members from the body field. Spike: body field names differ per type:
        //   class_declaration     -> body=class_body
        //   interface_declaration -> body=interface_body
        //   enum_declaration      -> body=enum_body
        //   record_declaration    -> body=class_body
        //   annotation_type_declaration -> body=annotation_type_body
        const body = child.childForFieldName('body');
        if (body) this.extractMembers(body, filePath, out);
      }
      // Recurse to handle nested types
      this.walkTypeDecls(child, filePath, out);
    }
  }

  private extractMembers(body: SyntaxNode, filePath: string, out: SymbolNode[]): void {
    for (let i = 0; i < body.childCount; i++) {
      const member = body.child(i)!;
      if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
        // Spike: both have field name=identifier
        const name = member.childForFieldName('name')?.text;
        if (name) {
          out.push({
            symbolId: this.buildSymbolId(filePath, name, 'method'),
            name,
            kind: 'method',
            ...this.nodeToLineRange(member),
          });
        }
      } else if (member.type === 'field_declaration') {
        // Spike: field_declaration has field declarator=variable_declarator
        // There can be multiple declarators (e.g. int a, b;) — iterate all children of that type
        for (let j = 0; j < member.childCount; j++) {
          const decl = member.child(j)!;
          if (decl.type === 'variable_declarator') {
            // Spike: variable_declarator has field name=identifier
            const name = decl.childForFieldName('name')?.text;
            if (name) {
              out.push({
                symbolId: this.buildSymbolId(filePath, name, 'variable'),
                name,
                kind: 'variable',
                ...this.nodeToLineRange(member),
              });
            }
          }
        }
      }
    }
  }

  // ── Task 5: extractEdges ────────────────────────────────────

  async extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    try {
      const tree = this.parse(source);
      const edges: GraphEdge[] = [];
      const imports = this.collectImports(tree.rootNode);
      const anchor = this.firstTypeSymbolId(tree.rootNode, filePath);
      if (anchor) {
        for (const path of imports) {
          const lastSegment = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : path;
          edges.push({ from: anchor, to: `${path}::${lastSegment}::class`, kind: 'imports' });
        }
      }
      this.walkTypeEdges(tree.rootNode, filePath, edges);
      return edges;
    } catch (err) {
      log.error(`Edge extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  /** Return the symbolId of the first top-level type declaration in the file, or undefined. */
  private firstTypeSymbolId(root: SyntaxNode, filePath: string): string | undefined {
    let found: string | undefined;
    const visit = (n: SyntaxNode) => {
      if (found) return;
      const kind = TYPE_DECL_KIND[n.type];
      if (kind) {
        const name = n.childForFieldName('name')?.text;
        if (name) { found = this.buildSymbolId(filePath, name, kind); return; }
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i)!);
    };
    visit(root);
    return found;
  }

  /**
   * Resolve a potentially-dotted type name to a Ctxo symbolId.
   * Uses the symbolRegistry for known kinds; falls back to fallbackKind.
   */
  private resolveTypeId(name: string, fallbackKind: SymbolKind): string {
    const last = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    const kind = this.symbolRegistry.get(last) ?? fallbackKind;
    return `${last}::${kind}`;
  }

  /**
   * Collect import paths from top-level import_declaration nodes.
   * Spike: import_declaration children include scoped_identifier or identifier for the path.
   */
  private collectImports(root: SyntaxNode): string[] {
    const paths: string[] = [];
    for (let i = 0; i < root.childCount; i++) {
      const node = root.child(i)!;
      if (node.type === 'import_declaration') {
        // Named children of import_declaration: the path is a scoped_identifier or identifier
        const nameNode = node.namedChildren.find(
          (c) => c.type === 'scoped_identifier' || c.type === 'identifier',
        );
        if (nameNode) paths.push(nameNode.text);
      }
    }
    return paths;
  }

  private walkTypeEdges(
    node: SyntaxNode,
    filePath: string,
    out: GraphEdge[],
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      const kind = TYPE_DECL_KIND[child.type];
      if (kind) {
        const name = child.childForFieldName('name')?.text;
        if (name) {
          const from = this.buildSymbolId(filePath, name, kind);

          if (child.type === 'class_declaration') {
            // Spike: class_declaration field superclass=superclass (child node of type "superclass")
            const superclassNode = child.childForFieldName('superclass');
            if (superclassNode) {
              for (const t of this.typeNames(superclassNode)) {
                out.push({ from, to: this.resolveTypeId(t, 'class'), kind: 'extends' });
              }
            }

            // Spike: class_declaration field interfaces=super_interfaces
            const implNode = child.childForFieldName('interfaces');
            if (implNode) {
              for (const t of this.typeNames(implNode)) {
                out.push({ from, to: this.resolveTypeId(t, 'interface'), kind: 'implements' });
              }
            }
          }

          if (child.type === 'interface_declaration') {
            // Spike: interface_declaration does NOT have an 'interfaces' field.
            // extends is via a CHILD NODE of type 'extends_interfaces' (not a named field).
            for (let j = 0; j < child.childCount; j++) {
              const c = child.child(j)!;
              if (c.type === 'extends_interfaces') {
                for (const t of this.typeNames(c)) {
                  out.push({ from, to: this.resolveTypeId(t, 'interface'), kind: 'extends' });
                }
              }
            }
          }
        }
      }
      // Recurse for nested types
      this.walkTypeEdges(child, filePath, out);
    }
  }

  /** Collect all type_identifier and scoped_type_identifier texts recursively under a node. */
  private typeNames(node: SyntaxNode): string[] {
    const names: string[] = [];
    const visit = (n: SyntaxNode) => {
      if (n.type === 'type_identifier' || n.type === 'scoped_type_identifier') {
        names.push(n.text);
      } else {
        for (let i = 0; i < n.childCount; i++) visit(n.child(i)!);
      }
    };
    visit(node);
    return names;
  }

  // ── Task 6: extractComplexity ───────────────────────────────

  async extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    try {
      const tree = this.parse(source);
      const metrics: ComplexityMetrics[] = [];
      const visit = (node: SyntaxNode) => {
        if (node.type === 'method_declaration' || node.type === 'constructor_declaration') {
          const name = node.childForFieldName('name')?.text;
          if (name) {
            const cyclomatic =
              this.countCyclomaticComplexity(node, JAVA_BRANCH_TYPES) +
              this.countLogicalOperators(node);
            metrics.push({
              symbolId: this.buildSymbolId(filePath, name, 'method'),
              cyclomatic,
            });
          }
        }
        for (let i = 0; i < node.childCount; i++) visit(node.child(i)!);
      };
      visit(tree.rootNode);
      return metrics;
    } catch (err) {
      log.error(`Complexity extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Count && and || binary_expression operators for cyclomatic complexity.
   * Spike: binary_expression children include operator nodes with type '&&' or '||'.
   */
  private countLogicalOperators(node: SyntaxNode): number {
    let count = 0;
    const visit = (n: SyntaxNode) => {
      if (n.type === 'binary_expression') {
        const op = n.children.find((c) => c.type === '&&' || c.type === '||');
        if (op) count++;
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i)!);
    };
    visit(node);
    return count;
  }
}
