// A test project that references Shared. It calls only the internal MapFriend (through
// InternalsVisibleTo); its own MapQuiet is another method of the same name.
using Microsoft.AspNetCore.Builder;
using Shared;

namespace Shared.Tests
{
    public class SharedEndpointTests
    {
        [RetryFact]
        public void MapsQuietly()
        {
            MapQuiet();
        }

        static void MapQuiet()
        {
        }

        public void MapsAFriend()
        {
            new WebApplication().MapGroup("/t").MapFriend();
        }
    }
}
