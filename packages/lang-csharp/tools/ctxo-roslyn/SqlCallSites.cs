using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Operations;

// ── SQL Call Sites ───────────────────────────────────────────────────

/// <summary>The SQL texts found at known call sites, as the batch <c>done</c> line reports them.</summary>
sealed class SqlStats
{
    /// <summary>Call sites whose text is a compile-time constant string.</summary>
    public int Constant;
    /// <summary>Call sites whose text is not a constant (built at runtime, <c>static readonly</c>, a parameter).</summary>
    public int NonConstant;
    /// <summary>Constant texts that ScriptDom rejects; they add no edges.</summary>
    public int Unparsable;
}

/// <summary>
/// Finds constant SQL text at the <see cref="KnownSqlApis"/> call sites of one
/// method or constructor body and reports its accesses as data edges:
/// <c>reads</c> and <c>writes</c> to <c>&lt;schema.name&gt;::table</c> and
/// <c>executes</c> to <c>&lt;schema.name&gt;::procedure</c>, the 2-part ids of
/// the TypeScript SQL plugin. Only <see cref="IOperation.ConstantValue"/>
/// counts as text, so interpolation with non-constant holes, <c>static
/// readonly</c> fields and concatenation with non-constants are non-constant.
/// </summary>
static class SqlCallSites
{
    const string Reads = "reads";
    const string Writes = "writes";
    const string Executes = "executes";

    /// <summary>EF Core composite-format placeholders and their brace escapes (<c>{0}</c>, <c>{0,5:x}</c>, <c>{{</c>, <c>}}</c>).</summary>
    static readonly Regex FormatItem = new(
        @"\{\{|\}\}|\{([0-9]+) *(?:,[^{}]*)?(?::[^{}]*)?\}",
        RegexOptions.CultureInvariant);

    /// <summary>
    /// Adds the data edges of one method or constructor body, given as every
    /// operation of the body in pre-order (the walk the code edges already made).
    /// </summary>
    public static void Collect(IReadOnlyList<IOperation> operations, Action<string, string> addEdge, SqlStats stats)
    {
        var procedures = new ProcedureCommands(operations);

        foreach (var op in operations)
        {
            switch (op)
            {
                case IObjectCreationOperation creation:
                {
                    var api = KnownSqlApis.Find(SqlSite.Constructor, creation.Constructor?.ContainingType, ".ctor");
                    if (api == null || ArgumentFor(creation.Arguments, api.Parameter) is not { } argument) break;
                    var procedure = api.ProcedureWhen == SqlProcedureWhen.CommandTypeProperty
                        ? procedures.IsProcedure(creation)
                        : CommandTypeArgumentIsProcedure(api, creation.Arguments);
                    Analyze(argument.Value, api.Form, procedure, addEdge, stats);
                    break;
                }
                case IInvocationOperation invocation:
                {
                    var method = invocation.TargetMethod;
                    var api = KnownSqlApis.Find(SqlSite.Method, method.ContainingType, method.Name);
                    if (api == null || ArgumentFor(invocation.Arguments, api.Parameter) is not { } argument) break;
                    var procedure = CommandTypeArgumentIsProcedure(api, invocation.Arguments);
                    Analyze(argument.Value, api.Form, procedure, addEdge, stats);
                    break;
                }
                case IAssignmentOperation { Target: IPropertyReferenceOperation property } assignment:
                {
                    var api = KnownSqlApis.Find(SqlSite.PropertyAssignment, property.Property.ContainingType, property.Property.Name);
                    if (api == null) break;
                    if (assignment is not ISimpleAssignmentOperation simple)
                    {
                        // `+=` and `??=` build the text at runtime.
                        stats.NonConstant++;
                        break;
                    }
                    var procedure = api.ProcedureWhen == SqlProcedureWhen.CommandTypeProperty && procedures.IsProcedure(property);
                    Analyze(simple.Value, api.Form, procedure, addEdge, stats);
                    break;
                }
            }
        }
    }

    static void Analyze(IOperation value, SqlTextForm form, bool procedure, Action<string, string> addEdge, SqlStats stats)
    {
        if (ConstantText(value) is not { } text)
        {
            stats.NonConstant++;
            return;
        }
        stats.Constant++;

        if (form == SqlTextForm.WrittenTableName)
        {
            if (SqlText.CanonicalName(text) is { } table) addEdge(table + "::table", Writes);
            return;
        }
        if (procedure && SqlText.CanonicalName(text) is { } procedureName)
        {
            addEdge(procedureName + "::procedure", Executes);
            return;
        }
        // A text that is no procedure name is read as statements: CommandType counts wherever the
        // body sets it, so a reused command can run a query before it runs a procedure.

        var sql = form == SqlTextForm.FormatStatements ? FormatItemsToParameters(text) : text;
        var accesses = SqlText.Extract(sql);
        if (accesses.Errors > 0)
        {
            stats.Unparsable++;
            return;
        }
        foreach (var name in accesses.Reads) addEdge(name + "::table", Reads);
        foreach (var name in accesses.Writes) addEdge(name + "::table", Writes);
        foreach (var name in accesses.Executes) addEdge(name + "::procedure", Executes);
    }

    /// <summary>
    /// True for an API whose text names a procedure when the <c>commandType</c> argument, named or
    /// positional, is <c>CommandType.StoredProcedure</c> (Dapper's methods and <c>CommandDefinition</c>).
    /// </summary>
    static bool CommandTypeArgumentIsProcedure(KnownSqlApi api, IEnumerable<IArgumentOperation> arguments) =>
        api.ProcedureWhen == SqlProcedureWhen.CommandTypeArgument
        && KnownSqlApis.IsStoredProcedure(ArgumentFor(arguments, "commandType")?.Value);

    /// <summary>The constant string of a value, looking through its conversions; null when it has none.</summary>
    static string? ConstantText(IOperation? value)
    {
        for (var op = value; op != null; op = (op as IConversionOperation)?.Operand)
        {
            if (op.ConstantValue is { HasValue: true, Value: string text }) return text;
        }
        return null;
    }

    /// <summary>The argument written for a parameter (by name), or null when there is none or the default fills it.</summary>
    static IArgumentOperation? ArgumentFor(IEnumerable<IArgumentOperation> arguments, string? parameter)
    {
        if (parameter == null) return null;
        foreach (var argument in arguments)
        {
            if (argument.ArgumentKind == ArgumentKind.DefaultValue) continue;
            if (string.Equals(argument.Parameter?.Name, parameter, StringComparison.Ordinal)) return argument;
        }
        return null;
    }

    /// <summary>EF Core formats raw SQL with <c>string.Format</c>, turning <c>{0}</c> into the parameter <c>@p0</c>.</summary>
    static string FormatItemsToParameters(string sql) =>
        FormatItem.Replace(sql, match => match.Value switch
        {
            "{{" => "{",
            "}}" => "}",
            _ => "@p" + match.Groups[1].Value,
        });

    /// <summary>
    /// The commands of one body whose <c>CommandType</c> is set to
    /// <c>StoredProcedure</c>: locals assigned it anywhere in the body, and
    /// object creations whose initializer sets it (with the local they
    /// initialize).
    /// </summary>
    sealed class ProcedureCommands
    {
        readonly HashSet<ILocalSymbol> locals = new(SymbolEqualityComparer.Default);
        readonly HashSet<IObjectCreationOperation> creations = new(ReferenceEqualityComparer.Instance);

        public ProcedureCommands(IEnumerable<IOperation> operations)
        {
            foreach (var op in operations)
            {
                if (op is not ISimpleAssignmentOperation { Target: IPropertyReferenceOperation property } assignment) continue;
                if (!string.Equals(property.Property.Name, "CommandType", StringComparison.Ordinal)) continue;
                if (!KnownSqlApis.IsCommandType(property.Property.ContainingType)) continue;
                if (!KnownSqlApis.IsStoredProcedure(assignment.Value)) continue;

                switch (property.Instance)
                {
                    case ILocalReferenceOperation local:
                        locals.Add(local.Local);
                        break;
                    case IInstanceReferenceOperation { ReferenceKind: InstanceReferenceKind.ImplicitReceiver }
                        when InitializedCreation(assignment) is { } creation:
                        creations.Add(creation);
                        if (LocalOf(creation) is { } initialized) locals.Add(initialized);
                        break;
                }
            }
        }

        /// <summary>True for a command created here whose CommandType is StoredProcedure.</summary>
        public bool IsProcedure(IObjectCreationOperation creation) =>
            creations.Contains(creation) || (LocalOf(creation) is { } local && locals.Contains(local));

        /// <summary>True when the command of a <c>CommandText</c> assignment has CommandType StoredProcedure.</summary>
        public bool IsProcedure(IPropertyReferenceOperation property) => property.Instance switch
        {
            ILocalReferenceOperation local => locals.Contains(local.Local),
            IInstanceReferenceOperation { ReferenceKind: InstanceReferenceKind.ImplicitReceiver }
                when property.Parent is ISimpleAssignmentOperation assignment && InitializedCreation(assignment) is { } creation
                => IsProcedure(creation),
            _ => false,
        };

        /// <summary>The object creation whose initializer holds an assignment, or null.</summary>
        static IObjectCreationOperation? InitializedCreation(ISimpleAssignmentOperation assignment) =>
            assignment.Parent is IObjectOrCollectionInitializerOperation { Parent: IObjectCreationOperation creation }
                ? creation
                : null;

        /// <summary>The local a creation initializes or is assigned to, through conversions; null otherwise.</summary>
        static ILocalSymbol? LocalOf(IObjectCreationOperation creation)
        {
            IOperation current = creation;
            var parent = creation.Parent;
            while (parent is IConversionOperation)
            {
                current = parent;
                parent = parent.Parent;
            }
            return parent switch
            {
                IVariableInitializerOperation { Parent: IVariableDeclaratorOperation declarator } => declarator.Symbol,
                ISimpleAssignmentOperation { Target: ILocalReferenceOperation target } assignment
                    when ReferenceEquals(assignment.Value, current) => target.Local,
                _ => null,
            };
        }
    }
}
