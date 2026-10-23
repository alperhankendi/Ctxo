using System.Text;
using Microsoft.SqlServer.TransactSql.ScriptDom;

// ── SQL Text (ScriptDom) ─────────────────────────────────────────────

/// <summary>
/// Reads, writes and executes in T-SQL text, parsed by ScriptDom under the
/// "SQL extraction rules" that @ctxo/sql-extract implements on the
/// TypeScript side. The conformance corpus in packages/sql-extract/corpus
/// keeps the two parsers in agreement. Every comparison is ordinal and name
/// folding touches ASCII A-Z only, so the canonical names match sql-extract
/// byte for byte.
/// </summary>
static class SqlText
{
    /// <summary>Canonical <c>schema.name</c> sets (ordinal) and the parser's error count.</summary>
    public sealed record Accesses(SortedSet<string> Reads, SortedSet<string> Writes, SortedSet<string> Executes, int Errors);

    const string DefaultSchema = "dbo";
    const char ByteOrderMark = '\uFEFF';

    /// <summary>
    /// The accesses of a statement or a script. Text the parser rejects gives
    /// no accesses and its error count. An exception from the parser counts as
    /// one error and is written to stderr on one line.
    /// </summary>
    public static Accesses Extract(string sql)
    {
        var reads = new SortedSet<string>(StringComparer.Ordinal);
        var writes = new SortedSet<string>(StringComparer.Ordinal);
        var executes = new SortedSet<string>(StringComparer.Ordinal);

        var text = RewriteDapperLists(WithoutByteOrderMark(sql));
        TSqlFragment? fragment;
        IList<ParseError> errors;
        try
        {
            fragment = NewParser().Parse(new StringReader(text), out errors);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ctxo-roslyn] ScriptDom failed on SQL text: {OneLine($"{ex.GetType().Name}: {ex.Message}")}");
            return new Accesses(reads, writes, executes, 1);
        }
        if (errors.Count > 0 || fragment == null)
            return new Accesses(reads, writes, executes, errors.Count);

        var nodes = new NodeCollector();
        fragment.Accept(nodes);

        // CTE names scope to the statement that declares them.
        var cteReferences = new HashSet<NamedTableReference>(ReferenceEqualityComparer.Instance);
        foreach (var statement in nodes.CteStatements)
        {
            var cteNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var cte in statement.WithCtesAndXmlNamespaces.CommonTableExpressions)
            {
                if (cte.ExpressionName?.Value is { } cteName) cteNames.Add(FoldAsciiLower(cteName));
            }
            var inner = new NodeCollector();
            statement.Accept(inner);
            foreach (var table in inner.Tables)
            {
                if (OnePart(table) is { } part && cteNames.Contains(FoldAsciiLower(part)))
                    cteReferences.Add(table);
            }
        }

        // Write targets first; a target is never also a read.
        var targets = new HashSet<NamedTableReference>(ReferenceEqualityComparer.Instance);
        foreach (var spec in nodes.Modifications)
        {
            if (spec.Target is NamedTableReference target)
            {
                targets.Add(target);
                var written = spec is UpdateDeleteSpecificationBase updateOrDelete
                    ? ResolveAlias(target, updateOrDelete.FromClause)
                    : target;
                if (written != null && !cteReferences.Contains(written) && CanonicalName(written.SchemaObject) is { } name)
                    writes.Add(name);
            }
            if (spec.OutputIntoClause?.IntoTable is NamedTableReference outputTarget)
            {
                targets.Add(outputTarget);
                if (CanonicalName(outputTarget.SchemaObject) is { } name) writes.Add(name);
            }
        }
        foreach (var into in nodes.SelectIntoTargets)
        {
            if (CanonicalName(into) is { } name) writes.Add(name);
        }
        foreach (var truncated in nodes.TruncatedTables)
        {
            if (CanonicalName(truncated) is { } name) writes.Add(name);
        }
        foreach (var bulkTarget in nodes.BulkInsertTargets)
        {
            if (CanonicalName(bulkTarget) is { } name) writes.Add(name);
        }

        foreach (var table in nodes.Tables)
        {
            if (targets.Contains(table) || cteReferences.Contains(table)) continue;
            if (CanonicalName(table.SchemaObject) is { } name) reads.Add(name);
        }

        foreach (var execute in nodes.Executes)
        {
            // A bare procedure name at the start of a batch also parses as an
            // execute, but only EXEC and EXECUTE are accesses.
            if (!StartsWithExecKeyword(execute)) continue;
            if (execute.ExecutableEntity is ExecutableProcedureReference procedure
                && procedure.ProcedureReference?.ProcedureReference?.Name is { } procedureName
                && CanonicalName(procedureName) is { } name)
            {
                executes.Add(name);
            }
        }

        return new Accesses(reads, writes, executes, 0);
    }

    /// <summary>
    /// Canonical <c>schema.name</c> of a parsed name, or null when the Names
    /// rule skips it: 3- and 4-part names, empty parts, parts containing
    /// <c>.</c> or <c>::</c>, temp tables, table variables and the sys and
    /// information_schema schemas. Like sql-extract, a name never starts with
    /// an unquoted reserved word (ScriptDom accepts a few, such as DISK).
    /// </summary>
    public static string? CanonicalName(SchemaObjectName? name)
    {
        var identifiers = name?.Identifiers;
        if (identifiers == null || identifiers.Count < 1 || identifiers.Count > 2) return null;
        if (IsUnquotedReservedWord(identifiers[0])) return null;
        var parts = new List<string>(identifiers.Count);
        foreach (var identifier in identifiers)
        {
            if (identifier?.Value == null) return null;
            parts.Add(identifier.Value);
        }
        return CanonicalFromParts(parts);
    }

    /// <summary>
    /// Canonical name of a multipart name text such as <c>[dbo].[Loans]</c>
    /// (a procedure name sent as is), or null when the text is not exactly
    /// one name or the Names rule skips it. No part may be an unquoted
    /// reserved word.
    /// </summary>
    public static string? CanonicalName(string multipartText)
    {
        try
        {
            var parser = NewParser();
            var text = QuoteGoWords(parser, WithoutByteOrderMark(multipartText));
            if (text == null) return null;
            var name = parser.ParseSchemaObjectName(new StringReader(text), out var errors);
            if (errors.Count > 0 || name?.Identifiers == null) return null;
            foreach (var identifier in name.Identifiers)
            {
                if (IsUnquotedReservedWord(identifier)) return null;
            }
            return CanonicalName(name);
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>The newest parser of the pinned ScriptDom package, with QUOTED_IDENTIFIER on.</summary>
    static TSqlParser NewParser() => new TSql180Parser(initialQuotedIdentifiers: true);

    /// <summary>
    /// The T-SQL reserved keywords, as sql-extract's <c>RESERVED_WORDS</c>
    /// (packages/sql-extract/src/keywords.ts; a test keeps the two equal).
    /// </summary>
    static readonly HashSet<string> ReservedWords = new(StringComparer.Ordinal)
    {
        "ADD", "ALL", "ALTER", "AND", "ANY", "AS", "ASC", "AUTHORIZATION", "BACKUP", "BEGIN", "BETWEEN",
        "BREAK", "BROWSE", "BULK", "BY", "CASCADE", "CASE", "CHECK", "CHECKPOINT", "CLOSE", "CLUSTERED",
        "COALESCE", "COLLATE", "COLUMN", "COMMIT", "COMPUTE", "CONSTRAINT", "CONTAINS", "CONTAINSTABLE",
        "CONTINUE", "CONVERT", "CREATE", "CROSS", "CURRENT", "CURRENT_DATE", "CURRENT_TIME",
        "CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR", "DATABASE", "DBCC", "DEALLOCATE", "DECLARE",
        "DEFAULT", "DELETE", "DENY", "DESC", "DISK", "DISTINCT", "DISTRIBUTED", "DOUBLE", "DROP", "DUMP",
        "ELSE", "END", "ERRLVL", "ESCAPE", "EXCEPT", "EXEC", "EXECUTE", "EXISTS", "EXIT", "EXTERNAL",
        "FETCH", "FILE", "FILLFACTOR", "FOR", "FOREIGN", "FREETEXT", "FREETEXTTABLE", "FROM", "FULL",
        "FUNCTION", "GOTO", "GRANT", "GROUP", "HAVING", "HOLDLOCK", "IDENTITY", "IDENTITY_INSERT",
        "IDENTITYCOL", "IF", "IN", "INDEX", "INNER", "INSERT", "INTERSECT", "INTO", "IS", "JOIN", "KEY",
        "KILL", "LEFT", "LIKE", "LINENO", "LOAD", "MERGE", "NATIONAL", "NOCHECK", "NONCLUSTERED", "NOT",
        "NULL", "NULLIF", "OF", "OFF", "OFFSETS", "ON", "OPEN", "OPENDATASOURCE", "OPENQUERY",
        "OPENROWSET", "OPENXML", "OPTION", "OR", "ORDER", "OUTER", "OVER", "PERCENT", "PIVOT", "PLAN",
        "PRECISION", "PRIMARY", "PRINT", "PROC", "PROCEDURE", "PUBLIC", "RAISERROR", "READ", "READTEXT",
        "RECONFIGURE", "REFERENCES", "REPLICATION", "RESTORE", "RESTRICT", "RETURN", "REVERT", "REVOKE",
        "RIGHT", "ROLLBACK", "ROWCOUNT", "ROWGUIDCOL", "RULE", "SAVE", "SCHEMA", "SECURITYAUDIT", "SELECT",
        "SEMANTICKEYPHRASETABLE", "SEMANTICSIMILARITYDETAILSTABLE", "SEMANTICSIMILARITYTABLE",
        "SESSION_USER", "SET", "SETUSER", "SHUTDOWN", "SOME", "STATISTICS", "SYSTEM_USER", "TABLE",
        "TABLESAMPLE", "TEXTSIZE", "THEN", "TO", "TOP", "TRAN", "TRANSACTION", "TRIGGER", "TRUNCATE",
        "TRY_CONVERT", "TSEQUAL", "UNION", "UNIQUE", "UNPIVOT", "UPDATE", "UPDATETEXT", "USE", "USER",
        "VALUES", "VARYING", "VIEW", "WAITFOR", "WHEN", "WHERE", "WHILE", "WITH", "WITHIN", "WRITETEXT",
    };

    static bool IsUnquotedReservedWord(Identifier? identifier) =>
        identifier is { QuoteType: QuoteType.NotQuoted, Value: { } value } && ReservedWords.Contains(FoldAsciiUpper(value));

    /// <summary>
    /// ScriptDom lexes every unquoted GO as a batch separator, which no name
    /// accepts, while sql-extract reads GO as a separator only alone on its
    /// line (optional count, optional trailing <c>--</c> comment) and as a
    /// word elsewhere. Null when the text holds a separator line, else the
    /// text with every other GO bracket-quoted.
    /// </summary>
    static string? QuoteGoWords(TSqlParser parser, string text)
    {
        var tokens = parser.GetTokenStream(new StringReader(text), out var errors);
        if (errors.Count > 0) return null;
        StringBuilder? quoted = null;
        var copied = 0;
        foreach (var token in tokens)
        {
            if (token.TokenType != TSqlTokenType.Go) continue;
            var end = token.Offset + token.Text.Length;
            if (IsBatchSeparatorLine(text, token.Offset, end)) return null;
            quoted ??= new StringBuilder(text.Length + 8);
            quoted.Append(text, copied, token.Offset - copied).Append('[').Append(token.Text).Append(']');
            copied = end;
        }
        return quoted == null ? text : quoted.Append(text, copied, text.Length - copied).ToString();
    }

    /// <summary>sql-extract's GO line rule for the GO at [start, end).</summary>
    static bool IsBatchSeparatorLine(string text, int start, int end)
    {
        for (var k = start - 1; k >= 0 && text[k] != '\n'; k--)
        {
            if (!IsBlank(text[k]) && text[k] != '\r' && text[k] != ByteOrderMark) return false;
        }
        var i = end;
        while (i < text.Length && IsBlank(text[i])) i++;
        if (i < text.Length && IsAsciiDigit(text[i]))
        {
            while (i < text.Length && IsAsciiDigit(text[i])) i++;
            while (i < text.Length && IsBlank(text[i])) i++;
        }
        if (i >= text.Length || text[i] == '\n' || text[i] == '\r') return true;
        return text[i] == '-' && i + 1 < text.Length && text[i + 1] == '-';
    }

    static bool IsBlank(char c) => c == ' ' || c == '\t' || c == '\f' || c == '\v';

    static bool IsAsciiDigit(char c) => c >= '0' && c <= '9';

    static string? CanonicalFromParts(IReadOnlyList<string> parts)
    {
        if (parts.Count < 1 || parts.Count > 2) return null;
        foreach (var part in parts)
        {
            if (part.Length == 0 || part.Contains("::", StringComparison.Ordinal) || part.Contains('.')) return null;
        }
        var name = parts[^1];
        if (name.StartsWith('#') || name.StartsWith('@')) return null;
        var schema = FoldAsciiLower(parts.Count == 2 ? parts[0] : DefaultSchema);
        if (string.Equals(schema, "sys", StringComparison.Ordinal)
            || string.Equals(schema, "information_schema", StringComparison.Ordinal))
        {
            return null;
        }
        return schema + "." + FoldAsciiLower(name);
    }

    /// <summary>Folds ASCII A-Z to lowercase and keeps every other character (no culture or Unicode folding).</summary>
    static string FoldAsciiLower(string text)
    {
        var chars = text.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] >= 'A' && chars[i] <= 'Z') chars[i] = (char)(chars[i] + ('a' - 'A'));
        }
        return new string(chars);
    }

    /// <summary>Folds ASCII a-z to uppercase and keeps every other character.</summary>
    static string FoldAsciiUpper(string text)
    {
        var chars = text.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] >= 'a' && chars[i] <= 'z') chars[i] = (char)(chars[i] - ('a' - 'A'));
        }
        return new string(chars);
    }

    static string WithoutByteOrderMark(string text) =>
        text.Length > 0 && text[0] == ByteOrderMark ? text[1..] : text;

    /// <summary>The text with every line break turned into a space.</summary>
    static string OneLine(string text) => text.Replace("\r\n", " ", StringComparison.Ordinal).Replace('\r', ' ').Replace('\n', ' ');

    /// <summary>The single part of a one-part name, else null.</summary>
    static string? OnePart(NamedTableReference table) =>
        table.SchemaObject?.Identifiers is { Count: 1 } ids ? ids[0]?.Value : null;

    /// <summary>
    /// A one-part UPDATE or DELETE target equal to an alias of the same
    /// statement's FROM clause (ASCII case-insensitive) is the aliased table,
    /// or nothing when the alias names a derived table, a table variable or a
    /// function. Any other target is itself.
    /// </summary>
    static NamedTableReference? ResolveAlias(NamedTableReference target, FromClause? from)
    {
        if (from == null || OnePart(target) is not { } part) return target;
        // An unquoted reserved word is no name and no alias for sql-extract.
        if (IsUnquotedReservedWord(target.SchemaObject.Identifiers[0])) return target;
        var wanted = FoldAsciiLower(part);
        foreach (var source in from.TableReferences)
        {
            if (FindAlias(source, wanted, out var aliased)) return aliased;
        }
        return target;
    }

    /// <summary>Looks for an alias in a FROM item, through joins and parenthesized joins (not into derived tables).</summary>
    static bool FindAlias(TableReference? reference, string wanted, out NamedTableReference? aliased)
    {
        aliased = null;
        switch (reference)
        {
            case JoinParenthesisTableReference parenthesized:
                return FindAlias(parenthesized.Join, wanted, out aliased);
            case JoinTableReference join:
                return FindAlias(join.FirstTableReference, wanted, out aliased)
                    || FindAlias(join.SecondTableReference, wanted, out aliased);
            case TableReferenceWithAlias withAlias
                when withAlias.Alias?.Value is { } alias && string.Equals(FoldAsciiLower(alias), wanted, StringComparison.Ordinal):
                aliased = withAlias as NamedTableReference;
                return true;
            default:
                return false;
        }
    }

    static bool StartsWithExecKeyword(ExecuteSpecification execute)
    {
        var tokens = execute.ScriptTokenStream;
        if (tokens == null || execute.FirstTokenIndex < 0 || execute.FirstTokenIndex >= tokens.Count) return false;
        var first = FoldAsciiLower(tokens[execute.FirstTokenIndex].Text ?? "");
        return string.Equals(first, "exec", StringComparison.Ordinal)
            || string.Equals(first, "execute", StringComparison.Ordinal);
    }

    /// <summary>
    /// Dapper expands a list parameter written <c>IN @ids</c> or <c>IN@ids</c>,
    /// which T-SQL rejects, so <c>IN @p</c> becomes <c>IN (@p)</c> and
    /// <c>IN@p</c> becomes <c>IN(@p)</c> before parsing. Only code is
    /// rewritten: strings, comments and delimited names are kept.
    /// </summary>
    static string RewriteDapperLists(string sql)
    {
        StringBuilder? rewritten = null;
        var copied = 0;
        var i = 0;
        while (i < sql.Length)
        {
            var c = sql[i];
            if (IsCommentStart(sql, i)) { i = SkipComment(sql, i); continue; }
            if (c == '\'' || c == '"' || c == '[')
            {
                i = SkipDelimited(sql, i, c == '[' ? ']' : c);
                continue;
            }
            if (!IsWordChar(c)) { i++; continue; }

            var start = i;
            while (i < sql.Length && IsWordChar(sql[i])) i++;
            if (i - start < 2 || (sql[start] | 0x20) != 'i' || (sql[start + 1] | 0x20) != 'n') continue;

            // `@` is a word character, so `IN@p` reads as one word that starts with IN.
            int variable;
            if (i - start == 2) variable = SkipTrivia(sql, i);
            else if (sql[start + 2] == '@') variable = start + 2;
            else continue;
            if (variable + 1 >= sql.Length || sql[variable] != '@' || sql[variable + 1] == '@' || !IsWordChar(sql[variable + 1]))
                continue;
            var end = variable + 1;
            while (end < sql.Length && IsWordChar(sql[end])) end++;

            rewritten ??= new StringBuilder(sql.Length + 8);
            rewritten.Append(sql, copied, variable - copied).Append('(').Append(sql, variable, end - variable).Append(')');
            copied = end;
            i = end;
        }
        if (rewritten == null) return sql;
        return rewritten.Append(sql, copied, sql.Length - copied).ToString();
    }

    static bool IsWordChar(char c) => char.IsLetterOrDigit(c) || c == '_' || c == '@' || c == '#' || c == '$';

    static bool IsCommentStart(string sql, int i) =>
        i + 1 < sql.Length && ((sql[i] == '-' && sql[i + 1] == '-') || (sql[i] == '/' && sql[i + 1] == '*'));

    /// <summary>The index after a line comment or a (nested) block comment starting at <paramref name="i"/>.</summary>
    static int SkipComment(string sql, int i)
    {
        if (sql[i] == '-')
        {
            var newline = sql.IndexOf('\n', i);
            return newline < 0 ? sql.Length : newline + 1;
        }
        var depth = 0;
        while (i < sql.Length)
        {
            if (i + 1 < sql.Length && sql[i] == '/' && sql[i + 1] == '*') { depth++; i += 2; }
            else if (i + 1 < sql.Length && sql[i] == '*' && sql[i + 1] == '/') { depth--; i += 2; if (depth == 0) return i; }
            else i++;
        }
        return sql.Length;
    }

    /// <summary>The index after a string or delimited name opened at <paramref name="i"/>; a doubled closer is an escape.</summary>
    static int SkipDelimited(string sql, int i, char closer)
    {
        i++;
        while (i < sql.Length)
        {
            if (sql[i] != closer) { i++; continue; }
            if (i + 1 < sql.Length && sql[i + 1] == closer) { i += 2; continue; }
            return i + 1;
        }
        return sql.Length;
    }

    static int SkipTrivia(string sql, int i)
    {
        while (i < sql.Length)
        {
            if (char.IsWhiteSpace(sql[i])) i++;
            else if (IsCommentStart(sql, i)) i = SkipComment(sql, i);
            else break;
        }
        return i;
    }

    /// <summary>Collects the nodes the access rules look at, in one pass over a fragment.</summary>
    sealed class NodeCollector : TSqlFragmentVisitor
    {
        public readonly List<NamedTableReference> Tables = [];
        public readonly List<DataModificationSpecification> Modifications = [];
        public readonly List<SchemaObjectName> SelectIntoTargets = [];
        public readonly List<SchemaObjectName> TruncatedTables = [];
        public readonly List<SchemaObjectName> BulkInsertTargets = [];
        public readonly List<ExecuteSpecification> Executes = [];
        public readonly List<StatementWithCtesAndXmlNamespaces> CteStatements = [];

        public override void Visit(NamedTableReference node) => Tables.Add(node);
        public override void Visit(DataModificationSpecification node) => Modifications.Add(node);
        public override void Visit(TruncateTableStatement node) { if (node.TableName != null) TruncatedTables.Add(node.TableName); }
        public override void Visit(BulkInsertStatement node) { if (node.To != null) BulkInsertTargets.Add(node.To); }
        public override void Visit(ExecuteSpecification node) => Executes.Add(node);

        public override void Visit(SelectStatement node)
        {
            if (node.Into != null) SelectIntoTargets.Add(node.Into);
        }

        public override void Visit(StatementWithCtesAndXmlNamespaces node)
        {
            if (node.WithCtesAndXmlNamespaces?.CommonTableExpressions is { Count: > 0 }) CteStatements.Add(node);
        }
    }
}
