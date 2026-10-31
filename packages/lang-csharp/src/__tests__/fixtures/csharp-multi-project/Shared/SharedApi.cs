// A library project the App project references: a base controller, a test attribute and group extensions.
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

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

        // Internal: every call site is in this project.
        internal static void MapInternal(this RouteGroupBuilder group)
        {
            group.MapGet("/int", () => 0);
        }
    }
}
