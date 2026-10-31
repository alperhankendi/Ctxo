// TypeScript fact evidence from ts-morph nodes (PR 4, issue #156, FC-3 to FC-5, FC-8 and G8). The collector
// reports evidence; the shared `finishFacts` decides which evidence becomes a fact.
import { Node, SyntaxKind, type CallExpression, type SourceFile, type StringLiteral, type Symbol as TsSymbol } from 'ts-morph';
import type { FactEvidence, FactOptions, LiteralKind } from './fact-types.js';
import { hasRetryTimeoutFragment, joinRoute, matchesNormalizationPattern } from './fact-rules.js';
import { findTestBlocks } from '../test-blocks.js';
import type { ModuleResolver } from '../sql/module-resolver.js';
import { receiverModule } from '../sql/provenance.js';
import type { RoutePrefixes } from './route-prefixes.js';

/** The packages a route call's receiver must trace to (G7): Express, Fastify, Koa routers and Hono. */
export const ROUTE_MODULES: ReadonlySet<string> = new Set(['express', 'fastify', '@koa/router', 'koa-router', 'hono']);

/** Koa router modules: `del` is DELETE, and a route may be named (`router.get('name', '/path', handler)`). */
const KOA_ROUTER_MODULES: ReadonlySet<string> = new Set(['@koa/router', 'koa-router']);

/** Express, Fastify, Koa and Hono route members and their verbs; `all` is `ANY`. */
const ROUTE_VERBS: Readonly<Record<string, string>> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  delete: 'DELETE',
  patch: 'PATCH',
  head: 'HEAD',
  options: 'OPTIONS',
  all: 'ANY',
};

const COMPARISON_OPERATORS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
]);

/** Global receivers of `setTimeout`. */
const TIMER_GLOBALS: ReadonlySet<string> = new Set(['window', 'globalThis']);

/** A declaration that owns the evidence inside it, minus the `exclude` sub-scopes (nested test blocks). */
interface Scope {
  readonly symbolId: string;
  readonly node: Node;
  readonly exclude: readonly Node[];
}

/**
 * G8 owners, with the adapter's symbol IDs: top-level named functions and classes and the methods of those
 * classes (exported or not: a non-exported one gets the ID the adapter would give it if exported), exported
 * variable declarations, and test blocks (the callback minus nested blocks' callbacks).
 */
function scopesOf(sourceFile: SourceFile, filePath: string, isTestFile?: (path: string) => boolean): Scope[] {
  const scopes: Scope[] = [];
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name) scopes.push({ symbolId: `${filePath}::${name}::function`, node: fn, exclude: [] });
  }
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!name) continue;
    scopes.push({ symbolId: `${filePath}::${name}::class`, node: cls, exclude: [] });
    for (const method of cls.getMethods()) {
      scopes.push({ symbolId: `${filePath}::${name}.${method.getName()}::method`, node: method, exclude: [] });
    }
  }
  for (const statement of sourceFile.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const declaration of statement.getDeclarations()) {
      scopes.push({ symbolId: `${filePath}::${declaration.getName()}::variable`, node: declaration, exclude: [] });
    }
  }
  for (const block of findTestBlocks(sourceFile, filePath, isTestFile)) {
    scopes.push({ symbolId: block.symbolId, node: block.body, exclude: block.nested });
  }
  return scopes;
}

/** A scope with its offsets computed once, its excluded ranges merged, and the next larger scope holding it. */
interface PlacedScope {
  readonly symbolId: string;
  readonly start: number;
  readonly end: number;
  /** Sorted by start, none inside another. */
  readonly exclude: ReadonlyArray<readonly [number, number]>;
  parent: PlacedScope | undefined;
}

/** Ranges `[start, end]` of `nodes`, sorted by start, with ranges inside another dropped. */
function mergedRanges(nodes: readonly Node[]): Array<readonly [number, number]> {
  const sorted = nodes.map((n) => [n.getStart(), n.getEnd()] as const).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<readonly [number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[1] <= last[1]) continue;
    merged.push(range);
  }
  return merged;
}

/** Whether `[start, end]` lies inside one of `ranges` (sorted, none inside another). */
function insideAny(start: number, end: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid]![0] <= start) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return candidate >= 0 && end <= ranges[candidate]![1];
}

/**
 * Owner lookup over scopes. Scopes are AST nodes, so two of them are nested or disjoint; sorted by start
 * (wider first on a tie), each one's parent is the nearest earlier scope holding it. A record's candidates
 * are then the last scope starting at or before it and that scope's parents, a chain as deep as the nesting.
 */
class Owners {
  private readonly sorted: PlacedScope[];

  constructor(scopes: readonly Scope[]) {
    this.sorted = scopes
      .map((scope): PlacedScope => ({
        symbolId: scope.symbolId,
        start: scope.node.getStart(),
        end: scope.node.getEnd(),
        exclude: mergedRanges(scope.exclude),
        parent: undefined,
      }))
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const open: PlacedScope[] = [];
    for (const scope of this.sorted) {
      while (open.length > 0 && !(open[open.length - 1]!.start <= scope.start && scope.end <= open[open.length - 1]!.end)) open.pop();
      scope.parent = open[open.length - 1];
      open.push(scope);
    }
  }

  /** The smallest scope holding `node` outside its excluded sub-scopes (ties: the lower symbol ID); undefined: the module. */
  ownerOf(node: Node): string | undefined {
    const start = node.getStart();
    const end = node.getEnd();
    let scope = this.last(start);
    let best: PlacedScope | undefined;
    for (; scope !== undefined; scope = scope.parent) {
      if (best !== undefined && (scope.start !== best.start || scope.end !== best.end)) break;
      if (scope.start > start || end > scope.end || insideAny(start, end, scope.exclude)) continue;
      if (best === undefined || scope.symbolId < best.symbolId) best = scope;
    }
    return best?.symbolId;
  }

  /** The last scope (in sorted order) starting at or before `offset`. */
  private last(offset: number): PlacedScope | undefined {
    let lo = 0;
    let hi = this.sorted.length - 1;
    let found: PlacedScope | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.sorted[mid]!.start <= offset) {
        found = this.sorted[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }
}

/** `expr` without the parentheses around it. */
function unparenthesized(expr: Node): Node {
  let node = expr;
  while (Node.isParenthesizedExpression(node)) node = node.getExpression();
  return node;
}

function isNumeric(node: Node): boolean {
  return Node.isNumericLiteral(node) || Node.isBigIntLiteral(node);
}

/** The literal kind of an operand: numbers (optionally signed), strings, templates without substitutions, `true`, `false`, `null`. */
function literalKindOf(node: Node): LiteralKind | undefined {
  if (isNumeric(node)) return 'number';
  if (Node.isPrefixUnaryExpression(node)) {
    const op = node.getOperatorToken();
    return (op === SyntaxKind.MinusToken || op === SyntaxKind.PlusToken) && isNumeric(node.getOperand()) ? 'number' : undefined;
  }
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return 'string';
  const kind = node.getKind();
  if (kind === SyntaxKind.TrueKeyword || kind === SyntaxKind.FalseKeyword) return 'boolean';
  if (kind === SyntaxKind.NullKeyword) return 'null';
  return undefined;
}

/** A string-literal or no-substitution-template value, else undefined. */
function stringValueOf(node: Node | undefined): string | undefined {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;
}

/** A property or member name written as an identifier or a string literal. */
function nameOf(node: Node): string | undefined {
  if (Node.isIdentifier(node) || Node.isPrivateIdentifier(node)) return node.getText();
  return Node.isStringLiteral(node) ? node.getLiteralValue() : undefined;
}

// ── FC-4b: where a normalization call's value goes ──────────────

/** Statements, declarations and function bodies end the walk, as in the other plugins. */
function endsDestination(node: Node): boolean {
  return Node.isStatement(node) || Node.isBlock(node) || Node.isSourceFile(node) || Node.isFunctionLikeDeclaration(node)
    || Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isPropertyDeclaration(node)
    || Node.isClassDeclaration(node) || Node.isClassExpression(node) || Node.isClassStaticBlockDeclaration(node);
}

/** ASCII whitespace, the one definition every tier uses (space, tab, LF, CR, FF, VT). */
const ASCII_WHITESPACE = /[ \t\n\r\f\v]/;

/** A string or template literal whose literal text holds ASCII whitespace; a tagged template (`sql\`...\``) is never prose. */
function isProse(node: Node): boolean {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return !Node.isTaggedTemplateExpression(node.getParent()) && ASCII_WHITESPACE.test(node.getLiteralText());
  }
  if (Node.isTemplateExpression(node)) {
    if (Node.isTaggedTemplateExpression(node.getParent())) return false;
    return [node.getHead().getLiteralText(), ...node.getTemplateSpans().map(span => span.getLiteral().getLiteralText())]
      .some(text => ASCII_WHITESPACE.test(text));
  }
  return false;
}

/** The operands of a `+` chain, through nested `+` (not through parentheses). */
function concatOperands(node: Node, out: Node[] = []): Node[] {
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    concatOperands(node.getLeft(), out);
    concatOperands(node.getRight(), out);
  } else {
    out.push(node);
  }
  return out;
}

/**
 * The package that declares a type symbol: the package folder after `node_modules/` of its declaration
 * file (`@nestjs/common`, `winston`; `@types/` dropped), else the name of the ambient
 * `declare module 'pino'` around its declaration; undefined for a project type and for a type of
 * TypeScript's own `lib.*.d.ts` files (`Console`, `Map`), which keeps its bare name.
 */
function packageOf(symbol: TsSymbol): string | undefined {
  const declaration = symbol.getDeclarations()[0];
  if (declaration === undefined) return undefined;
  const file = declaration.getSourceFile().getFilePath().replace(/\\/g, '/');
  if (/\/lib\.[^/]*\.d\.ts$/.test(file)) return undefined;
  const inModules = /\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file);
  if (inModules) return inModules[1]!.replace(/^@types\//, '');
  for (const ancestor of declaration.getAncestors()) {
    if (Node.isModuleDeclaration(ancestor) && ancestor.hasModuleKeyword() && Node.isStringLiteral(ancestor.getNameNode())) {
      return (ancestor.getNameNode() as StringLiteral).getLiteralValue();
    }
  }
  return undefined;
}

/**
 * The type of a consumer's receiver, when the checker resolves one: `<package>.<name>` for a type a
 * package or an ambient module declares (`pino.Logger`, `@nestjs/common.Logger`), else its name
 * (`Console` for `console`).
 */
function receiverTypes(callee: Node): string[] | undefined {
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const type = callee.getExpression().getType();
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  const name = symbol?.getName();
  if (symbol === undefined || name === undefined || name.startsWith('__')) return undefined;
  const pkg = packageOf(symbol);
  return [pkg !== undefined ? `${pkg}.${name}` : name];
}

/**
 * FC-4b: up to the statement and never out of a function, the nearest call (`new T` for a
 * construction) that takes the value as an argument, with its receiver's type name, and whether on
 * the way the value is a hole of a template literal, or an operand of a `+` chain with a string,
 * whose literal text holds ASCII whitespace.
 */
function destination(call: Node): { consumer: string | undefined; consumerTypes: string[] | undefined; inProse: boolean } {
  let inProse = false;
  let node = call;
  for (let parent = node.getParent(); parent; node = parent, parent = parent.getParent()) {
    if (endsDestination(parent)) break;
    if (Node.isCallExpression(parent) && parent.getArguments().includes(node)) {
      const callee = parent.getExpression();
      return { consumer: callee.getText().replace(/\s+/g, ' ').trim(), consumerTypes: receiverTypes(callee), inProse };
    } else if (Node.isNewExpression(parent) && (parent.getArguments() as Node[]).includes(node)) {
      return { consumer: `new ${parent.getExpression().getText().replace(/\s+/g, ' ').trim()}`, consumerTypes: undefined, inProse };
    } else if (Node.isTemplateExpression(parent) && Node.isTemplateSpan(node)) {
      if (isProse(parent)) inProse = true;
    } else if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
      if (concatOperands(parent).some(isProse)) inProse = true;
    }
  }
  return { consumer: undefined, consumerTypes: undefined, inProse };
}

/** Offsets of every `\n` in `text`, ascending. */
function newlineOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) offsets.push(at);
  return offsets;
}

class Collector {
  readonly evidence: FactEvidence[] = [];
  private readonly owners: Owners;
  private readonly newlines: number[];

  constructor(
    sourceFile: SourceFile,
    filePath: string,
    private readonly resolver: ModuleResolver,
    private readonly options: FactOptions,
    isTestFile?: (path: string) => boolean,
    private readonly prefixes?: RoutePrefixes,
  ) {
    this.owners = new Owners(scopesOf(sourceFile, filePath, isTestFile));
    this.newlines = newlineOffsets(sourceFile.getFullText());
  }

  /**
   * The 0-based line of `node`'s start: the `\n` count before it, as ts-morph's `getStartLineNumber() - 1`
   * counts, found by binary search instead of a scan from the file start.
   */
  private lineOf(node: Node): number {
    const start = node.getStart();
    let lo = 0;
    let hi = this.newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.newlines[mid]! < start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private push(node: Node, item: FactEvidence): void {
    const symbolId = this.owners.ownerOf(node);
    this.evidence.push(symbolId !== undefined ? { ...item, symbolId } : item);
  }

  visit(node: Node): void {
    if (Node.isIfStatement(node) || Node.isWhileStatement(node) || Node.isDoStatement(node)) {
      this.condition(node.getExpression());
    } else if (Node.isForStatement(node)) {
      const condition = node.getCondition();
      if (condition) this.condition(condition);
    } else if (Node.isConditionalExpression(node)) {
      this.condition(node.getCondition());
    } else if (Node.isSwitchStatement(node)) {
      // `switch (typeof x)` labels are type guards too.
      if (!Node.isTypeOfExpression(unparenthesized(node.getExpression()))) {
        this.caseLabels(node.getExpression().getText(), node.getCaseBlock().getClauses());
      }
    } else if (Node.isCallExpression(node)) {
      this.call(node);
    } else if (Node.isVariableDeclaration(node) || Node.isPropertyDeclaration(node) || Node.isPropertyAssignment(node)) {
      const initializer = node.getInitializer();
      const name = nameOf(node.getNameNode());
      if (initializer && name !== undefined) this.binding(node, name, initializer);
    } else if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
      const left = node.getLeft();
      const name = Node.isIdentifier(left) ? left.getText() : Node.isPropertyAccessExpression(left) ? left.getName() : undefined;
      if (name !== undefined) this.binding(node, name, node.getRight());
    }
  }

  /** FC-3: comparisons inside a condition, through `&&`, `||`, `!` and parentheses. */
  private condition(expr: Node): void {
    if (Node.isParenthesizedExpression(expr)) {
      this.condition(expr.getExpression());
    } else if (Node.isPrefixUnaryExpression(expr) && expr.getOperatorToken() === SyntaxKind.ExclamationToken) {
      this.condition(expr.getOperand());
    } else if (Node.isBinaryExpression(expr)) {
      const operator = expr.getOperatorToken();
      const kind = operator.getKind();
      if (kind === SyntaxKind.AmpersandAmpersandToken || kind === SyntaxKind.BarBarToken) {
        this.condition(expr.getLeft());
        this.condition(expr.getRight());
      } else if (COMPARISON_OPERATORS.has(kind)) {
        const leftKind = literalKindOf(expr.getLeft());
        const rightKind = literalKindOf(expr.getRight());
        if ((leftKind === undefined) === (rightKind === undefined)) return;
        const literal = leftKind !== undefined ? expr.getLeft() : expr.getRight();
        // `typeof x === 'string'` is a type guard, not a business literal.
        const other = leftKind !== undefined ? expr.getRight() : expr.getLeft();
        if (Node.isTypeOfExpression(unparenthesized(other))) return;
        this.push(expr, {
          kind: 'comparison',
          line: this.lineOf(expr),
          text: expr.getText(),
          operator: operator.getText(),
          literal: literal.getText(),
          literalKind: (leftKind ?? rightKind)!,
        });
      }
    }
  }

  /** FC-3: `case` clauses with a literal label give `<subject> case <label>`. */
  private caseLabels(subject: string, clauses: readonly Node[]): void {
    for (const clause of clauses) {
      if (!Node.isCaseClause(clause)) continue;
      const label = clause.getExpression();
      const literalKind = literalKindOf(label);
      if (literalKind === undefined) continue;
      this.push(clause, {
        kind: 'comparison',
        line: this.lineOf(clause),
        text: `${subject} case ${label.getText()}`,
        operator: 'case',
        literal: label.getText(),
        literalKind,
      });
    }
  }

  /** FC-5: a binding whose name has a retry or timeout fragment; the finisher checks the value. */
  private binding(node: Node, name: string, value: Node): void {
    if (!hasRetryTimeoutFragment(name)) return;
    this.push(node, { kind: 'binding', line: this.lineOf(node), name, value: value.getText() });
  }

  private call(call: CallExpression): void {
    const callee = call.getExpression();
    const args = call.getArguments();

    // setTimeout(fn, n), window.setTimeout and globalThis.setTimeout: a duration in milliseconds.
    const timer = Node.isIdentifier(callee)
      ? callee.getText() === 'setTimeout'
      : Node.isPropertyAccessExpression(callee) && callee.getName() === 'setTimeout' && TIMER_GLOBALS.has(callee.getExpression().getText());
    if (timer && args.length >= 2) {
      this.push(call, { kind: 'duration', line: this.lineOf(call), constructor: callee.getText(), unit: 'ms', amount: args[1]!.getText() });
    }

    if (!Node.isPropertyAccessExpression(callee)) return;
    const method = callee.getName();
    const receiver = callee.getExpression();

    // FC-4: x.m(...) whose simple name matches a normalization pattern.
    if (matchesNormalizationPattern(method, receiver.getText(), this.options.normalizationMethods)) {
      const { consumer, consumerTypes, inProse } = destination(call);
      this.push(call, {
        kind: 'call',
        line: this.lineOf(call),
        text: call.getText(),
        method,
        qualifier: receiver.getText(),
        ...(consumer !== undefined ? { consumer } : {}),
        ...(consumerTypes !== undefined ? { consumerTypes } : {}),
        ...(inProse ? { inProse } : {}),
      });
    }

    // G7: Express, Fastify, Koa and Hono routes: a literal path and a handler (Express `app.get('env')` reads a
    // setting); the receiver must trace to a route module. A Koa route may be named: `get('name', '/path', h)`.
    const verb = ROUTE_VERBS[method] ?? (method === 'del' ? 'DELETE' : undefined);
    const first = stringValueOf(args[0]);
    if (verb !== undefined && first !== undefined) {
      if (args.length < 2) return;
      const module = receiverModule(receiver, this.resolver, ROUTE_MODULES);
      if (module === undefined) return;
      const koa = KOA_ROUTER_MODULES.has(module);
      if (method === 'del' && !koa) return;
      const named = koa ? stringValueOf(args[1]) : undefined;
      if (named !== undefined && args.length < 3) return;
      const path = named ?? first;
      this.push(call, { kind: 'route', line: this.lineOf(call), verb, route: this.prefixed(receiver, path) });
    } else if (method === 'route' && args[0] && Node.isObjectLiteralExpression(args[0])) {
      this.fastifyRoute(call, receiver, args[0]);
    }
  }

  /** Fastify `route({ method, url })`: one route per method (a string or an array of strings). */
  private fastifyRoute(call: CallExpression, receiver: Node, options: Node): void {
    if (!Node.isObjectLiteralExpression(options)) return;
    let url: string | undefined;
    let methods: string[] | undefined;
    for (const property of options.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const key = nameOf(property.getNameNode());
      const value = property.getInitializer();
      if (key === 'url') {
        url = stringValueOf(value);
      } else if (key === 'method') {
        const single = stringValueOf(value);
        if (single !== undefined) {
          methods = [single];
        } else if (value && Node.isArrayLiteralExpression(value)) {
          const all = value.getElements().map((element) => stringValueOf(element));
          methods = all.every((m) => m !== undefined) ? (all as string[]) : undefined;
        } else {
          methods = undefined;
        }
      }
    }
    if (url === undefined || methods === undefined || methods.length === 0) return;
    if (receiverModule(receiver, this.resolver, ROUTE_MODULES) !== 'fastify') return;
    for (const method of methods) this.push(call, { kind: 'route', line: this.lineOf(call), verb: method, route: url });
  }

  /** `path` joined to the receiver's mount prefix (route prefixes); the path as written when there is none. */
  private prefixed(receiver: Node, path: string): string {
    const prefix = this.prefixes?.prefixOf(receiver) ?? '';
    return prefix === '' ? path : joinRoute(prefix, path);
  }
}

/**
 * Fact evidence of one TypeScript or JavaScript file: comparisons in conditions and `case` labels, `x.m(...)`
 * calls matching a normalization pattern, retry and timeout bindings (variables, class properties,
 * object-literal properties, assignments), `setTimeout` durations and Express, Fastify, Koa or Hono routes, joined
 * to their router's mount prefix when `prefixes` resolves one. Each record's
 * `symbolId` is its G8 owner, or unset for code outside every owner (the finisher uses the module symbol).
 * Route receivers are traced through `resolver`, which may add files to the project until its `release()`.
 */
export function collectTsEvidence(
  sourceFile: SourceFile,
  filePath: string,
  resolver: ModuleResolver,
  options: FactOptions,
  isTestFile?: (path: string) => boolean,
  prefixes?: RoutePrefixes,
): FactEvidence[] {
  const collector = new Collector(sourceFile, filePath, resolver, options, isTestFile, prefixes);
  sourceFile.forEachDescendant((node) => collector.visit(node));
  return collector.evidence;
}
