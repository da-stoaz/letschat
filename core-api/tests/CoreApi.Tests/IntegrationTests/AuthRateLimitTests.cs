using System.Net;
using CoreApi.Endpoints;
using CoreApi.Services;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// BUG_ANALYSIS A11: every auth endpoint shared one small per-IP bucket, so a
/// few requests of any kind from a CGNAT/VPN address locked everyone behind it
/// out of sign-in too. In-process test requests all come from one address,
/// which is exactly that situation.
/// </summary>
public sealed class AuthRateLimitTests
{
    private const string Password = "supersecret-test-1";

    private sealed class CapturingEmailSender : IEmailSender
    {
        public List<string> Sent { get; } = [];

        public Task SendAsync(string toAddress, string subject, string htmlBody, CancellationToken ct = default)
        {
            lock (Sent) Sent.Add(toAddress);
            return Task.CompletedTask;
        }
    }

    private static async Task<(WebApplicationFactory<Program> Factory, CapturingEmailSender Mail)> FactoryAsync(int permit)
    {
        var mail = new CapturingEmailSender();
        var factory = new LetsChatWebApplicationFactory().WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(mail);
            }));
        await factory.Services.GetRequiredService<SystemConfigService>().UpdateAsync(c =>
        {
            c.RateLimitPermitLimit = permit;
            c.RateLimitWindowSeconds = 300;
        });
        return (factory, mail);
    }

    private static Task<HttpResponseMessage> Register(HttpClient client, string username) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/register",
            new { username, displayName = username, password = Password, email = $"{username}@test.local" });

    private static Task<HttpResponseMessage> Login(HttpClient client, string username, string password = Password) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/login", new { username, password });

    private static Task<HttpResponseMessage> Forgot(HttpClient client, string email) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/forgot-password", new { email });

    [Fact]
    public async Task Exhausting_Other_Flows_Does_Not_Block_Sign_In_For_A_Shared_Address()
    {
        var (factory, _) = await FactoryAsync(permit: 3);
        using var _factory = factory;
        var client = factory.CreateClient();

        foreach (var name in new[] { "rl_a", "rl_b", "rl_c" })
            Assert.Equal(HttpStatusCode.OK, (await Register(client, name)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Register(client, "rl_d")).StatusCode);

        for (var i = 0; i < 3; i++) await Forgot(client, "rl_a@test.local");
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Forgot(client, "rl_a@test.local")).StatusCode);

        // Many people signing in from the same address, several times each.
        for (var round = 0; round < 5; round++)
            foreach (var name in new[] { "rl_a", "rl_b", "rl_c" })
                Assert.Equal(HttpStatusCode.OK, (await Login(client, name)).StatusCode);
    }

    [Fact]
    public async Task Username_Spraying_Still_Hits_The_Sign_In_Limit()
    {
        var (factory, _) = await FactoryAsync(permit: 3);
        using var _factory = factory;
        var client = factory.CreateClient();
        var budget = 3 * AuthEndpoints.LoginRateLimitMultiplier;

        for (var i = 0; i < budget; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Login(client, $"nobody_{i}", "wrong-password-1")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Login(client, "nobody_last", "wrong-password-1")).StatusCode);
    }

    [Fact]
    public async Task Mail_Per_Account_Is_Capped_Without_Revealing_It()
    {
        var (factory, mail) = await FactoryAsync(permit: 1000);
        using var _factory = factory;
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await Register(client, "rl_mail")).StatusCode);

        for (var i = 0; i < MailSendLimiter.MailsPerAccountPerHour + 2; i++)
            Assert.Equal(HttpStatusCode.OK, (await Forgot(client, "rl_mail@test.local")).StatusCode);

        Assert.Equal(MailSendLimiter.MailsPerAccountPerHour, mail.Sent.Count);
    }
}
