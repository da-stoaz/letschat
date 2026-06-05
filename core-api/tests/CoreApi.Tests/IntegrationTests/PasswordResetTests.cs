using System.Net;
using CoreApi.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// The password-reset flow: <c>/auth/forgot-password</c> stays generic, and
/// <c>/auth/reset-password</c> consumes an Identity reset token to set a new
/// password. The token is generated directly through <see cref="UserManager{T}"/>
/// (the same one the email would carry) so the test never touches SMTP.
/// </summary>
public sealed class PasswordResetTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public PasswordResetTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    private static object NewRegisterPayload(string username, string email, string password) =>
        new
        {
            username,
            displayName = $"User {username}",
            password,
            email,
            spacetimeToken = "test-spacetime-token-" + Guid.NewGuid().ToString("N"),
            spacetimeIdentity = Guid.NewGuid().ToString("N"),
        };

    private async Task RegisterAsync(HttpClient client, string username, string email, string password)
    {
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register", NewRegisterPayload(username, email, password));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private async Task<string> GenerateResetTokenAsync(string username)
    {
        using var scope = _factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByNameAsync(username)
            ?? throw new InvalidOperationException($"User {username} not found.");
        return await users.GeneratePasswordResetTokenAsync(user);
    }

    private async Task<string> GetUserIdAsync(string username)
    {
        using var scope = _factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByNameAsync(username)
            ?? throw new InvalidOperationException($"User {username} not found.");
        return user.Id;
    }

    private static FormUrlEncodedContent ResetForm(
        string userId, string token, string password, string? confirm = null) =>
        new(new Dictionary<string, string>
        {
            ["userId"] = userId,
            ["token"] = token,
            ["password"] = password,
            ["confirmPassword"] = confirm ?? password,
        });

    [Fact]
    public async Task ForgotPassword_Unknown_Email_Returns_Generic_Ok()
    {
        var client = _factory.CreateClient();

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/forgot-password", new { email = "nobody@test.local" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("password-reset email has been sent", body);
    }

    [Fact]
    public async Task ResetPassword_Sets_New_Password_And_Invalidates_Old()
    {
        var client = _factory.CreateClient();
        const string username = "reset_happy";
        const string oldPassword = "old-password-123";
        const string newPassword = "brand-new-password-456";
        await RegisterAsync(client, username, "reset_happy@test.local", oldPassword);

        var userId = await GetUserIdAsync(username);
        var token = await GenerateResetTokenAsync(username);

        var reset = await client.PostAsync("/auth/reset-password",
            ResetForm(userId, token, newPassword));
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        Assert.Contains("Password updated", await reset.Content.ReadAsStringAsync());

        // Old password no longer works.
        var oldLogin = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login", new { username, password = oldPassword });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);

        // New password works.
        var newLogin = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/login", new { username, password = newPassword });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_Rejects_Invalid_Token()
    {
        var client = _factory.CreateClient();
        const string username = "reset_badtoken";
        await RegisterAsync(client, username, "reset_badtoken@test.local", "old-password-123");

        var userId = await GetUserIdAsync(username);

        var reset = await client.PostAsync("/auth/reset-password",
            ResetForm(userId, "not-a-real-token", "brand-new-password-456"));

        Assert.Equal(HttpStatusCode.OK, reset.StatusCode); // HTML page, not JSON
        Assert.Contains("Link expired", await reset.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ResetPassword_Rejects_Mismatched_Confirmation()
    {
        var client = _factory.CreateClient();
        const string username = "reset_mismatch";
        await RegisterAsync(client, username, "reset_mismatch@test.local", "old-password-123");

        var userId = await GetUserIdAsync(username);
        var token = await GenerateResetTokenAsync(username);

        var reset = await client.PostAsync("/auth/reset-password",
            ResetForm(userId, token, "brand-new-password-456", confirm: "different-789"));

        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        var body = await reset.Content.ReadAsStringAsync();
        Assert.Contains("do not match", body);
        // The form is re-rendered so the user can retry.
        Assert.Contains("name=\"password\"", body);
    }

    [Fact]
    public async Task ResetPasswordForm_Returns_Form_For_Valid_Link()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync(
            "/auth/reset-password?userId=abc&token=xyz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Choose a new password", body);
        Assert.Contains("name=\"confirmPassword\"", body);
    }
}
