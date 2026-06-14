using CoreApi.Configuration;
using Microsoft.Extensions.Configuration;

namespace CoreApi.Tests;

/// <summary>
/// Guards the production secret-hardening check. A secret left at its public,
/// checked-in dev default is forgeable, so <see cref="ServiceOptions.FindInsecureDefaults"/>
/// must flag every one that callers (Program.cs) refuse to start on.
/// </summary>
public sealed class ServiceOptionsTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [Fact]
    public void FindInsecureDefaults_FlagsEverySecretLeftAtItsDevDefault()
    {
        // Empty config → ServiceOptions falls back to every dev default.
        var options = ServiceOptions.FromConfiguration(Config(new()));

        var insecure = options.FindInsecureDefaults();

        Assert.Equal(3, insecure.Count);
        Assert.Contains("AUTH_JWT_SECRET", insecure);
        Assert.Contains("LIVEKIT_API_SECRET", insecure);
        Assert.Contains("MINIO_SECRET_KEY", insecure);
    }

    [Fact]
    public void FindInsecureDefaults_ReturnsEmptyWhenEverySecretIsOverridden()
    {
        var options = ServiceOptions.FromConfiguration(Config(new()
        {
            ["AUTH_JWT_SECRET"] = "a-strong-unique-jwt-secret-value-1234567890",
            ["LIVEKIT_API_SECRET"] = "a-strong-unique-livekit-secret-1234567890",
            ["MINIO_SECRET_KEY"] = "a-strong-unique-minio-secret-value",
        }));

        Assert.Empty(options.FindInsecureDefaults());
    }

    [Fact]
    public void FindInsecureDefaults_FlagsOnlyTheSecretsStillAtTheirDefault()
    {
        // Override just the LiveKit secret — the other two remain at default.
        var options = ServiceOptions.FromConfiguration(Config(new()
        {
            ["LIVEKIT_API_SECRET"] = "a-strong-unique-livekit-secret-1234567890",
        }));

        var insecure = options.FindInsecureDefaults();

        Assert.DoesNotContain("LIVEKIT_API_SECRET", insecure);
        Assert.Contains("AUTH_JWT_SECRET", insecure);
        Assert.Contains("MINIO_SECRET_KEY", insecure);
    }
}
