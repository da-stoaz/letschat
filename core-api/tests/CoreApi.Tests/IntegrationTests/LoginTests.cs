using System.Net;
using System.Text.Json;
using CoreApi.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/auth/login</c> behaviour, especially the new identity-rebinding path
/// added for admin-created accounts. The admin Create-User flow seeds
/// <c>SpacetimeIdentity = "pending:{guid}"</c>; the first login that supplies
/// a real identity should swap it in transparently.
/// </summary>
public sealed class LoginTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public LoginTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task Login_Rejects_Bad_Credentials()
    {
        var client = _factory.CreateClient();

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login",
            new { username = "nobody", password = "supersecret-test-1" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_Succeeds_For_A_Self_Registered_Active_Account()
    {
        var client = _factory.CreateClient();
        var registerResponse = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new
            {
                username = "harriet",
                displayName = "Harriet",
                password = "supersecret-test-1",
                email = "harriet@test.local",
                spacetimeToken = "tok-harriet",
                spacetimeIdentity = "0x" + Guid.NewGuid().ToString("N"),
            });
        Assert.Equal(HttpStatusCode.OK, registerResponse.StatusCode);

        var loginResponse = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login",
            new { username = "harriet", password = "supersecret-test-1" });

        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
        using var doc = JsonDocument.Parse(await loginResponse.Content.ReadAsStringAsync());
        Assert.Equal("harriet", doc.RootElement.GetProperty("username").GetString());
    }

    [Fact]
    public async Task Login_Rebinds_A_Pending_Placeholder_Identity_On_First_Sign_In()
    {
        var client = _factory.CreateClient();

        // Simulate the admin Create-User flow directly via UserManager —
        // testing through the Razor form would require cookie auth as an admin
        // and the binding behaviour we care about is on the auth endpoint.
        const string username = "ingrid";
        const string password = "supersecret-test-1";
        const string placeholderIdentity = "pending:" + "11111111-2222-3333-4444-555555555555";

        using (var scope = _factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = new ApplicationUser
            {
                UserName = username,
                Email = "ingrid@test.local",
                DisplayName = "Ingrid",
                SpacetimeIdentity = placeholderIdentity,
                SpacetimeIdentityNorm = placeholderIdentity,
                SpacetimeToken = string.Empty,
                Status = AccountStatus.Active,
                EmailConfirmed = true,
            };
            var created = await users.CreateAsync(user, password);
            Assert.True(created.Succeeded, string.Join(";", created.Errors.Select(e => e.Description)));
        }

        var realIdentity = "0x" + Guid.NewGuid().ToString("N");
        var realToken = "spacetime-token-ingrid-first-login";

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login",
            new
            {
                username,
                password,
                spacetimeIdentity = realIdentity,
                spacetimeToken = realToken,
            });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(realIdentity, doc.RootElement.GetProperty("spacetimeIdentity").GetString());
        Assert.Equal(realToken, doc.RootElement.GetProperty("spacetimeToken").GetString());

        // The stored record should now hold the real identity, not the placeholder.
        using (var scope = _factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var stored = await users.FindByNameAsync(username);
            Assert.NotNull(stored);
            Assert.Equal(realIdentity, stored!.SpacetimeIdentity);
            Assert.Equal(realToken, stored.SpacetimeToken);
            Assert.False(stored.SpacetimeIdentity.StartsWith("pending:", StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task Login_Does_Not_Rebind_Once_Identity_Is_Established()
    {
        var client = _factory.CreateClient();
        var originalIdentity = "0x" + Guid.NewGuid().ToString("N");

        await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new
            {
                username = "jules",
                displayName = "Jules",
                password = "supersecret-test-1",
                email = "jules@test.local",
                spacetimeToken = "tok-jules",
                spacetimeIdentity = originalIdentity,
            });

        // Even if the client sends a different identity, an already-bound
        // account should keep its original.
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login",
            new
            {
                username = "jules",
                password = "supersecret-test-1",
                spacetimeIdentity = "0x" + Guid.NewGuid().ToString("N"),
                spacetimeToken = "tok-other",
            });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(originalIdentity, doc.RootElement.GetProperty("spacetimeIdentity").GetString());
    }
}
