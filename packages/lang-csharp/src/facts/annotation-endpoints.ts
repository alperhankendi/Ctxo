// C# attribute routes (PR 4, issue #156, FC-8 and the C# row of the language mapping). Built from
// symbol annotations, which the Roslyn and tree-sitter tiers both emit, so the tiers agree.
import type { SymbolAnnotation, SymbolNode } from '@ctxo/plugin-api';
import type { FactEvidence } from './fact-types.js';
import { joinRoute } from './fact-rules.js';

const HTTP_VERBS: Readonly<Record<string, string>> = {
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpDelete: 'DELETE',
  HttpPatch: 'PATCH',
  HttpHead: 'HEAD',
  HttpOptions: 'OPTIONS',
};

/**
 * The route template of an annotation: `args[0]`, else `named.template`, else `named.Template`.
 * `Template` is get-only on ASP.NET's attributes, so the named form in source is the constructor
 * argument `template:`: the Roslyn semantic path reports it in `args[0]`, the Roslyn syntax fallback
 * and tree-sitter in `named.template`.
 */
function template(annotation: SymbolAnnotation): string | undefined {
  return annotation.args?.[0] ?? annotation.named?.['template'] ?? annotation.named?.['Template'];
}

/** The last `.` segment of a symbol name, without the syntax tier's `(n)` parameter suffix. */
function simpleName(name: string): string {
  const bare = name.replace(/\(\d*\)$/, '');
  return bare.slice(bare.lastIndexOf('.') + 1);
}

/** The innermost class whose span holds the method: the later start, then the smaller span, then index order. */
function enclosingClass(method: SymbolNode, symbols: readonly SymbolNode[]): SymbolNode | undefined {
  let best: SymbolNode | undefined;
  for (const symbol of symbols) {
    if (symbol.kind !== 'class' || symbol.startLine > method.startLine || symbol.endLine < method.endLine) continue;
    if (
      !best
      || symbol.startLine > best.startLine
      || (symbol.startLine === best.startLine && symbol.endLine - symbol.startLine < best.endLine - best.startLine)
    ) {
      best = symbol;
    }
  }
  return best;
}

function replaceTokens(route: string, controller: string, action: string): string {
  return route.replace(/\[controller\]/gi, controller).replace(/\[action\]/gi, action);
}

/**
 * `route` evidence for C# attribute routes: one per `Http*` annotation of a method (its template, else
 * the method's `Route` template), or `ANY` for each `Route` of a method without `Http*`. The class
 * prefix is the `Route` of the innermost enclosing class, ignored when the method template starts
 * with `/` or `~/`; a class without its own `Route` takes its entry in `inheritedRoutes` (class symbol
 * ID to template, which only the Roslyn tier resolves). `[controller]` is the class name without a
 * `Controller` suffix, `[action]` the method name. The line is the method's `startLine`.
 */
export function annotationRouteEvidence(
  symbols: readonly SymbolNode[],
  inheritedRoutes: ReadonlyMap<string, string> = new Map(),
): FactEvidence[] {
  const evidence: FactEvidence[] = [];
  for (const method of symbols) {
    if (method.kind !== 'method' || !method.annotations) continue;
    const httpAnnotations = method.annotations.filter(a => HTTP_VERBS[a.name] !== undefined);
    const routeAnnotations = method.annotations.filter(a => a.name === 'Route');
    if (httpAnnotations.length === 0 && routeAnnotations.length === 0) continue;

    const owner = enclosingClass(method, symbols);
    const className = owner ? simpleName(owner.name) : '';
    const controller = className.length > 'Controller'.length && className.endsWith('Controller')
      ? className.slice(0, -'Controller'.length)
      : className;
    const action = simpleName(method.name);
    const classRouteAnnotation = owner?.annotations?.find(a => a.name === 'Route');
    const classRoute = classRouteAnnotation
      ? template(classRouteAnnotation)
      : owner ? inheritedRoutes.get(owner.symbolId) : undefined;
    const methodRoute = routeAnnotations.length > 0 ? template(routeAnnotations[0]!) : undefined;

    const routes: { readonly verb: string; readonly template: string | undefined }[] = httpAnnotations.length > 0
      ? httpAnnotations.map(a => ({ verb: HTTP_VERBS[a.name]!, template: template(a) ?? methodRoute }))
      : routeAnnotations.map(a => ({ verb: 'ANY', template: template(a) }));

    for (const { verb, template: methodTemplate } of routes) {
      const own = methodTemplate ?? '';
      const absolute = own.startsWith('/') || own.startsWith('~/');
      const combined = absolute ? joinRoute(own.replace(/^~/, '')) : joinRoute(classRoute, own);
      evidence.push({
        kind: 'route',
        symbolId: method.symbolId,
        line: method.startLine,
        verb,
        route: replaceTokens(combined, controller, action),
      });
    }
  }
  return evidence;
}
