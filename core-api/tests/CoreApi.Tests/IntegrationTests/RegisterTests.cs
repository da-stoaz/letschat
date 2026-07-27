using System.Net;
using System.Text.Json;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/auth/register</c> behaviour. The SpacetimeDB identity is now derived
/// server-side from the account id (not client-supplied), so the factory's
/// disabled email confirmation lets us assert immediate-active registrations,
/// the returned deterministic identity, and unique-key conflicts.
/// </summary>
public sealed class RegisterTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public RegisterTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    private static object NewRegisterPayload(
        string username,
        string email,
        string password = "supersecret-test-1") =>
        new
        {
            username,
            displayName = $"User {username}",
            password,
            email,
        };

    [Fact]
    public async Task Register_Active_Returns_Auth_Payload_With_Derived_Identity()
    {
        var client = _factory.CreateClient();

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            NewRegisterPayload("alice", "alice@test.local"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("active", doc.RootElement.GetProperty("status").GetString());

        var auth = doc.RootElement.GetProperty("auth");
        Assert.Equal("alice", auth.GetProperty("username").GetString());
        Assert.False(string.IsNullOrEmpty(auth.GetProperty("sessionToken")
            .GetProperty("access_token").GetString()));

        // Identity is derived, deterministic, and minted (not client-supplied).
        var identity = auth.GetProperty("spacetimeIdentity").GetString();
        Assert.False(string.IsNullOrEmpty(identity));
        Assert.StartsWith("c200", identity);
        Assert.False(string.IsNullOrEmpty(auth.GetProperty("spacetimeToken").GetString()));
    }

    [Fact]
    public async Task Register_Rejects_Duplicate_Username()
    {
        var client = _factory.CreateClient();

        var first = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            NewRegisterPayload("bob", "bob1@test.local"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            NewRegisterPayload("bob", "bob2@test.local"));

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var body = await second.Content.ReadAsStringAsync();
        Assert.Contains("Username", body);
    }

    [Fact]
    public async Task Register_Rejects_Duplicate_Email()
    {
        var client = _factory.CreateClient();

        var first = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            NewRegisterPayload("carol", "shared@test.local"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            NewRegisterPayload("dave", "shared@test.local"));

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var body = await second.Content.ReadAsStringAsync();
        Assert.Contains("Email", body);
    }

    [Fact]
    public async Task Register_Rejects_Short_Password()
    {
        var client = _factory.CreateClient();

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            NewRegisterPayload("eve", "eve@test.local", password: "short"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_Derives_Distinct_Identities_For_Distinct_Accounts()
    {
        var client = _factory.CreateClient();

        var frank = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register", NewRegisterPayload("frank", "frank@test.local"));
        var grace = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register", NewRegisterPayload("grace", "grace@test.local"));

        Assert.Equal(HttpStatusCode.OK, frank.StatusCode);
        Assert.Equal(HttpStatusCode.OK, grace.StatusCode);

        using var frankDoc = JsonDocument.Parse(await frank.Content.ReadAsStringAsync());
        using var graceDoc = JsonDocument.Parse(await grace.Content.ReadAsStringAsync());
        var frankId = frankDoc.RootElement.GetProperty("auth").GetProperty("spacetimeIdentity").GetString();
        var graceId = graceDoc.RootElement.GetProperty("auth").GetProperty("spacetimeIdentity").GetString();
        Assert.NotEqual(frankId, graceId);
    }
}
