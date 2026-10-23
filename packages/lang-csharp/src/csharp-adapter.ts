import CSharpLanguage from 'tree-sitter-c-sharp';
import type { SyntaxNode } from 'tree-sitter';
import { TreeSitterAdapter } from './tree-sitter-adapter.js';
import type { SymbolNode, GraphEdge, ComplexityMetrics, SymbolKind, SymbolAnnotation } from '@ctxo/plugin-api';

const CSHARP_BRANCH_TYPES = [
  'if_statement', 'for_statement', 'foreach_statement',
  'while_statement', 'do_statement', 'switch_section',
  'catch_clause', 'conditional_expression',
];

// Annotation caps shared with the Roslyn tier (protocol v2 SymbolAnnotation).
const MAX_ANNOTATIONS = 20;
const MAX_ENTRIES = 10;
const MAX_VALUE_LENGTH = 200;
const RESERVED_TYPE_KEY = 'type';
const ATTRIBUTE_SUFFIX = 'Attribute';
// Attribute targets that belong to another symbol than the declaration itself.
const FOREIGN_ATTRIBUTE_TARGETS = new Set(['return', 'param', 'typevar', 'assembly', 'module', 'field']);
const SIMPLE_ESCAPES: Record<string, string> = {
  "'": "'", '"': '"', '\\': '\\', '0': '\0', a: '\x07', b: '\b', e: '\x1b',
  f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
};

export class CSharpAdapter extends TreeSitterAdapter {
  readonly extensions = ['.cs'] as const;

  constructor() {
    super(CSharpLanguage);
  }

  async extractSymbols(filePath: string, source: string): Promise<SymbolNode[]> {
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

  async extractEdges(filePath: string, source: string): Promise<GraphEdge[]> {
    try {
      const tree = this.parse(source);
      const edges: GraphEdge[] = [];
      const symbols = await this.extractSymbols(filePath, source);
      const firstSymbol = symbols.length > 0 ? symbols[0]!.symbolId : undefined;
      if (!firstSymbol) return edges;

      this.visitEdges(tree.rootNode, filePath, firstSymbol, '', edges);
      return edges;
    } catch (err) {
      console.error(`[ctxo:csharp] Edge extraction failed for ${filePath}: ${(err as Error).message}`);
      return [];
    }
  }

  async extractComplexity(filePath: string, source: string): Promise<ComplexityMetrics[]> {
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
      const annotations = attributeAnnotations(node);
      symbols.push({
        symbolId: this.buildSymbolId(filePath, qualifiedName, kind),
        name: qualifiedName,
        kind,
        ...range,
        ...(annotations ? { annotations } : {}),
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
      const annotations = attributeAnnotations(child);
      symbols.push({
        symbolId: this.buildSymbolId(filePath, qualifiedName, 'method'),
        name: qualifiedName,
        kind: 'method',
        ...range,
        ...(annotations ? { annotations } : {}),
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

// ── Attribute annotations (syntax tier) ─────────────────────────

/**
 * Annotations from the `attribute_list` children of a declaration, in source
 * order. Literal arguments only; no `named.type` (the syntax tier never
 * resolves types), and a source argument named `type` is dropped because the
 * key is reserved, as in the Roslyn tier. Same caps as the Roslyn tier.
 */
function attributeAnnotations(declaration: SyntaxNode): SymbolAnnotation[] | undefined {
  const annotations: SymbolAnnotation[] = [];
  for (const list of declaration.children) {
    if (list.type !== 'attribute_list') continue;
    const target = list.children.find(c => c.type === 'attribute_target_specifier');
    if (target && FOREIGN_ATTRIBUTE_TARGETS.has(target.text.replace(':', '').trim())) continue;

    for (const attribute of list.children) {
      if (attribute.type !== 'attribute') continue;
      if (annotations.length === MAX_ANNOTATIONS) return annotations;
      annotations.push(toAnnotation(attribute));
    }
  }
  return annotations.length > 0 ? annotations : undefined;
}

function toAnnotation(attribute: SyntaxNode): SymbolAnnotation {
  const args: string[] = [];
  const named = new Map<string, string>();
  const argumentList = attribute.children.find(c => c.type === 'attribute_argument_list');

  for (const argument of argumentList?.children ?? []) {
    if (argument.type !== 'attribute_argument') continue;
    const { key, expression } = splitArgument(argument);
    const value = expression ? literalValue(expression) : undefined;
    if (value === undefined) continue;

    if (key === undefined) {
      if (args.length < MAX_ENTRIES) args.push(truncate(value));
    } else if (key !== RESERVED_TYPE_KEY && named.size < MAX_ENTRIES && !named.has(key)) {
      named.set(key, truncate(value));
    }
  }

  return {
    name: attributeName(attribute.childForFieldName('name')),
    ...(args.length > 0 ? { args } : {}),
    ...(named.size > 0 ? { named: Object.fromEntries(named) } : {}),
  };
}

// `Name = value` parses as an assignment, `name: value` as identifier, ':', expression.
function splitArgument(argument: SyntaxNode): { key?: string; expression?: SyntaxNode } {
  const parts = argument.namedChildren.filter(c => c.type !== 'comment');
  const first = parts[0];
  if (!first) return {};
  if (first.type === 'assignment_expression') {
    const left = first.childForFieldName('left');
    const right = first.childForFieldName('right');
    if (left?.type === 'identifier' && right) return { key: identifierText(left), expression: right };
  }
  if (parts.length === 2 && first.type === 'identifier' && argument.children.some(c => c.type === ':')) {
    return { key: identifierText(first), expression: parts[1] };
  }
  return { expression: first };
}

// Last identifier of the written name, without namespace, alias and `Attribute` suffix.
function attributeName(nameNode: SyntaxNode | null): string {
  if (!nameNode) return '';
  let current = nameNode;
  while (current.type === 'qualified_name' || current.type === 'alias_qualified_name') {
    const next = current.childForFieldName('name');
    if (!next) break;
    current = next;
  }
  if (current.type === 'generic_name') {
    current = current.children.find(c => c.type === 'identifier') ?? current;
  }
  const text = identifierText(current);
  return text.length > ATTRIBUTE_SUFFIX.length && text.endsWith(ATTRIBUTE_SUFFIX)
    ? text.slice(0, -ATTRIBUTE_SUFFIX.length)
    : text;
}

function identifierText(node: SyntaxNode): string {
  return node.text.startsWith('@') ? node.text.slice(1) : node.text;
}

/** String (regular, verbatim, raw), number and boolean literals; undefined for anything else. */
function literalValue(node: SyntaxNode): string | undefined {
  switch (node.type) {
    case 'string_literal':
      return node.children
        .map(c => (c.type === 'string_literal_content' ? c.text : c.type === 'escape_sequence' ? decodeEscape(c.text) : ''))
        .join('');
    case 'verbatim_string_literal':
      return node.text.slice(2, -1).replace(/""/g, '"');
    case 'raw_string_literal':
      return rawStringValue(node);
    case 'integer_literal':
      return integerText(node.text);
    case 'real_literal':
      return realText(node.text);
    case 'boolean_literal':
      return node.text;
    case 'prefix_unary_expression': {
      const operand = node.namedChildren[0];
      if (node.children[0]?.type !== '-' || !operand) return undefined;
      if (operand.type !== 'integer_literal' && operand.type !== 'real_literal') return undefined;
      const value = literalValue(operand);
      return value === undefined ? undefined : `-${value}`;
    }
    default:
      return undefined;
  }
}

function decodeEscape(sequence: string): string {
  const kind = sequence[1] ?? '';
  if (kind === 'u' || kind === 'x' || kind === 'U') {
    const codePoint = parseInt(sequence.slice(2), 16);
    return Number.isNaN(codePoint) || codePoint > 0x10ffff ? sequence : String.fromCodePoint(codePoint);
  }
  return SIMPLE_ESCAPES[kind] ?? sequence;
}

// A multi-line raw string drops its first and last line and the closing line's indentation.
function rawStringValue(node: SyntaxNode): string {
  const content = node.children.filter(c => c.type === 'raw_string_content').map(c => c.text).join('');
  if (!content.includes('\n')) return content;
  const lines = content.split('\n');
  const indentation = lines[lines.length - 1]!;
  return lines
    .slice(1, -1)
    .map(line => (line.startsWith(indentation) ? line.slice(indentation.length) : line.replace(/^[ \t]+/, '')))
    .join('\n')
    .replace(/\r$/, '');
}

// Same text as the Roslyn tier's invariant-culture value for the common forms.
function integerText(raw: string): string | undefined {
  const digits = raw.replace(/_/g, '').replace(/(ul|lu|u|l)$/i, '');
  try {
    return BigInt(digits).toString();
  } catch {
    return undefined;
  }
}

function realText(raw: string): string {
  const text = raw.replace(/_/g, '');
  if (/[mM]$/.test(text)) return text.slice(0, -1);
  const value = Number(text.replace(/[fFdD]$/, ''));
  return Number.isFinite(value) ? String(value) : text;
}

function truncate(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? value.slice(0, MAX_VALUE_LENGTH) : value;
}
