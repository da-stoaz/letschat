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

        Assert.Equal(5, insecure.Count);
        Assert.Contains("AUTH_JWT_SECRET", insecure);
        Assert.Contains("LIVEKIT_API_SECRET", insecure);
        Assert.Contains("MINIO_SECRET_KEY", insecure);
        // The OIDC issuer left at its dev default, and an unset signing key, are
        // both identity-defining and must be flagged for prod.
        Assert.Contains("SPACETIME_OIDC_ISSUER", insecure);
        Assert.Contains("SPACETIME_OIDC_PRIVATE_KEY", insecure);
    }

    [Fact]
    public void FindInsecureDefaults_ReturnsEmptyWhenEverySecretIsOverridden()
    {
        var options = ServiceOptions.FromConfiguration(Config(new()
        {
            ["AUTH_JWT_SECRET"] = "a-strong-unique-jwt-secret-value-1234567890",
            ["LIVEKIT_API_SECRET"] = "a-strong-unique-livekit-secret-1234567890",
            ["MINIO_SECRET_KEY"] = "a-strong-unique-minio-secret-value",
            ["SPACETIME_OIDC_ISSUER"] = "https://auth.example.com",
            ["SPACETIME_OIDC_PRIVATE_KEY"] = "-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----",
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

    // ── Client-facing endpoints ───────────────────────────────────────────────
    // These fail differently from a bad secret: nothing throws, nothing logs, and
    // every client is handed an address it cannot reach.

    [Fact]
    public void FindClientUnreachableEndpoints_FlagsEveryEndpointLeftAtItsDevDefault()
    {
        var options = ServiceOptions.FromConfiguration(Config(new()));

        var issues = options.FindClientUnreachableEndpoints();

        // MINIO_PUBLIC_ENDPOINT is flagged twice over — unset (so equal to the
        // internal endpoint) and loopback — plus the three discovery URLs.
        Assert.Contains(issues, issue => issue.Contains("MINIO_PUBLIC_ENDPOINT") && issue.Contains("unset"));
        Assert.Contains(issues, issue => issue.Contains("DISCOVERY_AUTH_URL"));
        Assert.Contains(issues, issue => issue.Contains("DISCOVERY_SPACETIMEDB_URI"));
        Assert.Contains(issues, issue => issue.Contains("DISCOVERY_LIVEKIT_URL"));
    }

    [Fact]
    public void FindClientUnreachableEndpoints_IsEmptyForAPublicDeployment()
    {
        var options = ServiceOptions.FromConfiguration(Config(new()
        {
            ["MINIO_INTERNAL_ENDPOINT"] = "http://minio:44390",
            ["MINIO_PUBLIC_ENDPOINT"] = "https://files.example.com",
            ["DISCOVERY_AUTH_URL"] = "https://auth.example.com",
            ["DISCOVERY_SPACETIMEDB_URI"] = "wss://chat.example.com",
            ["DISCOVERY_LIVEKIT_URL"] = "wss://lk.example.com",
        }));

        Assert.Empty(options.FindClientUnreachableEndpoints());
    }

    [Fact]
    public void FindClientUnreachableEndpoints_FlagsThePublicEndpointFallingBackToTheInternalOne()
    {
        // The exact production footgun: MINIO_PUBLIC_ENDPOINT left blank, so it
        // silently becomes the Docker-internal address baked into every
        // presigned URL. Discovery is set correctly, so nothing else fires.
        var options = ServiceOptions.FromConfiguration(Config(new()
        {
            ["MINIO_INTERNAL_ENDPOINT"] = "http://minio:44390",
            ["DISCOVERY_AUTH_URL"] = "https://auth.example.com",
            ["DISCOVERY_SPACETIMEDB_URI"] = "wss://chat.example.com",
            ["DISCOVERY_LIVEKIT_URL"] = "wss://lk.example.com",
        }));

        var issues = options.FindClientUnreachableEndpoints();

        var only = Assert.Single(issues);
        Assert.Contains("MINIO_PUBLIC_ENDPOINT", only);
        Assert.Contains("http://minio:44390", only);
    }

    [Fact]
    public void FindClientUnreachableEndpoints_FlagsALoopbackAddressNotJustTheLocalhostName()
    {
        // 127.0.0.1 is what a packaged macOS build refuses to load even on the
        // same machine, so it must be caught as well as the `localhost` name.
        var options = ServiceOptions.FromConfiguration(Config(new()
        {
            ["MINIO_INTERNAL_ENDPOINT"] = "http://minio:44390",
            ["MINIO_PUBLIC_ENDPOINT"] = "http://127.0.0.1:44390",
            ["DISCOVERY_AUTH_URL"] = "https://auth.example.com",
            ["DISCOVERY_SPACETIMEDB_URI"] = "wss://chat.example.com",
            ["DISCOVERY_LIVEKIT_URL"] = "wss://lk.example.com",
        }));

        var only = Assert.Single(options.FindClientUnreachableEndpoints());
        Assert.Contains("MINIO_PUBLIC_ENDPOINT", only);
        Assert.Contains("points at this machine", only);
    }
}
