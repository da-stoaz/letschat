using System.Net;
using System.Text.Json;
using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/auth/link</c> is reachable unauthenticated and can create an account, so
/// its create path has to honour exactly the controls <c>/auth/register</c>
/// does. It previously honoured none of them, which made a single unauthenticated
/// call a way past a closed instance, email confirmation and admin approval.
/// </summary>
public sealed class LinkTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public LinkTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    private const string Password = "supersecret-test-1";

    /// <summary>
    /// Each case sets every flag it depends on, so the shared factory's config
    /// can't leak an ordering dependency between tests.
    /// </summary>
    private async Task ConfigureAsync(bool registrationOpen, bool requireEmailConfirmation)
    {
        var config = _factory.Services.GetRequiredService<SystemConfigService>();
        await config.UpdateAsync(c =>
        {
            c.RegistrationOpen = registrationOpen;
            c.RequireEmailConfirmation = requireEmailConfirmation;
        });
    }

    private static Task<HttpResponseMessage> LinkAsync(HttpClient client, string username) =>
        LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/link",
            new
            {
                username,
                displayName = username,
                password = Password,
                email = $"{username}@test.local",
            });

    [Fact]
    public async Task Creates_An_Account_When_Registration_Is_Open()
    {
        await ConfigureAsync(registrationOpen: true, requireEmailConfirmation: false);
        var client = _factory.CreateClient();

        var response = await LinkAsync(client, "linkopen");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Refuses_To_Create_An_Account_When_Registration_Is_Closed()
    {
        await ConfigureAsync(registrationOpen: false, requireEmailConfirmation: false);
        var client = _factory.CreateClient();

        var response = await LinkAsync(client, "linkclosed");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // And the account must not exist afterwards — a 400 that still created
        // the user would leave the bypass wide open.
        await ConfigureAsync(registrationOpen: true, requireEmailConfirmation: false);
        var login = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login", new { username = "linkclosed", password = Password });
        Assert.NotEqual(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task Does_Not_Hand_Back_A_Session_When_Email_Confirmation_Is_Required()
    {
        await ConfigureAsync(registrationOpen: true, requireEmailConfirmation: true);
        var client = _factory.CreateClient();

        var response = await LinkAsync(client, "linkunconfirmed");

        // The account is created as Registered; it must not be signable-in until
        // the address is confirmed, exactly as a /auth/register account is not.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Existing accounts (BUG_ANALYSIS A12) ────────────────────────────────

    private static async Task<JsonElement> SessionOf(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var root = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        return (root.TryGetProperty("auth", out var auth) ? auth : root).GetProperty("sessionToken").Clone();
    }

    private static Task<HttpResponseMessage> ChangeViaLinkAsync(
        HttpClient client, string username, JsonElement sessionToken, string? currentPassword, string newPassword) =>
        LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/link",
            new { username, displayName = username, password = newPassword, sessionToken, currentPassword });

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string username, string password) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/login", new { username, password });

    [Fact]
    public async Task A_Revoked_Session_Cannot_Set_A_Password()
    {
        await ConfigureAsync(registrationOpen: true, requireEmailConfirmation: false);
        var client = _factory.CreateClient();
        var stolen = await SessionOf(await LinkAsync(client, "linkrevoked"));

        // The owner changes the password, which revokes every existing session.
        var change = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
            new { sessionToken = stolen, currentPassword = Password, newPassword = "owner-new-secret-2" });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);

        var link = await ChangeViaLinkAsync(client, "linkrevoked", stolen, "owner-new-secret-2", "attacker-secret-3");
        Assert.Equal(HttpStatusCode.Unauthorized, link.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client, "linkrevoked", "attacker-secret-3")).StatusCode);
    }

    [Fact]
    public async Task A_Session_Alone_Cannot_Set_A_Password()
    {
        await ConfigureAsync(registrationOpen: true, requireEmailConfirmation: false);
        var client = _factory.CreateClient();
        var session = await SessionOf(await LinkAsync(client, "linknocurrent"));

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await ChangeViaLinkAsync(client, "linknocurrent", session, null, "attacker-secret-3")).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await ChangeViaLinkAsync(client, "linknocurrent", session, "wrong-password-9", "attacker-secret-3")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "linknocurrent", Password)).StatusCode);
    }

    [Fact]
    public async Task Changing_A_Password_Revokes_Older_Sessions()
    {
        await ConfigureAsync(registrationOpen: true, requireEmailConfirmation: false);
        var client = _factory.CreateClient();
        var old = await SessionOf(await LinkAsync(client, "linkchange"));

        var fresh = await SessionOf(await ChangeViaLinkAsync(client, "linkchange", old, Password, "owner-new-secret-2"));

        var account = (JsonElement token) => LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/account", new { sessionToken = token });
        Assert.Equal(HttpStatusCode.Unauthorized, (await account(old)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await account(fresh)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, "linkchange", "owner-new-secret-2")).StatusCode);
    }
}
