using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Operations;

// ── Fact Evidence (PR 4, issue #156) ─────────────────────────────────

/// <summary>
/// The <c>--facts=</c> value: standard base64 of the UTF-8 JSON
/// <c>{"normalizationMethods":[...]}</c>. The helper applies only the
/// normalization patterns and the retry/timeout name rule; the plugin's
/// <c>finishFacts</c> decides everything else.
/// </summary>
sealed record FactOptions(IReadOnlyList<string> NormalizationMethods)
{
    /// <summary>The options, or null (and one stderr line) when the value is not valid.</summary>
    public static FactOptions? Decode(string? base64)
    {
        if (base64 == null) return null;
        try
        {
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(base64));
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("normalizationMethods", out var methods)
                || methods.ValueKind != JsonValueKind.Array)
            {
                throw new FormatException("normalizationMethods is not a list");
            }
            var list = new List<string>();
            foreach (var method in methods.EnumerateArray())
            {
                if (method.ValueKind != JsonValueKind.String) throw new FormatException("a normalization method is not a string");
                list.Add(method.GetString()!);
            }
            return new FactOptions(list);
        }
        catch (Exception ex) when (ex is FormatException or JsonException or ArgumentException)
        {
            Console.Error.WriteLine($"[ctxo-roslyn] --facts= ignored: {ex.Message}");
            return null;
        }
    }
}

/// <summary>
/// One evidence record, the shape of the plugin's <c>FactEvidence</c>: <c>comparison</c>,
/// <c>call</c>, <c>binding</c>, <c>duration</c> or <c>route</c>. <c>Line</c> is 0-based.
/// </summary>
record CtxoFactEvidence
{
    [JsonPropertyName("kind")] public string Kind { get; init; } = "";
    [JsonPropertyName("symbolId")] public string? SymbolId { get; init; }
    [JsonPropertyName("line")] public int Line { get; init; }
    [JsonPropertyName("text")] public string Text { get; init; } = "";
    [JsonPropertyName("operator")] public string? Operator { get; init; }
    [JsonPropertyName("literal")] public string? Literal { get; init; }
    [JsonPropertyName("literalKind")] public string? LiteralKind { get; init; }
    [JsonPropertyName("method")] public string? Method { get; init; }
    [JsonPropertyName("qualifier")] public string? Qualifier { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("value")] public string? Value { get; init; }
    [JsonPropertyName("constructor")] public string? Constructor { get; init; }
    [JsonPropertyName("unit")] public string? Unit { get; init; }
    [JsonPropertyName("amount")] public string? Amount { get; init; }
    [JsonPropertyName("verb")] public string? Verb { get; init; }
    [JsonPropertyName("route")] public string? Route { get; init; }
}

/// <summary>The symbol names and kinds of <c>ExtractSymbols</c>, shared by the symbols, edges and facts.</summary>
static class SymbolNames
{
    public static string? Kind(ISymbol symbol) => symbol switch
    {
        INamedTypeSymbol t => t.TypeKind switch
        {
            TypeKind.Class => "class",
            TypeKind.Struct => "class",
            TypeKind.Interface => "interface",
            TypeKind.Enum => "type",
            TypeKind.Delegate => "type",
            _ => null,
        },
        IMethodSymbol => "method",
        IPropertySymbol => "variable",
        IFieldSymbol => "variable",
        IEventSymbol => "variable",
        _ => null,
    };

    /// <summary>Namespace and type path plus the name; a constructor is named after its type.</summary>
    public static string Qualified(ISymbol symbol)
    {
        var parts = new List<string>();
        var current = symbol;

        // For constructors, replace .ctor with the type name (e.g., BaseSyncJob.BaseSyncJob)
        if (current is IMethodSymbol ms && ms.MethodKind == MethodKind.Constructor && ms.ContainingType != null)
        {
            parts.Add(ms.ContainingType.Name);
            current = current.ContainingSymbol; // skip to containing type
        }

        while (current != null && current is not INamespaceSymbol { IsGlobalNamespace: true })
        {
            if (current is INamespaceSymbol ns)
            {
                if (!ns.IsGlobalNamespace)
                    parts.Add(ns.Name);
            }
            else
            {
                parts.Add(current.Name);
            }
            current = current.ContainingSymbol;
        }
        parts.Reverse();
        return string.Join(".", parts);
    }
}

/// <summary>
/// Collects fact evidence from one file through <see cref="IOperation"/>: comparisons with a
/// literal in conditions and case labels, normalization calls, retry/timeout bindings, TimeSpan
/// durations and minimal API routes (with their <c>MapGroup</c> prefixes). Attribute routes are built by
/// the plugin from annotations.
/// </summary>
static class Facts
{
    /// <summary>Most evidence records reported per file; the finisher keeps at most 500 facts.</summary>
    public const int MaxEvidencePerFile = 2000;

    static readonly Dictionary<string, string> DurationUnits = new(StringComparer.Ordinal)
    {
        ["FromMilliseconds"] = "ms",
        ["FromSeconds"] = "s",
        ["FromMinutes"] = "min",
        ["FromHours"] = "h",
        ["FromDays"] = "d",
        ["FromMicroseconds"] = "us",
    };

    static readonly Dictionary<string, string> RouteVerbs = new(StringComparer.Ordinal)
    {
        ["MapGet"] = "GET",
        ["MapPost"] = "POST",
        ["MapPut"] = "PUT",
        ["MapDelete"] = "DELETE",
        ["MapPatch"] = "PATCH",
    };

    /// <summary>
    /// Walks each member (method, constructor, accessor, local function, field and property
    /// declarator, event) and top-level statement in source order. Accessors and local functions
    /// belong to their property, event or method; every field declarator uses its own name; a
    /// top-level statement has no symbol id, so the finisher gives it the file's module id.
    /// </summary>
    public static List<CtxoFactEvidence> Collect(SyntaxNode root, SemanticModel model, string filePath, FactOptions options)
    {
        var collector = new Collector(filePath, options, model);
        foreach (var node in root.DescendantNodes())
        {
            if (collector.Full) break;
            switch (node)
            {
                case MethodDeclarationSyntax:
                case ConstructorDeclarationSyntax:
                    collector.Member(model.GetDeclaredSymbol(node), model.GetOperation(node));
                    break;
                case PropertyDeclarationSyntax property:
                {
                    var symbol = model.GetDeclaredSymbol(property);
                    if (property.ExpressionBody != null) collector.Member(symbol, model.GetOperation(property.ExpressionBody));
                    foreach (var accessor in property.AccessorList?.Accessors ?? default)
                        collector.Member(symbol, model.GetOperation(accessor));
                    if (property.Initializer != null) collector.Member(symbol, model.GetOperation(property.Initializer));
                    break;
                }
                case EventDeclarationSyntax eventDeclaration:
                {
                    var symbol = model.GetDeclaredSymbol(eventDeclaration);
                    foreach (var accessor in eventDeclaration.AccessorList?.Accessors ?? default)
                        collector.Member(symbol, model.GetOperation(accessor));
                    break;
                }
                case BaseFieldDeclarationSyntax field:
                    foreach (var declarator in field.Declaration.Variables)
                    {
                        if (declarator.Initializer != null)
                            collector.Member(model.GetDeclaredSymbol(declarator), model.GetOperation(declarator.Initializer));
                    }
                    break;
                case GlobalStatementSyntax global:
                    // Top-level statements: no symbol id, so the finisher gives them the file's module id.
                    collector.TopLevel(model.GetOperation(global) ?? model.GetOperation(global.Statement));
                    break;
            }
        }
        return collector.Evidence;
    }

    sealed class Collector(string filePath, FactOptions options, SemanticModel model)
    {
        public readonly List<CtxoFactEvidence> Evidence = [];
        readonly RouteGroups groups = new(model.Compilation);
        string? symbolId;

        public bool Full => Evidence.Count >= MaxEvidencePerFile;

        public void Member(ISymbol? symbol, IOperation? body)
        {
            if (symbol == null || body == null) return;
            var kind = SymbolNames.Kind(symbol);
            if (kind == null) return;
            symbolId = $"{filePath}::{SymbolNames.Qualified(symbol)}::{kind}";
            Walk(body);
        }

        /// <summary>A top-level statement: evidence without a symbol id.</summary>
        public void TopLevel(IOperation? body)
        {
            if (body == null) return;
            symbolId = null;
            Walk(body);
        }

        void Walk(IOperation body)
        {
            foreach (var op in Enumerate(body))
            {
                if (Full) return;
                Visit(op);
            }
        }

        void Add(CtxoFactEvidence evidence)
        {
            if (!Full) Evidence.Add(evidence with { SymbolId = symbolId });
        }

        void Visit(IOperation op)
        {
            switch (op)
            {
                case IConditionalOperation conditional:
                    Condition(conditional.Condition);
                    break;
                case IWhileLoopOperation loop:
                    if (loop.Condition != null) Condition(loop.Condition);
                    break;
                case IForLoopOperation loop:
                    if (loop.Condition != null) Condition(loop.Condition);
                    break;
                case ISwitchOperation switchStatement:
                    foreach (var section in switchStatement.Cases)
                    foreach (var clause in section.Clauses)
                    {
                        switch (clause)
                        {
                            case ISingleValueCaseClauseOperation single when single.Value != null:
                                CaseValue(single.Value, single.Value.Syntax, switchStatement.Value);
                                break;
                            case IPatternCaseClauseOperation pattern:
                                CasePattern(pattern.Pattern, switchStatement.Value);
                                if (pattern.Guard != null) Condition(pattern.Guard);
                                break;
                        }
                    }
                    break;
                case ISwitchExpressionOperation switchExpression:
                    foreach (var arm in switchExpression.Arms)
                    {
                        CasePattern(arm.Pattern, switchExpression.Value);
                        if (arm.Guard != null) Condition(arm.Guard);
                    }
                    break;
                case ICatchClauseOperation catchClause:
                    if (catchClause.Filter != null) Condition(catchClause.Filter);
                    break;
                case IInvocationOperation invocation when invocation.Syntax is InvocationExpressionSyntax syntax:
                    Invocation(invocation, syntax, invocation.TargetMethod.Name, invocation.TargetMethod.ContainingType?.ToDisplayString());
                    break;
                case IInvalidOperation invalid when invalid.Syntax is InvocationExpressionSyntax syntax && SyntaxName(syntax) is { } name:
                    Invocation(invalid, syntax, name, null);
                    break;
                case IVariableDeclaratorOperation declarator when declarator.Initializer != null:
                    Binding(declarator.Symbol.Name, declarator.Initializer.Value, declarator.Syntax is VariableDeclaratorSyntax v ? v.Identifier.GetLocation() : declarator.Syntax.GetLocation());
                    break;
                case IFieldInitializerOperation fieldInitializer when fieldInitializer.InitializedFields.Length > 0:
                    Binding(fieldInitializer.InitializedFields[0].Name, fieldInitializer.Value, NameLocation(fieldInitializer.Syntax));
                    break;
                case IPropertyInitializerOperation propertyInitializer when propertyInitializer.InitializedProperties.Length > 0:
                    Binding(propertyInitializer.InitializedProperties[0].Name, propertyInitializer.Value, NameLocation(propertyInitializer.Syntax));
                    break;
                case ISimpleAssignmentOperation assignment when AssignedName(assignment) is { } assigned:
                    Binding(assigned, assignment.Value, assignment.Syntax.GetLocation());
                    break;
                case IArgumentOperation argument when argument.Syntax is ArgumentSyntax { NameColon: { } nameColon }:
                    Binding(nameColon.Name.Identifier.ValueText, argument.Value, nameColon.GetLocation());
                    break;
            }
        }

        // ── Comparisons ─────────────────────────────────────────────

        /// <summary>Comparisons through <c>&amp;&amp;</c>, <c>||</c>, <c>!</c> and <c>is</c> patterns, never into calls or lambdas.</summary>
        void Condition(IOperation condition)
        {
            switch (Unwrap(condition))
            {
                case IBinaryOperation { OperatorKind: BinaryOperatorKind.ConditionalAnd or BinaryOperatorKind.ConditionalOr } logical:
                    Condition(logical.LeftOperand);
                    Condition(logical.RightOperand);
                    break;
                case IUnaryOperation { OperatorKind: UnaryOperatorKind.Not } not:
                    Condition(not.Operand);
                    break;
                case IBinaryOperation binary when ComparisonOperator(binary.OperatorKind) is { } fallbackOperator:
                    Comparison(binary, fallbackOperator);
                    break;
                case IIsPatternOperation isPattern:
                    IsPattern(isPattern.Pattern, isPattern.Syntax, negated: false);
                    break;
            }
        }

        void Comparison(IBinaryOperation binary, string fallbackOperator)
        {
            var left = Literal(binary.LeftOperand);
            var right = Literal(binary.RightOperand);
            if ((left == null) == (right == null)) return;
            var literal = (left ?? right)!.Value;
            Add(new CtxoFactEvidence
            {
                Kind = "comparison",
                Line = LineOf(binary.Syntax.GetLocation()),
                Text = binary.Syntax.ToString(),
                Operator = binary.Syntax is BinaryExpressionSyntax syntax ? syntax.OperatorToken.Text : fallbackOperator,
                Literal = literal.Text,
                LiteralKind = literal.Kind,
            });
        }

        /// <summary>An <c>is</c> pattern: constant (<c>==</c>, <c>!=</c> under <c>not</c>), relational, and <c>and</c>/<c>or</c> combinations.</summary>
        void IsPattern(IPatternOperation pattern, SyntaxNode isExpression, bool negated)
        {
            switch (pattern)
            {
                case IConstantPatternOperation constant when Literal(constant.Value) is { } literal:
                    AddPattern(isExpression.ToString(), isExpression, negated ? "!=" : "==", literal);
                    break;
                case IRelationalPatternOperation relational when !negated && Literal(relational.Value) is { } literal:
                    AddPattern(isExpression.ToString(), isExpression, RelationalOperator(relational), literal);
                    break;
                case INegatedPatternOperation negatedPattern:
                    IsPattern(negatedPattern.Pattern, isExpression, !negated);
                    break;
                case IBinaryPatternOperation binary when !negated:
                    IsPattern(binary.LeftPattern, isExpression, negated);
                    IsPattern(binary.RightPattern, isExpression, negated);
                    break;
            }
        }

        /// <summary>A case label or arm: <c>&lt;subject&gt; case &lt;label&gt;</c>, operator <c>case</c> or the relational operator.</summary>
        void CasePattern(IPatternOperation pattern, IOperation subject)
        {
            switch (pattern)
            {
                case IConstantPatternOperation constant:
                    CaseValue(constant.Value, constant.Syntax, subject);
                    break;
                case IRelationalPatternOperation relational when Literal(relational.Value) is { } literal:
                    AddPattern($"{subject.Syntax} case {relational.Syntax}", relational.Syntax, RelationalOperator(relational), literal);
                    break;
                case IBinaryPatternOperation binary:
                    CasePattern(binary.LeftPattern, subject);
                    CasePattern(binary.RightPattern, subject);
                    break;
            }
        }

        void CaseValue(IOperation value, SyntaxNode label, IOperation subject)
        {
            if (Literal(value) is { } literal)
                AddPattern($"{subject.Syntax} case {label}", label, "case", literal);
        }

        void AddPattern(string text, SyntaxNode at, string op, (string Text, string Kind) literal) =>
            Add(new CtxoFactEvidence
            {
                Kind = "comparison",
                Line = LineOf(at.GetLocation()),
                Text = text,
                Operator = op,
                Literal = literal.Text,
                LiteralKind = literal.Kind,
            });

        // ── Calls, durations and routes ─────────────────────────────

        void Invocation(IOperation invocation, InvocationExpressionSyntax syntax, string method, string? containingType)
        {
            var line = LineOf(syntax.GetLocation());
            var receiver = syntax.Expression is MemberAccessExpressionSyntax access ? access.Expression.ToString() : null;

            if (MatchesNormalization(method, receiver, options.NormalizationMethods))
            {
                Add(new CtxoFactEvidence { Kind = "call", Line = line, Text = syntax.ToString(), Method = method, Qualifier = receiver });
            }

            var arguments = syntax.ArgumentList.Arguments;
            if (DurationUnits.TryGetValue(method, out var unit) && arguments.Count == 1 && IsTimeSpan(containingType, receiver))
            {
                Add(new CtxoFactEvidence
                {
                    Kind = "duration",
                    Line = line,
                    Text = syntax.ToString(),
                    Name = BindingName(invocation),
                    Constructor = containingType != null ? $"{containingType}.{method}" : syntax.Expression.ToString(),
                    Unit = unit,
                    Amount = arguments[0].Expression.ToString(),
                });
            }

            if (RouteVerbs.TryGetValue(method, out var verb) && arguments.Count > 0
                && arguments[0].Expression is LiteralExpressionSyntax route && route.IsKind(SyntaxKind.StringLiteralExpression))
            {
                // The MapGroup prefixes of the receiver, when every one resolves; else the call's own route.
                var prefix = RouteGroups.Receiver(syntax, model) is { } routeReceiver ? groups.Prefix(routeReceiver, model, 0) : null;
                var path = string.IsNullOrEmpty(prefix) ? route.Token.ValueText : RouteGroups.Join(prefix, route.Token.ValueText);
                Add(new CtxoFactEvidence { Kind = "route", Line = line, Text = syntax.ToString(), Verb = verb, Route = path });
            }
        }

        /// <summary><c>System.TimeSpan</c> when resolved; else the call is written <c>TimeSpan.X</c> or <c>System.TimeSpan.X</c>.</summary>
        static bool IsTimeSpan(string? containingType, string? receiver) =>
            containingType != null ? containingType == "System.TimeSpan" : receiver is "TimeSpan" or "System.TimeSpan";

        /// <summary>The method name of an unresolved call: the last name of <c>x.M(...)</c> or <c>M(...)</c>.</summary>
        static string? SyntaxName(InvocationExpressionSyntax syntax) => syntax.Expression switch
        {
            MemberAccessExpressionSyntax access => access.Name.Identifier.ValueText,
            SimpleNameSyntax name => name.Identifier.ValueText,
            _ => null,
        };

        // ── Bindings ────────────────────────────────────────────────

        void Binding(string name, IOperation value, Location at)
        {
            var unwrapped = Unwrap(value);
            // A call is never a numeric constant, and a bound duration call is reported by the duration itself.
            if (unwrapped is IInvocationOperation or IInvalidOperation && unwrapped.Syntax is InvocationExpressionSyntax) return;
            if (!HasRetryTimeoutFragment(name)) return;
            var valueText = unwrapped.Syntax.ToString();
            Add(new CtxoFactEvidence { Kind = "binding", Line = LineOf(at), Text = $"{name} = {valueText}", Name = name, Value = valueText });
        }

        /// <summary>The name a value is bound to: a declarator, initializer, assignment or named argument.</summary>
        static string? BindingName(IOperation value)
        {
            var current = value;
            var parent = value.Parent;
            while (parent is IConversionOperation { IsImplicit: true })
            {
                current = parent;
                parent = parent.Parent;
            }
            return parent switch
            {
                IVariableInitializerOperation { Parent: IVariableDeclaratorOperation declarator } => declarator.Symbol.Name,
                IFieldInitializerOperation field when field.InitializedFields.Length > 0 => field.InitializedFields[0].Name,
                IPropertyInitializerOperation property when property.InitializedProperties.Length > 0 => property.InitializedProperties[0].Name,
                ISimpleAssignmentOperation assignment when assignment.Value == current => AssignedName(assignment),
                IArgumentOperation { Syntax: ArgumentSyntax { NameColon: { } nameColon } } => nameColon.Name.Identifier.ValueText,
                _ => null,
            };
        }

        /// <summary>
        /// The assigned member or local; else the last name of the target as written. An indexer
        /// (<c>x[k] = ...</c>) names nothing, as an array element does, so both tiers agree.
        /// </summary>
        static string? AssignedName(ISimpleAssignmentOperation assignment) => assignment.Target switch
        {
            ILocalReferenceOperation local => local.Local.Name,
            IFieldReferenceOperation field => field.Field.Name,
            IPropertyReferenceOperation { Property.IsIndexer: true } => null,
            IPropertyReferenceOperation property => property.Property.Name,
            IParameterReferenceOperation parameter => parameter.Parameter.Name,
            { Syntax: IdentifierNameSyntax identifier } => identifier.Identifier.ValueText,
            { Syntax: MemberAccessExpressionSyntax access } => access.Name.Identifier.ValueText,
            _ => null,
        };

        /// <summary>The name's location for an initializer (<c>= value</c>) of a field declarator or a property.</summary>
        static Location NameLocation(SyntaxNode initializer) => initializer.Parent switch
        {
            VariableDeclaratorSyntax declarator => declarator.Identifier.GetLocation(),
            PropertyDeclarationSyntax property => property.Identifier.GetLocation(),
            _ => initializer.GetLocation(),
        };

        // ── Helpers ─────────────────────────────────────────────────

        static IOperation Unwrap(IOperation op)
        {
            while (op is IConversionOperation { IsImplicit: true } conversion) op = conversion.Operand;
            return op;
        }

        /// <summary>
        /// A literal operand: its syntax (conversions unwrapped) is a literal expression, or a
        /// number literal with a sign, so both tiers agree. Null for anything else.
        /// </summary>
        static (string Text, string Kind)? Literal(IOperation operand)
        {
            var syntax = Unwrap(operand).Syntax;
            return syntax switch
            {
                LiteralExpressionSyntax literal => LiteralKind(literal) is { } kind ? (literal.ToString(), kind) : null,
                PrefixUnaryExpressionSyntax { Operand: LiteralExpressionSyntax number } signed
                    when (signed.IsKind(SyntaxKind.UnaryMinusExpression) || signed.IsKind(SyntaxKind.UnaryPlusExpression))
                    && number.IsKind(SyntaxKind.NumericLiteralExpression) => (signed.ToString(), "number"),
                _ => null,
            };
        }

        static string? LiteralKind(LiteralExpressionSyntax literal) => literal.Kind() switch
        {
            SyntaxKind.NumericLiteralExpression => "number",
            SyntaxKind.StringLiteralExpression or SyntaxKind.Utf8StringLiteralExpression => "string",
            SyntaxKind.CharacterLiteralExpression => "char",
            SyntaxKind.TrueLiteralExpression or SyntaxKind.FalseLiteralExpression => "boolean",
            SyntaxKind.NullLiteralExpression => "null",
            _ => null,
        };

        static string? ComparisonOperator(BinaryOperatorKind kind) => kind switch
        {
            BinaryOperatorKind.Equals => "==",
            BinaryOperatorKind.NotEquals => "!=",
            BinaryOperatorKind.LessThan => "<",
            BinaryOperatorKind.LessThanOrEqual => "<=",
            BinaryOperatorKind.GreaterThan => ">",
            BinaryOperatorKind.GreaterThanOrEqual => ">=",
            _ => null,
        };

        static string RelationalOperator(IRelationalPatternOperation relational) =>
            relational.Syntax is RelationalPatternSyntax syntax
                ? syntax.OperatorToken.Text
                : ComparisonOperator(relational.OperatorKind) ?? relational.OperatorKind.ToString();

        static int LineOf(Location location) => location.GetLineSpan().StartLinePosition.Line;

        static IEnumerable<IOperation> Enumerate(IOperation root)
        {
            var stack = new Stack<IOperation>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                var current = stack.Pop();
                yield return current;
                foreach (var child in current.ChildOperations.Reverse())
                    stack.Push(child);
            }
        }
    }

    // ── Shared rules (the analyzer half; pinned by fact-vectors.json) ─────

    /// <summary>FC-4: <c>Name</c> exact, <c>Name*</c> prefix, <c>q.Name[*]</c> only when the call is written <c>q.Name(...)</c>.</summary>
    public static bool MatchesNormalization(string method, string? qualifier, IReadOnlyList<string> patterns)
    {
        foreach (var pattern in patterns)
        {
            var dot = pattern.IndexOf('.');
            var patternQualifier = dot >= 0 ? pattern[..dot] : null;
            var name = dot >= 0 ? pattern[(dot + 1)..] : pattern;
            if (patternQualifier != null && patternQualifier != qualifier) continue;
            if (name.EndsWith('*') ? method.StartsWith(name[..^1], StringComparison.Ordinal) : method == name) return true;
        }
        return false;
    }

    static readonly string[] RetryTimeoutFragments = ["retry", "retries", "attempt", "timeout", "delay", "backoff", "ttl", "expir"];

    /// <summary>ASCII tokens only: every other character separates them (FC-5).</summary>
    static readonly Regex NameToken = new("[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|[0-9]+", RegexOptions.CultureInvariant);

    /// <summary>FC-5: a fragment matches when the lower-cased tokens, joined from the start of some token, begin with it.</summary>
    public static bool HasRetryTimeoutFragment(string name)
    {
        var tokens = NameToken.Matches(name).Select(m => AsciiLower(m.Value)).ToList();
        for (var i = 0; i < tokens.Count; i++)
        {
            var rest = string.Concat(tokens.Skip(i));
            if (RetryTimeoutFragments.Any(fragment => rest.StartsWith(fragment, StringComparison.Ordinal))) return true;
        }
        return false;
    }

    static string AsciiLower(string token)
    {
        var chars = token.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
            if (chars[i] is >= 'A' and <= 'Z') chars[i] = (char)(chars[i] + 32);
        return new string(chars);
    }
}

// ── Route prefixes (MapGroup and inherited controller routes) ───────

/// <summary>
/// The <c>MapGroup</c> prefixes of a minimal API route call, resolved through the semantic model:
/// <c>var g = app.MapGroup("/api"); g.MapGet("/x", ...)</c> gives <c>/api/x</c>, nested groups
/// compose, and a group passed to a method (an extension method's <c>this</c> parameter included)
/// takes the prefix its call sites agree on. A prefix that does not resolve is null, and the route
/// keeps the call's own template: a route is never guessed.
/// </summary>
sealed class RouteGroups(Compilation compilation)
{
    const string MapGroup = "MapGroup";
    const int MaxDepth = 8;

    /// <summary>Types a receiver of which may be a route group; any other type is the app itself.</summary>
    static readonly HashSet<string> GroupTypeNames = new(StringComparer.Ordinal) { "RouteGroupBuilder", "IEndpointRouteBuilder" };

    readonly Dictionary<IParameterSymbol, string?> parameterPrefixes = new(SymbolEqualityComparer.Default);
    readonly HashSet<ISymbol> inProgress = new(SymbolEqualityComparer.Default);
    readonly Dictionary<SyntaxTree, SemanticModel> models = [];

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

    /// <summary>The group prefix of a receiver: <c>""</c> for the app itself, null when it does not resolve.</summary>
    public string? Prefix(ExpressionSyntax expression, SemanticModel model, int depth)
    {
        if (depth > MaxDepth) return null;
        while (expression is ParenthesizedExpressionSyntax parenthesized) expression = parenthesized.Expression;

        if (expression is InvocationExpressionSyntax invocation && MethodName(invocation) == MapGroup)
        {
            var segment = GroupSegment(invocation, model);
            var receiver = segment != null ? Receiver(invocation, model) : null;
            var outer = receiver != null ? Prefix(receiver, model, depth + 1) : null;
            return outer == null ? null : outer.Length == 0 ? segment : Join(outer, segment!);
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

    static string? MethodName(InvocationExpressionSyntax invocation) => invocation.Expression switch
    {
        MemberAccessExpressionSyntax access => access.Name.Identifier.ValueText,
        SimpleNameSyntax name => name.Identifier.ValueText,
        _ => null,
    };

    /// <summary>The constant string prefix of a <c>MapGroup</c> call; null for any other argument.</summary>
    static string? GroupSegment(InvocationExpressionSyntax invocation, SemanticModel model)
    {
        ExpressionSyntax? argument;
        if (model.GetOperation(invocation) is IInvocationOperation operation)
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

    /// <summary>Null, an unresolved type, or a type named <c>RouteGroupBuilder</c> or <c>IEndpointRouteBuilder</c>.</summary>
    static bool MayBeGroup(ITypeSymbol? type) =>
        type == null || type.TypeKind == TypeKind.Error || GroupTypeNames.Contains(type.Name);

    /// <summary>A local with one initializer that is never assigned again: the initializer's prefix.</summary>
    string? Local(ILocalSymbol local, SemanticModel model, int depth)
    {
        if (local.DeclaringSyntaxReferences is not [var reference]
            || reference.GetSyntax() is not VariableDeclaratorSyntax { Initializer.Value: var value } declarator
            || declarator.SyntaxTree != model.SyntaxTree
            || IsAssignedAgain(local, declarator, model))
        {
            return MayBeGroup(local.Type) ? null : "";
        }
        if (!inProgress.Add(local)) return null;
        try
        {
            return Prefix(value, model, depth + 1);
        }
        finally
        {
            inProgress.Remove(local);
        }
    }

    /// <summary>An assignment, or a <c>ref</c> or <c>out</c> argument, of the local in its scope.</summary>
    static bool IsAssignedAgain(ILocalSymbol local, VariableDeclaratorSyntax declarator, SemanticModel model)
    {
        SyntaxNode scope = declarator.FirstAncestorOrSelf<MemberDeclarationSyntax>() is { } member and not GlobalStatementSyntax
            ? member
            : declarator.SyntaxTree.GetRoot();
        foreach (var node in scope.DescendantNodes())
        {
            ExpressionSyntax? target = node switch
            {
                AssignmentExpressionSyntax assignment => assignment.Left,
                ArgumentSyntax { RefKindKeyword.RawKind: not 0 } argument => argument.Expression,
                _ => null,
            };
            if (target is IdentifierNameSyntax name && name.Identifier.ValueText == local.Name
                && SymbolEqualityComparer.Default.Equals(model.GetSymbolInfo(name).Symbol, local))
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>
    /// A parameter that may be a group: the prefix every call site of its method passes, found in this
    /// compilation. Null when there is no call site, the call sites disagree, one does not resolve, or
    /// the method is virtual, abstract, an override, an interface member or used as a method group.
    /// </summary>
    string? Parameter(IParameterSymbol parameter, int depth)
    {
        if (!MayBeGroup(parameter.Type)) return "";
        if (parameter.ContainingSymbol is not IMethodSymbol { } method) return null;
        method = (method.ReducedFrom ?? method).OriginalDefinition;
        var ordinal = parameter.Ordinal;
        if (method.Parameters.Length <= ordinal) return null;
        var key = method.Parameters[ordinal];
        if (parameterPrefixes.TryGetValue(key, out var cached)) return cached;
        if (method.IsVirtual || method.IsAbstract || method.IsOverride || method.ContainingType?.TypeKind == TypeKind.Interface
            || method.MethodKind is not (MethodKind.Ordinary or MethodKind.LocalFunction))
        {
            return parameterPrefixes[key] = null;
        }
        if (!inProgress.Add(key)) return null;
        try
        {
            return parameterPrefixes[key] = CallSitePrefix(method, ordinal, depth);
        }
        finally
        {
            inProgress.Remove(key);
        }
    }

    string? CallSitePrefix(IMethodSymbol method, int ordinal, int depth)
    {
        string? agreed = null;
        foreach (var tree in compilation.SyntaxTrees)
        {
            if (!tree.GetText().ToString().Contains(method.Name, StringComparison.Ordinal)) continue;
            var model = ModelOf(tree);
            foreach (var name in tree.GetRoot().DescendantNodes().OfType<SimpleNameSyntax>())
            {
                if (name.Identifier.ValueText != method.Name) continue;
                if (name.Parent is MethodDeclarationSyntax or LocalFunctionStatementSyntax) continue;
                var referenced = model.GetSymbolInfo(name).Symbol as IMethodSymbol;
                if (referenced == null || !SymbolEqualityComparer.Default.Equals((referenced.ReducedFrom ?? referenced).OriginalDefinition, method))
                    continue;

                // A reference that is not the target of a call (a method group) hides its call sites.
                var call = CallOf(name);
                if (call == null || model.GetOperation(call) is not IInvocationOperation operation) return null;
                var argument = operation.Arguments.FirstOrDefault(a => a.Parameter?.Ordinal == ordinal);
                if (argument is not { ArgumentKind: ArgumentKind.Explicit } || Unwrap(argument.Value).Syntax is not ExpressionSyntax value)
                    return null;
                var prefix = Prefix(value, model, depth + 1);
                if (prefix == null || (agreed != null && agreed != prefix)) return null;
                agreed = prefix;
            }
        }
        return agreed;
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
/// has any. Null when the class declares its own <c>Route</c> or no base class has one.
/// </summary>
static class InheritedRoutes
{
    public static string? For(INamedTypeSymbol type)
    {
        if (type.TypeKind != TypeKind.Class || RouteOf(type, out _)) return null;
        var depth = 0;
        for (var current = type.BaseType; current != null && current.SpecialType != SpecialType.System_Object && depth < 32; current = current.BaseType, depth++)
        {
            if (current.TypeKind == TypeKind.Error) return null;
            if (RouteOf(current, out var template)) return template;
        }
        return null;
    }

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
