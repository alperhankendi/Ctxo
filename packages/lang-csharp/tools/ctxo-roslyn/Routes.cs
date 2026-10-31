using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Operations;

// ── Route prefixes (MapGroup and inherited controller routes) ───────

/// <summary>
/// The <c>MapGroup</c> prefixes of a minimal API route call, resolved through the semantic model:
/// <c>var g = app.MapGroup("/api"); g.MapGet("/x", ...)</c> gives <c>/api/x</c>, nested groups
/// compose, fluent calls that return their own receiver (<c>WithTags</c>, <c>RequireAuthorization</c>)
/// keep the prefix, and a group passed to a method (an extension method's <c>this</c> parameter
/// included) takes the prefix its call sites agree on. A prefix that does not resolve is null, and
/// the route keeps the call's own template: a route is never guessed.
/// <para>
/// One instance per compilation, shared by every file of the project (the batch walks files one
/// at a time). Cost: the first group parameter builds a name index with one pass over the tokens
/// of the compilation; each method is then searched once, in the trees that name it, and its
/// result is cached for the rest of the compilation's files. Memory: the index (one entry per
/// distinct identifier per file) and the semantic models of the trees searched live until
/// <see cref="ReleaseAll"/>, which the batch calls after each project and keep-alive after each
/// request.
/// </para>
/// </summary>
sealed class RouteGroups
{
    const string MapGroupName = "MapGroup";
    const int MaxDepth = 8;

    static readonly Dictionary<Compilation, RouteGroups> PerCompilation = [];
    /// <summary>Instances of dependent compilations, used only for their name index and models.</summary>
    static readonly Dictionary<Compilation, RouteGroups> IndexOnly = [];
    /// <summary>Data-flow write sets per statement or expression, shared by the locals of a member body.</summary>
    static readonly Dictionary<SyntaxNode, HashSet<ISymbol>?> WrittenByRegion = [];

    /// <summary>Group types by name; <c>WebApplication</c> is the app itself, never a group.</summary>
    static readonly HashSet<string> GroupTypeNames = new(StringComparer.Ordinal) { "RouteGroupBuilder", "IEndpointRouteBuilder" };
    const string RouteBuilderInterface = "IEndpointRouteBuilder";
    const string AppTypeName = "WebApplication";

    readonly Compilation compilation;
    readonly IReadOnlyList<Compilation> dependentCompilations;
    readonly Dictionary<IParameterSymbol, string?> parameterPrefixes = new(SymbolEqualityComparer.Default);
    readonly HashSet<ISymbol> inProgress = new(SymbolEqualityComparer.Default);
    readonly Dictionary<SyntaxTree, SemanticModel> models = [];
    Dictionary<string, List<SyntaxTree>>? treesByName;

    /// <summary>Times a depth or cycle guard gave null; a result reached through one is not cached.</summary>
    int guardHits;

    RouteGroups(Compilation compilation, IReadOnlyList<Compilation> dependentCompilations)
    {
        this.compilation = compilation;
        this.dependentCompilations = dependentCompilations;
    }

    /// <summary>
    /// The shared instance of a compilation. <paramref name="dependentCompilations"/>: the compiled
    /// projects that reference this one, directly or not. An externally visible method that code in
    /// one of them references has call sites outside this compilation, so it is not followed.
    /// </summary>
    public static RouteGroups For(Compilation compilation, IReadOnlyList<Compilation> dependentCompilations)
    {
        if (!PerCompilation.TryGetValue(compilation, out var groups))
            PerCompilation[compilation] = groups = new RouteGroups(compilation, dependentCompilations);
        return groups;
    }

    /// <summary>Drops every instance with its name index, semantic models and cached results.</summary>
    public static void ReleaseAll()
    {
        PerCompilation.Clear();
        IndexOnly.Clear();
        WrittenByRegion.Clear();
    }

    /// <summary>A prefix and a template joined with one <c>/</c>; the plugin normalizes the rest.</summary>
    public static string Join(string prefix, string template) => $"{prefix.TrimEnd('/')}/{template.TrimStart('/')}";

    /// <summary>
    /// The receiver of a call: the <c>this</c> argument of an extension method (also in the static
    /// form), else the instance; for a call that does not resolve, the expression before the dot.
    /// </summary>
    public static ExpressionSyntax? Receiver(InvocationExpressionSyntax invocation, SemanticModel model)
    {
        if (model.GetOperation(invocation) is IInvocationOperation operation)
        {
            if (operation.TargetMethod.IsExtensionMethod)
            {
                var self = operation.Arguments.FirstOrDefault(a => a.Parameter?.Ordinal == 0);
                return self != null ? Unwrap(self.Value).Syntax as ExpressionSyntax : null;
            }
            if (operation.TargetMethod.IsStatic) return null;
            return operation.Instance is { IsImplicit: false } instance ? instance.Syntax as ExpressionSyntax : null;
        }
        return invocation.Expression is MemberAccessExpressionSyntax access ? access.Expression : null;
    }

    /// <summary>The group prefix of a route call's receiver: <c>""</c> for the app itself, null when it does not resolve.</summary>
    public string? Prefix(ExpressionSyntax receiver, SemanticModel model) => Resolve(receiver, model, 0);

    string? Resolve(ExpressionSyntax expression, SemanticModel model, int depth)
    {
        if (depth > MaxDepth)
        {
            guardHits++;
            return null;
        }
        while (expression is ParenthesizedExpressionSyntax parenthesized) expression = parenthesized.Expression;

        if (expression is InvocationExpressionSyntax invocation)
        {
            var operation = model.GetOperation(invocation) as IInvocationOperation;
            if (IsMapGroup(invocation, operation))
            {
                var segment = GroupSegment(invocation, operation, model);
                var groupReceiver = segment != null ? Receiver(invocation, model) : null;
                var outer = groupReceiver != null ? Resolve(groupReceiver, model, depth + 1) : null;
                return outer == null ? null : outer.Length == 0 ? segment : Join(outer, segment!);
            }
            // `group.WithTags("x")`: a fluent call that returns its own receiver keeps its prefix.
            if (operation != null && ReturnsItsReceiver(operation.TargetMethod))
            {
                var fluentReceiver = Receiver(invocation, model);
                return fluentReceiver != null ? Resolve(fluentReceiver, model, depth + 1) : null;
            }
        }

        switch (model.GetSymbolInfo(expression).Symbol)
        {
            case ILocalSymbol local:
                return Local(local, model, depth);
            case IParameterSymbol parameter:
                return Parameter(parameter, depth);
        }
        return MayBeGroup(model.GetTypeInfo(expression).Type) ? null : "";
    }

    /// <summary>
    /// A <c>MapGroup</c> call: by name when the call does not resolve; when it does, only ASP.NET's
    /// (declared by <c>EndpointRouteBuilderExtensions</c> or returning a <c>RouteGroupBuilder</c>).
    /// </summary>
    static bool IsMapGroup(InvocationExpressionSyntax invocation, IInvocationOperation? operation)
    {
        if (MethodName(invocation) != MapGroupName) return false;
        if (operation == null) return true;
        var method = operation.TargetMethod;
        return method.ContainingType?.Name == "EndpointRouteBuilderExtensions" || method.ReturnType.Name == "RouteGroupBuilder";
    }

    /// <summary>
    /// The ASP.NET convention shape <c>TBuilder M&lt;TBuilder&gt;(this TBuilder builder, ...)</c>
    /// (<c>WithTags</c>, <c>RequireAuthorization</c>, <c>WithOpenApi</c>, <c>AddEndpointFilter</c>):
    /// an extension method declared in a <c>Microsoft.AspNetCore</c> namespace whose return type is the
    /// type parameter of its <c>this</c> parameter. Any other call, a project's own method of that
    /// shape or a non-generic one returning <c>RouteGroupBuilder</c> included, is not followed.
    /// </summary>
    static bool ReturnsItsReceiver(IMethodSymbol method)
    {
        var definition = (method.ReducedFrom ?? method).OriginalDefinition;
        var ns = definition.ContainingNamespace?.ToDisplayString() ?? "";
        return (ns == "Microsoft.AspNetCore" || ns.StartsWith("Microsoft.AspNetCore.", StringComparison.Ordinal))
            && definition.IsExtensionMethod
            && definition.IsGenericMethod
            && definition.Parameters.Length > 0
            && definition.ReturnType is ITypeParameterSymbol { TypeParameterKind: TypeParameterKind.Method } returned
            && SymbolEqualityComparer.Default.Equals(definition.Parameters[0].Type, returned);
    }

    static string? MethodName(InvocationExpressionSyntax invocation) => invocation.Expression switch
    {
        MemberAccessExpressionSyntax access => access.Name.Identifier.ValueText,
        SimpleNameSyntax name => name.Identifier.ValueText,
        _ => null,
    };

    /// <summary>The constant string prefix of a <c>MapGroup</c> call; null for any other argument.</summary>
    static string? GroupSegment(InvocationExpressionSyntax invocation, IInvocationOperation? operation, SemanticModel model)
    {
        ExpressionSyntax? argument;
        if (operation != null)
        {
            var ordinal = operation.TargetMethod.IsExtensionMethod ? 1 : 0;
            argument = operation.Arguments.FirstOrDefault(a => a.Parameter?.Ordinal == ordinal) is { ArgumentKind: ArgumentKind.Explicit } a
                ? Unwrap(a.Value).Syntax as ExpressionSyntax
                : null;
        }
        else
        {
            var arguments = invocation.ArgumentList.Arguments;
            argument = arguments.Count == 1 ? arguments[0].Expression : null;
        }
        if (argument == null) return null;
        var constant = model.GetConstantValue(argument);
        return constant.HasValue && constant.Value is string segment ? segment : null;
    }

    /// <summary>
    /// Whether a value of this type may be a route group: no type, an unresolved type, a type
    /// parameter, a type named <c>RouteGroupBuilder</c> or <c>IEndpointRouteBuilder</c>, or any other
    /// type that implements <c>IEndpointRouteBuilder</c> except <c>WebApplication</c> (the app itself).
    /// </summary>
    static bool MayBeGroup(ITypeSymbol? type)
    {
        if (type == null || type.TypeKind is TypeKind.Error or TypeKind.TypeParameter) return true;
        if (GroupTypeNames.Contains(type.Name)) return true;
        if (type.Name == AppTypeName) return false;
        return type.AllInterfaces.Any(i => i.Name == RouteBuilderInterface);
    }

    /// <summary>A local with one initializer that is never written again: the initializer's prefix.</summary>
    string? Local(ILocalSymbol local, SemanticModel model, int depth)
    {
        if (local.IsRef
            || local.DeclaringSyntaxReferences is not [var reference]
            || reference.GetSyntax() is not VariableDeclaratorSyntax { Initializer.Value: var value } declarator
            || declarator.SyntaxTree != model.SyntaxTree
            || IsWrittenAgain(local, declarator, model))
        {
            return MayBeGroup(local.Type) ? null : "";
        }
        if (!inProgress.Add(local))
        {
            guardHits++;
            return null;
        }
        try
        {
            return Resolve(value, model, depth + 1);
        }
        finally
        {
            inProgress.Remove(local);
        }
    }

    /// <summary>
    /// Any write to the local after its declaration: Roslyn's data flow over every later statement of
    /// its block (or the later top-level statements), plus a syntax check for the forms data flow may
    /// leave out (writes in local functions, <c>ref</c> aliases). A declaration outside a block or the
    /// top level, or a data flow that does not succeed, counts as written.
    /// </summary>
    static bool IsWrittenAgain(ILocalSymbol local, VariableDeclaratorSyntax declarator, SemanticModel model) =>
        WrittenByDataFlow(local, declarator, model) || WrittenBySyntax(local, declarator, model);

    static bool WrittenByDataFlow(ILocalSymbol local, VariableDeclaratorSyntax declarator, SemanticModel model)
    {
        if (declarator.FirstAncestorOrSelf<LocalDeclarationStatementSyntax>() is not { } declaration) return true;
        IEnumerable<SyntaxNode> later;
        if (declaration.Parent is BlockSyntax block)
            later = block.Statements.SkipWhile(s => s != declaration).Skip(1);
        else if (declaration.Parent is GlobalStatementSyntax global && global.Parent is CompilationUnitSyntax unit)
            later = unit.Members.OfType<GlobalStatementSyntax>().SkipWhile(g => g != global).Skip(1).Select(g => (SyntaxNode)g.Statement);
        else
            return true;

        // Later declarators of the same declaration (`var g = ..., h = (g = ...);`).
        var siblings = declaration.Declaration.Variables.SkipWhile(v => v != declarator).Skip(1)
            .Select(v => v.Initializer?.Value).OfType<ExpressionSyntax>();

        foreach (var region in later.Concat(siblings))
        {
            var written = WrittenIn(region, model);
            if (written == null || written.Contains(local)) return true;
        }
        return false;
    }

    /// <summary>
    /// The symbols a statement or expression writes, from one data-flow analysis per node: every
    /// group local of a member body shares the analyses of its statements. Null when it does not
    /// succeed. Cleared by <see cref="ReleaseAll"/>.
    /// </summary>
    static HashSet<ISymbol>? WrittenIn(SyntaxNode region, SemanticModel model)
    {
        if (WrittenByRegion.TryGetValue(region, out var cached)) return cached;
        var flow = region is ExpressionSyntax expression ? model.AnalyzeDataFlow(expression) : model.AnalyzeDataFlow((StatementSyntax)region);
        var written = flow is { Succeeded: true } ? new HashSet<ISymbol>(flow.WrittenInside, SymbolEqualityComparer.Default) : null;
        WrittenByRegion[region] = written;
        return written;
    }

    static bool WrittenBySyntax(ILocalSymbol local, VariableDeclaratorSyntax declarator, SemanticModel model)
    {
        SyntaxNode scope = declarator.FirstAncestorOrSelf<MemberDeclarationSyntax>() is { } member and not GlobalStatementSyntax
            ? member
            : declarator.SyntaxTree.GetRoot();
        foreach (var node in scope.DescendantNodes())
        {
            var target = node switch
            {
                AssignmentExpressionSyntax assignment => assignment.Left,
                ArgumentSyntax { RefKindKeyword.RawKind: not 0 } argument => argument.Expression,
                RefExpressionSyntax alias => alias.Expression,
                ForEachVariableStatementSyntax deconstruction => deconstruction.Variable,
                PrefixUnaryExpressionSyntax { RawKind: (int)SyntaxKind.PreIncrementExpression or (int)SyntaxKind.PreDecrementExpression } unary => unary.Operand,
                PostfixUnaryExpressionSyntax { RawKind: (int)SyntaxKind.PostIncrementExpression or (int)SyntaxKind.PostDecrementExpression } unary => unary.Operand,
                _ => null,
            };
            if (target == null) continue;
            foreach (var name in WrittenNames(target))
            {
                if (name.Identifier.ValueText == local.Name
                    && SymbolEqualityComparer.Default.Equals(model.GetSymbolInfo(name).Symbol, local))
                {
                    return true;
                }
            }
        }
        return false;
    }

    /// <summary>The names a write target writes: itself, or each element of a (nested) tuple.</summary>
    static IEnumerable<IdentifierNameSyntax> WrittenNames(ExpressionSyntax target)
    {
        while (target is ParenthesizedExpressionSyntax parenthesized) target = parenthesized.Expression;
        switch (target)
        {
            case IdentifierNameSyntax name:
                yield return name;
                break;
            case TupleExpressionSyntax tuple:
                foreach (var element in tuple.Arguments)
                    foreach (var name in WrittenNames(element.Expression))
                        yield return name;
                break;
        }
    }

    /// <summary>
    /// A parameter that may be a group: the prefix every call site of its method passes, found in this
    /// compilation. Null when there is no call site, the call sites disagree, one does not resolve, the
    /// method is virtual, abstract, an override, an interface member or used as a method group, or the
    /// method is referenced by code in a project that references this one (whatever its accessibility:
    /// <c>InternalsVisibleTo</c> lets a test project call an internal method), or the parameter's type
    /// is a type parameter.
    /// </summary>
    string? Parameter(IParameterSymbol parameter, int depth)
    {
        if (!MayBeGroup(parameter.Type)) return "";
        // A type parameter (`TBuilder b` with `where TBuilder : IEndpointRouteBuilder`) is never followed.
        if (parameter.Type.TypeKind == TypeKind.TypeParameter) return null;
        if (parameter.ContainingSymbol is not IMethodSymbol { } method) return null;
        method = (method.ReducedFrom ?? method).OriginalDefinition;
        var ordinal = parameter.Ordinal;
        if (method.Parameters.Length <= ordinal) return null;
        var key = method.Parameters[ordinal];
        if (parameterPrefixes.TryGetValue(key, out var cached)) return cached;
        if (method.IsVirtual || method.IsAbstract || method.IsOverride || method.ContainingType?.TypeKind == TypeKind.Interface
            || method.MethodKind is not (MethodKind.Ordinary or MethodKind.LocalFunction)
            || IsReferencedByDependents(method))
        {
            return parameterPrefixes[key] = null;
        }
        if (!inProgress.Add(key))
        {
            guardHits++;
            return null;
        }
        var guardsBefore = guardHits;
        try
        {
            var result = CallSitePrefix(method, ordinal, depth);
            // A result reached through a depth or cycle guard depends on where it was reached from.
            if (guardHits == guardsBefore) parameterPrefixes[key] = result;
            return result;
        }
        finally
        {
            inProgress.Remove(key);
        }
    }

    /// <summary>
    /// Whether code in a dependent compilation references the method: a tree that names it, then the
    /// name bound to the same method (by documentation ID and assembly, as the dependent sees its own
    /// symbol for it).
    /// </summary>
    bool IsReferencedByDependents(IMethodSymbol method)
    {
        if (dependentCompilations.Count == 0) return false;
        var id = method.GetDocumentationCommentId();
        var assembly = method.ContainingAssembly?.Name;
        foreach (var dependent in dependentCompilations)
        {
            if (!PerCompilation.TryGetValue(dependent, out var other) && !IndexOnly.TryGetValue(dependent, out other))
                IndexOnly[dependent] = other = new RouteGroups(dependent, []);
            foreach (var tree in other.TreesNaming(method.Name))
            {
                var model = other.ModelOf(tree);
                foreach (var name in tree.GetRoot().DescendantNodes().OfType<SimpleNameSyntax>())
                {
                    if (name.Identifier.ValueText != method.Name) continue;
                    // Candidates count too: a call that does not bind (inaccessible, say) still names the method.
                    var info = model.GetSymbolInfo(name);
                    var symbols = info.Symbol != null ? [info.Symbol] : info.CandidateSymbols;
                    foreach (var referenced in symbols.OfType<IMethodSymbol>())
                    {
                        var definition = (referenced.ReducedFrom ?? referenced).OriginalDefinition;
                        if (definition.GetDocumentationCommentId() == id && definition.ContainingAssembly?.Name == assembly) return true;
                    }
                }
            }
        }
        return false;
    }

    string? CallSitePrefix(IMethodSymbol method, int ordinal, int depth)
    {
        string? agreed = null;
        foreach (var tree in TreesNaming(method.Name))
        {
            var model = ModelOf(tree);
            foreach (var name in tree.GetRoot().DescendantNodes().OfType<SimpleNameSyntax>())
            {
                if (name.Identifier.ValueText != method.Name) continue;
                var referenced = model.GetSymbolInfo(name).Symbol as IMethodSymbol;
                if (referenced == null || !SymbolEqualityComparer.Default.Equals((referenced.ReducedFrom ?? referenced).OriginalDefinition, method))
                    continue;

                // A reference that is not the target of a call (a method group) hides its call sites.
                var call = CallOf(name);
                if (call == null || model.GetOperation(call) is not IInvocationOperation operation) return null;
                var argument = operation.Arguments.FirstOrDefault(a => a.Parameter?.Ordinal == ordinal);
                if (argument is not { ArgumentKind: ArgumentKind.Explicit } || Unwrap(argument.Value).Syntax is not ExpressionSyntax value)
                    return null;
                var prefix = Resolve(value, model, depth + 1);
                if (prefix == null || (agreed != null && agreed != prefix)) return null;
                agreed = prefix;
            }
        }
        return agreed;
    }

    /// <summary>The trees whose identifiers include the name: one pass over the compilation, on first use.</summary>
    List<SyntaxTree> TreesNaming(string name)
    {
        if (treesByName == null)
        {
            treesByName = new Dictionary<string, List<SyntaxTree>>(StringComparer.Ordinal);
            foreach (var tree in compilation.SyntaxTrees)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var token in tree.GetRoot().DescendantTokens())
                {
                    if (!token.IsKind(SyntaxKind.IdentifierToken) || !seen.Add(token.ValueText)) continue;
                    if (!treesByName.TryGetValue(token.ValueText, out var trees)) treesByName[token.ValueText] = trees = [];
                    trees.Add(tree);
                }
            }
        }
        return treesByName.TryGetValue(name, out var found) ? found : [];
    }

    /// <summary>The invocation a name is the target of: <c>M(...)</c>, <c>x.M(...)</c> or <c>M&lt;T&gt;(...)</c>.</summary>
    static InvocationExpressionSyntax? CallOf(SimpleNameSyntax name)
    {
        SyntaxNode target = name.Parent is MemberAccessExpressionSyntax access && access.Name == name ? access : name;
        return target.Parent is InvocationExpressionSyntax invocation && invocation.Expression == target ? invocation : null;
    }

    SemanticModel ModelOf(SyntaxTree tree)
    {
        if (!models.TryGetValue(tree, out var model)) models[tree] = model = compilation.GetSemanticModel(tree);
        return model;
    }

    static IOperation Unwrap(IOperation operation)
    {
        while (operation is IConversionOperation { IsImplicit: true } conversion) operation = conversion.Operand;
        return operation;
    }
}

/// <summary>
/// The class <c>[Route]</c> a controller inherits: the first <c>Route</c> template of the nearest base
/// class that declares one, as ASP.NET Core takes route attributes from the most derived type that
/// has any. Null when the class declares its own <c>Route</c>, no base class has one, or the class is
/// not a controller (abstract, or marked <c>[NonController]</c> itself or through a base).
/// </summary>
static class InheritedRoutes
{
    public static string? For(INamedTypeSymbol type)
    {
        if (type.TypeKind != TypeKind.Class || type.IsAbstract || RouteOf(type, out _)) return null;
        string? inherited = null;
        var found = false;
        var depth = 0;
        for (INamedTypeSymbol? current = type; current != null && current.SpecialType != SpecialType.System_Object && depth < 32; current = current.BaseType, depth++)
        {
            if (current.TypeKind == TypeKind.Error) return null;
            if (HasAttribute(current, "NonController")) return null;
            if (!found && !SymbolEqualityComparer.Default.Equals(current, type) && RouteOf(current, out var template))
            {
                inherited = template;
                found = true;
            }
        }
        return inherited;
    }

    static bool HasAttribute(INamedTypeSymbol type, string shortName) =>
        type.OriginalDefinition.GetAttributes().Any(a => a.AttributeClass?.Name is { } name && (name == shortName || name == shortName + "Attribute"));

    /// <summary>Whether the type declares a <c>Route</c> attribute, with the template of the first one (null when it has none).</summary>
    static bool RouteOf(INamedTypeSymbol type, out string? template)
    {
        template = null;
        foreach (var attribute in type.OriginalDefinition.GetAttributes())
        {
            var name = attribute.AttributeClass?.Name;
            if (name is not ("RouteAttribute" or "Route")) continue;
            template = TemplateOf(attribute);
            return true;
        }
        return false;
    }

    /// <summary>The first constructor argument, else a named <c>Template</c>; from the syntax when the class does not resolve.</summary>
    static string? TemplateOf(AttributeData attribute)
    {
        if (attribute.AttributeConstructor != null)
        {
            if (attribute.ConstructorArguments is [{ Value: string positional }, ..]) return positional;
            foreach (var (key, value) in attribute.NamedArguments)
                if (key is "Template" or "template" && value.Value is string named) return named;
            return null;
        }
        if (attribute.ApplicationSyntaxReference?.GetSyntax() is AttributeSyntax { ArgumentList.Arguments: [var first, ..] }
            && first.Expression is LiteralExpressionSyntax literal && literal.IsKind(SyntaxKind.StringLiteralExpression))
        {
            return literal.Token.ValueText;
        }
        return null;
    }
}
