using Xunit;

namespace CsharpV2Sample.Tests;

// A project's own test attributes, derived from the framework ones.
public class RetryFactAttribute : FactAttribute
{
}

public sealed class SlowRetryFactAttribute : RetryFactAttribute
{
}

public sealed class LoanTheoryAttribute : TheoryAttribute
{
}

public sealed class SmokeTestAttribute : NUnit.Framework.TestAttribute
{
}

public sealed class IntegrationTestMethodAttribute : Microsoft.VisualStudio.TestTools.UnitTesting.TestMethodAttribute
{
}

// Look-alikes that derive from no test attribute.
public sealed class FactoryAttribute : System.Attribute
{
}

public sealed class FactsAttribute : System.Attribute
{
}

public class DerivedAttributeTests
{
    [RetryFact]
    public void Direct()
    {
    }

    [SlowRetryFact]
    [Trait("Rule", "LEND-09")]
    public void TwoLevels()
    {
    }

    [LoanTheory]
    public void FromTheory()
    {
    }

    [SmokeTest]
    public void FromNUnitTest()
    {
    }

    [IntegrationTestMethod]
    public void FromMSTestTestMethod()
    {
    }

    [Factory, Facts]
    public void LookAlikes()
    {
    }

    [Fact, RetryFact]
    public void KnownNameAlreadyThere()
    {
    }
}
