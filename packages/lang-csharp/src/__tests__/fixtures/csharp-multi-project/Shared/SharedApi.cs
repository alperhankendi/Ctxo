// A library project the App project references: a base controller, a test attribute and group extensions.
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Shared.Tests")]

namespace Shared
{
    [Route("api/[controller]")]
    public abstract class SharedControllerBase : ControllerBase
    {
    }

    public class RetryFactAttribute : Xunit.FactAttribute
    {
    }

    public static class SharedEndpoints
    {
        public static void Register(WebApplication app)
        {
            app.MapGroup("/s").MapPublic();
            app.MapGroup("/s").MapInternal();
            app.MapGroup("/q").MapQuiet();
            app.MapGroup("/f").MapFriend();
        }

        // Internal, but Shared.Tests calls it through InternalsVisibleTo: not followed.
        internal static void MapFriend(this RouteGroupBuilder group)
        {
            group.MapGet("/friend", () => 0);
        }

        // Public, but no dependent project references it: followed.
        public static void MapQuiet(this RouteGroupBuilder group)
        {
            group.MapGet("/quiet", () => 0);
        }

        // Public, and App calls it with another prefix: not followed.
        public static void MapPublic(this RouteGroupBuilder group)
        {
            group.MapGet("/pub", () => 0);
        }

        // Internal, and no dependent project calls it: followed.
        internal static void MapInternal(this RouteGroupBuilder group)
        {
            group.MapGet("/int", () => 0);
        }
    }
}
