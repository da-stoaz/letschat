using System.Net;
using System.Text.Json;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/auth/change-password</c> — unlike <c>/auth/link</c>, this verifies the
/// current password before replacing it, so a signed-in session alone cannot
/// lock the account owner out.
/// </summary>
public sealed class ChangePasswordTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public ChangePasswordTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    private const string OriginalPassword = "supersecret-test-1";

    private static async Task<JsonElement> RegisterAsync(HttpClient client, string username)
    {
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new
            {
                username,
                displayName = username,
                password = OriginalPassword,
                email = $"{username}@test.local",
            });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("auth").GetProperty("sessionToken").Clone();
    }

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string username, string password) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/login", new { username, password });

    [Fact]
    public async Task Changes_The_Password_When_The_Current_One_Is_Correct()
    {
        var client = _factory.CreateClient();
        var sessionToken = await RegisterAsync(client, "wilhelmina");

        var change = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
            new { sessionToken, currentPassword = OriginalPassword, newPassword = "a-brand-new-secret-2" });
        // Answers with a fresh auth payload rather than 204: the change revokes
        // every session issued under the old password, this caller's included,
        // so it has to be handed a replacement.
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "wilhelmina", "a-brand-new-secret-2")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client, "wilhelmina", OriginalPassword)).StatusCode);
    }

    [Fact]
    public async Task Rejects_A_Wrong_Current_Password_And_Leaves_The_Old_One_Working()
    {
        var client = _factory.CreateClient();
        var sessionToken = await RegisterAsync(client, "bartholomew");

        var change = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
            new { sessionToken, currentPassword = "not-the-right-one", newPassword = "a-brand-new-secret-2" });
        Assert.Equal(HttpStatusCode.BadRequest, change.StatusCode);

        // The account must be untouched: old password still works, new one does not.
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "bartholomew", OriginalPassword)).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await LoginAsync(client, "bartholomew", "a-brand-new-secret-2")).StatusCode);
    }

    [Fact]
    public async Task Rejects_A_Too_Short_New_Password()
    {
        var client = _factory.CreateClient();
        var sessionToken = await RegisterAsync(client, "cornelius");

        var change = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
            new { sessionToken, currentPassword = OriginalPassword, newPassword = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, change.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "cornelius", OriginalPassword)).StatusCode);
    }

    [Fact]
    public async Task Rejects_A_Bogus_Session_Token()
    {
        var client = _factory.CreateClient();

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
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
                currentPassword = OriginalPassword,
                newPassword = "a-brand-new-secret-2",
            });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
