using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.MSBuild;
using Microsoft.CodeAnalysis.Operations;

// ── Entry Point ──────────────────────────────────────────────────────

MSBuildLocator.RegisterDefaults();

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    WriteIndented = false,
};

var cliArgs = Environment.GetCommandLineArgs().Skip(1).ToArray();
var keepAlive = cliArgs.Contains("--keep-alive");
var solutionPath = cliArgs.FirstOrDefault(a => !a.StartsWith("--"));

if (string.IsNullOrEmpty(solutionPath))
{
    WriteError("Usage: dotnet run -- <solution.sln> [--keep-alive]");
    return 1;
}

if (!File.Exists(solutionPath))
{
    WriteError($"Solution not found: {solutionPath}");
    return 1;
}

var solutionDir = Path.GetDirectoryName(Path.GetFullPath(solutionPath))!;

// Load solution
WriteProgress("Loading solution...");
using var workspace = MSBuildWorkspace.Create();
workspace.WorkspaceFailed += (_, e) =>
{
    if (e.Diagnostic.Kind == WorkspaceDiagnosticKind.Failure)
        WriteStderr($"Workspace: {e.Diagnostic.Message}");
};

var solution = await workspace.OpenSolutionAsync(solutionPath);
var projectCount = solution.Projects.Count();
var fileCount = solution.Projects.SelectMany(p => p.Documents).Count(d => IsUserCsFile(d.FilePath));

WriteProgress($"Solution loaded: {projectCount} projects, {fileCount} .cs files");

// Build compilations
var compilations = new Dictionary<ProjectId, Compilation>();
foreach (var project in solution.Projects)
{
    var compilation = await project.GetCompilationAsync();
    if (compilation != null)
        compilations[project.Id] = compilation;
}

WriteProgress($"Compilations ready: {compilations.Count} projects");

if (keepAlive)
{
    await RunKeepAlive(solution, compilations);
}
else
{
    await RunBatchIndex(solution, compilations);
}

return 0;

// ── Batch Mode ───────────────────────────────────────────────────────

async Task RunBatchIndex(Solution sol, Dictionary<ProjectId, Compilation> comps)
{
    var totalFiles = 0;
    var sw = System.Diagnostics.Stopwatch.StartNew();

    foreach (var project in sol.Projects)
    {
        if (!comps.TryGetValue(project.Id, out var compilation)) continue;

        foreach (var document in project.Documents)
        {
            // BUG 2 FIX: Skip generated/obj/bin files
            if (!IsUserCsFile(document.FilePath)) continue;

            var relativePath = Path.GetRelativePath(solutionDir, document.FilePath!).Replace('\\', '/');
            var result = await AnalyzeDocument(document, compilation, sol, relativePath);
            WriteLine(JsonSerializer.Serialize(result, jsonOptions));
            totalFiles++;
        }
    }

    // Project dependency graph
    var projectGraph = BuildProjectGraph(sol);
    WriteLine(JsonSerializer.Serialize(projectGraph, jsonOptions));

    // Done
    sw.Stop();
    var done = new { type = "done", totalFiles, elapsed = $"{sw.Elapsed.TotalSeconds:F1}s" };
    WriteLine(JsonSerializer.Serialize(done, jsonOptions));
}

// ── Keep-Alive Mode ──────────────────────────────────────────────────

async Task RunKeepAlive(Solution sol, Dictionary<ProjectId, Compilation> comps)
{
    var ready = new { type = "ready", projectCount, fileCount };
    WriteLine(JsonSerializer.Serialize(ready, jsonOptions));

    string? line;
    while ((line = Console.ReadLine()) != null)
    {
        try
        {
            var request = JsonSerializer.Deserialize<KeepAliveRequest>(line, jsonOptions);
            if (request?.File == null) continue;

            var fullPath = Path.GetFullPath(Path.Combine(solutionDir, request.File));

            // Find the document
            var doc = sol.Projects
                .SelectMany(p => p.Documents)
                .FirstOrDefault(d => d.FilePath != null &&
                    string.Equals(Path.GetFullPath(d.FilePath), fullPath, StringComparison.OrdinalIgnoreCase));

            if (doc == null)
            {
                WriteError($"File not found in solution: {request.File}");
                continue;
            }

            // Incremental update if file content changed
            if (File.Exists(fullPath))
            {
                var newText = Microsoft.CodeAnalysis.Text.SourceText.From(File.ReadAllText(fullPath));
                sol = sol.WithDocumentText(doc.Id, newText);

                // Recompile affected project
                var project = sol.GetProject(doc.Project.Id);
                if (project != null)
                {
                    var newComp = await project.GetCompilationAsync();
                    if (newComp != null)
                        comps[project.Id] = newComp;
                }

                doc = sol.GetDocument(doc.Id)!;
            }

            if (!comps.TryGetValue(doc.Project.Id, out var compilation)) continue;

            var relativePath = Path.GetRelativePath(solutionDir, doc.FilePath!).Replace('\\', '/');
            var result = await AnalyzeDocument(doc, compilation, sol, relativePath);
            WriteLine(JsonSerializer.Serialize(result, jsonOptions));
        }
        catch (Exception ex)
        {
            WriteError($"Keep-alive error: {ex.Message}");
        }
    }
}

// ── Document Analysis ────────────────────────────────────────────────

async Task<FileResult> AnalyzeDocument(Document document, Compilation compilation, Solution sol, string relativePath)
{
    var semanticModel = await document.GetSemanticModelAsync();
    var syntaxRoot = await document.GetSyntaxRootAsync();

    if (semanticModel == null || syntaxRoot == null)
        return new FileResult { Type = "file", File = relativePath };

    var symbols = ExtractSymbols(syntaxRoot, semanticModel, relativePath);
    var edges = ExtractEdges(syntaxRoot, semanticModel, compilation, relativePath);
    var complexity = ExtractComplexity(syntaxRoot, semanticModel, relativePath);

    return new FileResult
    {
        Type = "file",
        File = relativePath,
        Symbols = symbols,
        Edges = edges,
        Complexity = complexity,
    };
}

// ── Symbol Extraction ────────────────────────────────────────────────

List<CtxoSymbol> ExtractSymbols(SyntaxNode root, SemanticModel model, string filePath)
{
    var symbols = new List<CtxoSymbol>();

    foreach (var node in root.DescendantNodes())
    {
        ISymbol? symbol = node switch
        {
            ClassDeclarationSyntax => model.GetDeclaredSymbol(node),
            StructDeclarationSyntax => model.GetDeclaredSymbol(node),
            RecordDeclarationSyntax => model.GetDeclaredSymbol(node),
            InterfaceDeclarationSyntax => model.GetDeclaredSymbol(node),
            EnumDeclarationSyntax => model.GetDeclaredSymbol(node),
            DelegateDeclarationSyntax => model.GetDeclaredSymbol(node),
            MethodDeclarationSyntax => model.GetDeclaredSymbol(node),
            ConstructorDeclarationSyntax => model.GetDeclaredSymbol(node),
            PropertyDeclarationSyntax => model.GetDeclaredSymbol(node),
            FieldDeclarationSyntax field => field.Declaration.Variables.FirstOrDefault() is { } v
                ? model.GetDeclaredSymbol(v) : null,
            EventDeclarationSyntax => model.GetDeclaredSymbol(node),
            EnumMemberDeclarationSyntax => model.GetDeclaredSymbol(node),
            _ => null,
        };

        if (symbol == null) continue;

        var kind = MapSymbolKind(symbol);
        if (kind == null) continue;

        // BUG 1 FIX: Use syntax node span for full body range, not just declaration line
        var nodeSpan = node.GetLocation().GetLineSpan();

        // BUG 3 FIX: Use type name for constructors instead of .ctor
        var qualifiedName = GetQualifiedName(symbol);

        symbols.Add(new CtxoSymbol
        {
            SymbolId = $"{filePath}::{qualifiedName}::{kind}",
            Name = qualifiedName,
            Kind = kind,
            StartLine = nodeSpan.StartLinePosition.Line,
            EndLine = nodeSpan.EndLinePosition.Line,
        });
    }

    return symbols;
}

// ── Edge Extraction (IOperation-based) ───────────────────────────────

List<CtxoEdge> ExtractEdges(
    SyntaxNode root, SemanticModel model, Compilation compilation, string filePath)
{
    var edges = new List<CtxoEdge>();
    var seen = new HashSet<string>();

    // 1. Inheritance edges: extends + implements
    foreach (var typeDecl in root.DescendantNodes().OfType<TypeDeclarationSyntax>())
    {
        if (model.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol typeSymbol) continue;
        var fromId = $"{filePath}::{GetQualifiedName(typeSymbol)}::{MapSymbolKind(typeSymbol)}";

        // BaseType -> extends
        if (typeSymbol.BaseType != null &&
            typeSymbol.BaseType.SpecialType != SpecialType.System_Object &&
            typeSymbol.BaseType.SpecialType != SpecialType.System_ValueType)
        {
            var toId = SymbolToId(typeSymbol.BaseType);
            if (toId != null)
                AddEdge(edges, seen, fromId, toId, "extends");
        }

        // Interfaces -> implements
        foreach (var iface in typeSymbol.Interfaces)
        {
            var toId = SymbolToId(iface);
            if (toId != null)
                AddEdge(edges, seen, fromId, toId, "implements");
        }
    }

    // BUG 5 FIX: Resolve using directives to actual type references, not just namespaces
    // Walk all identifier nodes and resolve cross-file type usages as imports edges
    var fileTypes = new HashSet<string>();
    foreach (var typeDecl in root.DescendantNodes().OfType<TypeDeclarationSyntax>())
    {
        if (model.GetDeclaredSymbol(typeDecl) is INamedTypeSymbol ts)
            fileTypes.Add(GetQualifiedName(ts));
    }

    var firstTypeId = root.DescendantNodes().OfType<TypeDeclarationSyntax>().FirstOrDefault() is { } ftd
        && model.GetDeclaredSymbol(ftd) is INamedTypeSymbol ft
        ? $"{filePath}::{GetQualifiedName(ft)}::{MapSymbolKind(ft)}"
        : null;

    if (firstTypeId != null)
    {
        // Find all type references in signatures (base lists already covered above)
        foreach (var typeRef in root.DescendantNodes().OfType<IdentifierNameSyntax>())
        {
            var refSymbol = model.GetSymbolInfo(typeRef).Symbol;
            if (refSymbol is INamedTypeSymbol referencedType &&
                referencedType.Locations.FirstOrDefault()?.IsInSource == true)
            {
                var refName = GetQualifiedName(referencedType);
                if (!fileTypes.Contains(refName)) // cross-file reference
                {
                    var toId = SymbolToId(referencedType);
                    if (toId != null)
                        AddEdge(edges, seen, firstTypeId, toId, "imports");
                }
            }
        }
    }

    // 3. Method body analysis: calls + uses (via IOperation tree)
    foreach (var methodDecl in root.DescendantNodes().OfType<BaseMethodDeclarationSyntax>())
    {
        if (model.GetDeclaredSymbol(methodDecl) is not IMethodSymbol methodSymbol) continue;
        var fromId = $"{filePath}::{GetQualifiedName(methodSymbol)}::{MapSymbolKind(methodSymbol)}";

        var body = (SyntaxNode?)methodDecl switch
        {
            MethodDeclarationSyntax m => (SyntaxNode?)m.Body ?? m.ExpressionBody,
            ConstructorDeclarationSyntax c => (SyntaxNode?)c.Body ?? c.ExpressionBody,
            _ => null,
        };
        if (body == null) continue;

        var operation = model.GetOperation(body);
        if (operation == null) continue;

        foreach (var op in EnumerateOperations(operation))
        {
            switch (op)
            {
                case IInvocationOperation invocation:
                {
                    var target = invocation.TargetMethod.OriginalDefinition;
                    var toId = SymbolToId(target);
                    if (toId != null)
                        AddEdge(edges, seen, fromId, toId, "calls");
                    break;
                }
                case IObjectCreationOperation creation:
                {
                    if (creation.Type is INamedTypeSymbol createdType)
                    {
                        var toId = SymbolToId(createdType);
                        if (toId != null)
                            AddEdge(edges, seen, fromId, toId, "uses");
                    }
                    break;
                }
                case IPropertyReferenceOperation propRef:
                {
                    if (!SymbolEqualityComparer.Default.Equals(propRef.Property.ContainingType, methodSymbol.ContainingType))
                    {
                        var toId = SymbolToId(propRef.Property);
                        if (toId != null)
                            AddEdge(edges, seen, fromId, toId, "uses");
                    }
                    break;
                }
                case IFieldReferenceOperation fieldRef:
                {
                    if (!SymbolEqualityComparer.Default.Equals(fieldRef.Field.ContainingType, methodSymbol.ContainingType))
                    {
                        var toId = SymbolToId(fieldRef.Field);
                        if (toId != null)
                            AddEdge(edges, seen, fromId, toId, "uses");
                    }
                    break;
                }
            }
        }
    }

    return edges;
}

// ── Complexity ───────────────────────────────────────────────────────

// BUG 4 FIX: Process all method-like declarations (methods + constructors + accessors)
List<CtxoComplexity> ExtractComplexity(SyntaxNode root, SemanticModel model, string filePath)
{
    var metrics = new List<CtxoComplexity>();

    foreach (var methodDecl in root.DescendantNodes().OfType<BaseMethodDeclarationSyntax>())
    {
        if (model.GetDeclaredSymbol(methodDecl) is not IMethodSymbol methodSymbol) continue;

        var body = (SyntaxNode?)methodDecl switch
        {
            MethodDeclarationSyntax m => (SyntaxNode?)m.Body ?? m.ExpressionBody,
            ConstructorDeclarationSyntax c => (SyntaxNode?)c.Body ?? c.ExpressionBody,
            _ => null,
        };
        if (body == null) continue;

        int cyclomatic = 1;
        int cognitive = 0;

        void Walk(SyntaxNode node, int depth)
        {
            bool increments = node is IfStatementSyntax
                or ConditionalExpressionSyntax
                or SwitchStatementSyntax or SwitchExpressionSyntax
                or ForStatementSyntax or ForEachStatementSyntax
                or WhileStatementSyntax or DoStatementSyntax
                or CatchClauseSyntax;

            // BUG 8 FIX: Count else clauses in cognitive complexity
            bool isElse = node is ElseClauseSyntax;

            bool isBoolOp = node is BinaryExpressionSyntax bin &&
                (bin.IsKind(SyntaxKind.LogicalAndExpression) ||
                 bin.IsKind(SyntaxKind.LogicalOrExpression) ||
                 bin.IsKind(SyntaxKind.CoalesceExpression));

            if (increments)
            {
                cyclomatic++;
                cognitive += 1 + depth;
            }
            if (isElse)
            {
                cognitive += 1 + depth; // else adds cognitive complexity with nesting penalty
            }
            if (isBoolOp)
            {
                cyclomatic++;
                cognitive++;
            }

            bool nests = node is IfStatementSyntax or SwitchStatementSyntax
                or ForStatementSyntax or ForEachStatementSyntax
                or WhileStatementSyntax or DoStatementSyntax
                or CatchClauseSyntax or LambdaExpressionSyntax;

            if (nests) depth++;

            foreach (var child in node.ChildNodes())
                Walk(child, depth);
        }

        Walk(body, 0);

        var qualifiedName = GetQualifiedName(methodSymbol);
        metrics.Add(new CtxoComplexity
        {
            SymbolId = $"{filePath}::{qualifiedName}::method",
            Cyclomatic = cyclomatic,
            Cognitive = cognitive,
        });
    }

    return metrics;
}

// ── Project Dependency Graph ─────────────────────────────────────────

object BuildProjectGraph(Solution sol)
{
    var depGraph = sol.GetProjectDependencyGraph();
    var projects = new List<object>();
    var graphEdges = new List<object>();

    foreach (var projectId in depGraph.GetTopologicallySortedProjects())
    {
        var project = sol.GetProject(projectId);
        if (project == null) continue;

        projects.Add(new { name = project.Name, path = project.FilePath });

        foreach (var depId in depGraph.GetProjectsThatThisProjectDirectlyDependsOn(projectId))
        {
            var dep = sol.GetProject(depId);
            if (dep != null)
                graphEdges.Add(new { from = project.Name, to = dep.Name, kind = "projectReference" });
        }
    }

    return new { type = "projectGraph", projects, edges = graphEdges };
}

// ── Helpers ──────────────────────────────────────────────────────────

// BUG 2 FIX: Filter out generated/build artifact files
bool IsUserCsFile(string? filePath)
{
    if (filePath == null || !filePath.EndsWith(".cs")) return false;
    var normalized = filePath.Replace('\\', '/');
    return !normalized.Contains("/obj/") && !normalized.Contains("/bin/");
}

IEnumerable<IOperation> EnumerateOperations(IOperation root)
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

string? MapSymbolKind(ISymbol symbol) => symbol switch
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

// BUG 3 FIX: Use containing type name for constructors
string GetQualifiedName(ISymbol symbol)
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

// BUG 6 FIX: Consistent SymbolToId for all symbol types
string? SymbolToId(ISymbol symbol)
{
    // Only resolve symbols that are in source (not metadata/framework)
    var original = symbol.OriginalDefinition;
    var location = original.Locations.FirstOrDefault();
    if (location == null || !location.IsInSource) return null;

    var sourceFilePath = location.SourceTree?.FilePath;
    if (sourceFilePath == null) return null;

    var relativePath = Path.GetRelativePath(solutionDir, sourceFilePath).Replace('\\', '/');
    var kind = MapSymbolKind(original);

    return kind != null ? $"{relativePath}::{GetQualifiedName(original)}::{kind}" : null;
}

void AddEdge(List<CtxoEdge> edges, HashSet<string> seen, string from, string to, string kind)
{
    if (from == to) return; // skip self-references
    var key = $"{from}|{to}|{kind}";
    if (!seen.Add(key)) return; // deduplicate
    edges.Add(new CtxoEdge { From = from, To = to, Kind = kind });
}

void WriteProgress(string message) =>
    WriteLine(JsonSerializer.Serialize(new { type = "progress", message }, jsonOptions));

void WriteError(string message) =>
    WriteStderr($"[ctxo-roslyn] {message}");

void WriteStderr(string message) =>
    Console.Error.WriteLine(message);

void WriteLine(string json) =>
    Console.WriteLine(json);

// ── Types ────────────────────────────────────────────────────────────

record FileResult
{
    [JsonPropertyName("type")] public string Type { get; init; } = "file";
    [JsonPropertyName("file")] public string File { get; init; } = "";
    [JsonPropertyName("symbols")] public List<CtxoSymbol>? Symbols { get; init; }
    [JsonPropertyName("edges")] public List<CtxoEdge>? Edges { get; init; }
    [JsonPropertyName("complexity")] public List<CtxoComplexity>? Complexity { get; init; }
}

record CtxoSymbol
{
    [JsonPropertyName("symbolId")] public string SymbolId { get; init; } = "";
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("kind")] public string Kind { get; init; } = "";
    [JsonPropertyName("startLine")] public int StartLine { get; init; }
    [JsonPropertyName("endLine")] public int EndLine { get; init; }
}

record CtxoEdge
{
    [JsonPropertyName("from")] public string From { get; init; } = "";
    [JsonPropertyName("to")] public string To { get; init; } = "";
    [JsonPropertyName("kind")] public string Kind { get; init; } = "";
}

record CtxoComplexity
{
    [JsonPropertyName("symbolId")] public string SymbolId { get; init; } = "";
    [JsonPropertyName("cyclomatic")] public int Cyclomatic { get; init; }
    [JsonPropertyName("cognitive")] public int Cognitive { get; init; }
}

record KeepAliveRequest
{
    [JsonPropertyName("file")] public string? File { get; init; }
}
