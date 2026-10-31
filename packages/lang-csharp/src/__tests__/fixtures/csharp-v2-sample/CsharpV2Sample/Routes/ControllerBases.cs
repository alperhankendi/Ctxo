// Route prefix fixture: base controllers whose [Route] the controllers in Controllers.cs inherit.
using Microsoft.AspNetCore.Mvc;

namespace Lending.Routes
{
    [ApiController]
    [Route("api/[controller]")]
    public abstract class ApiControllerBase : ControllerBase
    {
    }

    public abstract class VersionedControllerBase : ApiControllerBase
    {
    }

    [Route("api/v2/[controller]")]
    public abstract class GenericControllerBase<T> : ControllerBase
    {
    }

    [NonController]
    [Route("internal")]
    public abstract class NonControllerBase : ControllerBase
    {
    }

    [Route("api/[controller]/[action]")]
    public abstract class ActionControllerBase : ControllerBase
    {
    }
}
