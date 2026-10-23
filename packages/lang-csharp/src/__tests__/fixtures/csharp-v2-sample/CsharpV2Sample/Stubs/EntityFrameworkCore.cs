// Stand-ins for the EF Core raw SQL API, so the fixture needs no NuGet
// restore. Only the type, member and parameter names match the real library.
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Microsoft.EntityFrameworkCore
{
    public class DbContext
    {
        public virtual DatabaseFacade Database => throw new NotSupportedException();

        public virtual DbSet<TEntity> Set<TEntity>() where TEntity : class => throw new NotSupportedException();
    }

    public abstract class DbSet<TEntity> where TEntity : class
    {
    }

    public static class RelationalQueryableExtensions
    {
        public static IQueryable<TEntity> FromSqlRaw<TEntity>(this DbSet<TEntity> source, string sql, params object[] parameters)
            where TEntity : class =>
            throw new NotSupportedException();
    }

    public static class RelationalDatabaseFacadeExtensions
    {
        public static int ExecuteSqlRaw(this DatabaseFacade databaseFacade, string sql, params object[] parameters) =>
            throw new NotSupportedException();
    }
}

namespace Microsoft.EntityFrameworkCore.Infrastructure
{
    public class DatabaseFacade
    {
    }
}
