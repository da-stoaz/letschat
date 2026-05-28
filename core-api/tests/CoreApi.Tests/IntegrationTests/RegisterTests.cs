using System.Net;
using System.Text.Json;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/auth/register</c> behaviour, including the new unique-email guard.
/// The factory disables email confirmation so we can assert immediate-active
/// registrations and unique-key conflicts without poking at the SMTP path.
/// </summary>
public sealed class RegisterTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public RegisterTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    private static object NewRegisterPayload(
        string username,
        string email,
        string? identity = null,
        string password = "supersecret-test-1") =>
        new
        {
            username,
            displayName = $"User {username}",
            password,
            email,
            spacetimeToken = "test-spacetime-token-" + Guid.NewGuid().ToString("N"),
            spacetimeIdentity = identity ?? Guid.NewGuid().ToString("N"),
        };

    [Fact]
    public async Task Register_Active_Returns_Auth_Payload()
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
    public async Task Register_Rejects_Duplicate_Spacetime_Identity()
    {
        var client = _factory.CreateClient();
        var sharedIdentity = "0x" + Guid.NewGuid().ToString("N");

        var first = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            NewRegisterPayload("frank", "frank@test.local", identity: sharedIdentity));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            NewRegisterPayload("grace", "grace@test.local", identity: sharedIdentity));

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }
}
