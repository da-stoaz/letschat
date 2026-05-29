using System.Net;
using System.Text.Json;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// Covers the public endpoints that don't need persistence — the desktop
/// client and landing page both depend on the discovery JSON having stable
/// keys and the version triple.
/// </summary>
public sealed class DiscoveryTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public DiscoveryTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task Health_Returns_Ok()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("ok", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task WellKnown_Includes_The_Discovery_Fields_And_Version_Triple()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/.well-known/letschat.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // The desktop client and the landing page both parse these exact keys.
        Assert.Equal("ws://localhost:4300", root.GetProperty("spacetimedb").GetString());
        Assert.Equal("http://localhost:8787", root.GetProperty("auth").GetString());
        Assert.Equal("ws://localhost:7880", root.GetProperty("livekit").GetString());
        Assert.Equal("letschat-test", root.GetProperty("database").GetString());

        var serverVersion = root.GetProperty("serverVersion").GetString();
        Assert.False(string.IsNullOrWhiteSpace(serverVersion));
        // RecommendedClient defaults to serverVersion when no env override is set.
        Assert.Equal(serverVersion, root.GetProperty("recommendedClient").GetString());
        Assert.Equal(serverVersion, root.GetProperty("minClient").GetString());
    }

    [Fact]
    public async Task Downloads_RejectsUnknownPlatform()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/downloads/playstation");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Unknown platform", body);
    }
}
