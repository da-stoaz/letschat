using System.Net;
using CoreApi.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// The blocked-login "confirm your email" screen only knows the username the
/// user typed, so <c>/auth/resend-confirmation</c> must re-send when given a
/// username (not just an email) — and stay generic for unknown accounts.
/// </summary>
public sealed class ResendConfirmationTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public ResendConfirmationTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    /// <summary>Records every address an email was sent to.</summary>
    private sealed class CapturingEmailSender : IEmailSender
    {
        public List<string> Sent { get; } = [];

        public Task SendAsync(string toAddress, string subject, string htmlBody, CancellationToken ct = default)
        {
            Sent.Add(toAddress);
            return Task.CompletedTask;
        }
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

    private (WebApplicationFactory<Program> Factory, CapturingEmailSender Sender) ConfirmationRequiredFactory()
    {
        var sender = new CapturingEmailSender();
        var factory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration(config =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["REQUIRE_EMAIL_CONFIRMATION"] = "true",
                }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(sender);
            });
        });
        return (factory, sender);
    }

    [Fact]
    public async Task Resend_By_Username_Resends_For_Unconfirmed_Account()
    {
        var (factory, sender) = ConfirmationRequiredFactory();
        using var _ = factory;
        var client = factory.CreateClient();

        var register = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register", NewRegisterPayload("resend_user", "resend@test.local"));
        Assert.Equal(HttpStatusCode.OK, register.StatusCode);
        Assert.Single(sender.Sent); // confirmation email sent at registration

        var resend = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/resend-confirmation", new { username = "resend_user" });

        Assert.Equal(HttpStatusCode.OK, resend.StatusCode);
        Assert.Equal(2, sender.Sent.Count); // confirmation re-sent
        Assert.All(sender.Sent, to => Assert.Equal("resend@test.local", to));
    }

    [Fact]
    public async Task Resend_By_Unknown_Username_Is_Generic_And_Sends_Nothing()
    {
        var (factory, sender) = ConfirmationRequiredFactory();
        using var _ = factory;
        var client = factory.CreateClient();

        var resend = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/resend-confirmation", new { username = "nobody_here" });

        Assert.Equal(HttpStatusCode.OK, resend.StatusCode);
        Assert.Empty(sender.Sent);
    }
}
