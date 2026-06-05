using CoreApi.Logging;

namespace CoreApi.Tests;

public sealed class PiiRedactorTests
{
    [Theory]
    [InlineData("john@gmail.com", "j***@g***.com")]
    [InlineData("a@b.co", "a***@b***.co")]
    [InlineData("first.last@sub.example.org", "f***@s***.org")]
    public void MaskEmail_keeps_only_initials_and_tld(string input, string expected)
        => Assert.Equal(expected, PiiRedactor.MaskEmail(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void MaskEmail_returns_placeholder_for_empty(string? input)
        => Assert.Equal("(no address)", PiiRedactor.MaskEmail(input));

    [Theory]
    [InlineData("notanemail")]
    [InlineData("@nolocal.com")]
    [InlineData("trailing@")]
    public void MaskEmail_returns_stars_for_non_address(string input)
        => Assert.Equal("***", PiiRedactor.MaskEmail(input));

    [Fact]
    public void MaskEmail_does_not_leak_the_local_part()
    {
        var masked = PiiRedactor.MaskEmail("sensitive.user@example.com");
        Assert.DoesNotContain("sensitive", masked);
        Assert.DoesNotContain("user", masked);
        Assert.DoesNotContain("example", masked);
    }
}
