// Route prefix fixture: a group passed to an extension method declared in another file.
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;

namespace Lending.Routes
{
    public static class UserEndpoints
    {
        public static void MapUsers(this RouteGroupBuilder users)
        {
            users.MapGet("/{id}", (int id) => id);
            users.MapGroup("/admin").MapPost("/ban", () => 0);
        }
    }
}
