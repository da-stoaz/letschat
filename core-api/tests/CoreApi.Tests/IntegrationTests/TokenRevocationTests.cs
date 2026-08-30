using System.Net;
using System.Text.Json;
using CoreApi.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// Token revocation (BUG_ANALYSIS A4) on the core-api side.
///
/// <para>
/// Both tokens were stateless JWTs with no denylist and no stamp, so nothing
/// that happened to an account afterwards reached them: resetting a password
/// left a stolen session working for its full lifetime, and because that
/// session can be traded for fresh ones at <c>/auth/renew-session</c>, "its
/// full lifetime" meant indefinitely. Each account now carries a monotonic
/// <c>TokenGeneration</c> stamped into every token it issues.
/// </para>
///
/// <para>
/// The SpacetimeDB module's half — where the same generation stops a stolen
/// chat token — is covered by <c>tests/security/token-revocation.test.ts</c>
/// against a real instance.
/// </para>
/// </summary>
public sealed class TokenRevocationTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public TokenRevocationTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    private const string OriginalPassword = "supersecret-test-1";

    /// <summary>Registers an account and returns its whole auth payload.</summary>
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
        return doc.RootElement.GetProperty("auth").Clone();
    }

    private static Task<HttpResponseMessage> AccountAsync(HttpClient client, JsonElement sessionToken) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/account", new { sessionToken });

    /// <summary>Reads the <c>gen</c> claim straight off a raw JWT.</summary>
    private static long GenerationOf(string jwt) =>
        long.Parse(new JsonWebToken(jwt).GetClaim("gen").Value);

    [Fact]
    public async Task Both_Minted_Tokens_Carry_The_Account_Generation()
    {
        var client = _factory.CreateClient();
        var auth = await RegisterAsync(client, "stamped_one");

        // This is the seam between the two halves of the fix: core-api stamps
        // the generation, the SpacetimeDB module compares it against the floor
        // it holds. If the claim were missing or misspelled, the module would
        // read 0 and every revocation would silently do nothing.
        Assert.Equal(0, GenerationOf(auth.GetProperty("spacetimeToken").GetString()!));
        Assert.Equal(
            0,
            GenerationOf(auth.GetProperty("sessionToken").GetProperty("access_token").GetString()!));

        var change = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
            new
            {
                sessionToken = auth.GetProperty("sessionToken"),
                currentPassword = OriginalPassword,
                newPassword = "a-brand-new-secret-2",
            });
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        using var doc = JsonDocument.Parse(await change.Content.ReadAsStringAsync());
        var refreshed = doc.RootElement;

        // Bumped, and — the half the module test cannot reach with its own
        // SpacetimeDB-issued tokens — the replacement is above the new floor,
        // so the user keeps working while the stolen one does not.
        Assert.Equal(1, GenerationOf(refreshed.GetProperty("spacetimeToken").GetString()!));
        Assert.Equal(
            1,
            GenerationOf(refreshed.GetProperty("sessionToken").GetProperty("access_token").GetString()!));
    }

    [Fact]
    public async Task A_Session_From_Before_A_Password_Change_Stops_Working()
    {
        var client = _factory.CreateClient();
        var auth = await RegisterAsync(client, "revoked_one");
        var stolen = auth.GetProperty("sessionToken");

        // The stolen session works right up until the change.
        Assert.Equal(HttpStatusCode.OK, (await AccountAsync(client, stolen)).StatusCode);

        var change = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
            new
            {
                sessionToken = stolen,
                currentPassword = OriginalPassword,
                newPassword = "a-brand-new-secret-2",
            });
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        // …and not one request later. This is the whole point of the finding:
        // before, it stayed good for its full hour and could be renewed.
        Assert.Equal(HttpStatusCode.Unauthorized, (await AccountAsync(client, stolen)).StatusCode);
    }

    [Fact]
    public async Task The_Session_Handed_Back_By_A_Password_Change_Works()
    {
        var client = _factory.CreateClient();
        var auth = await RegisterAsync(client, "rotated_one");

        var change = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
            new
            {
                sessionToken = auth.GetProperty("sessionToken"),
                currentPassword = OriginalPassword,
                newPassword = "a-brand-new-secret-2",
            });
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        using var doc = JsonDocument.Parse(await change.Content.ReadAsStringAsync());
        var replacement = doc.RootElement.GetProperty("sessionToken");

        // Revocation must not lock out the device that did the changing, or
        // people learn to avoid changing their password.
        Assert.Equal(HttpStatusCode.OK, (await AccountAsync(client, replacement)).StatusCode);
    }

    [Fact]
    public async Task A_Revoked_Spacetime_Token_Cannot_Buy_A_Fresh_Session()
    {
        var client = _factory.CreateClient();
        var auth = await RegisterAsync(client, "renewer_one");
        var stolenSpacetimeToken = auth.GetProperty("spacetimeToken").GetString();

        // Renewal works before the change…
        var before = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/renew-session", new { spacetimeToken = stolenSpacetimeToken });
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);

        var change = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/change-password",
            new
            {
                sessionToken = auth.GetProperty("sessionToken"),
                currentPassword = OriginalPassword,
                newPassword = "a-brand-new-secret-2",
            });
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        // …and not after. Without this the chat token stays a renewable master
        // credential for its full 30 days, and revoking sessions achieves
        // nothing at all.
        var after = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/renew-session", new { spacetimeToken = stolenSpacetimeToken });
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    [Fact]
    public async Task A_Refresh_Token_Cannot_Stand_In_For_An_Access_Token()
    {
        var client = _factory.CreateClient();
        var auth = await RegisterAsync(client, "swapper_one");
        var session = auth.GetProperty("sessionToken");

        // Same key, same issuer, only `token_use` tells them apart — so before
        // the check, sending the 7-day refresh token here bought a 7-day session
        // where the design says one hour.
        var forged = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
            session.GetRawText(), LetsChatWebApplicationFactory.Json)!;
        forged["access_token"] = forged["refresh_token"];

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/account", new { sessionToken = forged });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_Disabled_Account_Cannot_Use_A_Session_It_Already_Held()
    {
        var client = _factory.CreateClient();
        var auth = await RegisterAsync(client, "disabled_one");
        var session = auth.GetProperty("sessionToken");

        Assert.Equal(HttpStatusCode.OK, (await AccountAsync(client, session)).StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByNameAsync("disabled_one");
            user!.Status = AccountStatus.Disabled;
            Assert.True((await users.UpdateAsync(user)).Succeeded);
        }

        // Disabling only blocked a fresh sign-in before; the session the account
        // was already holding kept working.
        Assert.Equal(HttpStatusCode.Unauthorized, (await AccountAsync(client, session)).StatusCode);
    }
}
