// Route prefixes of TypeScript routers (roadmap "Route prefixes from Express mounts"): the path a router is
// mounted at, joined to the routes declared on it. Mounts are Express and Koa router `use(path, router)`
// (`router.routes()` and `router.middleware()` for Koa) and Hono `route(path, app)`; a router's own prefix is the
// Koa `new Router({ prefix })` option or a Hono `basePath(path)` call. Resolution is syntactic: a mounted argument
// must be an identifier whose declaration is found in the project (same file, or a module-level router imported
// through relative imports). Anything unresolved, dynamic or ambiguous gives no prefix, so the route keeps the
// path written at the call (never a guessed route).
import { Node, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import type { ModuleResolver } from '../sql/module-resolver.js';
import { receiverModule } from '../sql/provenance.js';
import { WalkState, declarationOf, exportOf, importBindingOf, unwrapExpression } from '../sql/declarations.js';
import { isRelativeSpecifier } from '../sql/module-resolver.js';
import { joinRoute } from './fact-rules.js';

/** Modules whose `use(path, router)` mounts a router. */
const USE_MODULES: ReadonlySet<string> = new Set(['express', '@koa/router', 'koa-router']);
/** Modules whose `route(path, app)` mounts an app (Hono). */
const ROUTE_MOUNT_MODULES: ReadonlySet<string> = new Set(['hono']);
/** Koa router modules, whose `new Router({ prefix })` option is the router's own prefix. */
const KOA_MODULES: ReadonlySet<string> = new Set(['@koa/router', 'koa-router']);
/** Koa members that hand a router to `use`. */
const KOA_MOUNT_MEMBERS: ReadonlySet<string> = new Set(['routes', 'middleware']);
/** The most mount hops followed from one router (nested routers). */
const MAX_MOUNT_DEPTH = 8;

/** A mount path: a constant, none (mounted at the parent's root) or dynamic (not a constant). */
type MountPath = { readonly kind: 'constant'; readonly value: string } | { readonly kind: 'root' } | { readonly kind: 'dynamic' };

/** One mount of a router: the receiver it is mounted on and the path. */
interface Mount {
  readonly receiver: Node;
  readonly path: MountPath;
}

/** A known prefix (possibly `''`) or `undefined` for unknown. */
type Prefix = string | undefined;

/** The key of a declaration node: its file and start offset. */
function keyOf(node: Node): string {
  return `${node.getSourceFile().getFilePath()}#${node.getStart()}`;
}

/** A string literal or no-substitution template value, else undefined. */
function literalValue(node: Node | undefined): string | undefined {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;
}

/** A path argument: a literal, or an identifier of a `const` with a literal initializer; else undefined. */
function constantPath(node: Node): string | undefined {
  const expr = unwrapExpression(node, false);
  const literal = literalValue(expr);
  if (literal !== undefined) return literal;
  if (!Node.isIdentifier(expr)) return undefined;
  const declaration = declarationOf(expr);
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  const statement = declaration.getVariableStatement();
  if (!statement || statement.getDeclarationKind() !== 'const') return undefined;
  const initializer = declaration.getInitializer();
  return initializer ? literalValue(unwrapExpression(initializer, false)) : undefined;
}

/**
 * The path of a `use(...)` call's first argument: a constant; dynamic for a non-constant string-like expression
 * (template, `+`, member access, a parameter) when more arguments follow; root otherwise (a router or middleware
 * mounted at the parent's root).
 */
function usePath(args: readonly Node[]): MountPath {
  const first = args[0];
  if (!first) return { kind: 'root' };
  const constant = constantPath(first);
  if (constant !== undefined) return { kind: 'constant', value: constant };
  if (args.length < 2) return { kind: 'root' };
  const expr = unwrapExpression(first, false);
  if (
    Node.isTemplateExpression(expr) ||
    Node.isBinaryExpression(expr) ||
    Node.isPropertyAccessExpression(expr) ||
    Node.isElementAccessExpression(expr)
  ) {
    return { kind: 'dynamic' };
  }
  if (Node.isIdentifier(expr)) {
    const declaration = declarationOf(expr);
    if (!declaration || Node.isParameterDeclaration(declaration) || Node.isBindingElement(declaration)) return { kind: 'dynamic' };
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      const value = initializer ? unwrapExpression(initializer, false) : undefined;
      if (!value || Node.isTemplateExpression(value) || Node.isBinaryExpression(value) || literalValue(value) !== undefined) {
        return { kind: 'dynamic' };
      }
    }
  }
  return { kind: 'root' };
}

/** The identifier a mounted argument names: `router` (Express, Hono) or `router.routes()` / `router.middleware()` (Koa). */
function mountedIdentifier(arg: Node): Node | undefined {
  const expr = unwrapExpression(arg, false);
  if (Node.isIdentifier(expr)) return expr;
  if (Node.isCallExpression(expr)) {
    const callee = expr.getExpression();
    if (Node.isPropertyAccessExpression(callee) && KOA_MOUNT_MEMBERS.has(callee.getName()) && expr.getArguments().length === 0) {
      const target = unwrapExpression(callee.getExpression(), false);
      return Node.isIdentifier(target) ? target : undefined;
    }
  }
  return undefined;
}

/**
 * The router declaration an identifier names: its declaration in the same file, or, for a relative import, the
 * exported declaration of the imported module (through re-exports and `export default <identifier>`). Only
 * files the resolver serves count.
 */
function routerDeclaration(identifier: Node, resolver: ModuleResolver): Node | undefined {
  const state = new WalkState();
  let declaration = declarationOf(identifier);
  while (declaration && state.enter(declaration)) {
    const binding = importBindingOf(declaration);
    if (binding) {
      if (!isRelativeSpecifier(binding.specifier) || binding.exportName === undefined) return undefined;
      const target = resolver.sourceFileFor(binding.file, binding.specifier);
      declaration = target ? exportOf(target, binding.exportName, resolver, state) : undefined;
      continue;
    }
    if (Node.isExportAssignment(declaration)) {
      const expression = unwrapExpression(declaration.getExpression(), false);
      declaration = Node.isIdentifier(expression) ? declarationOf(expression) : undefined;
      continue;
    }
    return Node.isVariableDeclaration(declaration) ? declaration : undefined;
  }
  return undefined;
}

/** Whether a file may hold a mount (a cheap text check before walking its calls). */
function mayMount(sourceFile: SourceFile): boolean {
  const text = sourceFile.getFullText();
  return text.includes('.use(') || text.includes('.route(');
}

/**
 * The mounts of a set of source files, keyed by the mounted router's declaration, and the prefix of a route
 * call's receiver. Build it once per set of loaded files; `resolver` should serve loaded files only, so the
 * index never depends on files read from disk while it is built.
 */
export class RoutePrefixes {
  private readonly mounts = new Map<string, Mount[]>();
  private readonly cache = new Map<string, Prefix>();

  constructor(
    sourceFiles: readonly SourceFile[],
    private readonly resolver: ModuleResolver,
  ) {
    const sorted = [...sourceFiles].sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : a.getFilePath() > b.getFilePath() ? 1 : 0));
    for (const sourceFile of sorted) {
      if (sourceFile.isDeclarationFile() || !mayMount(sourceFile)) continue;
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) this.collect(call);
    }
  }

  private collect(call: CallExpression): void {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const member = callee.getName();
    if (member !== 'use' && member !== 'route') return;
    const args = call.getArguments();
    if (member === 'route' && args.length !== 2) return;
    if (member === 'use' && args.length === 0) return;
    const receiver = callee.getExpression();
    const modules = member === 'use' ? USE_MODULES : ROUTE_MOUNT_MODULES;
    let path: MountPath;
    let mounted: readonly Node[];
    if (member === 'route') {
      const constant = constantPath(args[0]!);
      path = constant !== undefined ? { kind: 'constant', value: constant } : { kind: 'dynamic' };
      mounted = [args[1]!];
    } else {
      path = usePath(args);
      mounted = path.kind === 'root' ? args : args.slice(1);
    }
    const identifiers = mounted.map(mountedIdentifier).filter((id): id is Node => id !== undefined);
    if (identifiers.length === 0) return;
    if (receiverModule(receiver, this.resolver, modules) === undefined) return;
    for (const identifier of identifiers) {
      const declaration = routerDeclaration(identifier, this.resolver);
      if (!declaration) continue;
      const key = keyOf(declaration);
      const list = this.mounts.get(key) ?? [];
      list.push({ receiver, path });
      this.mounts.set(key, list);
    }
  }

  /**
   * The prefix of a route call's receiver: the mount prefixes of the router it names joined with its own prefix,
   * `''` when there is none or when any part is unknown (dynamic, unresolved or mounted at different paths).
   */
  prefixOf(receiver: Node): string {
    return this.expressionPrefix(receiver, 0) ?? '';
  }

  private expressionPrefix(node: Node, depth: number): Prefix {
    if (depth > MAX_MOUNT_DEPTH) return undefined;
    const expr = unwrapExpression(node, true);
    if (Node.isIdentifier(expr)) {
      const declaration = routerDeclaration(expr, this.resolver);
      return declaration ? this.declarationPrefix(declaration, depth) : '';
    }
    if (Node.isCallExpression(expr)) {
      const callee = expr.getExpression();
      // Hono `x.basePath('/api')`: x's prefix joined with the base path.
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'basePath' && expr.getArguments().length === 1) {
        const base = constantPath(expr.getArguments()[0]!);
        if (base === undefined) return undefined;
        if (receiverModule(callee.getExpression(), this.resolver, ROUTE_MOUNT_MODULES) === undefined) return '';
        const outer = this.expressionPrefix(callee.getExpression(), depth + 1);
        return outer === undefined ? undefined : joinPrefix(outer, base);
      }
      return '';
    }
    if (Node.isNewExpression(expr)) return this.koaOption(expr);
    return '';
  }

  /** Koa `new Router({ prefix: '/api' })`: the option's value; unknown when the option is not a constant. */
  private koaOption(expr: Node): Prefix {
    if (!Node.isNewExpression(expr)) return '';
    const options = expr.getArguments()[0];
    if (!options || !Node.isObjectLiteralExpression(options)) return '';
    if (receiverModule(expr, this.resolver, KOA_MODULES) === undefined) return '';
    for (const property of options.getProperties()) {
      if (Node.isShorthandPropertyAssignment(property) && property.getName() === 'prefix') return undefined;
      if (!Node.isPropertyAssignment(property)) continue;
      const name = property.getNameNode();
      const key = Node.isIdentifier(name) ? name.getText() : literalValue(name);
      if (key !== 'prefix') continue;
      const initializer = property.getInitializer();
      return initializer ? constantPath(initializer) : undefined;
    }
    return '';
  }

  private declarationPrefix(declaration: Node, depth: number): Prefix {
    const key = keyOf(declaration);
    if (this.cache.has(key)) return this.cache.get(key);
    // A cycle (a router mounted on itself through others) is unknown.
    this.cache.set(key, undefined);
    const own = this.ownPrefix(declaration, depth);
    let result: Prefix = own;
    const mounts = this.mounts.get(key);
    if (own !== undefined && mounts && mounts.length > 0) {
      const outer = new Set<Prefix>();
      for (const mount of mounts) {
        if (mount.path.kind === 'dynamic') {
          outer.add(undefined);
          continue;
        }
        const parent = this.expressionPrefix(mount.receiver, depth + 1);
        outer.add(parent === undefined ? undefined : joinPrefix(parent, mount.path.kind === 'constant' ? mount.path.value : ''));
      }
      result = outer.size === 1 && !outer.has(undefined) ? joinPrefix([...outer][0]!, own) : undefined;
    }
    this.cache.set(key, result);
    return result;
  }

  /** The router's own prefix, from its initializer: Koa's `prefix` option or a Hono `basePath` chain. */
  private ownPrefix(declaration: Node, depth: number): Prefix {
    if (!Node.isVariableDeclaration(declaration)) return '';
    const initializer = declaration.getInitializer();
    if (!initializer) return '';
    const expr = unwrapExpression(initializer, true);
    if (Node.isNewExpression(expr)) return this.koaOption(expr);
    if (Node.isCallExpression(expr)) return this.expressionPrefix(expr, depth + 1);
    return '';
  }
}

/** Two prefix parts joined by the route rule; `''` stays `''`. */
function joinPrefix(a: string, b: string): string {
  const joined = joinRoute(a, b);
  return joined === '/' ? '' : joined;
}
