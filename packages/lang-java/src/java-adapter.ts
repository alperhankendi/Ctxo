import JavaLanguage from 'tree-sitter-java';
import type { SyntaxNode } from 'tree-sitter';
import { TreeSitterAdapter } from './tree-sitter-adapter.js';
import { createLogger } from './logger.js';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind } from '@ctxo/plugin-api';

const log = createLogger('ctxo:lang-java');

/**
 * Tree-sitter node types that increment cyclomatic complexity.
 * `&&` and `||` short-circuit operators are handled in the base class.
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

/** Top-level type-like declarations that own a method namespace. */
const TYPE_DECLARATIONS = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
]);

export class JavaAdapter extends TreeSitterAdapter {
  readonly extensions = ['.java'] as const;

  constructor() {
    super(JavaLanguage);
  }

  async extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
    try {
      const tree = this.parse(source);
      const symbols: SymbolNode[] = [];
      this.walkTypes(tree.rootNode, filePath, symbols, []);
      return symbols;
    } catch (err) {
      log.error(`Symbol extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  async extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    try {
      const tree = this.parse(source);
      const edges: GraphEdge[] = [];

      const firstType = this.findFirstTypeSymbolId(tree.rootNode, filePath);

      // Imports: anchored on the first declared top-level type.
      // Files with no top-level type (e.g. `package-info.java`) have no anchor;
      // imports edges are skipped in that case (mirrors lang-go's behavior).
      for (let i = 0; i < tree.rootNode.childCount; i++) {
        const node = tree.rootNode.child(i)!;
        if (node.type === 'import_declaration' && firstType) {
          const importEdge = this.buildImportEdge(node, firstType);
          if (importEdge) edges.push(importEdge);
        }
      }

      // extends / implements edges per type declaration.
      this.walkTypeRelations(tree.rootNode, filePath, edges, []);

      return edges;
    } catch (err) {
      log.error(`Edge extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  async extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
    try {
      const tree = this.parse(source);
      const metrics: ComplexityMetrics[] = [];
      this.walkMethods(tree.rootNode, filePath, [], (qualifiedName, kind, methodNode) => {
        metrics.push({
          symbolId: this.buildSymbolId(filePath, qualifiedName, kind),
          cyclomatic: this.countCyclomaticComplexity(methodNode, JAVA_BRANCH_TYPES),
        });
      });
      return metrics;
    } catch (err) {
      log.error(`Complexity extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  private typeKindFor(nodeType: string): SymbolKind {
    switch (nodeType) {
      case 'interface_declaration':
        return 'interface';
      case 'class_declaration':
      case 'enum_declaration':
      case 'record_declaration':
      default:
        return 'class';
    }
  }

  /**
   * Recursively visit type-like declarations (including nested types) and
   * record their symbols plus contained methods/constructors.
   *
   * `enclosing` is the chain of outer type names, used to qualify nested
   * type and method names: `Outer.Inner`, `Outer.Inner.method`.
   */
  private walkTypes(
    node: SyntaxNode,
    filePath: string,
    out: SymbolNode[],
    enclosing: string[],
  ): void {
    if (TYPE_DECLARATIONS.has(node.type)) {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const qualified = [...enclosing, name].join('.');
        const kind = this.typeKindFor(node.type);
        const range = this.nodeToLineRange(node);
        out.push({
          symbolId: this.buildSymbolId(filePath, qualified, kind),
          name: qualified,
          kind,
          ...range,
        });

        // Methods and constructors inside this type.
        const body = node.childForFieldName('body');
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            const member = body.child(i)!;
            if (member.type === 'method_declaration') {
              const methodName = member.childForFieldName('name')?.text;
              if (!methodName) continue;
              const qname = `${qualified}.${methodName}`;
              const r = this.nodeToLineRange(member);
              out.push({
                symbolId: this.buildSymbolId(filePath, qname, 'method'),
                name: qname,
                kind: 'method',
                ...r,
              });
            } else if (member.type === 'constructor_declaration') {
              // Constructor name is the same as the enclosing class name.
              const ctorName = `${qualified}.${name}`;
              const r = this.nodeToLineRange(member);
              out.push({
                symbolId: this.buildSymbolId(filePath, ctorName, 'method'),
                name: ctorName,
                kind: 'method',
                ...r,
              });
            } else if (TYPE_DECLARATIONS.has(member.type)) {
              this.walkTypes(member, filePath, out, [...enclosing, name]);
            }
          }
        }
        return;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkTypes(node.child(i)!, filePath, out, enclosing);
    }
  }

  /**
   * Yield every method/constructor with its qualified name and kind so callers
   * can produce per-symbol records (e.g. complexity metrics).
   */
  private walkMethods(
    node: SyntaxNode,
    filePath: string,
    enclosing: string[],
    visit: (qualifiedName: string, kind: SymbolKind, methodNode: SyntaxNode) => void,
  ): void {
    if (TYPE_DECLARATIONS.has(node.type)) {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const qualified = [...enclosing, name].join('.');
        const body = node.childForFieldName('body');
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            const member = body.child(i)!;
            if (member.type === 'method_declaration') {
              const methodName = member.childForFieldName('name')?.text;
              if (methodName) {
                visit(`${qualified}.${methodName}`, 'method', member);
              }
            } else if (member.type === 'constructor_declaration') {
              visit(`${qualified}.${name}`, 'method', member);
            } else if (TYPE_DECLARATIONS.has(member.type)) {
              this.walkMethods(member, filePath, [...enclosing, name], visit);
            }
          }
        }
        return;
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      this.walkMethods(node.child(i)!, filePath, enclosing, visit);
    }
  }

  /** Emit `extends`/`implements` edges for each top-level or nested type. */
  private walkTypeRelations(
    node: SyntaxNode,
    filePath: string,
    edges: GraphEdge[],
    enclosing: string[],
  ): void {
    if (TYPE_DECLARATIONS.has(node.type)) {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const qualified = [...enclosing, name].join('.');
        const kind = this.typeKindFor(node.type);
        const fromId = this.buildSymbolId(filePath, qualified, kind);

        // class extends Foo
        const superclass = node.childForFieldName('superclass');
        if (superclass) {
          for (const typeName of this.typeNamesIn(superclass)) {
            edges.push({
              from: fromId,
              to: this.resolveTypeTarget(typeName, 'class'),
              kind: 'extends',
            });
          }
        }

        // class implements Foo, Bar
        const interfaces = node.childForFieldName('interfaces');
        if (interfaces) {
          for (const typeName of this.typeNamesIn(interfaces)) {
            edges.push({
              from: fromId,
              to: this.resolveTypeTarget(typeName, 'interface'),
              kind: 'implements',
            });
          }
        }

        // interface extends Foo, Bar  (tree-sitter exposes this as a child
        // node of type `extends_interfaces`, not a labeled field).
        if (node.type === 'interface_declaration') {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i)!;
            if (c.type === 'extends_interfaces') {
              for (const typeName of this.typeNamesIn(c)) {
                edges.push({
                  from: fromId,
                  to: this.resolveTypeTarget(typeName, 'interface'),
                  kind: 'extends',
                });
              }
            }
          }
        }

        // Recurse into the body to capture nested types.
        const body = node.childForFieldName('body');
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            const member = body.child(i)!;
            if (TYPE_DECLARATIONS.has(member.type)) {
              this.walkTypeRelations(member, filePath, edges, [...enclosing, name]);
            }
          }
        }
        return;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.walkTypeRelations(node.child(i)!, filePath, edges, enclosing);
    }
  }

  private typeNamesIn(node: SyntaxNode): string[] {
    const out: string[] = [];
    const visit = (n: SyntaxNode) => {
      if (n.type === 'type_identifier' || n.type === 'scoped_type_identifier') {
        out.push(n.text);
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        visit(n.child(i)!);
      }
    };
    visit(node);
    return out;
  }

  /**
   * Build an `imports` edge from an import_declaration node, anchored at
   * `fromId`. Returns `undefined` when the import does not point to a
   * resolvable type target (currently: wildcard imports `import x.*;`).
   *
   * Static imports of members (`import static java.lang.Math.PI;`) are
   * normalized to the enclosing class (`java.lang.Math`).
   */
  private buildImportEdge(importDecl: SyntaxNode, fromId: string): GraphEdge | undefined {
    let target: string | undefined;
    let isStatic = false;
    let isWildcard = false;

    for (let i = 0; i < importDecl.childCount; i++) {
      const c = importDecl.child(i)!;
      if (c.type === 'static') isStatic = true;
      if (c.type === 'asterisk' || c.text === '*') isWildcard = true;
      if (c.type === 'scoped_identifier' || c.type === 'identifier') {
        target = c.text;
      }
    }

    if (!target) return undefined;

    // Wildcard imports (`import x.y.*;`) carry no specific target — skip.
    if (isWildcard) return undefined;

    // Static member import: drop trailing member to point at the enclosing class.
    // `java.lang.Math.PI` → `java.lang.Math`
    let resolvedTarget = target;
    if (isStatic) {
      const lastDot = target.lastIndexOf('.');
      if (lastDot > 0) resolvedTarget = target.slice(0, lastDot);
    }

    const baseName = resolvedTarget.split('.').pop()!;
    return {
      from: fromId,
      to: this.resolveImportTarget(resolvedTarget, baseName),
      kind: 'imports',
    };
  }

  /**
   * Resolve a referenced type to a concrete symbol ID.
   *
   * Strategy mirrors `lang-csharp` — walk the cross-file `symbolRegistry`
   * (populated by the indexer in pass 1) for any symbol whose ID ends with
   * `::TypeName::kind`. Falls back to a name-keyed ID `Name::Name::kind`
   * which the SymbolGraph fuzzy resolver can still grep against later.
   */
  private resolveTypeTarget(typeName: string, defaultKind: SymbolKind): string {
    // Strip generic args (`Foo<Bar>` → `Foo`)
    const bare = typeName.replace(/<.*$/, '').trim();
    if (this.symbolRegistry.size > 0) {
      for (const [id] of this.symbolRegistry) {
        if (id.endsWith(`::${bare}::class`) || id.endsWith(`::${bare}::interface`)) {
          return id;
        }
      }
    }
    return `${bare}::${bare}::${defaultKind}`;
  }

  /**
   * Resolve an import target (dotted package path) to a concrete symbol ID.
   * Same fallback strategy as {@link resolveTypeTarget} but anchored on the
   * trailing package segment.
   */
  private resolveImportTarget(qualifiedName: string, baseName: string): string {
    if (this.symbolRegistry.size > 0) {
      for (const [id] of this.symbolRegistry) {
        if (id.endsWith(`::${baseName}::class`) || id.endsWith(`::${baseName}::interface`)) {
          return id;
        }
      }
    }
    return `${qualifiedName}::${baseName}::class`;
  }

  private findFirstTypeSymbolId(rootNode: SyntaxNode, filePath: string): string | undefined {
    let found: string | undefined;
    const visit = (n: SyntaxNode): boolean => {
      if (TYPE_DECLARATIONS.has(n.type)) {
        const name = n.childForFieldName('name')?.text;
        if (name) {
          found = this.buildSymbolId(filePath, name, this.typeKindFor(n.type));
          return true;
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        if (visit(n.child(i)!)) return true;
      }
      return false;
    };
    visit(rootNode);
    return found;
  }
}
