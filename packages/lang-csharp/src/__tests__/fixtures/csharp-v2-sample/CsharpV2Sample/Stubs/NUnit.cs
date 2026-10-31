// Stand-in for the NUnit test attribute, so the fixture needs no NuGet restore.
namespace NUnit.Framework;

public class TestAttribute : System.Attribute
{
}
