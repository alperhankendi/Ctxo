// The App project: a controller and a test attribute from the referenced Shared project.
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;
using Shared;

namespace App
{
    public class OrdersController : SharedControllerBase
    {
        [HttpGet("{id}")]
        public int Get(int id) => id;
    }

    public static class AppEndpoints
    {
        public static void Register(WebApplication app)
        {
            app.MapGroup("/other").MapPublic();
        }
    }

    public class OrdersTests
    {
        [RetryFact]
        public void Retries()
        {
        }
    }
}
