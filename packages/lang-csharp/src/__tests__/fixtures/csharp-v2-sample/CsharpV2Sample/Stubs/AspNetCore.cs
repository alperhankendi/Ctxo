// Stand-ins for the ASP.NET Core types the Facts fixtures use, so the fixture needs no NuGet restore.
namespace Microsoft.AspNetCore.Mvc
{
    public sealed class ApiControllerAttribute : System.Attribute
    {
    }

    public sealed class NonControllerAttribute : System.Attribute
    {
    }

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
        public HttpGetAttribute()
        {
        }

        public HttpGetAttribute(string template)
        {
            Template = template;
        }

        public string? Template { get; }
    }

    public sealed class HttpPostAttribute : System.Attribute
    {
        public HttpPostAttribute()
        {
        }
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

    public sealed class RouteGroupBuilder : IEndpointRouteBuilder, Microsoft.AspNetCore.Builder.IEndpointConventionBuilder
    {
    }
}

namespace Microsoft.AspNetCore.Builder
{
    using Microsoft.AspNetCore.Routing;

    public interface IEndpointConventionBuilder
    {
    }

    // Conventions as in ASP.NET Core: generic extensions that return their receiver.
    public static class RoutingEndpointConventionBuilderExtensions
    {
        public static TBuilder WithTags<TBuilder>(this TBuilder builder, params string[] tags) where TBuilder : IEndpointConventionBuilder => builder;

        public static TBuilder RequireAuthorization<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder => builder;
    }

    // Route groups as in ASP.NET Core: extension methods on IEndpointRouteBuilder.
    public static class EndpointRouteBuilderExtensions
    {
        public static RouteGroupBuilder MapGroup(this IEndpointRouteBuilder endpoints, string prefix) => new RouteGroupBuilder();

        public static void MapGet(this IEndpointRouteBuilder endpoints, string pattern, System.Delegate handler)
        {
        }

        public static void MapPost(this IEndpointRouteBuilder endpoints, string pattern, System.Delegate handler)
        {
        }
    }

    public sealed class WebApplication : IEndpointRouteBuilder
    {
        public void MapGet(string pattern, System.Delegate handler)
        {
        }

        public void MapPost(string pattern, System.Delegate handler)
        {
        }

        public void MapPut(string pattern, System.Delegate handler)
        {
        }

        public void MapDelete(string pattern, System.Delegate handler)
        {
        }

        public void MapPatch(string pattern, System.Delegate handler)
        {
        }

        public void MapPatch(System.ReadOnlySpan<byte> pattern, System.Delegate handler)
        {
        }
    }
}
