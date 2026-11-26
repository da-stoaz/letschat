using CoreApi.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.Internal;

namespace CoreApi.Tests;

public sealed class ComposeRevisionTests
{
    private static VersionInfo Version(string environment, string? revision) => new(
        new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["LETSCHAT_COMPOSE_REVISION"] = revision }).Build(),
        new HostingEnvironment { EnvironmentName = environment });

    [Fact]
    public void Matching_Compose_Files_Do_Not_Warn() =>
        Assert.Null(Version(Environments.Production, VersionInfo.ComposeRevision.ToString()).ComposeWarning);

    [Theory]
    [InlineData(null, "from before 1.9.0")]
    [InlineData("0", "revision 0")]
    [InlineData("999", "revision 999")]
    public void Other_Compose_Files_Warn(string? revision, string described)
    {
        Assert.Contains(described, Version(Environments.Production, revision).ComposeWarning);
        Assert.NotNull(Version(Environments.Staging, revision).ComposeWarning);
    }

    [Fact]
    public void Local_Development_Has_No_Compose_Files() =>
        Assert.Null(Version(Environments.Development, null).ComposeWarning);
}
