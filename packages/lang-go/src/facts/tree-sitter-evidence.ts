// Go fact evidence from the tree-sitter CST (PR 4, issue #156): the syntax tier's port of the analyzer's
// collector (tools/ctxo-go-analyzer/internal/facts/facts.go). It walks the same places (function and method
// bodies, package-level const and var values) and reports the same evidence; the shared finisher decides what
// becomes a fact. Without types it decides by names and import paths:
// - nil, true and false are literals unless the file declares an identifier of that name;
// - time.<Unit> and time.Duration are found through the local name of the "time" import;
// - routes are net/http.HandleFunc and Handle through the "net/http" import name, <x>.HandleFunc and <x>.Handle in
//   a file that imports net/http, and the gin, echo and chi routing methods on a receiver the file shows to be a
//   router of that framework (a constructor, a group, a chi closure parameter or mount target, or a declared
//   framework type; tree-sitter-prefixes.ts); a route path is a string literal, a + of them, or a string constant
//   declared in the same file, joined to its group or mount prefix;
// - a keyed element is a struct field unless its composite literal is a map, slice or array literal.
import type { SyntaxNode } from 'tree-sitter';
import type { SymbolNode } from '@ctxo/plugin-api';
import type { DurationUnit, FactEvidence, FactOptions, LiteralKind } from './fact-types.js';
import { hasRetryTimeoutFragment, matchesNormalizationPattern } from './fact-rules.js';
import { receiverTypeName } from '../receiver-type.js';
import { TreeSitterPrefixes } from './tree-sitter-prefixes.js';

/** The most evidence records collected for one file, as in the analyzer (Q21). */
export const MAX_EVIDENCE_PER_FILE = 2000;

const DURATION_UNITS: Readonly<Record<string, DurationUnit>> = {
  Nanosecond: 'ns', Microsecond: 'us', Millisecond: 'ms', Second: 's', Minute: 'min', Hour: 'h',
};

const GIN_VERBS: Readonly<Record<string, string>> = {
  GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE', PATCH: 'PATCH', HEAD: 'HEAD', OPTIONS: 'OPTIONS', Any: 'ANY',
};

/** echo route methods gin does not have. */
const ECHO_ONLY_VERBS: Readonly<Record<string, string>> = { CONNECT: 'CONNECT', TRACE: 'TRACE' };

const CHI_VERBS: Readonly<Record<string, string>> = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Delete: 'DELETE', Patch: 'PATCH', Head: 'HEAD', Options: 'OPTIONS', Connect: 'CONNECT', Trace: 'TRACE',
};

const COMPARISONS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const UNIVERSE_LITERALS = new Set(['nil', 'true', 'false']);
const NON_STRUCT_LITERAL_TYPES = new Set(['map_type', 'slice_type', 'array_type', 'implicit_length_array_type']);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type DurationEvidence = Mutable<Extract<FactEvidence, { kind: 'duration' }>>;

const nodeKey = (node: SyntaxNode) => `${node.startIndex}:${node.endIndex}:${node.type}`;

/** A matched duration product: a base (`other` * time.<Unit>) or a chain step over a matched `side`. */
interface DurationMatch {
  readonly unit: DurationUnit;
  readonly unitName: string;
  readonly other?: SyntaxNode;
  readonly chain?: { readonly side: SyntaxNode; readonly rest: SyntaxNode };
}

/** The operands of an `x * y` binary expression, or undefined for any other node. */
function productOperands(node: SyntaxNode): readonly [SyntaxNode, SyntaxNode] | undefined {
  if (node.type !== 'binary_expression' || node.childForFieldName('operator')?.text !== '*') return undefined;
  const x = node.childForFieldName('left');
  const y = node.childForFieldName('right');
  return x && y ? [x, y] : undefined;
}

function children(node: SyntaxNode | null | undefined): SyntaxNode[] {
  return node ? node.namedChildren.filter((c) => c.type !== 'comment') : [];
}

/** The declared names of a const_spec or var_spec (the `name` field also holds the separating commas). */
function declaredNames(spec: SyntaxNode): SyntaxNode[] {
  return spec.childrenForFieldName('name').filter((n) => n.isNamed);
}

// ── FC-4b: where a normalization call's value goes ──

/** Statements, declarations, specs, blocks and function literals end the walk, as in ctxo-go-analyzer. */
function endsDestination(node: SyntaxNode): boolean {
  return node.type.endsWith('_statement') || node.type.endsWith('_declaration') || node.type.endsWith('_spec')
    || node.type === 'block' || node.type === 'func_literal' || node.type === 'source_file';
}

/** ASCII whitespace, the one definition every tier uses (space, tab, LF, CR, FF, VT). */
const ASCII_WHITESPACE = /[ \t\n\r\f\v]/;

const GO_SIMPLE_ESCAPES: Readonly<Record<string, string>> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"' };

/** The value of a Go escape sequence, as `strconv.Unquote` decodes it (simple, octal, `\x`, `\u`, `\U`). */
function goEscapeValue(sequence: string): string {
  const body = sequence.slice(1);
  const simple = GO_SIMPLE_ESCAPES[body];
  if (simple !== undefined) return simple;
  const code = /^[0-7]{3}$/.test(body) ? parseInt(body, 8) : /^[xuU][0-9a-fA-F]+$/.test(body) ? parseInt(body.slice(1), 16) : NaN;
  return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** A string literal whose value holds ASCII whitespace (escapes decoded as `strconv.Unquote` does). */
function isProse(node: SyntaxNode): boolean {
  if (node.type === 'raw_string_literal') return ASCII_WHITESPACE.test(node.text.slice(1, -1).replace(/\r/g, ''));
  if (node.type !== 'interpreted_string_literal') return false;
  return node.namedChildren.some(part => ASCII_WHITESPACE.test(part.type === 'escape_sequence' ? goEscapeValue(part.text) : part.text));
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
 * FC-4b, as ctxo-go-analyzer reads it: up to the statement or spec and never out of a function literal,
 * the nearest call that takes the value as an argument, and whether on the way the value is an operand of
 * a `+` chain with a string literal whose value holds ASCII whitespace. No types in the syntax tier.
 */
function destination(call: SyntaxNode): { consumer: string | undefined; inProse: boolean } {
  let inProse = false;
  let node = call;
  for (let parent = node.parent; parent; node = parent, parent = parent.parent) {
    if (endsDestination(parent)) break;
    const args = parent.childForFieldName('arguments');
    if (parent.type === 'call_expression' && args && args.startIndex === node.startIndex && args.endIndex === node.endIndex) {
      return { consumer: (parent.childForFieldName('function')?.text ?? '').replace(/\s+/g, ' ').trim(), inProse };
    } else if (parent.type === 'binary_expression' && parent.childForFieldName('operator')?.text === '+') {
      if (concatOperands(parent).some(isProse)) inProse = true;
    }
  }
  return { consumer: undefined, inProse };
}

function unparen(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const inner = children(current)[0];
    if (!inner) return current;
    current = inner;
  }
  return current;
}

/** The value of a Go interpreted string literal (`"..."`), or undefined when it is not valid. */
function decodeInterpreted(literal: string): string | undefined {
  if (literal.length < 2 || !literal.startsWith('"') || !literal.endsWith('"')) return undefined;
  const body = literal.slice(1, -1);
  const bytes: number[] = [];
  const pushText = (text: string) => bytes.push(...new TextEncoder().encode(text));
  const simple: Readonly<Record<string, number>> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '\\': 92, '"': 34 };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      const cp = body.codePointAt(i)!;
      const text = String.fromCodePoint(cp);
      pushText(text);
      i += text.length - 1;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) return undefined;
    if (simple[next] !== undefined) {
      bytes.push(simple[next]!);
      i++;
    } else if (next === 'x') {
      const hex = body.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return undefined;
      bytes.push(parseInt(hex, 16));
      i += 3;
    } else if (/[0-7]/.test(next)) {
      const oct = body.slice(i + 1, i + 4);
      if (!/^[0-7]{3}$/.test(oct) || parseInt(oct, 8) > 255) return undefined;
      bytes.push(parseInt(oct, 8));
      i += 3;
    } else if (next === 'u' || next === 'U') {
      const length = next === 'u' ? 4 : 8;
      const hex = body.slice(i + 2, i + 2 + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) return undefined;
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return undefined;
      pushText(String.fromCodePoint(cp));
      i += 1 + length;
    } else {
      return undefined;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The default package name of an import path: its last segment, the one before a /vN major suffix. */
function defaultImportName(path: string): string {
  const segments = path.split('/');
  let last = segments[segments.length - 1] ?? path;
  if (/^v\d+$/.test(last) && segments.length > 1) last = segments[segments.length - 2]!;
  return last.replace(/^go-/, '').replace(/[.-].*$/, '');
}

interface FileScope {
  /** Local name of each import path (dot and blank imports left out). */
  readonly imports: ReadonlyMap<string, string>;
  /** Every local import name. */
  readonly importNames: ReadonlySet<string>;
  /** nil, true and false when the file declares an identifier of that name. */
  readonly shadowed: ReadonlySet<string>;
  /** String constants declared in the file, by name (a name declared twice with other values is left out). */
  readonly stringConstants: ReadonlyMap<string, string>;
}

function readScope(root: SyntaxNode): FileScope {
  const imports = new Map<string, string>();
  const shadowed = new Set<string>();
  const constants = new Map<string, string | undefined>();
  const constSpecs: SyntaxNode[] = [];

  // Pre-order with an explicit stack, so deep expressions cannot overflow the stack (B-M2); false skips the children.
  const visit = (node: SyntaxNode): boolean => {
    switch (node.type) {
      case 'import_spec': {
        const path = node.childForFieldName('path');
        const value = path ? decodeInterpreted(path.text) ?? (path.type === 'raw_string_literal' ? path.text.slice(1, -1) : undefined) : undefined;
        const name = node.childForFieldName('name');
        if (value !== undefined && (!name || name.type === 'package_identifier')) imports.set(value, name ? name.text : defaultImportName(value));
        return false;
      }
      case 'identifier':
        if (UNIVERSE_LITERALS.has(node.text)) shadowed.add(node.text);
        return false;
      case 'short_var_declaration':
        for (const target of children(node.childForFieldName('left'))) {
          if (UNIVERSE_LITERALS.has(target.type)) shadowed.add(target.type);
        }
        break;
      case 'const_spec':
        constSpecs.push(node);
        break;
    }
    return true;
  };
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!visit(node)) continue;
    const kids = node.namedChildren;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }

  const scope: FileScope = { imports, importNames: new Set(imports.values()), shadowed, stringConstants: new Map() };
  for (const spec of constSpecs) {
    const names = declaredNames(spec);
    const values = children(spec.childForFieldName('value'));
    if (names.length !== values.length) continue;
    names.forEach((name, i) => {
      const value = constantString(values[i]!, scope);
      const previous = constants.get(name.text);
      constants.set(name.text, constants.has(name.text) && previous !== value ? undefined : value);
    });
  }
  const resolved = scope.stringConstants as Map<string, string>;
  for (const [name, value] of constants) if (value !== undefined) resolved.set(name, value);
  return scope;
}

/** A constant string expression: string literals, + of them, and the file's string constants. */
function constantString(node: SyntaxNode, scope: FileScope): string | undefined {
  const expr = unparen(node);
  switch (expr.type) {
    case 'interpreted_string_literal':
      return decodeInterpreted(expr.text);
    case 'raw_string_literal':
      return expr.text.slice(1, -1).replace(/\r/g, '');
    case 'binary_expression': {
      if (expr.childForFieldName('operator')?.text !== '+') return undefined;
      const left = expr.childForFieldName('left');
      const right = expr.childForFieldName('right');
      const a = left ? constantString(left, scope) : undefined;
      const b = right ? constantString(right, scope) : undefined;
      return a !== undefined && b !== undefined ? a + b : undefined;
    }
    case 'identifier':
      return scope.stringConstants.get(expr.text);
    default:
      return undefined;
  }
}

/** Splits a net/http pattern "[METHOD ][HOST]/[PATH]" into a verb (ANY without a method) and its path. */
function httpPattern(pattern: string): { verb: string; route: string } | undefined {
  let verb = 'ANY';
  let rest = pattern.trim();
  const space = rest.search(/[ \t]/);
  if (space >= 0) {
    verb = rest.slice(0, space);
    rest = rest.slice(space).replace(/^[ \t]+/, '');
  }
  const slash = rest.indexOf('/');
  return slash < 0 ? undefined : { verb, route: rest.slice(slash) };
}

class Collector {
  readonly out: FactEvidence[] = [];
  private readonly consumed = new Set<string>();
  /** `durationMatch` results by `nodeKey`; null when the node is not a duration product. */
  private readonly durationMatches = new Map<string, DurationMatch | null>();
  private readonly timeName: string | undefined;
  private readonly httpName: string | undefined;
  private readonly prefixes: TreeSitterPrefixes;

  constructor(root: SyntaxNode, private readonly scope: FileScope, private readonly options: FactOptions) {
    this.timeName = scope.imports.get('time');
    this.httpName = scope.imports.get('net/http');
    this.prefixes = new TreeSitterPrefixes(root, { imports: scope.imports, constant: (node) => constantString(node, scope) });
  }

  private add(evidence: FactEvidence): void {
    if (this.out.length < MAX_EVIDENCE_PER_FILE) this.out.push(evidence);
  }

  private static owner(sid: string | undefined): { symbolId?: string } {
    return sid !== undefined ? { symbolId: sid } : {};
  }

  /** Pre-order walk of a body or value, like the analyzer's ast.Inspect; iterative, so deep expressions cannot overflow the stack. */
  inspect(root: SyntaxNode, sid: string | undefined): void {
    const stack: SyntaxNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      this.visitNode(node, sid);
      const kids = node.namedChildren;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
  }

  private visitNode(node: SyntaxNode, sid: string | undefined): void {
    switch (node.type) {
      case 'if_statement': {
        const condition = node.childForFieldName('condition');
        if (condition) this.condition(condition, sid);
        break;
      }
      case 'for_statement': {
        const body = node.childForFieldName('body');
        for (const child of children(node)) {
          if (body && child.startIndex === body.startIndex && child.type === body.type) continue;
          if (child.type === 'range_clause') continue;
          if (child.type === 'for_clause') {
            const condition = child.childForFieldName('condition');
            if (condition) this.condition(condition, sid);
          } else {
            this.condition(child, sid);
          }
        }
        break;
      }
      case 'expression_switch_statement':
        this.switchCases(node, sid);
        break;
      case 'call_expression':
        this.call(node, sid);
        break;
      case 'var_spec':
      case 'const_spec': {
        const names = declaredNames(node);
        const values = children(node.childForFieldName('value'));
        if (names.length === values.length) names.forEach((name, i) => this.binding(name, name.text, values[i]!, sid));
        break;
      }
      case 'short_var_declaration':
      case 'assignment_statement': {
        if (node.type === 'assignment_statement' && node.childForFieldName('operator')?.text !== '=') break;
        const left = children(node.childForFieldName('left'));
        const right = children(node.childForFieldName('right'));
        if (left.length !== right.length) break;
        left.forEach((target, i) => {
          const name = assignedName(target);
          if (name) this.binding(target, name, right[i]!, sid);
        });
        break;
      }
      case 'keyed_element': {
        const key = children(node.childForFieldName('key'))[0];
        const value = children(node.childForFieldName('value'))[0];
        if (key?.type === 'identifier' && value && isStructLiteralElement(node)) this.binding(key, key.text, value, sid);
        break;
      }
      case 'binary_expression': {
        if (this.consumed.has(nodeKey(node))) break;
        const found = this.duration(node);
        if (found) {
          this.consume(found.nested);
          this.add({ ...found.evidence, ...Collector.owner(sid), line: node.startPosition.row });
        }
        break;
      }
    }
  }

  /** The comparisons of a condition, through &&, ||, ! and parentheses. */
  condition(node: SyntaxNode, sid: string | undefined): void {
    switch (node.type) {
      case 'parenthesized_expression': {
        const inner = children(node)[0];
        if (inner) this.condition(inner, sid);
        return;
      }
      case 'unary_expression': {
        const operand = node.childForFieldName('operand');
        if (node.childForFieldName('operator')?.text === '!' && operand) this.condition(operand, sid);
        return;
      }
      case 'binary_expression': {
        const operator = node.childForFieldName('operator')?.text ?? '';
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) return;
        if (operator === '&&' || operator === '||') {
          this.condition(left, sid);
          this.condition(right, sid);
          return;
        }
        if (!COMPARISONS.has(operator)) return;
        const leftKind = this.literalKind(left);
        const rightKind = this.literalKind(right);
        if ((leftKind === undefined) === (rightKind === undefined)) return;
        const [literal, kind] = leftKind !== undefined ? [left, leftKind] : [right, rightKind!];
        this.add({
          kind: 'comparison', ...Collector.owner(sid), line: node.startPosition.row, text: node.text,
          operator, literal: literal.text, literalKind: kind,
        });
        return;
      }
    }
  }

  /** A tagless switch's case expressions as conditions; a tagged switch's literal case values as "<tag> case <value>". */
  private switchCases(node: SyntaxNode, sid: string | undefined): void {
    const tag = node.childForFieldName('value');
    for (const clause of children(node)) {
      if (clause.type !== 'expression_case') continue;
      for (const value of children(clause.childForFieldName('value'))) {
        if (!tag) {
          this.condition(value, sid);
          continue;
        }
        const kind = this.literalKind(value);
        if (kind === undefined) continue;
        this.add({
          kind: 'comparison', ...Collector.owner(sid), line: value.startPosition.row, text: `${tag.text} case ${value.text}`,
          operator: 'case', literal: value.text, literalKind: kind,
        });
      }
    }
  }

  private literalKind(node: SyntaxNode): LiteralKind | undefined {
    switch (node.type) {
      case 'int_literal':
      case 'float_literal':
        return 'number';
      case 'rune_literal':
        return 'char';
      case 'interpreted_string_literal':
      case 'raw_string_literal':
        return 'string';
      case 'unary_expression': {
        const operator = node.childForFieldName('operator')?.text;
        const operand = node.childForFieldName('operand');
        return (operator === '-' || operator === '+') && (operand?.type === 'int_literal' || operand?.type === 'float_literal') ? 'number' : undefined;
      }
      case 'nil':
        return this.scope.shadowed.has('nil') ? undefined : 'null';
      case 'true':
      case 'false':
        return this.scope.shadowed.has(node.type) ? undefined : 'boolean';
      default:
        return undefined;
    }
  }

  private consume(nodes: readonly SyntaxNode[]): void {
    for (const node of nodes) this.consumed.add(nodeKey(node));
  }

  /** A bound value: a duration as a named duration, any other value only when the name has a retry or timeout fragment. */
  binding(at: SyntaxNode, name: string, value: SyntaxNode, sid: string | undefined): void {
    const inner = unparen(value);
    const found = this.duration(inner);
    if (found) {
      this.consume([...found.nested, inner]);
      this.add({ ...found.evidence, ...Collector.owner(sid), line: inner.startPosition.row, name });
      return;
    }
    const unit = this.timeConst(inner);
    if (unit) {
      this.add({ kind: 'duration', ...Collector.owner(sid), line: inner.startPosition.row, name, constructor: `time.${unit.name}`, unit: unit.unit, amount: '1' });
      return;
    }
    if (!hasRetryTimeoutFragment(name)) return;
    this.add({ kind: 'binding', ...Collector.owner(sid), line: at.startPosition.row, name, value: value.text });
  }

  /** A time.<Unit> constant through the local name of the "time" import. */
  private timeConst(node: SyntaxNode): { unit: DurationUnit; name: string } | undefined {
    const expr = unparen(node);
    if (!this.timeName || expr.type !== 'selector_expression') return undefined;
    const operand = expr.childForFieldName('operand');
    const field = expr.childForFieldName('field')?.text;
    if (operand?.type !== 'identifier' || operand.text !== this.timeName || !field) return undefined;
    const unit = DURATION_UNITS[field];
    return unit ? { unit, name: field } : undefined;
  }

  private isDurationType(fun: SyntaxNode): boolean {
    const expr = unparen(fun);
    if (!this.timeName || expr.type !== 'selector_expression') return false;
    const operand = expr.childForFieldName('operand');
    return operand?.type === 'identifier' && operand.text === this.timeName && expr.childForFieldName('field')?.text === 'Duration';
  }

  /** time.Duration(n) unwrapped to n. */
  private amountOf(node: SyntaxNode): SyntaxNode {
    const amount = unparen(node);
    if (amount.type === 'call_expression') {
      const fun = amount.childForFieldName('function');
      const args = children(amount.childForFieldName('arguments'));
      if (fun && args.length === 1 && this.isDurationType(fun)) return args[0]!;
    }
    return amount;
  }

  /**
   * n * time.<Unit> and time.Duration(n) * time.<Unit>, either order; a chain such as 2 * time.Second * 3 is one
   * duration whose amount multiplies the parts, and `nested` holds the inner products the caller must not report again.
   */
  private duration(node: SyntaxNode): { evidence: Omit<DurationEvidence, 'line'>; nested: SyntaxNode[] } | undefined {
    const match = this.durationMatch(node);
    if (!match) return undefined;
    // Walk down the chain once: the nested products and the amounts multiplied on the way up.
    const nested: SyntaxNode[] = [];
    const rests: SyntaxNode[] = [];
    let base = match;
    while (base.chain) {
      nested.push(base.chain.side);
      rests.push(base.chain.rest);
      base = this.durationMatch(base.chain.side)!;
    }
    // amount(k) = `(${amount(k - 1)}) * (${rest(k)})`, unrolled: k opening parentheses, the base amount, then
    // `) * (rest)` from the innermost product outwards.
    let amount = '('.repeat(rests.length) + this.amountOf(base.other!).text;
    for (let i = rests.length - 1; i >= 0; i--) amount += `) * (${this.amountOf(rests[i]!).text})`;
    return {
      evidence: { kind: 'duration', constructor: `time.${base.unitName}`, unit: base.unit, amount },
      nested: nested.reverse(),
    };
  }

  /**
   * The match of `duration`, memoised per node and computed bottom-up with an explicit stack, so a chain of n
   * products costs O(n) over the whole file and cannot overflow the stack (B-M2). A match is either a base
   * product (`other` * time.<Unit>) or a chain step (`chain.side` is a matched product, `chain.rest` the factor).
   */
  private durationMatch(root: SyntaxNode): DurationMatch | undefined {
    const rootKey = nodeKey(root);
    if (!this.durationMatches.has(rootKey)) {
      const stack: Array<{ node: SyntaxNode; expanded: boolean }> = [{ node: root, expanded: false }];
      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const key = nodeKey(top.node);
        if (this.durationMatches.has(key)) {
          stack.pop();
          continue;
        }
        const operands = productOperands(top.node);
        if (!operands) {
          this.durationMatches.set(key, null);
          stack.pop();
          continue;
        }
        if (!top.expanded) {
          top.expanded = true;
          stack.push({ node: unparen(operands[1]), expanded: false }, { node: unparen(operands[0]), expanded: false });
          continue;
        }
        this.durationMatches.set(key, this.combineDuration(operands[0], operands[1]));
        stack.pop();
      }
    }
    return this.durationMatches.get(rootKey) ?? undefined;
  }

  /** One step of `durationMatch` for x * y, with the matches of both (unparenthesised) operands already known. */
  private combineDuration(x: SyntaxNode, y: SyntaxNode): DurationMatch | null {
    let other = y;
    let unit = this.timeConst(x);
    if (!unit) {
      other = x;
      unit = this.timeConst(y);
    }
    if (unit) {
      if (this.timeConst(other)) return null;
      return { unit: unit.unit, unitName: unit.name, other };
    }
    for (const [first, rest] of [[x, y], [y, x]] as const) {
      const side = unparen(first);
      const inner = this.durationMatches.get(nodeKey(side));
      if (!inner) continue;
      if (this.timeConst(rest)) return null;
      if (this.durationMatches.get(nodeKey(unparen(rest)))) return null;
      return { unit: inner.unit, unitName: inner.unitName, chain: { side, rest } };
    }
    return null;
  }

  /** x.m(...) calls matching a normalization pattern, and routes. */
  private call(node: SyntaxNode, sid: string | undefined): void {
    const fun = node.childForFieldName('function');
    if (!fun) return;
    const selector = unparen(fun);
    if (selector.type !== 'selector_expression') return;
    const operand = selector.childForFieldName('operand');
    const method = selector.childForFieldName('field')?.text;
    if (!operand || !method) return;
    const qualifier = operand.text;
    if (matchesNormalizationPattern(method, qualifier, this.options.normalizationMethods)) {
      const { consumer, inProse } = destination(node);
      this.add({
        kind: 'call',
        ...Collector.owner(sid),
        line: node.startPosition.row,
        text: node.text,
        method,
        qualifier,
        ...(consumer !== undefined ? { consumer } : {}),
        ...(inProse ? { inProse } : {}),
      });
    }
    const route = this.route(node, operand, method);
    if (route) this.add({ kind: 'route', ...Collector.owner(sid), line: node.startPosition.row, ...route });
  }

  private route(node: SyntaxNode, operand: SyntaxNode, method: string): { verb: string; route: string } | undefined {
    const args = children(node.childForFieldName('arguments'));
    const arg = (i: number) => (args[i] ? constantString(args[i]!, this.scope) : undefined);
    const isPackage = operand.type === 'identifier' && this.scope.importNames.has(operand.text);
    const isHttpPackage = isPackage && operand.text === this.httpName;
    const httpMethod = method === 'HandleFunc' || method === 'Handle';

    if (isHttpPackage) {
      const pattern = httpMethod ? arg(0) : undefined;
      return pattern !== undefined ? httpPattern(pattern) : undefined;
    }
    if (isPackage) return undefined;
    const prefixed = (verb: string, path: string) => ({ verb, route: this.prefixes.prefixed(operand, path) });
    const methodPath = (): { verb: string; route: string } | undefined | null => {
      const verbArg = arg(0);
      const path = arg(1);
      if (verbArg === undefined || path === undefined) return null;
      return verbArg !== '' ? prefixed(verbArg, path) : undefined;
    };
    // Framework routes only on a receiver this file shows to be a router of that framework, and only its own
    // routing methods (so `Header().Add(...)` or `cache.Get(...)` in a file that imports echo or chi give nothing).
    const kind = this.prefixes.kindOf(operand);
    if (kind === 'gin' || kind === 'echo') {
      const verb = GIN_VERBS[method] ?? (kind === 'echo' ? ECHO_ONLY_VERBS[method] : undefined);
      if (verb) {
        const path = arg(0);
        return path !== undefined ? prefixed(verb, path) : undefined;
      }
      // gin Handle takes variadic handlers (2 or more args); echo Add takes one handler (3 args).
      if ((method === 'Handle' && kind === 'gin' && args.length >= 2) || (method === 'Add' && kind === 'echo' && args.length >= 3)) {
        const found = methodPath();
        if (found !== null) return found;
      }
    }
    if (kind === 'chi') {
      // chi panics on a pattern without a leading "/", so requiring one loses no route.
      const verb = CHI_VERBS[method];
      if (verb && args.length >= 2) {
        const path = arg(0);
        return path?.startsWith('/') ? prefixed(verb, path) : undefined;
      }
      if ((method === 'Method' || method === 'MethodFunc') && args.length >= 3) {
        if (!arg(1)?.startsWith('/')) return undefined;
        const found = methodPath();
        if (found !== null) return found;
      }
      if (httpMethod && args.length >= 2) {
        const pattern = arg(0);
        const split = pattern !== undefined ? httpPattern(pattern) : undefined;
        return split ? prefixed(split.verb, split.route) : undefined;
      }
    }
    if (httpMethod && this.httpName !== undefined) {
      const pattern = arg(0);
      return pattern !== undefined ? httpPattern(pattern) : undefined;
    }
    return undefined;
  }
}

function assignedName(target: SyntaxNode): string | undefined {
  if (target.type === 'identifier') return target.text !== '_' ? target.text : undefined;
  if (target.type === 'selector_expression') return target.childForFieldName('field')?.text;
  return undefined;
}

function unpointer(type: SyntaxNode | null): SyntaxNode | null {
  let current = type;
  while (current && (current.type === 'pointer_type' || current.type === 'parenthesized_type')) current = children(current)[0] ?? null;
  return current;
}

/**
 * The written or elided type of a literal_value: the composite literal's type, or, for an elided literal inside
 * another one, the outer map's key or value type or the outer slice's or array's element type. Null when unknown.
 */
function literalValueType(literalValue: SyntaxNode): SyntaxNode | null {
  const parent = literalValue.parent;
  if (!parent) return null;
  if (parent.type === 'composite_literal') return unpointer(parent.childForFieldName('type'));
  if (parent.type !== 'literal_element') return null;
  const holder = parent.parent;
  if (!holder) return null;
  const outerValue = holder.type === 'keyed_element' ? holder.parent : holder;
  if (!outerValue || outerValue.type !== 'literal_value') return null;
  const outerType = literalValueType(outerValue);
  if (!outerType) return null;
  if (outerType.type === 'map_type') {
    const isKey = holder.type === 'keyed_element' && holder.childForFieldName('key')?.startIndex === parent.startIndex;
    return unpointer(outerType.childForFieldName(isKey ? 'key' : 'value'));
  }
  if (NON_STRUCT_LITERAL_TYPES.has(outerType.type)) return unpointer(outerType.childForFieldName('element'));
  return null;
}

/** A keyed element of a struct literal (by its type, written or elided); the syntax tier cannot see named map types. */
function isStructLiteralElement(keyed: SyntaxNode): boolean {
  const literalValue = keyed.parent;
  if (literalValue?.type !== 'literal_value') return false;
  const type = literalValueType(literalValue);
  return !type || !NON_STRUCT_LITERAL_TYPES.has(type.type);
}

/** The syntax tier's own ID of a function or method declaration (G8), from the symbols at the same offset. */
function declarationId(decl: SyntaxNode, file: string, symbols: readonly SymbolNode[]): string {
  const own = symbols.find((s) => s.startOffset === decl.startIndex && (s.kind === 'function' || s.kind === 'method'));
  if (own) return own.symbolId;
  const name = decl.childForFieldName('name')?.text ?? '';
  if (decl.type === 'method_declaration') {
    const param = children(decl.childForFieldName('receiver')).find((c) => c.type === 'parameter_declaration');
    const typeText = param?.childForFieldName('type')?.text;
    const receiver = typeText === undefined ? undefined : receiverTypeName(typeText);
    if (receiver) return `${file}::${receiver}.${name}::method`;
  }
  return `${file}::${name}::function`;
}

/**
 * Evidence of one Go file from its CST: the analyzer's collector without types. Function and method bodies belong
 * to their declaration (closures included), package-level const and var values to `<file>::<name>::variable`.
 * At most 2,000 records, in walk order.
 */
export function collectTreeSitterEvidence(root: SyntaxNode, file: string, symbols: readonly SymbolNode[], options: FactOptions): FactEvidence[] {
  const collector = new Collector(root, readScope(root), options);
  for (const decl of children(root)) {
    if (decl.type === 'function_declaration' || decl.type === 'method_declaration') {
      const body = decl.childForFieldName('body');
      if (body && decl.childForFieldName('name')) collector.inspect(body, declarationId(decl, file, symbols));
      continue;
    }
    if (decl.type !== 'const_declaration' && decl.type !== 'var_declaration') continue;
    const specs = children(decl).flatMap((c) => (c.type === 'var_spec_list' ? children(c) : [c]));
    for (const spec of specs) {
      if (spec.type !== 'const_spec' && spec.type !== 'var_spec') continue;
      const names = declaredNames(spec);
      const values = children(spec.childForFieldName('value'));
      const owner = (i: number) => (i < names.length && names[i]!.text !== '_' ? `${file}::${names[i]!.text}::variable` : undefined);
      values.forEach((value, i) => {
        let sid = owner(i);
        if (values.length !== names.length) {
          sid = owner(0);
        } else {
          collector.binding(names[i]!, names[i]!.text, value, sid);
        }
        collector.inspect(value, sid);
      });
    }
  }
  return collector.out;
}
