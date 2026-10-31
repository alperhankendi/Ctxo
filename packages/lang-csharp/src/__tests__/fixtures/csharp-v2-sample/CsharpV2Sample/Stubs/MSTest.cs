// Stand-in for the MSTest test attribute, so the fixture needs no NuGet restore.
namespace Microsoft.VisualStudio.TestTools.UnitTesting;

public class TestMethodAttribute : System.Attribute
{
}
