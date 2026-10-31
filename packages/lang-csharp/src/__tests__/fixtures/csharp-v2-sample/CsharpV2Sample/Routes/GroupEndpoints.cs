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

            // Fluent ASP.NET conventions return their receiver; a project's own call does not count.
            var tagged = app.MapGroup("/tagged").WithTags("x").RequireAuthorization();
            tagged.MapGet("/t", () => 0);
            app.MapGroup("/detached").Detached().MapGet("/d", () => 0);
            app.MapGroup("/same").SameShape().MapGet("/s", () => 0);

            // Written again in other forms: deconstruction, ??=, out.
            var dec = app.MapGroup("/d1");
            (dec, _) = (app.MapGroup("/d2"), 1);
            dec.MapGet("/decon", () => 0);
            RouteGroupBuilder? maybe = app.MapGroup("/m1");
            maybe ??= app.MapGroup("/m2");
            maybe.MapGet("/coalesce", () => 0);
            var viaOut = app.MapGroup("/o1");
            Replace(out viaOut, app);
            viaOut.MapGet("/out", () => 0);
            var fe = app.MapGroup("/f1");
            foreach ((fe, _) in Pairs(app))
            {
            }
            fe.MapGet("/foreachdecon", () => 0);

            // A generic builder receiver is never followed.
            app.MapGroup("/gen").MapGeneric();
        }

        static void Replace(out RouteGroupBuilder group, WebApplication app) => group = app.MapGroup("/o2");

        static (RouteGroupBuilder, int)[] Pairs(WebApplication app) => [(app.MapGroup("/f2"), 1)];

        static RouteGroupBuilder Detached(this RouteGroupBuilder group) => group;

        static TBuilder SameShape<TBuilder>(this TBuilder builder) where TBuilder : IEndpointRouteBuilder => builder;

        static TBuilder MapGeneric<TBuilder>(this TBuilder builder) where TBuilder : IEndpointRouteBuilder
        {
            builder.MapGroup("/admin").MapPost("/generic", () => 0);
            return builder;
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
