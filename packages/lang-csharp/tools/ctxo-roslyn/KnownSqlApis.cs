using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Operations;

// ── Known SQL APIs ───────────────────────────────────────────────────

/// <summary>Where a known API takes its SQL text.</summary>
enum SqlSite
{
    /// <summary>A constructor argument, matched by parameter name.</summary>
    Constructor,
    /// <summary>A method argument, matched by parameter name.</summary>
    Method,
    /// <summary>The value assigned to a property.</summary>
    PropertyAssignment,
}

/// <summary>When the text names a procedure instead of holding statements.</summary>
enum SqlProcedureWhen
{
    Never,
    /// <summary>The command's <c>CommandType</c> is set to <c>StoredProcedure</c> in the same method.</summary>
    CommandTypeProperty,
    /// <summary>The call's or constructor's <c>commandType</c> argument is <c>CommandType.StoredProcedure</c>.</summary>
    CommandTypeArgument,
}

/// <summary>What the text is when it does not name a procedure.</summary>
enum SqlTextForm
{
    /// <summary>T-SQL statements.</summary>
    Statements,
    /// <summary>T-SQL statements with composite-format placeholders (<c>{0}</c>) that the library turns into parameters.</summary>
    FormatStatements,
    /// <summary>One table name, which the call writes.</summary>
    WrittenTableName,
}

/// <summary>
/// One known data-access call site. <see cref="Types"/> are full metadata
/// names; with <see cref="IncludeDerived"/> a type deriving from or
/// implementing one of them also matches. A member matches by exact name or,
/// for <see cref="MemberPrefixes"/>, by prefix (ordinal). Constructors have no
/// member names.
/// </summary>
sealed record KnownSqlApi(
    string[] Types,
    bool IncludeDerived,
    SqlSite Site,
    string[] Members,
    string[] MemberPrefixes,
    string? Parameter,
    SqlProcedureWhen ProcedureWhen,
    SqlTextForm Form);

/// <summary>
/// The data-access APIs whose constant SQL text becomes reads, writes and
/// executes edges: ADO.NET commands, Dapper, SqlBulkCopy and EF Core raw SQL.
/// Every comparison is ordinal.
/// </summary>
static class KnownSqlApis
{
    const string CommandTypeEnum = "System.Data.CommandType";

    static readonly string[] SqlCommandTypes =
    [
        "Microsoft.Data.SqlClient.SqlCommand",
        "System.Data.SqlClient.SqlCommand",
    ];

    static readonly string[] CommandTypes =
    [
        .. SqlCommandTypes,
        "System.Data.Common.DbCommand",
        "System.Data.IDbCommand",
    ];

    public static readonly KnownSqlApi[] All =
    [
        new(SqlCommandTypes, IncludeDerived: false, SqlSite.Constructor,
            Members: [], MemberPrefixes: [], Parameter: "cmdText",
            SqlProcedureWhen.CommandTypeProperty, SqlTextForm.Statements),
        new(CommandTypes, IncludeDerived: true, SqlSite.PropertyAssignment,
            Members: ["CommandText"], MemberPrefixes: [], Parameter: null,
            SqlProcedureWhen.CommandTypeProperty, SqlTextForm.Statements),
        new(["Dapper.SqlMapper"], IncludeDerived: false, SqlSite.Method,
            Members: [], MemberPrefixes: ["Query", "Execute"], Parameter: "sql",
            SqlProcedureWhen.CommandTypeArgument, SqlTextForm.Statements),
        // The SqlMapper overloads that take a CommandDefinition have no `sql`
        // parameter, so the struct's constructor is the call site that carries the text.
        new(["Dapper.CommandDefinition"], IncludeDerived: false, SqlSite.Constructor,
            Members: [], MemberPrefixes: [], Parameter: "commandText",
            SqlProcedureWhen.CommandTypeArgument, SqlTextForm.Statements),
        new(["Microsoft.Data.SqlClient.SqlBulkCopy", "System.Data.SqlClient.SqlBulkCopy"], IncludeDerived: false, SqlSite.PropertyAssignment,
            Members: ["DestinationTableName"], MemberPrefixes: [], Parameter: null,
            SqlProcedureWhen.Never, SqlTextForm.WrittenTableName),
        new(["Microsoft.EntityFrameworkCore.RelationalQueryableExtensions"], IncludeDerived: false, SqlSite.Method,
            Members: ["FromSqlRaw"], MemberPrefixes: [], Parameter: "sql",
            SqlProcedureWhen.Never, SqlTextForm.FormatStatements),
        new(["Microsoft.EntityFrameworkCore.RelationalDatabaseFacadeExtensions"], IncludeDerived: false, SqlSite.Method,
            Members: ["ExecuteSqlRaw", "ExecuteSqlRawAsync", "SqlQueryRaw"], MemberPrefixes: [], Parameter: "sql",
            SqlProcedureWhen.Never, SqlTextForm.FormatStatements),
    ];

    /// <summary>The known API for a member of <paramref name="containingType"/> at a site, or null.</summary>
    public static KnownSqlApi? Find(SqlSite site, INamedTypeSymbol? containingType, string memberName)
    {
        if (containingType == null) return null;
        foreach (var api in All)
        {
            if (api.Site != site || !MemberMatches(api, memberName)) continue;
            if (TypeMatches(containingType, api.Types, api.IncludeDerived)) return api;
        }
        return null;
    }

    /// <summary>True for a type whose <c>CommandType</c> property decides whether its text is a procedure.</summary>
    public static bool IsCommandType(INamedTypeSymbol? type) =>
        type != null && TypeMatches(type, CommandTypes, includeDerived: true);

    /// <summary>
    /// True when the value, after its conversions, is the constant
    /// <c>System.Data.CommandType.StoredProcedure</c>.
    /// </summary>
    public static bool IsStoredProcedure(IOperation? value)
    {
        for (var op = value; op != null; op = (op as IConversionOperation)?.Operand)
        {
            if (op.Type is INamedTypeSymbol { TypeKind: TypeKind.Enum } type
                && string.Equals(FullName(type), CommandTypeEnum, StringComparison.Ordinal)
                && op.ConstantValue.HasValue)
            {
                var constant = op.ConstantValue.Value;
                foreach (var member in type.GetMembers("StoredProcedure"))
                {
                    if (member is IFieldSymbol { HasConstantValue: true } field && Equals(field.ConstantValue, constant))
                        return true;
                }
                return false;
            }
        }
        return false;
    }

    static bool MemberMatches(KnownSqlApi api, string memberName)
    {
        if (api.Site == SqlSite.Constructor) return true;
        foreach (var member in api.Members)
        {
            if (string.Equals(member, memberName, StringComparison.Ordinal)) return true;
        }
        foreach (var prefix in api.MemberPrefixes)
        {
            if (memberName.StartsWith(prefix, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    static bool TypeMatches(INamedTypeSymbol type, string[] names, bool includeDerived)
    {
        if (Contains(names, FullName(type))) return true;
        if (!includeDerived) return false;
        for (var baseType = type.BaseType; baseType != null; baseType = baseType.BaseType)
        {
            if (Contains(names, FullName(baseType))) return true;
        }
        foreach (var iface in type.AllInterfaces)
        {
            if (Contains(names, FullName(iface))) return true;
        }
        return false;
    }

    static bool Contains(string[] names, string name)
    {
        foreach (var candidate in names)
        {
            if (string.Equals(candidate, name, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    /// <summary>Namespace-qualified metadata name (<c>Dapper.SqlMapper</c>); nested types use <c>+</c>.</summary>
    static string FullName(INamedTypeSymbol type)
    {
        var original = type.OriginalDefinition;
        if (original.ContainingType != null) return FullName(original.ContainingType) + "+" + original.MetadataName;
        var ns = original.ContainingNamespace;
        return ns == null || ns.IsGlobalNamespace
            ? original.MetadataName
            : ns.ToDisplayString() + "." + original.MetadataName;
    }
}
