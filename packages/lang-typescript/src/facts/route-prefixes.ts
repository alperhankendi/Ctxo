// Route prefixes of TypeScript routers (route prefixes from Express, Koa and Hono mounts): the path a router is
// mounted at, joined to the routes declared on it. Mounts are Express and Koa router `use(path, router)`
// (`router.routes()` and `router.middleware()` for Koa) and Hono `route(path, app)`; a router's own prefix is the
// Koa `new Router({ prefix })` option or a Hono `basePath(path)` call. Resolution is syntactic and reads the file
// being indexed only: a mounted router must be a `const` declared in that file, and the mount must be in that file
// too, so a full run and a run that re-indexes only this file give the same facts. Every segment of the chain must
// be a compile-time constant string; anything dynamic, unresolved, imported or ambiguous leaves the whole prefix
// unresolved, and the route is reported as written at the call (never a guessed route).
import { Node, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { ModuleResolver } from '../sql/module-resolver.js';
import { receiverModule } from '../sql/provenance.js';
import { declarationOf, unwrapExpression } from '../sql/declarations.js';
import { joinRoute } from './fact-rules.js';

/** Modules whose `use(path, router)` mounts a router. */
const USE_MODULES: ReadonlySet<string> = new Set(['express', '@koa/router', 'koa-router']);
/** Modules whose `route(path, app)` mounts an app (Hono). */
const ROUTE_MOUNT_MODULES: ReadonlySet<string> = new Set(['hono']);
/** Koa router modules, whose `new Router({ prefix })` option is the router's own prefix. */
const KOA_MODULES: ReadonlySet<string> = new Set(['@koa/router', 'koa-router']);
/** Every router module: a `const` traced to one of them is a router, not a path. */
const ROUTER_MODULES: ReadonlySet<string> = new Set([...USE_MODULES, ...ROUTE_MOUNT_MODULES]);
/** Koa members that hand a router to `use`. */
const KOA_MOUNT_MEMBERS: ReadonlySet<string> = new Set(['routes', 'middleware']);
/** The most mount hops followed from one router (nested routers). */
const MAX_MOUNT_DEPTH = 8;

/** A resolver that never leaves the file: relative imports stay unresolved, so prefixes depend on this file only. */
class SameFileResolver extends ModuleResolver {
  override sourceFileFor(): SourceFile | undefined {
    return undefined;
  }
}

/** A mount path: a constant, none (mounted at the parent's root) or dynamic (not a constant). */
type MountPath = { readonly kind: 'constant'; readonly value: string } | { readonly kind: 'root' } | { readonly kind: 'dynamic' };

/** One mount of a router: the receiver it is mounted on and the path. */
interface Mount {
  readonly receiver: Node;
  readonly path: MountPath;
}

/** A known prefix (possibly `''`) or `undefined` for unknown. */
type Prefix = string | undefined;

/** A string literal or no-substitution template value, else undefined. */
function literalValue(node: Node | undefined): string | undefined {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;
}

/** A `const` variable declaration of this file, else undefined. */
function constDeclaration(declaration: Node | undefined): Node | undefined {
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  const statement = declaration.getVariableStatement();
  return statement && statement.getDeclarationKind() === 'const' ? declaration : undefined;
}

/** A path argument: a literal, or an identifier of a `const` with a literal initializer; else undefined. */
function constantPath(node: Node): string | undefined {
  const expr = unwrapExpression(node, false);
  const literal = literalValue(expr);
  if (literal !== undefined) return literal;
  if (!Node.isIdentifier(expr)) return undefined;
  const declaration = constDeclaration(declarationOf(expr));
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = declaration.getInitializer();
  return initializer ? literalValue(unwrapExpression(initializer, false)) : undefined;
}

/** The router `const` an identifier names in this file (never through an import), else undefined. */
function routerDeclaration(identifier: Node): Node | undefined {
  return constDeclaration(declarationOf(identifier));
}

/** Whether a file may hold a mount (a cheap text check before walking its calls). */
function mayMount(sourceFile: SourceFile): boolean {
  const text = sourceFile.getFullText();
  return text.includes('.use(') || text.includes('.route(');
}

/**
 * The mounts of one source file, keyed by the mounted router's declaration, and the prefix of a route call's
 * receiver in that file.
 */
export class RoutePrefixes {
  private readonly mounts = new Map<Node, Mount[]>();
  private readonly cache = new Map<Node, Prefix>();
  private readonly resolver: ModuleResolver;
  /** Set when a lookup reached the depth cap: such results are not cached. */
  private capped = false;

  constructor(sourceFile: SourceFile) {
    this.resolver = new SameFileResolver(sourceFile.getProject());
    if (sourceFile.isDeclarationFile() || !mayMount(sourceFile)) return;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) this.collect(call);
  }

  /**
   * The path of a `use(...)` call's first argument: a constant; root when it is itself something mounted (a router
   * `const` of this file, a function, `x.routes()`), with more arguments following; dynamic for anything else (a call,
   * a conditional, an array, a regex, a template with expressions, an import, a parameter).
   */
  private usePath(args: readonly Node[]): MountPath {
    const first = args[0];
    if (!first) return { kind: 'root' };
    const constant = constantPath(first);
    if (constant !== undefined) return { kind: 'constant', value: constant };
    return this.isMountable(first) ? { kind: 'root' } : { kind: 'dynamic' };
  }

  /** A router or a middleware function: never a path. */
  private isMountable(node: Node): boolean {
    const expr = unwrapExpression(node, false);
    if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) return true;
    if (Node.isCallExpression(expr)) {
      const callee = expr.getExpression();
      return Node.isPropertyAccessExpression(callee) && KOA_MOUNT_MEMBERS.has(callee.getName()) && expr.getArguments().length === 0;
    }
    if (!Node.isIdentifier(expr)) return false;
    const declaration = declarationOf(expr);
    if (declaration && Node.isFunctionDeclaration(declaration)) return true;
    const constant = constDeclaration(declaration);
    if (!constant || !Node.isVariableDeclaration(constant)) return false;
    const initializer = constant.getInitializer();
    if (!initializer) return false;
    const value = unwrapExpression(initializer, true);
    if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) return true;
    return receiverModule(value, this.resolver, ROUTER_MODULES) !== undefined;
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
    } else if (args.length === 1) {
      path = { kind: 'root' };
      mounted = args;
    } else {
      path = this.usePath(args);
      mounted = path.kind === 'root' ? args : args.slice(1);
    }
    const identifiers = mounted.map(mountedIdentifier).filter((id): id is Node => id !== undefined);
    if (identifiers.length === 0) return;
    if (receiverModule(receiver, this.resolver, modules) === undefined) return;
    for (const identifier of identifiers) {
      const declaration = routerDeclaration(identifier);
      if (!declaration) continue;
      const list = this.mounts.get(declaration) ?? [];
      list.push({ receiver, path });
      this.mounts.set(declaration, list);
    }
  }

  /**
   * The prefix of a route call's receiver: the mount prefixes of the router it names joined with its own prefix,
   * `''` when there is none or when any part is unknown (dynamic, unresolved or mounted at different paths).
   */
  prefixOf(receiver: Node): string {
    this.capped = false;
    return this.expressionPrefix(receiver, 0) ?? '';
  }

  private expressionPrefix(node: Node, depth: number): Prefix {
    if (depth > MAX_MOUNT_DEPTH) {
      this.capped = true;
      return undefined;
    }
    const expr = unwrapExpression(node, true);
    if (Node.isIdentifier(expr)) {
      const declaration = declarationOf(expr);
      if (!declaration || Node.isParameterDeclaration(declaration)) return '';
      const router = routerDeclaration(expr);
      // A `let`/`var` router or an imported one: unknown, so a mount of an earlier value is never used.
      return router ? this.declarationPrefix(router, depth) : Node.isVariableDeclaration(declaration) ? undefined : '';
    }
    if (Node.isCallExpression(expr)) {
      const callee = expr.getExpression();
      // Hono `x.basePath('/api')`: x's prefix joined with the base path.
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'basePath' && expr.getArguments().length === 1) {
        if (receiverModule(callee.getExpression(), this.resolver, ROUTE_MOUNT_MODULES) === undefined) return '';
        const base = constantPath(expr.getArguments()[0]!);
        if (base === undefined) return undefined;
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
      if (Node.isSpreadAssignment(property)) return undefined;
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
    if (this.cache.has(declaration)) return this.cache.get(declaration);
    // A cycle (a router mounted on itself through others) is unknown.
    this.cache.set(declaration, undefined);
    const outerCapped = this.capped;
    this.capped = false;
    const own = this.ownPrefix(declaration, depth);
    let result: Prefix = own;
    const mounts = this.mounts.get(declaration);
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
    // A result cut by the depth cap is not cached: a shallower lookup may resolve it.
    if (this.capped) this.cache.delete(declaration);
    else this.cache.set(declaration, result);
    this.capped = this.capped || outerCapped;
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

/** Two prefix parts joined by the route rule; `''` stays `''`. */
function joinPrefix(a: string, b: string): string {
  const joined = joinRoute(a, b);
  return joined === '/' ? '' : joined;
}
