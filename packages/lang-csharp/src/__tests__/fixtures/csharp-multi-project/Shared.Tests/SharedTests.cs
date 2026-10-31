// A test project that references Shared without calling its group mappers. Its own MapQuiet is
// another method of the same name.
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
    }
}
