// Route prefix fixture: MapGroup prefixes resolved through the semantic model (Roslyn tier only).
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;

namespace Lending.Routes
{
    public static class GroupEndpoints
    {
        public static void Map(WebApplication app)
        {
            var api = app.MapGroup("/api");
            api.MapGet("/status", () => 0);
            var v1 = api.MapGroup("v1/");
            v1.MapPost("/loans", () => 0);
            app.MapGroup("/inline").MapGet("/chained", () => 0);
            app.MapGroup("/users").MapUsers();
            app.MapGroup("/a").MapShared();
            app.MapGroup("/b").MapShared();
            var moved = app.MapGroup("/first");
            moved = app.MapGroup("/second");
            moved.MapGet("/reassigned", () => 0);
            Opaque(app).MapGet("/opaque", () => 0);
            app.MapGroup(Prefix()).MapGet("/dynamic", () => 0);
            app.MapGet("/root", () => 0);
        }

        static RouteGroupBuilder Opaque(WebApplication app) => app.MapGroup("/hidden");

        static string Prefix() => "/dyn";

        public static void MapShared(this RouteGroupBuilder group)
        {
            group.MapGet("/shared", () => 0);
        }

        public static void MapNowhere(this IEndpointRouteBuilder routes)
        {
            routes.MapGet("/nowhere", () => 0);
        }
    }
}
