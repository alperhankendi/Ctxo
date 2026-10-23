// Stand-ins for the xUnit attribute types, so the fixture needs no NuGet restore.
namespace Xunit;

public class FactAttribute : System.Attribute
{
}

public class TheoryAttribute : FactAttribute
{
}

public sealed class TraitAttribute : System.Attribute
{
    public TraitAttribute(string name, string value)
    {
        Name = name;
        Value = value;
    }

    public string Name { get; }

    public string Value { get; }
}
