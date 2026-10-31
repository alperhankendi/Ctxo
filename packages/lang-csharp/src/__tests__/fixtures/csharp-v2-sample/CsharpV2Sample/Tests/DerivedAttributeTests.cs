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

    [RetryFact, Fact]
    public void KnownNameAfterward()
    {
    }

    [RetryFact, SlowRetryFact]
    public void TwoDerivedFromOneBase()
    {
    }

    [RetryFact, C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14, C15, C16, C17, C18, C19, C20, Fact]
    public void KnownNameCutByTheCap()
    {
    }

    [RetryFact, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14, B15, B16, B17, B18, B19, B20]
    public void TwentyWrittenAttributes()
    {
    }
}
