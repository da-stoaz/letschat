using System.Net;
using System.Text.Json;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/auth/login</c> behaviour. Identity is now derived deterministically at
/// account creation, so login just authenticates and mints a fresh SpacetimeDB
/// token — there is no first-login identity rebinding anymore.
/// </summary>
public sealed class LoginTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public LoginTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    private static object Register(string username, string email) => new
    {
        username,
        displayName = username,
        password = "supersecret-test-1",
        email,
    };

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
            client, "/auth/register", Register("harriet", "harriet@test.local"));
        Assert.Equal(HttpStatusCode.OK, registerResponse.StatusCode);

        var loginResponse = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login",
            new { username = "harriet", password = "supersecret-test-1" });

        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
        using var doc = JsonDocument.Parse(await loginResponse.Content.ReadAsStringAsync());
        Assert.Equal("harriet", doc.RootElement.GetProperty("username").GetString());
        Assert.StartsWith("c200", doc.RootElement.GetProperty("spacetimeIdentity").GetString());
    }

    [Fact]
    public async Task Login_Returns_The_Same_Deterministic_Identity_Each_Time()
    {
        var client = _factory.CreateClient();
        var reg = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register", Register("jules", "jules@test.local"));
        using var regDoc = JsonDocument.Parse(await reg.Content.ReadAsStringAsync());
        var registeredIdentity = regDoc.RootElement.GetProperty("auth")
            .GetProperty("spacetimeIdentity").GetString();

        var login = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login",
            new { username = "jules", password = "supersecret-test-1" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        using var loginDoc = JsonDocument.Parse(await login.Content.ReadAsStringAsync());

        // Identity is stable across register + login; a valid token is minted.
        Assert.Equal(registeredIdentity, loginDoc.RootElement.GetProperty("spacetimeIdentity").GetString());
        Assert.False(string.IsNullOrEmpty(loginDoc.RootElement.GetProperty("spacetimeToken").GetString()));
    }
}
