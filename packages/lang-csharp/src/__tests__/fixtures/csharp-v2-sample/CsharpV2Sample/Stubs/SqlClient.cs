// Stand-ins for the Microsoft.Data.SqlClient types, so the fixture needs no
// NuGet restore. Only the type, member and parameter names match the real
// library; the bodies are empty so they hold no SQL call sites themselves.
using System.Data;

namespace Microsoft.Data.SqlClient;

public sealed class SqlConnection
{
    public SqlConnection(string connectionString)
    {
    }
}

public sealed class SqlCommand
{
    public SqlCommand()
    {
    }

    public SqlCommand(string cmdText, SqlConnection connection)
    {
    }

    public string CommandText { get; set; } = "";

    public CommandType CommandType { get; set; }

    public int ExecuteNonQuery() => 0;
}

public sealed class SqlBulkCopy
{
    public SqlBulkCopy(SqlConnection connection)
    {
    }

    public string DestinationTableName { get; set; } = "";

    public void WriteToServer(DataTable table)
    {
    }
}
