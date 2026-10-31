// Java fact evidence of the tree-sitter (syntax) tier (PR 4, issue #156, Fact contract FC-3 to FC-5).
// It mirrors the JDT collector (packages/lang-java-analyzer/java/src/main/java/io/ctxo/jdt/FactEvidence.java)
// node for node, so both tiers give the same facts; the shared finisher decides which evidence
// becomes a fact.
import type { SyntaxNode } from 'tree-sitter';
import type { SymbolNode } from '@ctxo/plugin-api';
import type { DurationUnit, FactEvidence, FactOptions, LiteralKind } from './fact-types.js';
import { hasRetryTimeoutFragment, matchesNormalizationPattern } from './fact-rules.js';
import { annotationRouteEvidence } from './annotation-endpoints.js';
import { decodeJavaStringLiteral } from './java-string-literal.js';

/** At most this many CST evidence records per file, as in the JDT collector (routes come on top). */
export const MAX_EVIDENCE_PER_FILE = 2000;

const COMPARISONS: ReadonlySet<string> = new Set(['==', '!=', '<', '<=', '>', '>=']);
const ARITHMETIC: ReadonlySet<string> = new Set(['+', '-', '*', '/']);

const NUMBER_LITERALS: ReadonlySet<string> = new Set([
  'decimal_integer_literal',
  'hex_integer_literal',
  'octal_integer_literal',
  'binary_integer_literal',
  'decimal_floating_point_literal',
  'hex_floating_point_literal',
]);

/** Declaration node type -> the kind of its symbol ID, as EmitVisitor names types. */
const TYPE_OWNER_KIND: Readonly<Record<string, string>> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'type',
  record_declaration: 'class',
  annotation_type_declaration: 'interface',
};

const METHOD_DECLARATIONS: ReadonlySet<string> = new Set([
  'method_declaration',
  'constructor_declaration',
  'compact_constructor_declaration',
]);

const FIELD_DECLARATIONS: ReadonlySet<string> = new Set(['field_declaration', 'constant_declaration']);

const DURATION_METHODS: Readonly<Record<string, DurationUnit>> = {
  ofNanos: 'ns', ofMillis: 'ms', ofSeconds: 's', ofMinutes: 'min', ofHours: 'h', ofDays: 'd',
};

const CHRONO_UNITS: Readonly<Record<string, DurationUnit>> = {
  NANOS: 'ns', MICROS: 'us', MILLIS: 'ms', SECONDS: 's', MINUTES: 'min', HOURS: 'h', DAYS: 'd',
};

const INT_MIN = -(2n ** 31n);
const INT_MAX = 2n ** 31n - 1n;

function isComment(node: SyntaxNode): boolean {
  return node.type === 'line_comment' || node.type === 'block_comment';
}

/** The named children without comments. */
function children(node: SyntaxNode): SyntaxNode[] {
  return node.namedChildren.filter((c) => !isComment(c));
}

function same(a: SyntaxNode | null | undefined, b: SyntaxNode): boolean {
  return !!a && a.type === b.type && a.startIndex === b.startIndex && a.endIndex === b.endIndex;
}

/** The expression inside one pair of parentheses. */
function unparen(node: SyntaxNode): SyntaxNode | undefined {
  return children(node)[0];
}

function operatorOf(node: SyntaxNode): string | undefined {
  return node.childForFieldName('operator')?.type;
}

/** A method invocation with a `super` receiver (`super.f()`, `A.super.f()`): JDT's SuperMethodInvocation, not reported. */
function isSuperCall(call: SyntaxNode): boolean {
  return call.children.some((c) => c.type === 'super');
}

/** number (a number literal, optionally under a unary minus), string (text blocks too), char, boolean, null; else undefined. */
function literalKind(node: SyntaxNode): LiteralKind | undefined {
  if (NUMBER_LITERALS.has(node.type)) return 'number';
  if (node.type === 'unary_expression') {
    const operand = node.childForFieldName('operand');
    return operatorOf(node) === '-' && operand && NUMBER_LITERALS.has(operand.type) ? 'number' : undefined;
  }
  if (node.type === 'string_literal') return 'string';
  if (node.type === 'character_literal') return 'char';
  if (node.type === 'true' || node.type === 'false') return 'boolean';
  if (node.type === 'null_literal') return 'null';
  return undefined;
}

/** The assigned name: an identifier, or the field of a field access (`this.x`, `a.b`, `super.x`); else undefined. */
function assignedName(left: SyntaxNode | null): string | undefined {
  if (!left) return undefined;
  if (left.type === 'identifier') return left.text;
  if (left.type === 'field_access') return left.childForFieldName('field')?.text;
  return undefined;
}

/** A dotted name of identifiers only (`ChronoUnit`, `java.time.temporal.ChronoUnit`), as JDT's QualifiedName; else undefined. */
function dottedName(node: SyntaxNode): string | undefined {
  if (node.type === 'identifier') return node.text;
  if (node.type !== 'field_access') return undefined;
  const object = node.childForFieldName('object');
  const field = node.childForFieldName('field');
  if (!object || !field || field.type !== 'identifier') return undefined;
  const qualifier = dottedName(object);
  return qualifier === undefined ? undefined : `${qualifier}.${field.text}`;
}

// ── FC-4b: where a normalization call's value goes ──

/** Statements, declarations, bodies and lambdas end the walk, as in the JDT collector. */
function endsDestination(node: SyntaxNode): boolean {
  return node.type.endsWith('_statement') || node.type.endsWith('_declaration') || node.type === 'block'
    || node.type === 'constructor_body' || node.type === 'class_body' || node.type === 'lambda_expression'
    || node.type === 'program';
}

/** ASCII whitespace, the one definition every tier uses (space, tab, LF, CR, FF, VT). */
const ASCII_WHITESPACE = /[ \t\n\r\f\v]/;

const JAVA_SIMPLE_ESCAPES: Readonly<Record<string, string>> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', s: ' ', '"': '"', "'": "'", '\\': '\\' };

/** A plain string literal's body with Unicode, octal and simple escapes decoded, as JDT's literal value has them. */
function decodeJavaEscapes(body: string): string {
  return body.replace(/\\(u+[0-9a-fA-F]{4}|[0-7]{1,3}|[\s\S])/g, (_, escape: string) => {
    if (escape.startsWith('u')) return String.fromCharCode(parseInt(escape.replace(/^u+/, ''), 16));
    if (/^[0-7]/.test(escape)) return String.fromCharCode(parseInt(escape, 8));
    return JAVA_SIMPLE_ESCAPES[escape] ?? escape;
  });
}

/** A string literal or text block whose value holds ASCII whitespace. */
function isProse(node: SyntaxNode): boolean {
  if (node.type !== 'string_literal') return false;
  if (node.text.startsWith('"""')) {
    const content = decodeJavaStringLiteral(node.text);
    return ASCII_WHITESPACE.test(content ?? node.text.slice(3, -3));
  }
  return ASCII_WHITESPACE.test(decodeJavaEscapes(node.text.slice(1, -1)));
}

/** The operands of a `+` chain, through nested `+` (not through parentheses). */
function concatOperands(node: SyntaxNode, out: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === 'binary_expression' && operatorOf(node) === '+') {
    for (const side of [node.childForFieldName('left'), node.childForFieldName('right')]) if (side) concatOperands(side, out);
  } else {
    out.push(node);
  }
  return out;
}

/** The callee as the JDT collector writes it: `receiver.name`, or `name` alone. */
function calleeText(call: SyntaxNode): string {
  const object = call.childForFieldName('object');
  const name = call.childForFieldName('name')?.text ?? '';
  return (object ? `${object.text}.${name}` : name).replace(/\s+/g, ' ').trim();
}

/**
 * FC-4b: up to the statement and never out of a lambda, the nearest call (`new T` for a construction)
 * that takes the value as an argument, and whether on the way the value is an operand of a `+` chain
 * with a string whose value holds ASCII whitespace. The syntax tier has no types (no `consumerTypes`).
 */
function destination(call: SyntaxNode): { consumer: string | undefined; inProse: boolean } {
  let inProse = false;
  let node = call;
  for (let parent = node.parent; parent; node = parent, parent = parent.parent) {
    if (endsDestination(parent)) break;
    const args = parent.childForFieldName('arguments');
    if (parent.type === 'method_invocation' && args && same(args, node)) {
      return { consumer: calleeText(parent), inProse };
    } else if (parent.type === 'object_creation_expression' && args && same(args, node)) {
      return { consumer: `new ${(parent.childForFieldName('type')?.text ?? '').replace(/\s+/g, ' ').trim()}`, inProse };
    } else if (parent.type === 'binary_expression' && operatorOf(parent) === '+') {
      if (concatOperands(parent).some(isProse)) inProse = true;
    }
  }
  return { consumer: undefined, inProse };
}

function callArguments(call: SyntaxNode): SyntaxNode[] {
  const list = call.childForFieldName('arguments');
  return list ? children(list) : [];
}

/** `Duration.ofX(n)` or `Duration.of(n, ChronoUnit.X)` with a known unit, by name; else undefined. */
function durationUnit(call: SyntaxNode): DurationUnit | undefined {
  if (call.type !== 'method_invocation' || isSuperCall(call)) return undefined;
  const receiver = call.childForFieldName('object');
  if (!receiver) return undefined;
  if (receiver.text !== 'Duration' && receiver.text !== 'java.time.Duration') return undefined;
  const method = call.childForFieldName('name')?.text ?? '';
  const args = callArguments(call);
  if (args.length === 1) return Object.hasOwn(DURATION_METHODS, method) ? DURATION_METHODS[method] : undefined;
  if (args.length !== 2 || method !== 'of' || args[1]!.type !== 'field_access') return undefined;
  const unit = args[1]!;
  const owner = dottedName(unit.childForFieldName('object')!);
  if (owner === undefined || dottedName(unit) === undefined) return undefined;
  if (owner !== 'ChronoUnit' && owner !== 'java.time.temporal.ChronoUnit') return undefined;
  const name = unit.childForFieldName('field')!.text;
  return Object.hasOwn(CHRONO_UNITS, name) ? CHRONO_UNITS[name] : undefined;
}

/** True when the call is the whole value of a declarator, resource, plain assignment or annotation member. */
function boundDuration(call: SyntaxNode): boolean {
  const parent = call.parent;
  if (!parent) return false;
  if (parent.type === 'variable_declarator' || parent.type === 'resource' || parent.type === 'element_value_pair') {
    return same(parent.childForFieldName('value'), call);
  }
  if (parent.type === 'assignment_expression') {
    return same(parent.childForFieldName('right'), call)
      && operatorOf(parent) === '='
      && assignedName(parent.childForFieldName('left')) !== undefined;
  }
  return false;
}

// ── Int overflow (Java wraps, the shared rules do not), from the literals alone ──

class Overflow extends Error {}

/** An exact integer and whether its Java type is long (an `L` suffix somewhere in it); else int. */
interface Exact { readonly value: bigint; readonly isLong: boolean }

/**
 * True when `node` is integer literal arithmetic (`+ - * /`, parentheses, unary signs) in which some
 * int-typed step leaves the int range, as the JDT collector decides it. The rule is type-free: an
 * integer literal without `L` is an int. Hex, octal and binary int literals above INT_MAX count as
 * leaving the range. Anything else (names, casts) is false: the shared rules decide about it.
 */
export function overflowsInt(node: SyntaxNode): boolean {
  try {
    exact(node);
    return false;
  } catch (err) {
    if (err instanceof Overflow) return true;
    throw err;
  }
}

function checkInt(value: bigint, isInt: boolean): void {
  if (isInt && (value < INT_MIN || value > INT_MAX)) throw new Overflow();
}

function exact(node: SyntaxNode): Exact | undefined {
  const result = exactUnchecked(node);
  if (result) checkInt(result.value, !result.isLong);
  return result;
}

/** The operands of a left-nested chain of one operator, flattened as JDT's extended operands. */
function chain(node: SyntaxNode, op: string): SyntaxNode[] {
  const left = node.childForFieldName('left')!;
  const right = node.childForFieldName('right')!;
  const head = left.type === 'binary_expression' && operatorOf(left) === op ? chain(left, op) : [left];
  return [...head, right];
}

function exactUnchecked(node: SyntaxNode): Exact | undefined {
  if (NUMBER_LITERALS.has(node.type)) return integerLiteral(node.text, false);
  if (node.type === 'parenthesized_expression') {
    const inner = unparen(node);
    return inner ? exact(inner) : undefined;
  }
  if (node.type === 'unary_expression') {
    const op = operatorOf(node);
    const operand = node.childForFieldName('operand');
    if ((op !== '-' && op !== '+') || !operand) return undefined;
    // -2147483648 is an int: the literal under the minus is not checked on its own.
    const literal = NUMBER_LITERALS.has(operand.type);
    const value = literal ? integerLiteral(operand.text, op === '-') : exact(operand);
    if (!value) return undefined;
    return op === '-' && !literal ? { value: -value.value, isLong: value.isLong } : value;
  }
  if (node.type === 'binary_expression') {
    const op = operatorOf(node);
    if (!op || !ARITHMETIC.has(op)) return undefined;
    // Every operand is evaluated (and checked) first, then the chain is folded left to right; the
    // int steps before the first floating operand are checked, and from there on the result is not
    // an exact integer.
    const values = chain(node, op).map(exact);
    let acc = values[0];
    if (!acc) return undefined;
    for (let i = 1; i < values.length; i++) {
      const next = values[i];
      if (!next) return undefined;
      const isLong: boolean = acc.isLong || next.isLong;
      let value: bigint;
      if (op === '+') value = acc.value + next.value;
      else if (op === '-') value = acc.value - next.value;
      else if (op === '*') value = acc.value * next.value;
      else if (next.value === 0n) return undefined;
      else value = acc.value / next.value; // truncates toward zero, as Java does
      checkInt(value, !isLong);
      acc = { value, isLong };
    }
    return acc;
  }
  return undefined;
}

/** An integer literal's exact value (negated when `negate`); undefined for floating-point literals. */
function integerLiteral(token: string, negate: boolean): Exact | undefined {
  let text = token.replace(/_/g, '').toLowerCase();
  const isLong = text.endsWith('l');
  if (isLong) text = text.slice(0, -1);
  let value: bigint;
  try {
    if (text.startsWith('0x')) {
      if (text.includes('p') || text.includes('.') || text.length === 2) return undefined;
      value = BigInt(text);
    } else if (text.startsWith('0b')) {
      if (text.length === 2) return undefined;
      value = BigInt(text);
    } else if (text.includes('.') || text.includes('e') || text.endsWith('f') || text.endsWith('d')) {
      return undefined;
    } else if (text.length > 1 && text.startsWith('0')) {
      value = BigInt(`0o${text.slice(1)}`);
    } else {
      value = BigInt(text);
    }
  } catch {
    return undefined;
  }
  return { value: negate ? -value : value, isLong };
}

// ── The walk ──

class Collector {
  private readonly owners: string[] = [];
  readonly out: FactEvidence[] = [];

  constructor(private readonly file: string, private readonly patterns: readonly string[]) {}

  private id(name: string, kind: string): string {
    return `${this.file}::${name}::${kind}`;
  }

  private owner(): string | undefined {
    return this.owners[this.owners.length - 1];
  }

  private full(): boolean {
    return this.out.length >= MAX_EVIDENCE_PER_FILE;
  }

  private push(evidence: FactEvidence): void {
    this.out.push(evidence);
  }

  private base(node: SyntaxNode): { symbolId?: string; line: number } {
    const symbolId = this.owner();
    return { ...(symbolId !== undefined ? { symbolId } : {}), line: node.startPosition.row };
  }

  visit(node: SyntaxNode): void {
    const owner = this.ownerOf(node);
    if (owner !== undefined) this.owners.push(owner);
    this.inspect(node);
    if (FIELD_DECLARATIONS.has(node.type)) {
      for (const child of node.namedChildren) {
        const declarator = child.type === 'variable_declarator' ? child.childForFieldName('name')?.text : undefined;
        if (declarator !== undefined) this.owners.push(this.id(declarator, 'variable'));
        this.visit(child);
        if (declarator !== undefined) this.owners.pop();
      }
    } else {
      for (const child of node.namedChildren) this.visit(child);
    }
    if (owner !== undefined) this.owners.pop();
  }

  /** The owner a declaration opens, as EmitVisitor names it (a field opens its first declarator). */
  private ownerOf(node: SyntaxNode): string | undefined {
    const typeKind = TYPE_OWNER_KIND[node.type];
    if (typeKind !== undefined) {
      const name = node.childForFieldName('name')?.text;
      return name === undefined ? undefined : this.id(name, typeKind);
    }
    if (METHOD_DECLARATIONS.has(node.type)) {
      const name = node.childForFieldName('name')?.text ?? node.namedChildren.find((c) => c.type === 'identifier')?.text;
      return name === undefined ? undefined : this.id(name, 'method');
    }
    if (FIELD_DECLARATIONS.has(node.type)) {
      const first = node.namedChildren.find((c) => c.type === 'variable_declarator')?.childForFieldName('name')?.text;
      return first === undefined ? undefined : this.id(first, 'variable');
    }
    return undefined;
  }

  private inspect(node: SyntaxNode): void {
    switch (node.type) {
      case 'if_statement':
      case 'while_statement':
      case 'do_statement':
      case 'for_statement':
      case 'ternary_expression': {
        const condition = node.childForFieldName('condition');
        if (condition) this.condition(condition);
        return;
      }
      case 'switch_expression':
        this.caseLabels(node);
        return;
      case 'method_invocation':
        this.call(node);
        return;
      case 'variable_declarator':
      case 'resource': {
        const name = node.childForFieldName('name')?.text;
        const value = node.childForFieldName('value');
        if (name !== undefined && value) this.bound(node, name, value);
        return;
      }
      case 'assignment_expression': {
        if (operatorOf(node) !== '=') return;
        const name = assignedName(node.childForFieldName('left'));
        const value = node.childForFieldName('right');
        if (name !== undefined && value) this.bound(node, name, value);
        return;
      }
      case 'element_value_pair': {
        const name = node.childForFieldName('key')?.text;
        const value = node.childForFieldName('value');
        if (name !== undefined && value) this.bound(node, name, value);
        return;
      }
      default:
    }
  }

  // ── Conditions ──

  private condition(node: SyntaxNode): void {
    if (node.type === 'parenthesized_expression') {
      const inner = unparen(node);
      if (inner) this.condition(inner);
      return;
    }
    if (node.type === 'unary_expression') {
      const operand = node.childForFieldName('operand');
      if (operatorOf(node) === '!' && operand) this.condition(operand);
      return;
    }
    if (node.type !== 'binary_expression') return;
    const op = operatorOf(node);
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!op || !left || !right) return;
    if (op === '&&' || op === '||') {
      this.condition(left);
      this.condition(right);
      return;
    }
    // JDT keeps `a == b == c` nested (no extended operands), so the outer comparison is checked too.
    if (!COMPARISONS.has(op)) return;
    const leftKind = literalKind(left);
    const rightKind = literalKind(right);
    if ((leftKind === undefined) === (rightKind === undefined)) return;
    const literal = leftKind !== undefined ? left : right;
    // 0xFFFFFFFF is -1 in Java, the shared rules would read 4294967295: not a constant, no fact.
    if (overflowsInt(literal) || this.full()) return;
    this.push({
      kind: 'comparison', ...this.base(node), text: node.text, operator: op, literal: literal.text, literalKind: (leftKind ?? rightKind)!,
    });
  }

  private caseLabels(node: SyntaxNode): void {
    const subjectNode = node.childForFieldName('condition');
    const subject = subjectNode?.type === 'parenthesized_expression' ? unparen(subjectNode) : subjectNode;
    const body = node.childForFieldName('body');
    if (!subject || !body) return;
    for (const entry of body.namedChildren) {
      if (entry.type !== 'switch_block_statement_group' && entry.type !== 'switch_rule') continue;
      for (const label of entry.namedChildren) {
        if (label.type !== 'switch_label') continue;
        for (const value of children(label)) {
          const kind = literalKind(value);
          if (kind === undefined || overflowsInt(value)) continue;
          if (this.full()) return;
          this.push({
            kind: 'comparison', ...this.base(label), text: `${subject.text} case ${value.text}`, operator: 'case', literal: value.text, literalKind: kind,
          });
        }
      }
    }
  }

  // ── Calls and durations ──

  private call(node: SyntaxNode): void {
    if (isSuperCall(node)) return;
    const method = node.childForFieldName('name')?.text;
    if (method === undefined) return;
    const qualifier = node.childForFieldName('object')?.text;
    if (matchesNormalizationPattern(method, qualifier, this.patterns) && !this.full()) {
      const { consumer, inProse } = destination(node);
      this.push({
        kind: 'call',
        ...this.base(node),
        text: node.text,
        method,
        ...(qualifier !== undefined ? { qualifier } : {}),
        ...(consumer !== undefined ? { consumer } : {}),
        ...(inProse ? { inProse } : {}),
      });
    }
    if (durationUnit(node) !== undefined && !boundDuration(node)) this.duration(node, undefined);
  }

  private duration(call: SyntaxNode, name: string | undefined): void {
    const unit = durationUnit(call)!;
    const amount = callArguments(call)[0]!;
    if (overflowsInt(amount) || this.full()) return;
    this.push({
      kind: 'duration',
      ...this.base(call),
      ...(name !== undefined ? { name } : {}),
      constructor: `${call.childForFieldName('object')!.text}.${call.childForFieldName('name')!.text}`,
      unit,
      amount: amount.text,
    });
  }

  // ── Bindings ──

  /** A named duration whatever the name; otherwise a binding when the name has a retry or timeout fragment. */
  private bound(node: SyntaxNode, name: string, value: SyntaxNode): void {
    if (durationUnit(value) !== undefined) {
      this.duration(value, name);
      return;
    }
    if (!hasRetryTimeoutFragment(name) || overflowsInt(value) || this.full()) return;
    this.push({ kind: 'binding', ...this.base(node), name, value: value.text });
  }
}

/**
 * The fact evidence of one parsed Java file: comparisons in conditions and case labels, normalization
 * calls, retry and timeout bindings and durations (at most `MAX_EVIDENCE_PER_FILE`), then the Spring
 * and JAX-RS routes of `symbols`' annotations. IDs follow the JDT tier's owners.
 */
export function collectTreeSitterEvidence(
  root: SyntaxNode,
  file: string,
  symbols: readonly SymbolNode[],
  options: FactOptions,
): FactEvidence[] {
  const collector = new Collector(file, options.normalizationMethods);
  collector.visit(root);
  return [...collector.out, ...annotationRouteEvidence(symbols)];
}
