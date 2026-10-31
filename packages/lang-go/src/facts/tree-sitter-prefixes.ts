// Routers and route prefixes in the syntax tier (route prefixes from gin and echo groups and chi mounts): the port
// of the analyzer's prefixes.go without types. Router objects are names, scoped as Go scopes them: parameters to
// their function, `:=` and `var` names to the innermost block or `if`/`for`/`switch`/`select`/case clause, else to
// the package level of the file. A name is a router only when the file shows where it comes from: a framework
// constructor (`gin.New`, `gin.Default`, `echo.New`, `chi.NewRouter`, `chi.NewMux`), a group of a router
// (gin and echo `Group`, chi `Route`, `Group`, `With`), a chi `Route`/`Group` closure parameter or `Mount` target,
// a declared framework type (`*gin.Engine`, `gin.IRouter`, `*echo.Group`, `chi.Router`, ...), a field `x.f` of a
// struct of the file that declares `f` with such a type, or a call to a function or method of the file whose result
// is such a type. Groups and mounts
// give prefixes; a dynamic, conflicting or cyclic prefix gives none, so the route keeps the path written at the call.
import type { SyntaxNode } from 'tree-sitter';

/** The most group and mount hops followed from one route, as in the analyzer. */
const MAX_PREFIX_DEPTH = 8;

export type RouterKind = 'gin' | 'echo' | 'chi';

const FUNCTION_TYPES = new Set(['function_declaration', 'method_declaration', 'func_literal']);
const SCOPE_TYPES = new Set([
  ...FUNCTION_TYPES,
  'block',
  'if_statement',
  'for_statement',
  'expression_switch_statement',
  'type_switch_statement',
  'select_statement',
  'expression_case',
  'type_case',
  'default_case',
  'communication_case',
]);

const GIN_PATH = 'github.com/gin-gonic/gin';
const ECHO_PATH = /^github\.com\/labstack\/echo(\/v[0-9]+)?$/;
const CHI_PATH = /^github\.com\/go-chi\/chi(\/v[0-9]+)?$/;

const CONSTRUCTORS: Readonly<Record<RouterKind, ReadonlySet<string>>> = {
  gin: new Set(['New', 'Default']),
  echo: new Set(['New']),
  chi: new Set(['NewRouter', 'NewMux']),
};
const TYPES: Readonly<Record<RouterKind, ReadonlySet<string>>> = {
  gin: new Set(['Engine', 'RouterGroup', 'IRouter', 'IRoutes']),
  echo: new Set(['Echo', 'Group']),
  chi: new Set(['Mux', 'Router']),
};

/** The router framework of an import path, or undefined. */
export function frameworkOfPath(path: string): RouterKind | undefined {
  if (path === GIN_PATH) return 'gin';
  if (ECHO_PATH.test(path)) return 'echo';
  if (CHI_PATH.test(path)) return 'chi';
  return undefined;
}

/** What the prefixes need from the file: its imports (path to local name) and constant strings. */
export interface PrefixContext {
  readonly imports: ReadonlyMap<string, string>;
  readonly constant: (node: SyntaxNode) => string | undefined;
}

interface Mount {
  readonly recv: SyntaxNode;
  readonly path: string | undefined;
}

type Prefix = { readonly prefix: string; readonly ok: boolean };

function named(node: SyntaxNode | null | undefined): SyntaxNode[] {
  return node ? node.namedChildren.filter((c) => c.type !== 'comment') : [];
}

function unparen(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const inner = named(current)[0];
    if (!inner) return current;
    current = inner;
  }
  return current;
}

const scopeId = (node: SyntaxNode) => `${node.startIndex}:${node.endIndex}:${node.type}`;

/** The parameter declarations of a parameter list. */
function parameters(list: SyntaxNode | null): SyntaxNode[] {
  return named(list).filter((p) => p.type === 'parameter_declaration' || p.type === 'variadic_parameter_declaration');
}

/** The first parameter name of a function literal, or undefined. */
function firstParam(node: SyntaxNode | undefined): SyntaxNode | undefined {
  const lit = node ? unparen(node) : undefined;
  if (lit?.type !== 'func_literal') return undefined;
  const first = parameters(lit.childForFieldName('parameters'))[0];
  return first?.childrenForFieldName('name').find((n) => n.type === 'identifier');
}

/** "/"-joined route parts with a leading "/"; "" when both are empty. */
export function joinPrefix(a: string, b: string): string {
  const parts = [a, b].map((p) => p.replace(/^\/+|\/+$/g, '')).filter((p) => p.length > 0);
  return parts.length === 0 ? '' : `/${parts.join('/')}`.replace(/\/{2,}/g, '/');
}

export class TreeSitterPrefixes {
  /** Names declared by each scope (by scope id); the package level is `pkg`. */
  private readonly declared = new Map<string, Set<string>>();
  private readonly defs = new Map<string, SyntaxNode[]>();
  private readonly declaredTypes = new Map<string, SyntaxNode[]>();
  private readonly mounts = new Map<string, Mount[]>();
  private readonly prefixCache = new Map<string, Prefix | 'pending'>();
  private readonly kindCache = new Map<string, RouterKind | null | 'pending'>();
  /** Local import name to framework. */
  private readonly frameworks = new Map<string, RouterKind>();
  private readonly importNames: ReadonlySet<string>;
  /** Set when a lookup reached the depth cap: such results are not cached. */
  private capped = false;
  /** Kinds of the struct fields, functions and methods declared in the file, by name (undefined: not a router type). */
  private readonly fieldKinds = new Map<string, Set<RouterKind | undefined>>();
  private readonly functionKinds = new Map<string, Set<RouterKind | undefined>>();
  private readonly methodKinds = new Map<string, Set<RouterKind | undefined>>();

  private addKind(map: Map<string, Set<RouterKind | undefined>>, name: string, kind: RouterKind | undefined): void {
    let kinds = map.get(name);
    if (!kinds) {
      kinds = new Set();
      map.set(name, kinds);
    }
    kinds.add(kind);
  }

  /** The one router kind every declaration of `name` has, else undefined. */
  private static single(kinds: ReadonlySet<RouterKind | undefined> | undefined): RouterKind | undefined {
    return kinds && kinds.size === 1 ? [...kinds][0] : undefined;
  }

  constructor(root: SyntaxNode, private readonly context: PrefixContext) {
    for (const [path, name] of context.imports) {
      const kind = frameworkOfPath(path);
      if (kind) this.frameworks.set(name, kind);
    }
    this.importNames = new Set(context.imports.values());
    const declarations: Array<[SyntaxNode, SyntaxNode]> = [];
    const typed: Array<[SyntaxNode, SyntaxNode]> = [];
    const calls: SyntaxNode[] = [];
    const stack: SyntaxNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      switch (node.type) {
        case 'field_declaration': {
          // A struct field of a framework router type: `x.field` is a router.
          const type = node.childForFieldName('type');
          const kind = type ? this.typeKind(type) : undefined;
          for (const id of node.childrenForFieldName('name').filter((n) => n.type === 'field_identifier')) {
            this.addKind(this.fieldKinds, id.text, kind);
          }
          break;
        }
        case 'function_declaration':
        case 'method_declaration':
        case 'func_literal': {
          if (node.type !== 'func_literal') {
            // A function or method of the file whose single result is a framework router type.
            const name = node.childForFieldName('name')?.text;
            const result = node.childForFieldName('result');
            if (name !== undefined) {
              this.addKind(node.type === 'function_declaration' ? this.functionKinds : this.methodKinds, name, result ? this.typeKind(result) : undefined);
            }
          }
          const names = this.namesOf(scopeId(node));
          for (const list of [node.childForFieldName('parameters'), node.childForFieldName('receiver')]) {
            for (const param of parameters(list)) {
              const type = param.childForFieldName('type');
              for (const id of param.childrenForFieldName('name').filter((n) => n.type === 'identifier')) {
                names.add(id.text);
                if (type) typed.push([id, type]);
              }
            }
          }
          break;
        }
        case 'short_var_declaration':
        case 'assignment_statement': {
          if (node.type === 'assignment_statement' && node.childForFieldName('operator')?.text !== '=') break;
          const left = named(node.childForFieldName('left'));
          const right = named(node.childForFieldName('right'));
          if (node.type === 'short_var_declaration') for (const id of left) if (id.type === 'identifier') this.declare(id);
          if (left.length === right.length) left.forEach((id, i) => declarations.push([id, right[i]!]));
          break;
        }
        case 'var_spec':
        case 'const_spec': {
          const ids = node.childrenForFieldName('name').filter((n) => n.isNamed);
          for (const id of ids) this.declare(id);
          const type = node.childForFieldName('type');
          if (type) for (const id of ids) typed.push([id, type]);
          const values = named(node.childForFieldName('value'));
          if (ids.length === values.length) ids.forEach((id, i) => declarations.push([id, values[i]!]));
          break;
        }
        case 'call_expression':
          calls.push(node);
          break;
      }
      const kids = node.namedChildren;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    for (const [id, value] of declarations) {
      if (id.type !== 'identifier' || id.text === '_') continue;
      const key = this.keyOf(id);
      if (key !== undefined) this.push(this.defs, key, value);
    }
    for (const [id, type] of typed) {
      const key = this.keyOf(id);
      if (key !== undefined) this.push(this.declaredTypes, key, type);
    }
    for (const call of calls) this.chiMount(call);
    // Kinds looked up while the mounts were collected may lack a mount found later.
    this.kindCache.clear();
  }

  private namesOf(id: string): Set<string> {
    let names = this.declared.get(id);
    if (!names) {
      names = new Set();
      this.declared.set(id, names);
    }
    return names;
  }

  /** Records a declared name in its innermost scope, else at the package level. */
  private declare(id: SyntaxNode): void {
    let scope = id.parent;
    while (scope && !SCOPE_TYPES.has(scope.type)) scope = scope.parent;
    this.namesOf(scope ? scopeId(scope) : 'pkg').add(id.text);
  }

  /** The key of the object an identifier names: the innermost scope declaring it, else the package level. */
  private keyOf(id: SyntaxNode): string | undefined {
    for (let scope = id.parent; scope; scope = scope.parent) {
      if (!SCOPE_TYPES.has(scope.type)) continue;
      const sid = scopeId(scope);
      if (this.declared.get(sid)?.has(id.text)) return `${sid}#${id.text}`;
    }
    return this.declared.get('pkg')?.has(id.text) ? `pkg#${id.text}` : undefined;
  }

  private push<T>(map: Map<string, T[]>, key: string, value: T): void {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  }

  /** The operand, method and arguments of a `x.m(...)` call, else undefined. */
  private selector(call: SyntaxNode): { recv: SyntaxNode; method: string; args: SyntaxNode[] } | undefined {
    if (call.type !== 'call_expression') return undefined;
    const fun = call.childForFieldName('function');
    const selector = fun ? unparen(fun) : undefined;
    if (selector?.type !== 'selector_expression') return undefined;
    const recv = selector.childForFieldName('operand');
    const method = selector.childForFieldName('field')?.text;
    if (!recv || !method) return undefined;
    return { recv, method, args: named(call.childForFieldName('arguments')) };
  }

  /** chi `Mount(pattern, router)`, `Route(pattern, func(r))` and `Group(func(r))` on a known chi router. */
  private chiMount(call: SyntaxNode): void {
    const sel = this.selector(call);
    if (!sel || !['Mount', 'Route', 'Group'].includes(sel.method)) return;
    const { recv, method, args } = sel;
    if (this.kindOf(recv, 0) !== 'chi') return;
    const add = (id: SyntaxNode | undefined, path: string | undefined) => {
      if (!id) return;
      const key = this.keyOf(id);
      if (key !== undefined) this.push(this.mounts, key, { recv, path });
    };
    if (method === 'Mount' && args.length === 2) {
      const target = unparen(args[1]!);
      if (target.type === 'identifier') add(target, this.context.constant(args[0]!));
    } else if (method === 'Route' && args.length === 2) {
      add(firstParam(args[1]), this.context.constant(args[0]!));
    } else if (method === 'Group' && args.length === 1) {
      add(firstParam(args[0]), '');
    }
  }

  /** The framework of a declared type: `[*]pkg.Name` with a router type of that framework. */
  private typeKind(type: SyntaxNode): RouterKind | undefined {
    let current: SyntaxNode | undefined = type;
    while (current && (current.type === 'pointer_type' || current.type === 'parenthesized_type')) current = named(current)[0];
    if (current?.type !== 'qualified_type') return undefined;
    const pkg = current.childForFieldName('package')?.text;
    const name = current.childForFieldName('name')?.text;
    const kind = pkg !== undefined ? this.frameworks.get(pkg) : undefined;
    return kind && name !== undefined && TYPES[kind].has(name) ? kind : undefined;
  }

  /** The router framework an expression is known to be, from this file alone; undefined when it is not known. */
  kindOf(node: SyntaxNode, depth = 0): RouterKind | undefined {
    if (depth > MAX_PREFIX_DEPTH) {
      this.capped = true;
      return undefined;
    }
    const expr = unparen(node);
    if (expr.type === 'identifier') {
      const key = this.keyOf(expr);
      return key === undefined ? undefined : this.objectKind(key, depth);
    }
    if (expr.type === 'selector_expression') {
      // `x.field` where a struct of this file declares `field` with a router type.
      const operand = expr.childForFieldName('operand');
      if (operand?.type === 'identifier' && this.importNames.has(operand.text)) return undefined;
      const field = expr.childForFieldName('field')?.text;
      return field !== undefined ? TreeSitterPrefixes.single(this.fieldKinds.get(field)) : undefined;
    }
    if (expr.type === 'call_expression') {
      // `setup()`: a function of this file whose result is a router type.
      const fun = expr.childForFieldName('function');
      const callee = fun ? unparen(fun) : undefined;
      if (callee?.type === 'identifier') return TreeSitterPrefixes.single(this.functionKinds.get(callee.text));
    }
    const sel = this.selector(expr);
    if (!sel) return undefined;
    const { recv, method } = sel;
    if (recv.type === 'identifier' && this.importNames.has(recv.text)) {
      const kind = this.frameworks.get(recv.text);
      return kind && CONSTRUCTORS[kind].has(method) ? kind : undefined;
    }
    const kind = this.kindOf(recv, depth + 1);
    if ((kind === 'gin' || kind === 'echo') && method === 'Group') return kind;
    if (kind === 'chi' && (method === 'Route' || method === 'Group' || method === 'With')) return kind;
    // `s.routes()`: a method of this file whose result is a router type.
    if (kind === undefined) return TreeSitterPrefixes.single(this.methodKinds.get(method));
    return undefined;
  }

  private objectKind(key: string, depth: number): RouterKind | undefined {
    const cached = this.kindCache.get(key);
    if (cached === 'pending') return undefined;
    if (cached !== undefined) return cached ?? undefined;
    this.kindCache.set(key, 'pending');
    const outerCapped = this.capped;
    this.capped = false;
    const kinds = new Set<RouterKind | undefined>();
    for (const type of this.declaredTypes.get(key) ?? []) kinds.add(this.typeKind(type));
    for (const def of this.defs.get(key) ?? []) kinds.add(this.kindOf(def, depth + 1));
    if ((this.mounts.get(key) ?? []).length > 0) kinds.add('chi');
    kinds.delete(undefined);
    const result = kinds.size === 1 ? [...kinds][0]! : null;
    if (this.capped) this.kindCache.delete(key);
    else this.kindCache.set(key, result);
    this.capped = this.capped || outerCapped;
    return result ?? undefined;
  }

  /** `path` joined to the receiver's prefix; the path as written when the prefix is empty or unknown. */
  prefixed(recv: SyntaxNode, path: string): string {
    const { prefix, ok } = this.prefixOf(recv, 0);
    return ok && prefix !== '' ? joinPrefix(prefix, path) : path;
  }

  private prefixOf(node: SyntaxNode, depth: number): Prefix {
    if (depth > MAX_PREFIX_DEPTH) {
      this.capped = true;
      return { prefix: '', ok: false };
    }
    const expr = unparen(node);
    if (expr.type === 'identifier') {
      const key = this.keyOf(expr);
      return key === undefined ? { prefix: '', ok: true } : this.objectPrefix(key, depth);
    }
    const sel = this.selector(expr);
    if (!sel) return { prefix: '', ok: true };
    const { recv, method, args } = sel;
    if (recv.type === 'identifier' && this.importNames.has(recv.text)) return { prefix: '', ok: true };
    const kind = this.kindOf(recv);
    if (((kind === 'gin' || kind === 'echo') && method === 'Group') || (kind === 'chi' && method === 'Route')) {
      const path = args[0] ? this.context.constant(args[0]) : undefined;
      if (path === undefined) return { prefix: '', ok: false };
      const outer = this.prefixOf(recv, depth + 1);
      return { prefix: joinPrefix(outer.prefix, path), ok: outer.ok };
    }
    if (kind === 'chi' && (method === 'With' || method === 'Group')) return this.prefixOf(recv, depth + 1);
    return { prefix: '', ok: true };
  }

  private objectPrefix(key: string, depth: number): Prefix {
    const cached = this.prefixCache.get(key);
    if (cached === 'pending') return { prefix: '', ok: false };
    if (cached) return cached;
    this.prefixCache.set(key, 'pending');
    const outerCapped = this.capped;
    this.capped = false;
    const values: string[] = [];
    let ok = true;
    const mounts = this.mounts.get(key) ?? [];
    const defs = this.defs.get(key) ?? [];
    if (mounts.length > 0) {
      // A mounted object assigned more than once: the mount may be of an earlier value.
      if (defs.length > 1) ok = false;
      for (const mount of mounts) {
        if (!ok) break;
        const outer = mount.path === undefined ? { prefix: '', ok: false } : this.prefixOf(mount.recv, depth + 1);
        if (!outer.ok) {
          ok = false;
          break;
        }
        values.push(joinPrefix(outer.prefix, mount.path!));
      }
    } else {
      for (const def of defs) {
        const value = this.prefixOf(def, depth + 1);
        if (!value.ok) {
          ok = false;
          break;
        }
        values.push(value.prefix);
      }
    }
    if (ok && values.some((v) => v !== values[0])) ok = false;
    const result = { prefix: ok && values.length > 0 ? values[0]! : '', ok };
    if (this.capped) this.prefixCache.delete(key);
    else this.prefixCache.set(key, result);
    this.capped = this.capped || outerCapped;
    return result;
  }
}
