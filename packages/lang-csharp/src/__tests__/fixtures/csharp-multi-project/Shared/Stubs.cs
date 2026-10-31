// Stand-ins for the ASP.NET Core and xUnit types, so the fixture needs no NuGet restore.
namespace Microsoft.AspNetCore.Mvc
{
    public sealed class RouteAttribute : System.Attribute
    {
        public RouteAttribute(string template)
        {
            Template = template;
        }

        public string Template { get; }
    }

    public sealed class HttpGetAttribute : System.Attribute
    {
        public HttpGetAttribute(string template)
        {
            Template = template;
        }

        public string Template { get; }
    }

    public abstract class ControllerBase
    {
    }
}

namespace Microsoft.AspNetCore.Routing
{
    public interface IEndpointRouteBuilder
    {
    }

    public sealed class RouteGroupBuilder : IEndpointRouteBuilder
    {
    }
}

namespace Microsoft.AspNetCore.Builder
{
    using Microsoft.AspNetCore.Routing;

    public sealed class WebApplication : IEndpointRouteBuilder
    {
    }

    public static class EndpointRouteBuilderExtensions
    {
        public static RouteGroupBuilder MapGroup(this IEndpointRouteBuilder endpoints, string prefix) => new RouteGroupBuilder();

        public static void MapGet(this IEndpointRouteBuilder endpoints, string pattern, System.Delegate handler)
        {
        }
    }
}

namespace Xunit
{
    public class FactAttribute : System.Attribute
    {
    }
}
