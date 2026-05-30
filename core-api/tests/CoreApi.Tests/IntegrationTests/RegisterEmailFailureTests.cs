using System.Net;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// Registration must not strand a half-created account when the (mandatory)
/// confirmation email can't be sent. With email confirmation required and a
/// transport that always fails, <c>/auth/register</c> should answer 503 and
/// leave no user behind — so the username/email free up for a clean retry.
/// </summary>
public sealed class RegisterEmailFailureTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public RegisterEmailFailureTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    /// <summary>Stands in for an unreachable SMTP server.</summary>
    private sealed class ThrowingEmailSender : IEmailSender
    {
        public Task SendAsync(
            string toAddress, string subject, string htmlBody, CancellationToken ct = default) =>
            throw new EmailDeliveryException("test: SMTP server unreachable");
    }

    private static object NewRegisterPayload(string username, string email) =>
        new
        {
            username,
            displayName = $"User {username}",
            password = "supersecret-test-1",
            email,
            spacetimeToken = "test-spacetime-token-" + Guid.NewGuid().ToString("N"),
            spacetimeIdentity = Guid.NewGuid().ToString("N"),
        };

    [Fact]
    public async Task Register_RollsBack_Account_When_Confirmation_Email_Fails()
    {
        using var factory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration(config =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["REQUIRE_EMAIL_CONFIRMATION"] = "true",
                }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender, ThrowingEmailSender>();
            });
        });

        var client = factory.CreateClient();
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register", NewRegisterPayload("emailfail", "emailfail@test.local"));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("confirmation email", body);

        // The account was rolled back — the username is free again.
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        Assert.Null(await users.FindByNameAsync("emailfail"));
    }
}
