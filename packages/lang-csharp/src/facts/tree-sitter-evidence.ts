// C# fact evidence from the tree-sitter syntax tree (PR 4, issue #156). The syntax-tier twin of the
// Roslyn helper's Facts.cs: the same members, the same evidence, the same text and line rules, so
// both tiers give the same facts (pinned by facts-tier-agreement.integration.test.ts).
import type { SyntaxNode } from 'tree-sitter';
import type { SymbolNode } from '@ctxo/plugin-api';
import type { DurationUnit, FactEvidence, FactOptions, LiteralKind } from './fact-types.js';
import { hasRetryTimeoutFragment, matchesNormalizationPattern } from './fact-rules.js';
import { decodeCsharpRawString } from './csharp-string-literal.js';

/** Most evidence records collected per file, as in the Roslyn helper; the finisher keeps at most 500 facts. */
export const MAX_TREE_SITTER_EVIDENCE_PER_FILE = 2000;

const DURATION_UNITS: Readonly<Record<string, DurationUnit>> = {
  FromMilliseconds: 'ms',
  FromSeconds: 's',
  FromMinutes: 'min',
  FromHours: 'h',
  FromDays: 'd',
  FromMicroseconds: 'us',
};

const ROUTE_VERBS: Readonly<Record<string, string>> = {
  MapGet: 'GET',
  MapPost: 'POST',
  MapPut: 'PUT',
  MapDelete: 'DELETE',
  MapPatch: 'PATCH',
};

/** Receivers that name System.TimeSpan without type information. */
const TIME_SPAN_RECEIVERS = new Set(['TimeSpan', 'System.TimeSpan', 'global::System.TimeSpan']);
const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '<=', '>', '>=']);
/** Binary operators that bind looser than a relational or constant pattern's operand. */
const LOOSER_THAN_PATTERN_OPERAND = new Set(['==', '!=', '<', '<=', '>', '>=', '&', '^', '|', '&&', '||', '??']);
const TYPE_DECLARATIONS = new Set([
  'class_declaration', 'struct_declaration', 'record_declaration', 'record_struct_declaration', 'interface_declaration',
]);
/** Never part of a member's operations in Roslyn: parameter defaults and attribute arguments. */
const NOT_WALKED = new Set(['parameter_list', 'bracketed_parameter_list', 'attribute_list']);
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  "'": "'", '"': '"', '\\': '\\', '0': '\0', a: '\x07', b: '\b', e: '\x1b',
  f: '\f', n: '\n', r: '\r', t: '\t', v: '\v',
};

// ── Virtual nodes ───────────────────────────────────────────────
//
// tree-sitter-c-sharp 0.23.1 lets a relational or constant pattern swallow the rest of the
// expression: `days is > 14 ? "late" : "ok"` parses as `days is > (14 ? "late" : "ok")`, and
// `limit is 3 && n > 2` as `limit is (3 && n > 2)`. C# binds the pattern operand tighter, so the
// collector rebuilds the C# shape as virtual nodes over the same source spans.

interface Span {
  readonly start: number;
  readonly end: number;
  readonly row: number;
}
interface VirtualBinary extends Span {
  readonly virtual: 'binary';
  readonly operator: string;
  readonly left: Expr;
  readonly right: SyntaxNode;
}
interface VirtualConditional extends Span {
  readonly virtual: 'conditional';
  readonly condition: Expr;
}
/** The `is` expression up to the pattern operand's real end; `leaf` is the pattern whose operand is `operand`. */
interface VirtualIs extends Span {
  readonly virtual: 'is';
  readonly node: SyntaxNode;
  readonly leaf: SyntaxNode;
  readonly operand: SyntaxNode;
}
type Virtual = VirtualBinary | VirtualConditional | VirtualIs;
type Expr = SyntaxNode | Virtual;

function isVirtual(expr: Expr): expr is Virtual {
  return 'virtual' in expr;
}

function same(a: SyntaxNode | null | undefined, b: SyntaxNode | null | undefined): boolean {
  return !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type;
}

function key(node: SyntaxNode): string {
  return `${node.type}:${node.startIndex}:${node.endIndex}`;
}

function operatorOf(node: SyntaxNode): string {
  return node.childForFieldName('operator')?.text ?? '';
}

function looserThanPatternOperand(node: SyntaxNode): boolean {
  return node.type === 'conditional_expression'
    || (node.type === 'binary_expression' && LOOSER_THAN_PATTERN_OPERAND.has(operatorOf(node)));
}

/** The pattern at the right end of a pattern: through `and`, `or` and `not`, when it is relational or constant. */
function trailingPattern(pattern: SyntaxNode | null): SyntaxNode | undefined {
  let current = pattern;
  while (current) {
    if (current.type === 'and_pattern' || current.type === 'or_pattern') current = current.childForFieldName('right');
    else if (current.type === 'negated_pattern') current = current.namedChildren[0] ?? null;
    else break;
  }
  return current && (current.type === 'relational_pattern' || current.type === 'constant_pattern') ? current : undefined;
}

function isPatternChain(node: SyntaxNode): boolean {
  return node.type === 'and_pattern' || node.type === 'or_pattern';
}

function unwrapParentheses(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.type === 'parenthesized_expression' && current.namedChildren.length === 1) current = current.namedChildren[0]!;
  return current;
}

function identifierText(node: SyntaxNode): string {
  return node.text.startsWith('@') ? node.text.slice(1) : node.text;
}

/** The identifier of a simple or generic name. */
function simpleName(node: SyntaxNode | null): string | undefined {
  if (!node) return undefined;
  if (node.type === 'identifier') return identifierText(node);
  if (node.type === 'generic_name') {
    const identifier = node.namedChildren.find(c => c.type === 'identifier');
    return identifier ? identifierText(identifier) : undefined;
  }
  return undefined;
}

function hasModifier(declaration: SyntaxNode, modifier: string): boolean {
  return declaration.namedChildren.some(c => c.type === 'modifier' && c.text === modifier);
}

function parameterCount(declaration: SyntaxNode): number {
  const parameters = declaration.childForFieldName('parameters');
  return parameters ? parameters.namedChildren.filter(c => c.type === 'parameter').length : 0;
}

/** The expression after `=` in a declarator, or undefined without an initializer. */
function declaratorValue(declarator: SyntaxNode): SyntaxNode | undefined {
  const children = declarator.children;
  const equals = children.findIndex(c => c.type === '=' && !c.isNamed);
  if (equals < 0) return undefined;
  return children.slice(equals + 1).find(c => c.isNamed && c.type !== 'comment');
}

/** An argument's expression, without its `name:`. */
function argumentExpression(argument: SyntaxNode): SyntaxNode | undefined {
  const name = argument.childForFieldName('name');
  const expressions = argument.namedChildren.filter(c => !same(c, name) && c.type !== 'comment');
  return expressions[expressions.length - 1];
}

function argumentsOf(invocation: SyntaxNode): SyntaxNode[] {
  return invocation.childForFieldName('arguments')?.namedChildren.filter(c => c.type === 'argument') ?? [];
}

/** The member or local an assignment writes, as Roslyn names it; undefined for any other target. */
function assignedName(target: SyntaxNode | null): string | undefined {
  if (!target) return undefined;
  if (target.type === 'identifier') return identifierText(target);
  if (target.type === 'member_access_expression') return simpleName(target.childForFieldName('name'));
  return undefined;
}

/** `name = value` pairs of an anonymous object or a `with` initializer: [name, value]. */
function initializerPairs(node: SyntaxNode): [SyntaxNode, SyntaxNode][] {
  const pairs: [SyntaxNode, SyntaxNode][] = [];
  const children = node.children;
  for (let i = 0; i + 2 < children.length; i++) {
    const name = children[i]!;
    if (name.type === 'identifier' && children[i + 1]!.type === '=' && children[i + 2]!.isNamed) {
      pairs.push([name, children[i + 2]!]);
    }
  }
  return pairs;
}

/**
 * Where Roslyn's syntax for a call or member chain starts: after the `?` of a conditional access
 * (Roslyn keeps `a?.b.Trim()` as `a?` plus `.b.Trim()`). Undefined when the chain has none.
 */
function conditionalAccessStart(expression: SyntaxNode | null): SyntaxNode | undefined {
  let current = expression;
  while (current) {
    switch (current.type) {
      case 'conditional_access_expression': {
        const question = current.children.findIndex(c => c.type === '?' && !c.isNamed);
        return question >= 0 ? current.children.slice(question + 1).find(c => c.isNamed) : undefined;
      }
      case 'member_access_expression':
      case 'element_access_expression':
        current = current.childForFieldName('expression');
        break;
      case 'invocation_expression':
        current = current.childForFieldName('function');
        break;
      default:
        return undefined;
    }
  }
  return undefined;
}

function decodeEscape(sequence: string): string | undefined {
  const kind = sequence[1] ?? '';
  if (kind === 'u' || kind === 'x' || kind === 'U') {
    const codePoint = parseInt(sequence.slice(2), 16);
    return Number.isNaN(codePoint) || codePoint > 0x10ffff ? undefined : String.fromCodePoint(codePoint);
  }
  return SIMPLE_ESCAPES[kind];
}

/** The value of a regular, verbatim or raw string literal (Roslyn's `ValueText`); undefined for `u8` and anything else. */
function routeLiteralValue(node: SyntaxNode | undefined): string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'string_literal': {
      if (node.children.some(c => c.type === 'string_literal_encoding')) return undefined;
      let value = '';
      for (const child of node.children) {
        if (child.type === 'string_literal_content') value += child.text;
        else if (child.type === 'escape_sequence') {
          const decoded = decodeEscape(child.text);
          if (decoded === undefined) return undefined;
          value += decoded;
        }
      }
      return value;
    }
    case 'verbatim_string_literal':
      return node.text.slice(2, -1).split('""').join('"');
    case 'raw_string_literal':
      return decodeCsharpRawString(node.text);
    default:
      return undefined;
  }
}

/** A literal operand, as Roslyn's `Literal`: a literal (parentheses unwrapped) or a signed number literal. */
function literalOf(expr: Expr | undefined): { readonly text: string; readonly kind: LiteralKind } | undefined {
  if (!expr || isVirtual(expr)) return undefined;
  const node = unwrapParentheses(expr);
  switch (node.type) {
    case 'integer_literal':
    case 'real_literal':
      return { text: node.text, kind: 'number' };
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'raw_string_literal':
      return { text: node.text, kind: 'string' };
    case 'character_literal':
      return { text: node.text, kind: 'char' };
    case 'boolean_literal':
      return { text: node.text, kind: 'boolean' };
    case 'null_literal':
      return { text: node.text, kind: 'null' };
    case 'prefix_unary_expression': {
      const sign = node.children[0]?.text;
      const operand = node.namedChildren[0];
      if ((sign !== '-' && sign !== '+') || !operand) return undefined;
      return operand.type === 'integer_literal' || operand.type === 'real_literal' ? { text: node.text, kind: 'number' } : undefined;
    }
    default:
      return undefined;
  }
}

// ── Collector ───────────────────────────────────────────────────

class Collector {
  readonly evidence: FactEvidence[] = [];
  private symbolId: string | undefined;
  /** Misparsed conditional expressions that a virtual conditional replaces. */
  private readonly hidden = new Set<string>();

  constructor(
    private readonly root: SyntaxNode,
    private readonly source: string,
    private readonly file: string,
    private readonly options: FactOptions,
  ) {}

  get full(): boolean {
    return this.evidence.length >= MAX_TREE_SITTER_EVIDENCE_PER_FILE;
  }

  // ── Declarations ──────────────────────────────────────────────

  /** Namespaces, types and top-level statements of a compilation unit or a namespace body. */
  declarations(container: SyntaxNode, namespace: string): void {
    let current = namespace;
    for (const child of container.namedChildren) {
      if (this.full) return;
      switch (child.type) {
        case 'file_scoped_namespace_declaration':
          current = qualify(namespace, namespaceName(child));
          break;
        case 'namespace_declaration': {
          const body = child.childForFieldName('body');
          if (body) this.declarations(body, qualify(current, namespaceName(child)));
          break;
        }
        case 'global_statement':
          this.member(undefined, [child]);
          break;
        default:
          if (TYPE_DECLARATIONS.has(child.type)) this.type(child, current, current);
      }
    }
  }

  private type(declaration: SyntaxNode, container: string, namespace: string): void {
    const name = simpleName(declaration.childForFieldName('name'));
    if (!name) return;
    const type = qualify(container, name);
    const body = declaration.childForFieldName('body') ?? declaration.namedChildren.find(c => c.type === 'declaration_list');
    if (!body) return;

    for (const member of body.namedChildren) {
      if (this.full) return;
      if (TYPE_DECLARATIONS.has(member.type)) {
        this.type(member, type, namespace);
        continue;
      }
      switch (member.type) {
        case 'method_declaration': {
          const method = simpleName(member.childForFieldName('name'));
          if (method) this.member(this.methodId(member, `${type}.${explicitInterface(member, namespace)}${method}`), [member.childForFieldName('body')]);
          break;
        }
        case 'constructor_declaration': {
          const constructor = simpleName(member.childForFieldName('name'));
          if (!constructor) break;
          // Roslyn names a static constructor `.cctor` and an instance constructor after its type.
          const id = hasModifier(member, 'static')
            ? this.id(`${type}..cctor`, 'method')
            : this.methodId(member, `${type}.${constructor}`);
          this.member(id, [member.namedChildren.find(c => c.type === 'constructor_initializer'), member.childForFieldName('body')]);
          break;
        }
        case 'property_declaration': {
          const property = member.childForFieldName('name');
          if (!property) break;
          const id = this.id(`${type}.${explicitInterface(member, namespace)}${identifierText(property)}`, 'variable');
          const value = member.childForFieldName('value');
          const accessorBodies = accessorBodiesOf(member);
          if (value && value.type !== 'arrow_expression_clause') {
            this.symbolId = id;
            this.binding(identifierText(property), value, property.startPosition.row);
          }
          this.member(id, [value, ...accessorBodies]);
          break;
        }
        case 'event_declaration': {
          const event = member.childForFieldName('name');
          if (event) this.member(this.id(`${type}.${explicitInterface(member, namespace)}${identifierText(event)}`, 'variable'), accessorBodiesOf(member));
          break;
        }
        case 'field_declaration':
        case 'event_field_declaration': {
          const declaration = member.namedChildren.find(c => c.type === 'variable_declaration');
          for (const declarator of declaration?.namedChildren ?? []) {
            if (declarator.type !== 'variable_declarator' || !declaratorValue(declarator)) continue;
            const field = declarator.childForFieldName('name');
            if (field) this.member(this.id(`${type}.${identifierText(field)}`, 'variable'), [declarator]);
          }
          break;
        }
        // Indexers, operators, conversion operators, destructors, enums and delegates give no evidence.
      }
    }
  }

  private id(qualified: string, kind: 'method' | 'variable'): string {
    return `${this.file}::${qualified}::${kind}`;
  }

  /** A public method or constructor gets the syntax tier's own ID (with its parameter count); any other the full-tier shape. */
  private methodId(declaration: SyntaxNode, qualified: string): string {
    return hasModifier(declaration, 'public')
      ? this.id(`${qualified}(${parameterCount(declaration)})`, 'method')
      : this.id(qualified, 'method');
  }

  member(symbolId: string | undefined, nodes: readonly (SyntaxNode | null | undefined)[]): void {
    this.symbolId = symbolId;
    for (const node of nodes) if (node) this.walk(node);
  }

  // ── Walk ──────────────────────────────────────────────────────

  private walk(root: SyntaxNode): void {
    const stack = [root];
    while (stack.length > 0) {
      if (this.full) return;
      const node = stack.pop()!;
      this.visit(node);
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)!;
        if (!NOT_WALKED.has(child.type)) stack.push(child);
      }
    }
  }

  private visit(node: SyntaxNode): void {
    switch (node.type) {
      case 'if_statement':
      case 'while_statement':
      case 'do_statement':
      case 'for_statement': {
        const condition = node.childForFieldName('condition');
        if (condition) this.condition(condition);
        break;
      }
      case 'conditional_expression': {
        const condition = node.childForFieldName('condition');
        if (condition && !this.hidden.has(key(node))) this.condition(condition);
        break;
      }
      case 'is_pattern_expression':
        this.virtualConditionals(this.repair(node));
        break;
      case 'switch_statement': {
        const subject = node.childForFieldName('value');
        const body = node.childForFieldName('body');
        if (!subject || !body) break;
        for (const section of body.namedChildren) {
          if (section.type === 'switch_section') this.switchSection(section, unwrapParentheses(subject).text);
        }
        break;
      }
      case 'switch_expression': {
        const subject = node.namedChildren[0];
        if (!subject || subject.type === 'switch_expression_arm') break;
        for (const arm of node.namedChildren) {
          if (arm.type !== 'switch_expression_arm') continue;
          const pattern = arm.namedChildren[0];
          if (pattern) this.casePattern(pattern, unwrapParentheses(subject).text);
          this.guard(arm.namedChildren.find(c => c.type === 'when_clause'));
        }
        break;
      }
      case 'catch_filter_clause': {
        const filter = node.namedChildren.find(c => c.type !== 'comment');
        if (filter) this.condition(filter);
        break;
      }
      case 'invocation_expression':
        this.invocation(node);
        break;
      case 'variable_declarator': {
        const name = node.childForFieldName('name');
        const value = declaratorValue(node);
        if (name && value) this.binding(identifierText(name), value, name.startPosition.row);
        break;
      }
      case 'assignment_expression': {
        if (operatorOf(node) !== '=') break;
        const name = assignedName(node.childForFieldName('left'));
        const value = node.childForFieldName('right');
        if (name && value) this.binding(name, value, node.startPosition.row);
        break;
      }
      case 'argument': {
        const name = node.childForFieldName('name');
        const value = argumentExpression(node);
        const list = node.parent?.type;
        if (name && value && (list === 'argument_list' || list === 'bracketed_argument_list')) {
          this.binding(identifierText(name), value, name.startPosition.row);
        }
        break;
      }
      case 'anonymous_object_creation_expression':
      case 'with_initializer':
        for (const [name, value] of initializerPairs(node)) this.binding(identifierText(name), value, name.startPosition.row);
        break;
    }
  }

  private add(evidence: FactEvidence): void {
    if (this.full) return;
    this.evidence.push(this.symbolId !== undefined ? { ...evidence, symbolId: this.symbolId } : evidence);
  }

  private text(expr: Expr): string {
    if (!isVirtual(expr)) return expr.text;
    return this.source.slice(expr.start - this.root.startIndex, expr.end - this.root.startIndex);
  }

  private row(expr: Expr): number {
    return isVirtual(expr) ? expr.row : expr.startPosition.row;
  }

  // ── Comparisons ───────────────────────────────────────────────

  /** The C# shape of an `is` expression whose trailing pattern swallowed a looser expression, else the node. */
  private repair(node: SyntaxNode): Expr {
    const leaf = trailingPattern(node.childForFieldName('pattern'));
    const swallowed = leaf?.namedChildren[0];
    if (!leaf || !swallowed || !looserThanPatternOperand(swallowed)) return node;

    let operand = swallowed;
    while (looserThanPatternOperand(operand)) {
      const next = operand.type === 'conditional_expression' ? operand.childForFieldName('condition') : operand.childForFieldName('left');
      if (!next) return node;
      operand = next;
    }
    const start = node.startIndex;
    const row = node.startPosition.row;
    const is: VirtualIs = { virtual: 'is', node, leaf, operand, start, end: operand.endIndex, row };

    const rotate = (current: SyntaxNode): Expr => {
      if (same(current, operand)) return is;
      if (current.type === 'conditional_expression') {
        this.hidden.add(key(current));
        return { virtual: 'conditional', condition: rotate(current.childForFieldName('condition')!), start, end: current.endIndex, row };
      }
      return {
        virtual: 'binary',
        operator: operatorOf(current),
        left: rotate(current.childForFieldName('left')!),
        right: current.childForFieldName('right')!,
        start,
        end: current.endIndex,
        row,
      };
    };
    return rotate(swallowed);
  }

  /** Conditions of the virtual conditionals a repair built (the real ones are visited by the walk). */
  private virtualConditionals(expr: Expr): void {
    if (!isVirtual(expr)) return;
    if (expr.virtual === 'conditional') {
      this.condition(expr.condition);
      this.virtualConditionals(expr.condition);
    } else if (expr.virtual === 'binary') {
      this.virtualConditionals(expr.left);
    }
  }

  private guard(clause: SyntaxNode | undefined): void {
    const condition = clause?.namedChildren.find(c => c.type !== 'comment');
    if (condition) this.condition(condition);
  }

  /** Comparisons through `&&`, `||`, `!`, parentheses and `is` patterns, never into calls or lambdas. */
  private condition(expr: Expr): void {
    if (isVirtual(expr)) {
      if (expr.virtual === 'is') {
        this.isPattern(expr.node.childForFieldName('pattern'), expr, false, expr);
      } else if (expr.virtual === 'binary') {
        if (expr.operator === '&&' || expr.operator === '||') {
          this.condition(expr.left);
          this.condition(expr.right);
        } else if (COMPARISON_OPERATORS.has(expr.operator)) {
          this.comparison(expr, expr.operator, expr.left, expr.right);
        }
      }
      return;
    }

    const node = unwrapParentheses(expr);
    switch (node.type) {
      case 'is_pattern_expression': {
        const repaired = this.repair(node);
        if (isVirtual(repaired)) this.condition(repaired);
        else this.isPattern(node.childForFieldName('pattern'), node, false, undefined);
        break;
      }
      case 'prefix_unary_expression': {
        const operand = node.namedChildren[0];
        if (node.children[0]?.text === '!' && operand) this.condition(operand);
        break;
      }
      case 'binary_expression': {
        const operator = operatorOf(node);
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) break;
        if (operator === '&&' || operator === '||') {
          this.condition(left);
          this.condition(right);
        } else if (COMPARISON_OPERATORS.has(operator)) {
          this.comparison(node, operator, left, right);
        }
        break;
      }
    }
  }

  private comparison(expr: Expr, operator: string, left: Expr, right: Expr): void {
    const leftLiteral = literalOf(left);
    const rightLiteral = literalOf(right);
    if ((leftLiteral === undefined) === (rightLiteral === undefined)) return;
    const literal = (leftLiteral ?? rightLiteral)!;
    this.add({
      kind: 'comparison',
      line: this.row(expr),
      text: this.text(expr),
      operator,
      literal: literal.text,
      literalKind: literal.kind,
    });
  }

  /** An `is` pattern: constant (`==`, `!=` under `not`), relational, and `and`/`or` combinations. */
  private isPattern(pattern: SyntaxNode | null, isExpression: Expr, negated: boolean, repaired: VirtualIs | undefined): void {
    if (!pattern) return;
    const operandOf = (leaf: SyntaxNode): SyntaxNode | undefined =>
      repaired && same(leaf, repaired.leaf) ? repaired.operand : leaf.namedChildren[0];
    switch (pattern.type) {
      case 'parenthesized_pattern':
        this.isPattern(pattern.namedChildren[0] ?? null, isExpression, negated, repaired);
        break;
      case 'constant_pattern': {
        const literal = literalOf(operandOf(pattern));
        if (literal) this.addPattern(this.text(isExpression), this.row(isExpression), negated ? '!=' : '==', literal);
        break;
      }
      case 'relational_pattern': {
        const literal = negated ? undefined : literalOf(operandOf(pattern));
        if (literal) this.addPattern(this.text(isExpression), this.row(isExpression), pattern.children[0]!.text, literal);
        break;
      }
      case 'negated_pattern': {
        const inner = pattern.namedChildren[0] ?? null;
        if (inner && isPatternChain(inner)) {
          // `not A and B` is `(not A) and B`; a combination under negation gives no evidence.
          if (!negated) this.negatedChain(inner, isExpression, repaired);
        } else {
          this.isPattern(inner, isExpression, !negated, repaired);
        }
        break;
      }
      case 'and_pattern':
      case 'or_pattern':
        if (negated) break;
        this.isPattern(pattern.childForFieldName('left'), isExpression, negated, repaired);
        this.isPattern(pattern.childForFieldName('right'), isExpression, negated, repaired);
        break;
    }
  }

  /**
   * tree-sitter-c-sharp 0.23.1 parses `not A and B` as `not (A and B)`; C# binds `not` to `A`. The
   * chain is read as `(not A) and B`: the first operand negated, the rest as written.
   */
  private negatedChain(chain: SyntaxNode, isExpression: Expr, repaired: VirtualIs | undefined): void {
    const left = chain.childForFieldName('left');
    if (left && isPatternChain(left)) this.negatedChain(left, isExpression, repaired);
    else this.isPattern(left, isExpression, true, repaired);
    this.isPattern(chain.childForFieldName('right'), isExpression, false, repaired);
  }

  private switchSection(section: SyntaxNode, subject: string): void {
    let label = false;
    for (const child of section.children) {
      if (child.type === 'case' && !child.isNamed) {
        label = true;
      } else if (child.type === 'when_clause') {
        this.guard(child);
      } else if (label && child.isNamed) {
        this.casePattern(child, subject);
        label = false;
      }
    }
  }

  /** A case label or arm: `<subject> case <label>`, operator `case` or the relational operator. */
  private casePattern(pattern: SyntaxNode, subject: string): void {
    switch (pattern.type) {
      case 'parenthesized_pattern': {
        const inner = pattern.namedChildren[0];
        if (inner) this.casePattern(inner, subject);
        break;
      }
      case 'constant_pattern': {
        const literal = literalOf(pattern.namedChildren[0]);
        if (literal) this.addPattern(`${subject} case ${pattern.text}`, pattern.startPosition.row, 'case', literal);
        break;
      }
      case 'relational_pattern': {
        const literal = literalOf(pattern.namedChildren[0]);
        if (literal) this.addPattern(`${subject} case ${pattern.text}`, pattern.startPosition.row, pattern.children[0]!.text, literal);
        break;
      }
      case 'and_pattern':
      case 'or_pattern': {
        const left = pattern.childForFieldName('left');
        const right = pattern.childForFieldName('right');
        if (left) this.casePattern(left, subject);
        if (right) this.casePattern(right, subject);
        break;
      }
      case 'negated_pattern': {
        // A negated label gives nothing, but `not A and B` is `(not A) and B`, so B still counts.
        let chain = pattern.namedChildren[0];
        const rest: SyntaxNode[] = [];
        while (chain && isPatternChain(chain)) {
          const right = chain.childForFieldName('right');
          if (right) rest.push(right);
          chain = chain.childForFieldName('left') ?? undefined;
        }
        for (const right of rest.reverse()) this.casePattern(right, subject);
        break;
      }
    }
  }

  private addPattern(text: string, line: number, operator: string, literal: { readonly text: string; readonly kind: LiteralKind }): void {
    this.add({ kind: 'comparison', line, text, operator, literal: literal.text, literalKind: literal.kind });
  }

  // ── Calls, durations and routes ───────────────────────────────

  private invocation(node: SyntaxNode): void {
    const callee = node.childForFieldName('function');
    if (!callee) return;
    let method: string | undefined;
    let receiver: string | undefined;
    let start: SyntaxNode = node;

    if (callee.type === 'member_access_expression') {
      method = simpleName(callee.childForFieldName('name'));
      const expression = callee.childForFieldName('expression');
      if (!expression) return;
      const conditional = conditionalAccessStart(expression);
      if (conditional) {
        start = conditional;
        receiver = this.source.slice(conditional.startIndex - this.root.startIndex, expression.endIndex - this.root.startIndex);
      } else {
        receiver = expression.text;
      }
    } else if (callee.type === 'conditional_access_expression') {
      const binding = callee.namedChildren[callee.namedChildren.length - 1];
      if (binding?.type !== 'member_binding_expression') return;
      method = simpleName(binding.childForFieldName('name'));
      start = binding;
    } else {
      method = simpleName(callee);
    }
    if (!method) return;

    const line = start.startPosition.row;
    const text = same(start, node)
      ? node.text
      : this.source.slice(start.startIndex - this.root.startIndex, node.endIndex - this.root.startIndex);

    if (matchesNormalizationPattern(method, receiver, this.options.normalizationMethods)) {
      const { consumer, inProse } = destination(node);
      this.add({
        kind: 'call',
        line,
        text,
        method,
        ...(receiver !== undefined ? { qualifier: receiver } : {}),
        ...(consumer !== undefined ? { consumer } : {}),
        ...(inProse ? { inProse } : {}),
      });
    }

    const args = argumentsOf(node);
    const unit = DURATION_UNITS[method];
    const amount = args.length === 1 ? argumentExpression(args[0]!) : undefined;
    if (unit && amount && receiver !== undefined && TIME_SPAN_RECEIVERS.has(receiver)) {
      const name = bindingName(node);
      this.add({
        kind: 'duration',
        line,
        ...(name !== undefined ? { name } : {}),
        constructor: `System.TimeSpan.${method}`,
        unit,
        amount: amount.text,
      });
    }

    const verb = ROUTE_VERBS[method];
    const route = verb && args.length > 0 ? routeLiteralValue(argumentExpression(args[0]!)) : undefined;
    if (verb && route !== undefined) this.add({ kind: 'route', line, verb, route });
  }

  // ── Bindings ──────────────────────────────────────────────────

  private binding(name: string, value: SyntaxNode, line: number): void {
    const bound = unwrapParentheses(value);
    // A call is never a numeric constant, and a bound duration call is reported by the duration itself.
    if (bound.type === 'invocation_expression') return;
    if (!hasRetryTimeoutFragment(name)) return;
    this.add({ kind: 'binding', line, name, value: bound.text });
  }
}

// ── FC-4b: where a normalization call's value goes ──────────────

/** Nodes that end the walk: statements, declarations and function bodies (Roslyn stops at the same places). */
function endsDestination(node: SyntaxNode): boolean {
  return node.type.endsWith('_statement') || node.type.endsWith('_declaration') || node.type === 'block'
    || node.type === 'lambda_expression' || node.type === 'anonymous_method_expression' || node.type === 'declaration_list';
}

/** ASCII whitespace, the one definition every tier uses (space, tab, LF, CR, FF, VT). */
const ASCII_WHITESPACE = /[ \t\n\r\f\v]/;

/** The value of a C# escape sequence, as Roslyn decodes it (simple, `\x`, `\u` and `\U` escapes). */
function escapeValue(sequence: string): string {
  const simple = SIMPLE_ESCAPES[sequence.slice(1)];
  if (simple !== undefined) return simple;
  const hex = /^\\[xuU]([0-9a-fA-F]+)$/.exec(sequence);
  const code = hex ? parseInt(hex[1]!, 16) : NaN;
  return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** ASCII whitespace in a literal part of a string, with escape sequences decoded as Roslyn decodes them. */
function hasWhitespace(part: SyntaxNode): boolean {
  return ASCII_WHITESPACE.test(part.type === 'escape_sequence' ? escapeValue(part.text) : part.text);
}

/** A string literal or interpolated string whose literal text holds ASCII whitespace. */
function isProse(node: SyntaxNode): boolean {
  switch (node.type) {
    case 'string_literal':
      return node.namedChildren.some(hasWhitespace);
    case 'verbatim_string_literal':
      return ASCII_WHITESPACE.test(node.text.slice(2, -1));
    case 'raw_string_literal': {
      const content = decodeCsharpRawString(node.text);
      return content !== undefined && ASCII_WHITESPACE.test(content);
    }
    case 'interpolated_string_expression':
      return node.namedChildren.some(c => c.type !== 'interpolation' && hasWhitespace(c));
    default:
      return false;
  }
}

/** The operands of a `+` chain, through nested `+` (not through parentheses). */
function concatOperands(node: SyntaxNode, out: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === 'binary_expression' && node.childForFieldName('operator')?.text === '+') {
    for (const side of [node.childForFieldName('left'), node.childForFieldName('right')]) if (side) concatOperands(side, out);
  } else {
    out.push(node);
  }
  return out;
}

/**
 * FC-4b, as Facts.cs reads it: up to the statement and never out of a lambda, the nearest call (`new T`
 * for a construction) that takes the value as an argument, and whether on the way the value is a hole
 * of an interpolated string, or an operand of a `+` chain with a string, whose literal text holds ASCII
 * whitespace. The syntax tier has no types, so it reports no `consumerTypes`.
 */
function destination(call: SyntaxNode): { consumer: string | undefined; inProse: boolean } {
  let inProse = false;
  let node = call;
  for (let parent = node.parent; parent; node = parent, parent = parent.parent) {
    if (endsDestination(parent)) break;
    const args = parent.childForFieldName('arguments');
    if (parent.type === 'invocation_expression' && same(args, node)) {
      return { consumer: collapse(parent.childForFieldName('function')?.text ?? ''), inProse };
    } else if (parent.type === 'object_creation_expression' && same(args, node)) {
      return { consumer: `new ${collapse(parent.childForFieldName('type')?.text ?? '')}`, inProse };
    } else if (parent.type === 'implicit_object_creation_expression' && node.type === 'argument_list') {
      return { consumer: 'new', inProse };
    } else if (parent.type === 'interpolated_string_expression' && node.type === 'interpolation') {
      if (isProse(parent)) inProse = true;
    } else if (parent.type === 'binary_expression' && parent.childForFieldName('operator')?.text === '+') {
      if (concatOperands(parent).some(isProse)) inProse = true;
    }
  }
  return { consumer: undefined, inProse };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The name a call's value is bound to: a declarator, property initializer, assignment, named argument or initializer member. */
function bindingName(call: SyntaxNode): string | undefined {
  let child = call;
  let parent = call.parent;
  while (parent?.type === 'parenthesized_expression') {
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return undefined;
  switch (parent.type) {
    case 'variable_declarator': {
      const name = parent.childForFieldName('name');
      return name && same(declaratorValue(parent), child) ? identifierText(name) : undefined;
    }
    case 'property_declaration': {
      const name = parent.childForFieldName('name');
      return name && same(parent.childForFieldName('value'), child) ? identifierText(name) : undefined;
    }
    case 'assignment_expression':
      return operatorOf(parent) === '=' && same(parent.childForFieldName('right'), child)
        ? assignedName(parent.childForFieldName('left'))
        : undefined;
    case 'argument': {
      const name = parent.childForFieldName('name');
      const list = parent.parent?.type;
      return name && (list === 'argument_list' || list === 'bracketed_argument_list') ? identifierText(name) : undefined;
    }
    case 'anonymous_object_creation_expression':
    case 'with_initializer': {
      const pair = initializerPairs(parent).find(([, value]) => same(value, child));
      return pair ? identifierText(pair[0]) : undefined;
    }
    default:
      return undefined;
  }
}

function accessorBodiesOf(declaration: SyntaxNode): SyntaxNode[] {
  const accessors = declaration.childForFieldName('accessors') ?? declaration.namedChildren.find(c => c.type === 'accessor_list');
  return (accessors?.namedChildren ?? [])
    .filter(c => c.type === 'accessor_declaration')
    .map(c => c.childForFieldName('body'))
    .filter((body): body is SyntaxNode => body !== null);
}

/**
 * The `<Interface>.` prefix of an explicit interface implementation (`bool IRenewable.CanRenew()`),
 * as Roslyn names the member: the interface's qualified name. The syntax tier knows only the written
 * name, so a simple name is taken to live in the member's namespace; a written qualified name is
 * kept as written. Empty for any other member. Accepted difference (pinned by
 * KnownDifferences/ExternalRenewal.cs): an interface from another namespace written by its simple
 * name, or a partly qualified name, gives another ID than Roslyn's.
 */
function explicitInterface(member: SyntaxNode, namespace: string): string {
  const specifier = member.namedChildren.find(c => c.type === 'explicit_interface_specifier');
  const written = specifier?.namedChildren.find(c => c.type !== 'comment')?.text.replace(/\s+/g, '');
  if (!written) return '';
  const qualified = written.includes('.') || written.includes('::') ? written : qualify(namespace, written);
  return `${qualified}.`;
}

function namespaceName(declaration: SyntaxNode): string {
  return (declaration.childForFieldName('name')?.text ?? '').replace(/\s+/g, '');
}

function qualify(container: string, name: string): string {
  return container ? `${container}.${name}` : name;
}

/**
 * Fact evidence of one C# file from its tree-sitter tree, the syntax-tier twin of the Roslyn helper:
 * conditions (if, while, do, for, `?:`, case guards, catch filters) with a literal comparison or
 * `is` pattern, case labels and switch arms, normalization calls, retry/timeout bindings, TimeSpan
 * durations and minimal API routes. Members as in Roslyn: methods, constructors, properties,
 * events and field declarators (indexers, operators, conversion operators, destructors and enum
 * values give none); top-level statements have no symbol ID, so the finisher gives them the module
 * ID. A public method or constructor gets the syntax tier's own ID (`<Ns.Type.Method>(<n>)`),
 * every other member the full-tier shape; namespaces come from both namespace forms.
 * Attribute routes come from `annotationRouteEvidence`. At most 2,000 records, in source order.
 * An explicit interface implementation is named `<Type>.<Ns.Interface>.<Member>`, as in Roslyn.
 * A public method of a non-public or nested type still gets the `(n)` ID, though the syntax tier
 * indexes no symbol for it (an accepted difference).
 *
 * `_symbols` is unused on purpose: every ID comes from the declarations themselves; the parameter stays
 * because the plan fixed this signature.
 */
export function collectTreeSitterEvidence(
  root: SyntaxNode,
  file: string,
  _symbols: readonly SymbolNode[],
  options: FactOptions,
): FactEvidence[] {
  const collector = new Collector(root, root.text, file, options);
  collector.declarations(root, '');
  return collector.evidence;
}
