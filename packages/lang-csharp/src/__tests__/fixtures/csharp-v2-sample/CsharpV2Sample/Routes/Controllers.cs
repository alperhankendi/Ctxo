// Route prefix fixture: controllers that inherit the class [Route] of a base in another file.
using Microsoft.AspNetCore.Mvc;

namespace Lending.Routes
{
    public class MembersController : ApiControllerBase
    {
        [HttpGet("{id}")]
        public int Get(int id) => id;
    }

    public class FinesController : VersionedControllerBase
    {
        [HttpPost]
        public int Pay() => 0;
    }

    [Route("own")]
    public class OwnRouteController : ApiControllerBase
    {
        [HttpGet("x")]
        public int X() => 0;
    }

    public class ReportsController : ActionControllerBase
    {
        [HttpGet]
        public int List() => 0;
    }

    public class PlainController : ControllerBase
    {
        [HttpGet("plain")]
        public int Plain() => 0;
    }
}
