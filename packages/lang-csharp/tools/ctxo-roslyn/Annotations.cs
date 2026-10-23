using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

// ── Attribute Annotations (protocol v2) ──────────────────────────────

/// <summary>
/// Turns the attributes written on one declaration into annotations. Each
/// attribute uses its semantic data when its class resolves, otherwise the
/// syntax. Caps: 20 attributes per symbol, 10 positional and 10 named entries
/// per attribute, 200 characters per value. <c>named.type</c> is reserved for
/// the resolved attribute class and comes on top of the 10 named entries; a
/// source argument named <c>type</c> is dropped, as in the tree-sitter tier.
/// </summary>
static class AttributeAnnotations
{
    const int MaxAttributes = 20;
    const int MaxEntries = 10;
    const int MaxValueLength = 200;
    const string TypeKey = "type";
    const string AttributeSuffix = "Attribute";

    public static List<CtxoAnnotation>? For(SyntaxNode declaration, ISymbol symbol, SemanticModel model)
    {
        if (declaration is not MemberDeclarationSyntax member || member.AttributeLists.Count == 0)
            return null;

        var applied = symbol.GetAttributes();
        var annotations = new List<CtxoAnnotation>();

        // Source order of this declaration's own lists, so each partial part
        // keeps its own attributes.
        foreach (var list in member.AttributeLists)
        {
            if (!AppliesToDeclaration(list, declaration)) continue;

            foreach (var attribute in list.Attributes)
            {
                if (annotations.Count == MaxAttributes) return annotations;

                var data = applied.FirstOrDefault(a =>
                    a.ApplicationSyntaxReference is { } r &&
                    r.SyntaxTree == attribute.SyntaxTree &&
                    r.Span == attribute.Span);
                var resolvedClass = data?.AttributeClass is { TypeKind: not TypeKind.Error } c ? c : null;

                var args = new List<string>();
                var named = new List<KeyValuePair<string, string>>();
                if (resolvedClass != null && data!.AttributeConstructor != null)
                    FromData(data, args, named);
                else
                    FromSyntax(attribute, model, args, named);

                annotations.Add(Build(NameOf(attribute), args, named, resolvedClass?.ToDisplayString()));
            }
        }

        return annotations.Count > 0 ? annotations : null;
    }

    static CtxoAnnotation Build(
        string name, List<string> args, List<KeyValuePair<string, string>> named, string? typeName)
    {
        // Up to 10 entries from the source, as in the tree-sitter tier, plus the reserved `type`.
        var namedOut = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, value) in named)
        {
            if (namedOut.Count == MaxEntries) break;
            if (key == TypeKey) continue; // reserved for the resolved class
            namedOut.TryAdd(key, value);
        }
        if (typeName != null) namedOut[TypeKey] = Truncate(typeName);

        return new CtxoAnnotation
        {
            Name = name,
            Args = args.Count > 0 ? args.Take(MaxEntries).ToList() : null,
            Named = namedOut.Count > 0 ? namedOut : null,
        };
    }

    // The name as written: last identifier, without namespace, alias and `Attribute` suffix.
    static string NameOf(AttributeSyntax attribute)
    {
        SimpleNameSyntax? simple = attribute.Name switch
        {
            QualifiedNameSyntax q => q.Right,
            AliasQualifiedNameSyntax a => a.Name,
            SimpleNameSyntax s => s,
            _ => null,
        };
        var text = simple?.Identifier.ValueText ?? attribute.Name.ToString();
        return text.Length > AttributeSuffix.Length && text.EndsWith(AttributeSuffix, StringComparison.Ordinal)
            ? text[..^AttributeSuffix.Length]
            : text;
    }

    // `[return: X]`, `[param: X]` and friends belong to another symbol; `field:`
    // is the declaration itself only on a field.
    static bool AppliesToDeclaration(AttributeListSyntax list, SyntaxNode declaration)
    {
        var target = list.Target?.Identifier.ValueText;
        return target switch
        {
            null => true,
            "return" or "param" or "typevar" or "assembly" or "module" => false,
            "field" => declaration is FieldDeclarationSyntax,
            _ => true,
        };
    }

    // ── Semantic path ──

    static void FromData(AttributeData data, List<string> args, List<KeyValuePair<string, string>> named)
    {
        foreach (var argument in data.ConstructorArguments)
            AddValues(argument, args);

        foreach (var (key, argument) in data.NamedArguments)
        {
            var values = new List<string>();
            AddValues(argument, values);
            if (values.Count > 0) named.Add(new(key, Truncate(string.Join(",", values))));
        }
    }

    static void AddValues(TypedConstant constant, List<string> values)
    {
        if (constant.Kind == TypedConstantKind.Error || constant.IsNull) return;

        switch (constant.Kind)
        {
            case TypedConstantKind.Array:
                foreach (var element in constant.Values) AddValues(element, values);
                return;
            case TypedConstantKind.Type:
                if (constant.Value is ITypeSymbol type) values.Add(Truncate(type.ToDisplayString()));
                return;
            case TypedConstantKind.Enum:
                values.Add(Truncate(EnumMember(constant.Type, constant.Value) ?? FormatScalar(constant.Value!)));
                return;
            default:
                values.Add(Truncate(FormatScalar(constant.Value!)));
                return;
        }
    }

    static string? EnumMember(ITypeSymbol? enumType, object? value)
    {
        if (enumType is not INamedTypeSymbol { TypeKind: TypeKind.Enum } named) return null;
        var member = named.GetMembers().OfType<IFieldSymbol>()
            .FirstOrDefault(f => f.HasConstantValue && Equals(f.ConstantValue, value));
        return member != null ? $"{named.Name}.{member.Name}" : null;
    }

    // ── Syntax path (attribute class does not resolve) ──

    static void FromSyntax(
        AttributeSyntax attribute, SemanticModel model, List<string> args, List<KeyValuePair<string, string>> named)
    {
        if (attribute.ArgumentList is not { } argumentList) return;

        foreach (var argument in argumentList.Arguments)
        {
            var key = argument.NameEquals?.Name.Identifier.ValueText ?? argument.NameColon?.Name.Identifier.ValueText;
            var values = new List<string>();
            AddSyntaxValues(argument.Expression, model, values);

            if (key == null) args.AddRange(values);
            else if (values.Count > 0) named.Add(new(key, Truncate(string.Join(",", values))));
        }
    }

    static void AddSyntaxValues(ExpressionSyntax expression, SemanticModel model, List<string> values)
    {
        switch (expression)
        {
            case ArrayCreationExpressionSyntax { Initializer: { } init }:
                foreach (var element in init.Expressions) AddSyntaxValues(element, model, values);
                return;
            case ImplicitArrayCreationExpressionSyntax implicitArray:
                foreach (var element in implicitArray.Initializer.Expressions) AddSyntaxValues(element, model, values);
                return;
            case CollectionExpressionSyntax collection:
                foreach (var element in collection.Elements.OfType<ExpressionElementSyntax>())
                    AddSyntaxValues(element.Expression, model, values);
                return;
            case TypeOfExpressionSyntax typeOf:
            {
                var type = model.GetTypeInfo(typeOf.Type).Type;
                values.Add(Truncate(type is { TypeKind: not TypeKind.Error } ? type.ToDisplayString() : typeOf.Type.ToString()));
                return;
            }
        }

        if (model.GetSymbolInfo(expression).Symbol is IFieldSymbol { ContainingType: { TypeKind: TypeKind.Enum } enumType } field)
        {
            values.Add(Truncate($"{enumType.Name}.{field.Name}"));
            return;
        }

        var constant = model.GetConstantValue(expression);
        if (constant.HasValue && constant.Value != null)
            values.Add(Truncate(FormatScalar(constant.Value)));
    }

    // ── Formatting ──

    static string FormatScalar(object value) => value switch
    {
        bool b => b ? "true" : "false",
        string s => s,
        char c => c.ToString(),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? "",
    };

    static string Truncate(string value) =>
        value.Length > MaxValueLength ? value[..MaxValueLength] : value;
}

record CtxoAnnotation
{
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("args")] public List<string>? Args { get; init; }
    [JsonPropertyName("named")] public Dictionary<string, string>? Named { get; init; }
}
