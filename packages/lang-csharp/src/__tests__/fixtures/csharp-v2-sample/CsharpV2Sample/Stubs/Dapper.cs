// A stand-in for Dapper's SqlMapper and CommandDefinition, so the fixture needs
// no NuGet restore. Only the type, member and parameter names match the real library.
using System.Data;

namespace Dapper;

[Flags]
public enum CommandFlags
{
    None = 0,
    Buffered = 1,
    Pipelined = 2,
    NoCache = 4,
}

public readonly struct CommandDefinition
{
    public CommandDefinition(string commandText, object? parameters = null, IDbTransaction? transaction = null, int? commandTimeout = null, CommandType? commandType = null, CommandFlags flags = CommandFlags.Buffered, CancellationToken cancellationToken = default)
    {
    }
}

public static class SqlMapper
{
    public static IEnumerable<T> Query<T>(this IDbConnection cnn, string sql, object? param = null, IDbTransaction? transaction = null, bool buffered = true, int? commandTimeout = null, CommandType? commandType = null) =>
        throw new NotSupportedException();

    public static IEnumerable<T> Query<T>(this IDbConnection cnn, CommandDefinition command) =>
        throw new NotSupportedException();

    public static int Execute(this IDbConnection cnn, string sql, object? param = null, IDbTransaction? transaction = null, int? commandTimeout = null, CommandType? commandType = null) =>
        throw new NotSupportedException();

    public static int Execute(this IDbConnection cnn, CommandDefinition command) =>
        throw new NotSupportedException();
}
