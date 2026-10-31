// Route prefixes in the syntax tier (roadmap "Route prefixes from Express mounts, gin groups and MapGroup"): the
// port of the analyzer's prefixes.go without types. Router objects are names, scoped to the innermost function
// (declaration or literal) that declares them (parameters, `:=`, `var`), else to the package level of the file.
// Groups are gin and echo `Group(prefix)` calls (in a file that imports gin or echo) and chi `Route(pattern, func(r))`,
// `Group(func(r))` and `With(...)` (in a file that imports chi); mounts are chi `Mount(pattern, router)`. A dynamic,
// conflicting or cyclic prefix gives none, so the route keeps the path written at the call.
import type { SyntaxNode } from 'tree-sitter';

/** The most group and mount hops followed from one route, as in the analyzer. */
const MAX_PREFIX_DEPTH = 8;

const FUNCTION_TYPES = new Set(['function_declaration', 'method_declaration', 'func_literal']);

/** What the prefixes need from the file: its frameworks, import names and constant strings. */
export interface PrefixContext {
  readonly groups: boolean;
  readonly chi: boolean;
  readonly importNames: ReadonlySet<string>;
  readonly constant: (node: SyntaxNode) => string | undefined;
}

interface Mount {
  readonly recv: SyntaxNode;
  readonly path: string | undefined;
}

type Result = { readonly prefix: string; readonly ok: boolean } | 'pending';

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

/** The names a parameter list declares. */
function parameterNames(list: SyntaxNode | null): SyntaxNode[] {
  return named(list)
    .filter((p) => p.type === 'parameter_declaration' || p.type === 'variadic_parameter_declaration')
    .flatMap((p) => p.childrenForFieldName('name').filter((n) => n.type === 'identifier'));
}

/** The first parameter name of a function literal, or undefined. */
function firstParam(node: SyntaxNode | undefined): SyntaxNode | undefined {
  const lit = node ? unparen(node) : undefined;
  if (lit?.type !== 'func_literal') return undefined;
  const first = named(lit.childForFieldName('parameters')).find((p) => p.type === 'parameter_declaration');
  return first?.childrenForFieldName('name').find((n) => n.type === 'identifier');
}

/** "/"-joined route parts with a leading "/"; "" when both are empty. */
export function joinPrefix(a: string, b: string): string {
  const parts = [a, b].map((p) => p.replace(/^\/+|\/+$/g, '')).filter((p) => p.length > 0);
  return parts.length === 0 ? '' : `/${parts.join('/')}`.replace(/\/{2,}/g, '/');
}

export class TreeSitterPrefixes {
  /** Names declared by each function-like node (by start index) and at the package level (-1). */
  private readonly declared = new Map<number, Set<string>>();
  private readonly defs = new Map<string, SyntaxNode[]>();
  private readonly mounts = new Map<string, Mount[]>();
  private readonly cache = new Map<string, Result>();

  constructor(root: SyntaxNode, private readonly context: PrefixContext) {
    const declarations: Array<[SyntaxNode, SyntaxNode]> = [];
    const calls: SyntaxNode[] = [];
    const stack: SyntaxNode[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      switch (node.type) {
        case 'function_declaration':
        case 'method_declaration':
        case 'func_literal': {
          const names = this.namesOf(node.startIndex);
          for (const id of parameterNames(node.childForFieldName('parameters'))) names.add(id.text);
          for (const id of parameterNames(node.childForFieldName('receiver'))) names.add(id.text);
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
          const names = node.childrenForFieldName('name').filter((n) => n.isNamed);
          for (const id of names) this.declare(id);
          const values = named(node.childForFieldName('value'));
          if (names.length === values.length) names.forEach((id, i) => declarations.push([id, values[i]!]));
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
    if (context.chi) for (const call of calls) this.chiMount(call);
  }

  private namesOf(index: number): Set<string> {
    let names = this.declared.get(index);
    if (!names) {
      names = new Set();
      this.declared.set(index, names);
    }
    return names;
  }

  /** Records a declared name in its innermost function, else at the package level. */
  private declare(id: SyntaxNode): void {
    let scope = id.parent;
    while (scope && !FUNCTION_TYPES.has(scope.type)) scope = scope.parent;
    this.namesOf(scope ? scope.startIndex : -1).add(id.text);
  }

  /** The key of the object an identifier names: the innermost function declaring it, else the package level. */
  private keyOf(id: SyntaxNode): string | undefined {
    for (let scope = id.parent; scope; scope = scope.parent) {
      if (FUNCTION_TYPES.has(scope.type) && this.declared.get(scope.startIndex)?.has(id.text)) return `${scope.startIndex}:${id.text}`;
    }
    return this.declared.get(-1)?.has(id.text) ? `-1:${id.text}` : undefined;
  }

  private push<T>(map: Map<string, T[]>, key: string, value: T): void {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  }

  /** The operand and method of a `x.m(...)` call whose operand is not a package name, else undefined. */
  private selector(call: SyntaxNode): { recv: SyntaxNode; method: string; args: SyntaxNode[] } | undefined {
    const fun = call.childForFieldName('function');
    const selector = fun ? unparen(fun) : undefined;
    if (selector?.type !== 'selector_expression') return undefined;
    const recv = selector.childForFieldName('operand');
    const method = selector.childForFieldName('field')?.text;
    if (!recv || !method) return undefined;
    if (recv.type === 'identifier' && this.context.importNames.has(recv.text)) return undefined;
    return { recv, method, args: named(call.childForFieldName('arguments')) };
  }

  /** chi `Mount(pattern, router)`, `Route(pattern, func(r))` and `Group(func(r))`. */
  private chiMount(call: SyntaxNode): void {
    const sel = this.selector(call);
    if (!sel) return;
    const { recv, method, args } = sel;
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

  /** The prefix of a route call's receiver; `''` when there is none or when any part of it is unknown. */
  prefixed(recv: SyntaxNode, path: string): string {
    const { prefix, ok } = this.prefixOf(recv, 0);
    return ok && prefix !== '' ? joinPrefix(prefix, path) : path;
  }

  private prefixOf(node: SyntaxNode, depth: number): { prefix: string; ok: boolean } {
    if (depth > MAX_PREFIX_DEPTH) return { prefix: '', ok: false };
    const expr = unparen(node);
    if (expr.type === 'identifier') {
      const key = this.keyOf(expr);
      return key === undefined ? { prefix: '', ok: true } : this.objectPrefix(key, depth);
    }
    if (expr.type !== 'call_expression') return { prefix: '', ok: true };
    const sel = this.selector(expr);
    if (!sel) return { prefix: '', ok: true };
    const { recv, method, args } = sel;
    const chiFunc = this.context.chi && args.length === 1 && unparen(args[0]!).type === 'func_literal';
    if ((method === 'Group' && this.context.groups && !chiFunc) || (method === 'Route' && this.context.chi)) {
      const path = args[0] ? this.context.constant(args[0]) : undefined;
      if (path === undefined) return { prefix: '', ok: false };
      const outer = this.prefixOf(recv, depth + 1);
      return { prefix: joinPrefix(outer.prefix, path), ok: outer.ok };
    }
    if (this.context.chi && (method === 'With' || (method === 'Group' && chiFunc))) return this.prefixOf(recv, depth + 1);
    return { prefix: '', ok: true };
  }

  private objectPrefix(key: string, depth: number): { prefix: string; ok: boolean } {
    const cached = this.cache.get(key);
    if (cached === 'pending') return { prefix: '', ok: false };
    if (cached) return cached;
    this.cache.set(key, 'pending');
    const values: string[] = [];
    let ok = true;
    const mounts = this.mounts.get(key) ?? [];
    if (mounts.length > 0) {
      for (const mount of mounts) {
        const outer = mount.path === undefined ? { prefix: '', ok: false } : this.prefixOf(mount.recv, depth + 1);
        if (!outer.ok) {
          ok = false;
          break;
        }
        values.push(joinPrefix(outer.prefix, mount.path!));
      }
    } else {
      for (const def of this.defs.get(key) ?? []) {
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
    this.cache.set(key, result);
    return result;
  }
}
