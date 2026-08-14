using System.Net;
using System.Text.Json;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/auth/account</c> — the signed-in account reading back its own details
/// (notably the email, which lives nowhere the client can otherwise see).
/// </summary>
public sealed class AccountTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public AccountTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task Account_Returns_The_Callers_Own_Details()
    {
        var client = _factory.CreateClient();

        var register = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new
            {
                username = "marlowe",
                displayName = "Marlowe",
                password = "supersecret-test-1",
                email = "marlowe@test.local",
            });
        Assert.Equal(HttpStatusCode.OK, register.StatusCode);

        using var registerDoc = JsonDocument.Parse(await register.Content.ReadAsStringAsync());
        var sessionToken = registerDoc.RootElement.GetProperty("auth").GetProperty("sessionToken");

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/account", new { sessionToken });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal("marlowe", root.GetProperty("username").GetString());
        Assert.Equal("Marlowe", root.GetProperty("displayName").GetString());
        Assert.Equal("marlowe@test.local", root.GetProperty("email").GetString());
        Assert.Equal("active", root.GetProperty("status").GetString());

        // Round-trips as an absolute instant, so the client can format it.
        Assert.True(DateTimeOffset.TryParse(root.GetProperty("createdAt").GetString(), out _));
    }

    [Fact]
    public async Task Account_Rejects_A_Bogus_Session_Token()
    {
        var client = _factory.CreateClient();

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/account",
            new
            {
                sessionToken = new
                {
                    token_id = "nope",
                    user_id = "nope",
                    access_token = "not-a-real-token",
                    issued_at = DateTimeOffset.UtcNow.ToString("o"),
                    expires_at = DateTimeOffset.UtcNow.AddHours(1).ToString("o"),
                    scopes = Array.Empty<string>(),
                    auth_method = "password",
                    permissions = Array.Empty<string>(),
                    roles = Array.Empty<string>(),
                    metadata = new { },
                },
            });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
